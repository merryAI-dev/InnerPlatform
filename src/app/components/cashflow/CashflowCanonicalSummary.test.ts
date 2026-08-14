import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CashflowCanonicalSummary } from './CashflowCanonicalSummary';

const render = (props: Parameters<typeof CashflowCanonicalSummary>[0]) => (
  renderToStaticMarkup(createElement(CashflowCanonicalSummary, props))
);

describe('CashflowCanonicalSummary', () => {
  it('renders the server display contract without rebuilding labels from settlement fields', () => {
    const html = render({ summary: {
      projectId: 'axr', fromMonth: '2023-01',
      comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 4 },
      settlementDifferenceAmount: 18_371_453, settlementMatches: false,
      display: {
        periodLabel: '서버 누적 범위',
        statusLabel: '서버 판정',
        statusTone: 'success',
        differenceLabel: '서버 차액 문자열',
      },
    } });
    expect(html).toContain('서버 누적 범위');
    expect(html).toContain('서버 판정');
    expect(html).toContain('서버 차액 문자열');
    expect(html).not.toContain('누적 2023-01~2026-08 4주차');
    expect(html).not.toContain('18,371,453원');
  });

  it('does not infer a match label from an exact zero', () => {
    const html = render({ summary: {
      projectId: 'axr', fromMonth: '2023-01',
      comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 4 },
      settlementDifferenceAmount: 0, settlementMatches: true,
      display: {
        periodLabel: '누적 표시',
        statusLabel: '서버 확인 완료',
        statusTone: 'success',
        differenceLabel: '서버 금액 표시',
      },
    } });
    expect(html).toContain('서버 확인 완료');
    expect(html).toContain('서버 금액 표시');
    expect(html).not.toContain('일치 · 100%');
    expect(html).not.toContain('차액 0원');
  });

  it('shows unavailable when the server display contract is missing', () => {
    const html = render({ summary: {
      projectId: 'axr', fromMonth: '2023-01',
      comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 4 },
      settlementDifferenceAmount: 0, settlementMatches: true,
    } as unknown as NonNullable<Parameters<typeof CashflowCanonicalSummary>[0]['summary']> });
    expect(html).toContain('확인 불가');
    expect(html).not.toContain('일치 · 100%');
  });

  it('keeps loading and retryable error states explicit', () => {
    expect(render({ loading: true })).toContain('확인 중');
    const error = render({ error: true, onRetry: () => {} });
    expect(error).toContain('확인 불가');
    expect(error).toContain('다시 조회');
  });

  it('keeps prior canonical data visible when a retry later fails', () => {
    const html = render({
      summary: {
        projectId: 'axr', fromMonth: '2023-01',
        comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 4 },
        settlementDifferenceAmount: 18_371_453, settlementMatches: false,
        display: {
          periodLabel: '누적 표시', statusLabel: '서버 판정', statusTone: 'danger', differenceLabel: '서버 차액',
        },
      },
      error: true,
      onRetry: () => {},
    });
    expect(html).toContain('서버 차액');
    expect(html).toContain('최신 조회 실패');
    expect(html).not.toContain('role="alert"');
  });
});
