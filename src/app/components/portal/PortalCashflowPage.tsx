import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { CashflowProjectSheet } from '../cashflow/CashflowProjectSheet';
import { usePortalStore } from '../../data/portal-store';
import {
  resolvePortalProjectResourceId,
  resolvePortalProjectResourcePath,
} from '../../platform/portal-project-selection';

export function PortalCashflowPage() {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    activeProjectId,
    portalUser,
    myProject,
    upsertWeeklySubmissionStatus,
  } = usePortalStore();

  const projectId = resolvePortalProjectResourceId(routeProjectId, activeProjectId, myProject?.id);
  const currentPath = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    if (routeProjectId || !projectId) return;
    navigate(resolvePortalProjectResourcePath(currentPath, projectId), { replace: true });
  }, [currentPath, navigate, projectId, routeProjectId]);

  if (!projectId) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  return (
    <CashflowProjectSheet
      projectId={projectId}
      projectName={myProject?.name}
      roleOverride={portalUser?.role}
      onUpdateWeeklySubmissionStatus={upsertWeeklySubmissionStatus}
    />
  );
}
