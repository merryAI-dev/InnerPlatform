import { describe, expect, it } from 'vitest';

import { buildCashflowOpsSummary } from './cashflow-ops-summary';

const weeks = [
  { key: '2026-06:1', label: '26-6-1', weekStart: '2026-06-03', weekEnd: '2026-06-09', projectionWritten: true, actualWritten: true, adminClosed: true },
  { key: '2026-06:2', label: '26-6-2', weekStart: '2026-06-10', weekEnd: '2026-06-16', projectionWritten: true, actualWritten: false, adminClosed: false },
  { key: '2026-06:3', label: '26-6-3', weekStart: '2026-06-17', weekEnd: '2026-06-23', projectionWritten: false, actualWritten: false, adminClosed: false },
  { key: '2026-07:1', label: '26-7-1', weekStart: '2026-07-01', weekEnd: '2026-07-07', projectionWritten: false, actualWritten: false, adminClosed: false },
];

describe('cashflow ops summary', () => {
  it('builds settlement status, actionable inbox items, and writing rates', () => {
    const summary = buildCashflowOpsSummary({
      asOfDate: '2026-06-17',
      weeks,
      diffCellCount: 3,
      labor: {
        nextMonthProjectionWritten: false,
        missingProjectionMonthCount: 1,
        shortageStatus: 'ok',
        shortageWeekLabel: null,
        shortageAmount: 0,
      },
      lastEditedLabel: '보람이 06.17 18:15 수정',
    });

    expect(summary.status.kind).toBe('blocked');
    expect(summary.status.label).toBe('확인 필요');
    expect(summary.status.detail).toBe('이번 주 기준 3개 확인 항목이 있습니다.');
    expect(summary.rates.projection).toMatchObject({ done: 2, total: 3 });
    expect(summary.rates.actual).toMatchObject({ done: 1, total: 3 });
    expect(summary.rates.closed).toMatchObject({ done: 1, total: 3 });
    expect(summary.rates.projection.missingLabels).toEqual(['26-6-3']);
    expect(summary.rates.actual.missingLabels).toEqual(['26-6-2', '26-6-3']);
    expect(summary.rates.closed.missingLabels).toEqual(['26-6-2', '26-6-3']);
    expect(summary.inbox.map((item) => item.title)).toEqual([
      'Actual 미작성 주차 2건',
      'Projection 미작성 주차 1건',
      'Projection/Actual 차이 3건',
      '다음 달 인건비 Projection 미작성',
    ]);
    expect(summary.timelineCounts).toMatchObject({ record: 1, computed: 1, system: 0 });
    expect(summary.timeline).toContainEqual(expect.objectContaining({
      title: '마지막 수정',
      tone: 'info',
      source: 'record',
      sourceLabel: '기록',
    }));
    expect(summary.timeline).toContainEqual(expect.objectContaining({
      title: '차이 확인 필요',
      source: 'computed',
      sourceLabel: '계산',
    }));
    expect(summary.timeline.some((item) => 'fieldLabel' in item)).toBe(false);
  });

  it('marks settlement as available when due weeks are written, no diffs exist, and labor risk is clear', () => {
    const summary = buildCashflowOpsSummary({
      asOfDate: '2026-06-17',
      weeks: weeks.map((week) => ({
        ...week,
        projectionWritten: week.key === '2026-07:1' ? false : true,
        actualWritten: week.key === '2026-07:1' ? false : true,
        adminClosed: week.key === '2026-07:1' ? false : true,
      })),
      diffCellCount: 0,
      labor: {
        nextMonthProjectionWritten: true,
        missingProjectionMonthCount: 0,
        shortageStatus: 'ok',
        shortageWeekLabel: null,
        shortageAmount: 0,
      },
      lastEditedLabel: '',
    });

    expect(summary.status.kind).toBe('ready');
    expect(summary.status.label).toBe('결산 가능');
    expect(summary.status.detail).toBe('이번 주 기준 확인 항목이 없습니다.');
    expect(summary.inbox[0].title).toBe('확인할 항목이 없습니다');
    expect(summary.timelineCounts).toEqual({ record: 0, computed: 0, system: 1 });
    expect(summary.timeline[0]).toMatchObject({
      title: '운영 로그 대기',
      source: 'system',
      sourceLabel: '시스템',
    });
  });

  it('surfaces balance shortage as a danger inbox item and timeline event', () => {
    const summary = buildCashflowOpsSummary({
      asOfDate: '2026-06-17',
      weeks: weeks.map((week) => ({ ...week, projectionWritten: true, actualWritten: true })),
      diffCellCount: 0,
      labor: {
        nextMonthProjectionWritten: true,
        missingProjectionMonthCount: 0,
        shortageStatus: 'danger',
        shortageWeekLabel: '26-8-2',
        shortageAmount: 18_200_000,
      },
      lastEditedLabel: '',
    });

    expect(summary.status.kind).toBe('blocked');
    expect(summary.inbox[0]).toMatchObject({ tone: 'danger', title: '잔액 부족 예상' });
    expect(summary.timeline).toContainEqual(expect.objectContaining({
      title: '잔액 부족 예상',
      source: 'computed',
    }));
    expect(summary.timeline.some((item) => 'fieldLabel' in item)).toBe(false);
  });
});
