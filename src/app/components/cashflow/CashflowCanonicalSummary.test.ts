import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CashflowCanonicalSummary } from './CashflowCanonicalSummary';

const render = (props: Parameters<typeof CashflowCanonicalSummary>[0]) => (
  renderToStaticMarkup(createElement(CashflowCanonicalSummary, props))
);

describe('CashflowCanonicalSummary', () => {
  it('shows the exact JVM cumulative amount and boundary without using selected-week detail', () => {
    const html = render({ summary: {
      projectId: 'axr', fromMonth: '2023-01',
      comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 4 },
      settlementDifferenceAmount: 18_371_453, settlementMatches: false,
    } });
    expect(html).toContain('누적 2023-01~2026-08 4주차');
    expect(html).toContain('불일치');
    expect(html).toContain('18,371,453원');
    expect(html).not.toContain('12,371,453');
    expect(html).not.toContain('6,370,000');
  });

  it('maps an exact zero only to the JVM match state and 100 percent', () => {
    const html = render({ summary: {
      projectId: 'axr', fromMonth: '2023-01',
      comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 4 },
      settlementDifferenceAmount: 0, settlementMatches: true,
    } });
    expect(html).toContain('일치 · 100%');
    expect(html).toContain('차액 0원');
  });

  it('keeps loading and retryable error states explicit', () => {
    expect(render({ loading: true })).toContain('확인 중');
    const error = render({ error: true, onRetry: () => {} });
    expect(error).toContain('조회 오류');
    expect(error).toContain('다시 조회');
  });

  it('keeps prior canonical data visible when a retry later fails', () => {
    const html = render({
      summary: {
        projectId: 'axr', fromMonth: '2023-01',
        comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 4 },
        settlementDifferenceAmount: 18_371_453, settlementMatches: false,
      },
      error: true,
      onRetry: () => {},
    });
    expect(html).toContain('18,371,453원');
    expect(html).toContain('최신 조회 실패');
    expect(html).not.toContain('role="alert"');
  });
});
