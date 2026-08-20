import { describe, expect, it } from 'vitest';
import { resolvePortalMonthlyCloseProgress } from './cashflow-portal-settlement';

describe('portal monthly close progress', () => {
  it('maps JVM closed and request-approved states to complete', () => {
    expect(resolvePortalMonthlyCloseProgress({ available: true, closeStatus: 'CLOSED' })).toMatchObject({ percent: 100, label: '월 결산 완료' });
    expect(resolvePortalMonthlyCloseProgress({ available: true, closeStatus: 'OPEN', requestStatus: 'APPROVED' })).toMatchObject({ percent: 100, label: '월 결산 완료' });
  });

  it('keeps pending and reopen states visible as an incomplete workflow', () => {
    expect(resolvePortalMonthlyCloseProgress({ available: true, closeStatus: 'OPEN', requestStatus: 'PENDING' })).toMatchObject({ percent: 50, label: '조직장 승인 대기' });
    expect(resolvePortalMonthlyCloseProgress({ available: true, closeStatus: 'REOPEN_REQUESTED' })).toMatchObject({ percent: 50, label: '조직장 승인 대기' });
  });

  it('does not infer missing next-month data as zero progress', () => {
    expect(resolvePortalMonthlyCloseProgress({ available: false })).toMatchObject({ percent: null, label: '확인 불가' });
    expect(resolvePortalMonthlyCloseProgress({ available: true, closeStatus: 'OPEN' })).toMatchObject({ percent: 0, label: '실무자 요청 전' });
  });
});
