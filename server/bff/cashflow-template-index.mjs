import { createHash } from 'node:crypto';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from './cashflow-policy.mjs';

// 전사 고정 양식(주차 그리드 12개월 × 5주, 라인 카탈로그)을 상수로 활용하는
// 읽기 전용 인덱스. 셀 좌표를 문자열 키 탐색 대신 산술 인덱스로 바꾼다.
export const WEEKS_PER_MONTH = 5;
export const MONTHS_PER_YEAR = 12;
export const WEEKS_PER_YEAR = WEEKS_PER_MONTH * MONTHS_PER_YEAR;

export const CELL_STATE = Object.freeze({ EMPTY: 0, ZERO: 1, VALUE: 2, INVALID: 3 });
const CELL_STATE_NAMES = ['EMPTY', 'ZERO', 'VALUE', 'INVALID'];

// 템플릿 계약이 바뀌면 파생 캐시가 전부 자동 무효화되도록 버전을 해시로 만든다.
export function computeCatalogVersion({ lines, weeklyYears, annualYears }) {
  const canonical = JSON.stringify({
    lines,
    weeklyYears: [...weeklyYears].sort(),
    annualYears: [...annualYears].sort(),
    weeksPerMonth: WEEKS_PER_MONTH,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export function buildCashflowTemplateIndex({
  lines = CASHFLOW_ALL_LINES,
  inLines = CASHFLOW_IN_LINES,
  outLines = CASHFLOW_OUT_LINES,
  weeklyYears,
  annualYears,
  weekProvider,
} = {}) {
  if (!Array.isArray(weeklyYears) || !Array.isArray(annualYears)) {
    throw new TypeError('weeklyYears and annualYears must come from the template contract.');
  }
  const lineIndex = new Map(lines.map((lineId, i) => [lineId, i]));
  const weeklyYearSet = new Set(weeklyYears.map(Number));
  const annualYearSet = new Set(annualYears.map(Number));
  const calendarMemo = new Map();
  const monthBaseMemo = new Map();
  return {
    catalogVersion: computeCatalogVersion({ lines, weeklyYears, annualYears }),
    lineCount: lines.length,
    lineIds: [...lines],
    inLineIndexes: inLines.map((lineId) => lineIndex.get(lineId)).filter((i) => i !== undefined),
    outLineIndexes: outLines.map((lineId) => lineIndex.get(lineId)).filter((i) => i !== undefined),
    lineIndexOf: (lineId) => {
      const i = lineIndex.get(lineId);
      return i === undefined ? -1 : i;
    },
    isWeeklyManagedYear: (year) => weeklyYearSet.has(Number(year)),
    isAnnualManagedYear: (year) => annualYearSet.has(Number(year)),
    // "이 연도가 주별 관리인가"는 문서 존재 여부가 아니라 템플릿 계약이 답한다.
    // 연월 문자열은 유한집합(주별 연도당 12개)이므로 검증 결과를 인터닝한다 —
    // 정규식·파싱은 문자열당 1회, 이후 조회는 Map 1회 + 산술이다.
    weekOrdinal(yearMonth, weekNo) {
      const raw = String(yearMonth || '');
      let monthBase = monthBaseMemo.get(raw);
      if (monthBase === undefined) {
        monthBase = /^20\d{2}-(0[1-9]|1[0-2])$/.test(raw) && weeklyYearSet.has(Number(raw.slice(0, 4)))
          ? (Number(raw.slice(5, 7)) - 1) * WEEKS_PER_MONTH
          : -1;
        monthBaseMemo.set(raw, monthBase);
      }
      if (monthBase < 0) return -1;
      const week = Number(weekNo);
      if (!Number.isInteger(week) || week < 1 || week > WEEKS_PER_MONTH) return -1;
      return monthBase + week - 1;
    },
    // 재무주차 달력은 결정적(SPEC-21)이므로 프로세스 수명 동안 무효화 없이 메모한다.
    financeWeeks(yearMonth) {
      if (calendarMemo.has(yearMonth)) return calendarMemo.get(yearMonth);
      const weeks = typeof weekProvider === 'function' ? weekProvider(yearMonth) : [];
      calendarMemo.set(yearMonth, weeks);
      return weeks;
    },
  };
}

// 주별 관리 연도 한 해 = lineCount × 60 밀집 행렬. 셀 조회가 O(1) 산술이 된다.
export function createYearMatrix(index) {
  return new Float64Array(index.lineCount * WEEKS_PER_YEAR);
}

export function setCell(index, matrix, lineId, yearMonth, weekNo, amount) {
  const line = index.lineIndexOf(lineId);
  const week = index.weekOrdinal(yearMonth, weekNo);
  if (line < 0 || week < 0) return false;
  matrix[line * WEEKS_PER_YEAR + week] = Number(amount) || 0;
  return true;
}

export function getCell(index, matrix, lineId, yearMonth, weekNo) {
  const line = index.lineIndexOf(lineId);
  const week = index.weekOrdinal(yearMonth, weekNo);
  if (line < 0 || week < 0) return 0;
  return matrix[line * WEEKS_PER_YEAR + week];
}

export function packYearMatrixFromMonths(index, months, mode) {
  const matrix = createYearMatrix(index);
  for (const month of Array.isArray(months) ? months : []) {
    const yearMonth = month?.yearMonth;
    for (const week of Array.isArray(month?.[mode]?.weeks) ? month[mode].weeks : []) {
      const amounts = week?.amounts && typeof week.amounts === 'object' ? week.amounts : {};
      for (const [lineId, amount] of Object.entries(amounts)) {
        setCell(index, matrix, lineId, yearMonth, week.weekNo, amount);
      }
    }
  }
  return matrix;
}

// 주차별 입금/출금 합계와 누적 잔액 걷기. 검사 4종이 재순회 없이 이 결과를 공유한다.
export function weekDirectionTotals(index, matrix) {
  const totalIn = new Float64Array(WEEKS_PER_YEAR);
  const totalOut = new Float64Array(WEEKS_PER_YEAR);
  for (const line of index.inLineIndexes) {
    const base = line * WEEKS_PER_YEAR;
    for (let week = 0; week < WEEKS_PER_YEAR; week += 1) totalIn[week] += matrix[base + week];
  }
  for (const line of index.outLineIndexes) {
    const base = line * WEEKS_PER_YEAR;
    for (let week = 0; week < WEEKS_PER_YEAR; week += 1) totalOut[week] += matrix[base + week];
  }
  return { totalIn, totalOut };
}

export function walkWeeklyBalances(totalIn, totalOut, openingBalance = 0) {
  const balances = new Float64Array(WEEKS_PER_YEAR);
  let balance = Number(openingBalance) || 0;
  for (let week = 0; week < WEEKS_PER_YEAR; week += 1) {
    balance += totalIn[week] - totalOut[week];
    balances[week] = balance;
  }
  return balances;
}

// 셀 상태 4종은 2비트면 충분하다. 960셀 = 240바이트 — 문자열 맵 대비 약 100배 절감.
export function packCellStates(codes) {
  const packed = new Uint8Array(Math.ceil(codes.length / 4));
  for (let i = 0; i < codes.length; i += 1) {
    packed[i >> 2] |= (codes[i] & 0b11) << ((i & 0b11) * 2);
  }
  return packed;
}

export function readCellState(packed, ordinal) {
  return (packed[ordinal >> 2] >> ((ordinal & 0b11) * 2)) & 0b11;
}

export function countCellStates(packed, cellCount) {
  const counts = { EMPTY: 0, ZERO: 0, VALUE: 0, INVALID: 0 };
  for (let i = 0; i < cellCount; i += 1) {
    counts[CELL_STATE_NAMES[readCellState(packed, i)]] += 1;
  }
  return counts;
}

// revision(저장된 식별자)을 키로 쓰는 캐시. 내용 해시를 재계산하지 않으므로
// 판정 SSOT(JVM)를 침범하지 않는다. 키가 바뀌면 항목은 자연히 미적중이 된다.
export function revisionCacheKey({ catalogVersion, tenantId, projectId, scope, revision }) {
  return `${catalogVersion}|${tenantId}|${projectId}|${scope}|${revision}`;
}

export function createRevisionCache({ maxEntries = 128 } = {}) {
  const entries = new Map();
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    size: () => entries.size,
  };
}

// 같은 (프로젝트, 범위, revision) 요청이 동시에 오면 Firestore 조회를 1회로 합친다.
export function createSingleFlight() {
  const inflight = new Map();
  return function run(key, fetcher) {
    if (inflight.has(key)) return inflight.get(key);
    const promise = Promise.resolve()
      .then(fetcher)
      .finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };
}

// 브라우저 재검증용 강한 ETag. revision이 같으면 본문 재조립 없이 304.
export function cashflowReadEtag({ catalogVersion, scope, revision }) {
  const digest = createHash('sha256')
    .update(`${catalogVersion}|${scope}|${revision}`)
    .digest('base64url')
    .slice(0, 16);
  return `"cf-${digest}"`;
}
