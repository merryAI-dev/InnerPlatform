// 월 결산 카드의 안내는 한 줄이다. 서버가 버튼마다 "왜 못 하는지"를 주지만 그걸 다 나열하면
// 정보가 아니다(2026-08-19 보람). 지금 상태에서 결정적인 것 하나만 고르고, 그것만 강조한다.
// 판정은 하지 않는다 - 서버가 준 상태·이름·문구를 고르기만 한다.

export interface CashflowMonthCloseNoticeInput {
  requestStatus: string | null | undefined;
  requestedByUid?: string | null;
  requestedByName?: string | null;
  approverName?: string | null;
  requestedAt?: string | null;
  currentUid?: string | null;
  canWithdraw: boolean;
  withdrawGuide?: string | null;
  canRequestReopen: boolean;
  reopenGuide?: string | null;
  requestGuide?: string | null;
  todayIso?: string;
}

export interface CashflowMonthCloseNotice {
  tone: 'attention' | 'muted';
  text: string;
}

function daysBetween(fromIso: string | null | undefined, todayIso: string | undefined): number | null {
  if (!fromIso || !todayIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(todayIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

function who(name: string | null | undefined, uid: string | null | undefined): string {
  return (name && name.trim()) || (uid && uid.trim()) || '다른 담당자';
}

export function pickCashflowMonthCloseNotice(input: CashflowMonthCloseNoticeInput): CashflowMonthCloseNotice | null {
  const status = (input.requestStatus || '').toUpperCase();

  if (['PENDING', 'APPROVING', 'UNCERTAIN'].includes(status)) {
    // 승인 대기 중: 관건은 "누가 움직일 수 있나". 본인이 요청자면 버튼이 있으니 말할 게 없다.
    if (input.canWithdraw) return null;
    const mine = Boolean(input.currentUid) && input.currentUid === input.requestedByUid;
    if (mine) return null;
    const days = daysBetween(input.requestedAt, input.todayIso);
    const waited = days === null ? '' : days === 0 ? ' · 오늘 요청' : ` · ${days}일째 대기`;
    const approver = input.approverName?.trim() ? ` · ${input.approverName.trim()} 님 승인 대기` : '';
    return {
      tone: 'attention',
      text: `${who(input.requestedByName, input.requestedByUid)} 님이 요청한 월 결산이에요${approver}${waited}. 회수는 요청한 사람만 할 수 있어요.`,
    };
  }

  if (status === 'APPROVED') {
    // 승인 완료: 관건은 재오픈. 가능하면 버튼이 있으니 말할 게 없다.
    if (input.canRequestReopen) return null;
    const guide = input.reopenGuide?.trim();
    return guide ? { tone: 'muted', text: guide } : null;
  }

  const guide = input.requestGuide?.trim();
  return guide ? { tone: 'muted', text: guide } : null;
}
