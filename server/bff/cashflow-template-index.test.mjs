import { describe, expect, it } from 'vitest';
import {
  CELL_STATE,
  WEEKS_PER_YEAR,
  buildCashflowTemplateIndex,
  cashflowReadEtag,
  computeCatalogVersion,
  countCellStates,
  createRevisionCache,
  createSingleFlight,
  createYearMatrix,
  getCell,
  packCellStates,
  packYearMatrixFromMonths,
  readCellState,
  revisionCacheKey,
  setCell,
  walkWeeklyBalances,
  weekDirectionTotals,
} from './cashflow-template-index.mjs';

const TEMPLATE = { weeklyYears: [2026], annualYears: [2024, 2025, 2027, 2028, 2029, 2030, 2031, 2032] };

function makeIndex(extra = {}) {
  return buildCashflowTemplateIndex({ ...TEMPLATE, ...extra });
}

describe('catalog version', () => {
  it('is stable for the same contract and changes when line order changes', () => {
    const base = { lines: ['A_IN', 'B_OUT'], ...TEMPLATE };
    expect(computeCatalogVersion(base)).toBe(computeCatalogVersion({ ...base }));
    expect(computeCatalogVersion({ ...base, lines: ['B_OUT', 'A_IN'] }))
      .not.toBe(computeCatalogVersion(base));
  });
});

describe('week ordinal arithmetic', () => {
  const index = makeIndex();

  it('maps the fixed 60-cell grid to 0..59', () => {
    expect(index.weekOrdinal('2026-01', 1)).toBe(0);
    expect(index.weekOrdinal('2026-01', 5)).toBe(4);
    expect(index.weekOrdinal('2026-12', 5)).toBe(WEEKS_PER_YEAR - 1);
  });

  it('rejects annual-managed years — a stray weekly document cannot flip a year to weekly', () => {
    expect(index.weekOrdinal('2025-12', 4)).toBe(-1);
    expect(index.weekOrdinal('2024-03', 2)).toBe(-1);
    expect(index.isWeeklyManagedYear(2025)).toBe(false);
    expect(index.isAnnualManagedYear(2025)).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(index.weekOrdinal('2026-13', 1)).toBe(-1);
    expect(index.weekOrdinal('2026-01', 6)).toBe(-1);
    expect(index.weekOrdinal('', 1)).toBe(-1);
  });
});

describe('dense year matrix', () => {
  const index = makeIndex();

  it('round-trips readModel months into O(1) cell lookups', () => {
    const months = [
      { yearMonth: '2026-08', projection: { weeks: [{ weekNo: 4, amounts: { SALES_IN: 100_000_000 } }] } },
      { yearMonth: '2026-08', projection: { weeks: [{ weekNo: 5, amounts: { TEAM_SUPPORT_OUT: 90_000_000 } }] } },
      { yearMonth: '2025-12', projection: { weeks: [{ weekNo: 4, amounts: { SALES_IN: 7_582_243 } }] } },
    ];
    const matrix = packYearMatrixFromMonths(index, months, 'projection');
    expect(getCell(index, matrix, 'SALES_IN', '2026-08', 4)).toBe(100_000_000);
    expect(getCell(index, matrix, 'TEAM_SUPPORT_OUT', '2026-08', 5)).toBe(90_000_000);
    // 연 단위 관리 연도의 낙오 주차 값은 행렬에 들어오지 못한다.
    expect(getCell(index, matrix, 'SALES_IN', '2025-12', 4)).toBe(0);
  });

  it('matches a hand-computed balance walk', () => {
    const matrix = createYearMatrix(index);
    setCell(index, matrix, 'SALES_IN', '2026-01', 2, 1000);
    setCell(index, matrix, 'DIRECT_COST_OUT', '2026-01', 1, 300);
    const { totalIn, totalOut } = weekDirectionTotals(index, matrix);
    const balances = walkWeeklyBalances(totalIn, totalOut, 0);
    expect(balances[0]).toBe(-300);
    expect(balances[1]).toBe(700);
    expect(balances[WEEKS_PER_YEAR - 1]).toBe(700);
  });
});

describe('2-bit cell states', () => {
  it('round-trips all four states across a full 960-cell year', () => {
    const cellCount = 16 * WEEKS_PER_YEAR;
    const codes = Array.from({ length: cellCount }, (_, i) => i % 4);
    const packed = packCellStates(codes);
    expect(packed.byteLength).toBe(cellCount / 4);
    for (let i = 0; i < cellCount; i += 1) expect(readCellState(packed, i)).toBe(i % 4);
    expect(countCellStates(packed, cellCount)).toEqual({ EMPTY: 240, ZERO: 240, VALUE: 240, INVALID: 240 });
  });

  it('detects corruption — counts change when a byte flips', () => {
    const packed = packCellStates([CELL_STATE.VALUE, CELL_STATE.VALUE, CELL_STATE.VALUE, CELL_STATE.VALUE]);
    const before = countCellStates(packed, 4);
    packed[0] ^= 0b11;
    expect(countCellStates(packed, 4)).not.toEqual(before);
  });
});

describe('calendar memo', () => {
  it('calls the provider once per yearMonth', () => {
    let calls = 0;
    const index = makeIndex({ weekProvider: () => { calls += 1; return [{ weekNo: 1 }]; } });
    index.financeWeeks('2026-08');
    index.financeWeeks('2026-08');
    index.financeWeeks('2026-09');
    expect(calls).toBe(2);
  });
});

describe('revision cache and single flight', () => {
  it('evicts the least recently used entry and refreshes on hit', () => {
    const cache = createRevisionCache({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('coalesces concurrent identical fetches into one execution', async () => {
    const flight = createSingleFlight();
    let executions = 0;
    const fetcher = async () => { executions += 1; return 'result'; };
    const key = revisionCacheKey({ catalogVersion: 'v', tenantId: 'mysc', projectId: 'p1', scope: 'MONTH:2026-08', revision: 'r7' });
    const results = await Promise.all([flight(key, fetcher), flight(key, fetcher), flight(key, fetcher)]);
    expect(results).toEqual(['result', 'result', 'result']);
    expect(executions).toBe(1);
  });

  it('produces a different etag when the revision moves', () => {
    const base = { catalogVersion: 'v1', scope: 'MONTH:2026-08' };
    expect(cashflowReadEtag({ ...base, revision: 'r1' })).not.toBe(cashflowReadEtag({ ...base, revision: 'r2' }));
    expect(cashflowReadEtag({ ...base, revision: 'r1' })).toBe(cashflowReadEtag({ ...base, revision: 'r1' }));
  });
});

describe('benchmark: fixed-template index vs sequential find-chains', () => {
  it('reports the measured speedup for cell lookups', () => {
    const index = makeIndex();
    const lineIds = index.lineIds;
    // 현행 canonicalCashflowWeeks 형태의 자료구조 재현: months[].projection.weeks[].amounts
    const months = [];
    for (let m = 1; m <= 12; m += 1) {
      const weeks = [];
      for (let w = 1; w <= 5; w += 1) {
        const amounts = {};
        for (const lineId of lineIds) amounts[lineId] = m * 100 + w;
        weeks.push({ weekNo: w, amounts });
      }
      months.push({ yearMonth: `2026-${String(m).padStart(2, '0')}`, projection: { weeks } });
    }
    const matrix = packYearMatrixFromMonths(index, months, 'projection');

    const probes = [];
    for (let i = 0; i < 50_000; i += 1) {
      probes.push({
        lineId: lineIds[i % lineIds.length],
        yearMonth: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
        weekNo: (i % 5) + 1,
      });
    }

    const naiveStart = performance.now();
    let naiveSum = 0;
    for (const probe of probes) {
      const month = months.find((item) => item.yearMonth === probe.yearMonth);
      const week = month?.projection.weeks.find((item) => item.weekNo === probe.weekNo);
      naiveSum += week?.amounts[probe.lineId] || 0;
    }
    const naiveMs = performance.now() - naiveStart;

    const indexedStart = performance.now();
    let indexedSum = 0;
    for (const probe of probes) {
      indexedSum += getCell(index, matrix, probe.lineId, probe.yearMonth, probe.weekNo);
    }
    const indexedMs = performance.now() - indexedStart;

    expect(indexedSum).toBe(naiveSum);
    const speedup = naiveMs / indexedMs;
    console.log(`[bench] 50k lookups — find-chain: ${naiveMs.toFixed(1)}ms, indexed: ${indexedMs.toFixed(1)}ms, speedup: ${speedup.toFixed(1)}x`);
    expect(indexedMs).toBeLessThan(naiveMs);
  });

  it('reports the measured speedup for the polling pipeline (rebuild-per-request vs revision cache)', () => {
    const index = makeIndex();
    const lineIds = index.lineIds;
    const inLines = lineIds.filter((_, i) => index.inLineIndexes.includes(i));
    const outLines = lineIds.filter((_, i) => index.outLineIndexes.includes(i));
    const months = [];
    for (let m = 1; m <= 12; m += 1) {
      const weeks = [];
      for (let w = 1; w <= 5; w += 1) {
        const amounts = {};
        for (const lineId of lineIds) amounts[lineId] = m * 100 + w;
        weeks.push({ weekNo: w, amounts });
      }
      months.push({ yearMonth: `2026-${String(m).padStart(2, '0')}`, projection: { weeks } });
    }
    const REQUESTS = 1_000; // 폴링: revision 이 안 변한 채 반복되는 대시보드 요청

    // 현행: 요청마다 주차 배열 재구축 + 라인 합산 + 잔액 걷기
    const naiveStart = performance.now();
    let naiveLast = 0;
    for (let r = 0; r < REQUESTS; r += 1) {
      const weeks = [];
      for (const month of months) {
        for (let w = 1; w <= 5; w += 1) {
          const week = month.projection.weeks.find((item) => item.weekNo === w);
          weeks.push({ yearMonth: month.yearMonth, weekNo: w, projection: week?.amounts || {} });
        }
      }
      let balance = 0;
      for (const week of weeks) {
        const totalIn = inLines.reduce((sum, lineId) => sum + (week.projection[lineId] || 0), 0);
        const totalOut = outLines.reduce((sum, lineId) => sum + (week.projection[lineId] || 0), 0);
        balance += totalIn - totalOut;
      }
      naiveLast = balance;
    }
    const naiveMs = performance.now() - naiveStart;

    // 인덱스 + revision 캐시: 같은 revision 이면 팩·합산·걷기를 재사용
    const cache = createRevisionCache({ maxEntries: 8 });
    const key = revisionCacheKey({ catalogVersion: index.catalogVersion, tenantId: 'mysc', projectId: 'p1', scope: 'YEAR:2026', revision: 'r1' });
    const cachedStart = performance.now();
    let cachedLast = 0;
    for (let r = 0; r < REQUESTS; r += 1) {
      let entry = cache.get(key);
      if (!entry) {
        const matrix = packYearMatrixFromMonths(index, months, 'projection');
        const { totalIn, totalOut } = weekDirectionTotals(index, matrix);
        entry = { balances: walkWeeklyBalances(totalIn, totalOut, 0) };
        cache.set(key, entry);
      }
      cachedLast = entry.balances[WEEKS_PER_YEAR - 1];
    }
    const cachedMs = performance.now() - cachedStart;

    expect(cachedLast).toBe(naiveLast);
    console.log(`[bench] ${REQUESTS} polling requests — rebuild: ${naiveMs.toFixed(1)}ms, cached: ${cachedMs.toFixed(2)}ms, speedup: ${(naiveMs / cachedMs).toFixed(0)}x`);
    expect(cachedMs).toBeLessThan(naiveMs);
  });
});
