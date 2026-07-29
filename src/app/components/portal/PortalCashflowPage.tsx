import { Navigate, useLocation, useParams } from 'react-router';
import { CashflowProjectSheet } from '../cashflow/CashflowProjectSheet';
import { usePortalStore } from '../../data/portal-store';
import {
  resolvePortalProjectResourceId,
  resolvePortalProjectResourcePath,
} from '../../platform/portal-project-selection';

export function PortalCashflowPage() {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const {
    activeProjectId,
    members,
    portalUser,
    myProject,
    projects,
    patchProjectSnapshot,
    upsertWeeklySubmissionStatus,
  } = usePortalStore();

  const projectId = resolvePortalProjectResourceId(routeProjectId, activeProjectId, myProject?.id);
  const project = projects.find((candidate) => candidate.id === projectId) || myProject;
  const currentPath = `${location.pathname}${location.search}${location.hash}`;

  if (!projectId) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  if (!routeProjectId) {
    return <Navigate to={resolvePortalProjectResourcePath(currentPath, projectId)} replace />;
  }

  return (
    <CashflowProjectSheet
      key={projectId}
      projectId={projectId}
      projectName={project?.name}
      project={project}
      members={members}
      onExecutiveApproverSaved={(result) => {
        if (!project) return;
        patchProjectSnapshot({ ...project, ...result });
      }}
      roleOverride={portalUser?.role}
      onUpdateWeeklySubmissionStatus={upsertWeeklySubmissionStatus}
    />
  );
}
