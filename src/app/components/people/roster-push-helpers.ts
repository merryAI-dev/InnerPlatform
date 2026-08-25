/**
 * 시트 명단 푸시 패널의 순수 로직. 사유 코드는 BFF(participation-roster-push.mjs)의
 * refusal reason 과 1:1 이다 - 새 사유가 생기면 여기 라벨을 함께 늘린다.
 */

export const ROSTER_PUSH_REASON_LABELS: Record<string, string> = {
  permission_denied: '편집 권한 없음 - 시스템 계정을 편집자로 공유해 주세요',
  format_mismatch: '양식이 다릅니다 - 표준양식 사본인지 확인해 주세요',
  tenant_mismatch: '다른 조직의 시트입니다 - 링크를 확인해 주세요',
  roster_shrunk: '명단이 줄어들어 중단했습니다 - 관리자에게 문의해 주세요',
  people_empty: '인력 명부가 비어 있어 중단했습니다',
  invalid_link: '시트 링크가 올바르지 않습니다',
  not_found: '시트를 찾을 수 없습니다 - 삭제되었는지 확인해 주세요',
  request_rejected: '요청이 거부되었습니다 - 관리자에게 문의해 주세요',
  api_error: '일시적인 오류 - 다음 실행 때 다시 시도합니다',
};

export function rosterPushReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '알 수 없는 실패';
  return ROSTER_PUSH_REASON_LABELS[reason] || `실패 (${reason})`;
}

/** 명단 푸시 실행 권한. BFF 의 personWrite(admin·tenant_admin·finance)와 같은 집합. */
export function canTriggerRosterPush(role: string | null | undefined): boolean {
  return ['admin', 'tenant_admin', 'finance'].includes(String(role || ''));
}

/** ISO 시각을 화면용 'YYYY.MM.DD HH:mm' 로. 값이 없으면 '-'. */
export function formatRosterInstant(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
