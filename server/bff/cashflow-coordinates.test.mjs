import { describe, expect, it } from 'vitest';
import cashflowPolicyData from '../../policies/cashflow-policy.json' with { type: 'json' };
import {
  ANNUAL_COLUMNS_AFTER,
  ANNUAL_COLUMNS_BEFORE,
  CashflowTemplateMismatchError,
  LINE_IDS,
  LINE_ROWS,
  WEEKS_PER_YEAR,
  annualColumnFor,
  annualYearsFor,
  isWeeklyMonth,
  lineIndexOfRow,
  lineRowFor,
  weekColumnFor,
  weekOrdinal,
} from './cashflow-coordinates.mjs';

const WEEKLY_YEAR = 2026;

describe('좌표 계약', () => {
  it('주별 블록은 60칸이고 E:BL 을 채운다', () => {
    expect(WEEKS_PER_YEAR).toBe(60);
    expect(weekColumnFor(WEEKLY_YEAR, '2026-01', 1)).toBe(4);
    expect(weekColumnFor(WEEKLY_YEAR, '2026-12', 5)).toBe(63);
  });

  it('연간 연도는 주별 연도 이전 2개 · 이후 6개로 좌표가 결정한다', () => {
    expect(annualYearsFor(WEEKLY_YEAR)).toEqual([2024, 2025, 2027, 2028, 2029, 2030, 2031, 2032]);
    expect(annualColumnFor(WEEKLY_YEAR, 2024)).toBe(ANNUAL_COLUMNS_BEFORE[0]);
    expect(annualColumnFor(WEEKLY_YEAR, 2025)).toBe(ANNUAL_COLUMNS_BEFORE[1]);
    expect(annualColumnFor(WEEKLY_YEAR, 2027)).toBe(ANNUAL_COLUMNS_AFTER[0]);
    expect(annualColumnFor(WEEKLY_YEAR, 2032)).toBe(ANNUAL_COLUMNS_AFTER[5]);
  });

  it('라인 정체성은 행 인덱스이며 정책 순서와 1:1 대응한다', () => {
    expect(LINE_IDS).toHaveLength(16);
    expect(LINE_ROWS.projection).toHaveLength(LINE_IDS.length);
    expect(LINE_ROWS.actual).toHaveLength(LINE_IDS.length);
    for (const [index, lineId] of LINE_IDS.entries()) {
      expect(lineIndexOfRow('projection', lineRowFor('projection', index))).toBe(index);
      expect(lineIndexOfRow('actual', lineRowFor('actual', index))).toBe(index);
      expect(cashflowPolicyData.lineEntries[index].lineId).toBe(lineId);
    }
  });

  it('입금 7행 · 출금 9행 배치가 시트 계약과 같다', () => {
    expect(LINE_IDS.filter((id) => id.endsWith('_IN'))).toHaveLength(7);
    expect(LINE_IDS.filter((id) => id.endsWith('_OUT'))).toHaveLength(9);
    // 21/31/32 (합계·잔액) 과 44/54/55 는 라인 행이 아니다.
    for (const derived of [21, 31, 32]) expect(LINE_ROWS.projection).not.toContain(derived);
    for (const derived of [44, 54, 55]) expect(LINE_ROWS.actual).not.toContain(derived);
  });
});

describe('좌표 밖은 존재하지 않는다', () => {
  it.each([
    ['연 단위 관리 이전 연도', '2025-12', 4],
    ['연 단위 관리 이후 연도', '2027-01', 1],
    ['5주를 넘는 주차', '2026-03', 6],
    ['0주차', '2026-03', 0],
  ])('낙오 문서 %s 는 행렬에 진입하지 못한다', (_label, yearMonth, weekNo) => {
    expect(weekOrdinal(WEEKLY_YEAR, yearMonth, weekNo)).toBe(-1);
    expect(weekColumnFor(WEEKLY_YEAR, yearMonth, weekNo)).toBe(-1);
  });

  it('실제 낙오 문서 p1773651024850-2025-12-w4 를 거부한다', () => {
    expect(isWeeklyMonth(WEEKLY_YEAR, '2025-12')).toBe(false);
    expect(weekOrdinal(WEEKLY_YEAR, '2025-12', 4)).toBe(-1);
  });

  it('양식이 다르면 적응하지 않고 거부한다', () => {
    expect(() => annualYearsFor(1999)).toThrow(CashflowTemplateMismatchError);
    expect(() => lineRowFor('projection', 16)).toThrow(CashflowTemplateMismatchError);
    expect(() => lineRowFor('unknown', 0)).toThrow(CashflowTemplateMismatchError);
    expect(() => annualYearsFor(1999)).toThrow('양식이 다릅니다.');
  });
});

describe('사보타주', () => {
  it('주차 산술에 오프바이원이 있으면 좌표가 어긋난다', () => {
    // (month-1)*5 + (week-1) 이 아닌 값이면 마지막 칸이 BL(63)을 벗어난다.
    const last = weekOrdinal(WEEKLY_YEAR, '2026-12', 5);
    expect(last).toBe(59);
    expect(last + 1).toBe(WEEKS_PER_YEAR);
  });

  it('연간 연도 하나가 빠지면 열 매핑이 깨진다', () => {
    const years = annualYearsFor(WEEKLY_YEAR);
    expect(years).toHaveLength(ANNUAL_COLUMNS_BEFORE.length + ANNUAL_COLUMNS_AFTER.length);
    expect(new Set(years).size).toBe(years.length);
    expect(years).not.toContain(WEEKLY_YEAR);
  });
});
