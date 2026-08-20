export type PortalMonthlyCloseProgress = {
  percent: number | null;
  label: string;
  tone: 'neutral' | 'warning' | 'success';
};

// 서버가 준 상태만 표시한다. 다음 월에 요청 기록이 없으면 완료 단계를 추정하지 않는다.
export function resolvePortalMonthlyCloseProgress(input: {
  available: boolean;
  closeStatus?: string | null;
  requestStatus?: string | null;
}): PortalMonthlyCloseProgress {
  if (!input.available) return { percent: null, label: '확인 불가', tone: 'neutral' };

  const closeStatus = String(input.closeStatus || '').toUpperCase();
  const requestStatus = String(input.requestStatus || '').toUpperCase();
  if (closeStatus === 'CLOSED' || (requestStatus === 'APPROVED' && closeStatus !== 'REOPEN_REQUESTED')) {
    return { percent: 100, label: '월 결산 완료', tone: 'success' };
  }
  if (closeStatus === 'REOPEN_REQUESTED' || ['PENDING', 'APPROVING', 'UNCERTAIN', 'REOPEN_REQUESTED'].includes(requestStatus)) {
    return { percent: 50, label: '조직장 승인 대기', tone: 'warning' };
  }
  if (closeStatus === 'OPEN') return { percent: 0, label: '실무자 요청 전', tone: 'neutral' };
  return { percent: null, label: '확인 불가', tone: 'neutral' };
}
