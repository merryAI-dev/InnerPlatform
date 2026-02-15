import { useMemo } from 'react';
import { CashflowProjectSheet } from '../cashflow/CashflowProjectSheet';
import { usePortalStore } from '../../data/portal-store';

export function PortalCashflowPage() {
  const { portalUser, myProject } = usePortalStore();

  const projectId = portalUser?.projectId || '';
  const projectName = myProject?.name || '내 사업';

  const ready = useMemo(() => Boolean(projectId), [projectId]);

  if (!ready) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  return (
    <CashflowProjectSheet projectId={projectId} projectName={projectName} />
  );
}

