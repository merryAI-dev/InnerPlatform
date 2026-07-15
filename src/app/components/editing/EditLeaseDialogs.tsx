import type { EditLeaseHolder } from '../../lib/edit-lease-client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

export function editLeaseHolderMessage(holder: EditLeaseHolder | null): string {
  return `현재 ${holder?.holderDisplayName.trim() || '다른 사용자'}님이 수정 중입니다.`;
}

function formatLeaseExpiry(expiresAt: string | null | undefined): string {
  if (!expiresAt) return '';
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatLeaseRemaining(remainingMs: number | undefined): string {
  if (remainingMs == null || remainingMs <= 0) return '';
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `약 ${minutes}분 남음`;
}

export function EditLeaseDialogs({
  warningOpen,
  expiredOpen,
  conflictOpen,
  holder,
  expiresAt,
  remainingMs,
  busy = false,
  onDismissWarning,
  onExtend,
  onContinueReadOnly,
  onReacquire,
  onTakeover,
}: {
  warningOpen: boolean;
  expiredOpen: boolean;
  conflictOpen: boolean;
  holder: EditLeaseHolder | null;
  expiresAt?: string | null;
  remainingMs?: number;
  busy?: boolean;
  onDismissWarning: () => void;
  onExtend: () => void | Promise<void>;
  onContinueReadOnly: () => void;
  onReacquire: () => void | Promise<void>;
  onTakeover?: () => void | Promise<void>;
}) {
  return (
    <>
      <AlertDialog open={warningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>수정 시간이 5분 남았습니다</AlertDialogTitle>
            <AlertDialogDescription>
              수정 세션은 자동으로 연장되지 않습니다. 계속 수정하려면 직접 연장해주세요.
              {formatLeaseExpiry(expiresAt) ? ` 현재 만료 예정 ${formatLeaseExpiry(expiresAt)} · ${formatLeaseRemaining(remainingMs)}` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} onClick={onDismissWarning}>계속 편집</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void onExtend()}>
              30분 연장
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={expiredOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>수정 세션이 종료되었습니다</AlertDialogTitle>
            <AlertDialogDescription>
              30분이 지나 선점만 해제되었습니다. 입력 내용과 첨부파일은 임시저장본에 유지됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} onClick={onContinueReadOnly}>
              읽기 모드로 보기
            </AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void onReacquire()}>
              다시 수정하기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={conflictOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{editLeaseHolderMessage(holder)}</AlertDialogTitle>
            <AlertDialogDescription>
              지금은 수정은 불가능하지만 읽기/조회는 가능해요!
              {formatLeaseExpiry(holder?.expiresAt) ? ` 수정 권한 만료 예정 ${formatLeaseExpiry(holder?.expiresAt)}` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} onClick={onContinueReadOnly}>
              읽기 모드로 보기
            </AlertDialogCancel>
            {holder?.sameActor && onTakeover ? (
              <AlertDialogAction disabled={busy} onClick={() => void onTakeover()}>
                이전 수정 세션 이어서 작성
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
