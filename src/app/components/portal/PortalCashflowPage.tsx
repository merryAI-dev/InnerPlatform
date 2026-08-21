import { Navigate, useParams } from 'react-router';
import { CashflowProjectSheet } from '../cashflow/CashflowProjectSheet';
import { usePortalStore } from '../../data/portal-store';
import {
  resolvePortalProjectResourceId,
} from '../../platform/portal-project-selection';

export function PortalCashflowPage() {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const {
    activeProjectId,
    members,
    portalUser,
    projects,
    patchProjectSnapshot,
    upsertWeeklySubmissionStatus,
  } = usePortalStore();

  // `/portal/cashflow` is the session-entry URL; an explicit route ID always wins.
  const projectId = resolvePortalProjectResourceId(routeProjectId, activeProjectId);
  const project = projects.find((candidate) => candidate.id === projectId);

  if (!projectId) {
    return <Navigate to="/portal/project-select" replace />;
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
      portalMode
      onUpdateWeeklySubmissionStatus={upsertWeeklySubmissionStatus}
    />
  );
}
