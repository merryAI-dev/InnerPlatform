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
  if (holder?.sameActor) return '현재 계정의 다른 탭에서 수정 중입니다';
  return `${holder?.holderDisplayName.trim() || '다른 사용자'}님이 이 프로젝트를 수정 중입니다`;
}

export function EditLeaseDialogs({
  warningOpen,
  expiredOpen,
  conflictOpen,
  holder,
  busy = false,
  onDismissWarning,
  onExtend,
  onContinueReadOnly,
  onReacquire,
}: {
  warningOpen: boolean;
  expiredOpen: boolean;
  conflictOpen: boolean;
  holder: EditLeaseHolder | null;
  busy?: boolean;
  onDismissWarning: () => void;
  onExtend: () => void | Promise<void>;
  onContinueReadOnly: () => void;
  onReacquire: () => void | Promise<void>;
}) {
  return (
    <>
      <AlertDialog open={warningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>수정 시간이 5분 남았습니다</AlertDialogTitle>
            <AlertDialogDescription>
              수정 세션은 자동으로 연장되지 않습니다. 계속 수정하려면 직접 연장해주세요.
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
            <AlertDialogTitle>다른 수정 세션이 사용 중입니다</AlertDialogTitle>
            <AlertDialogDescription>{editLeaseHolderMessage(holder)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction disabled={busy} onClick={onContinueReadOnly}>
              읽기 모드로 보기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
