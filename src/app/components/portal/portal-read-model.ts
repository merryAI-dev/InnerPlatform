import { PROJECT_STATUS_LABELS, type Project } from '../../data/types';
import type { PortalReadModelProjectSummary } from '../../lib/platform-bff-client';

type PortalFallbackProject = Pick<
  Project,
  'id' | 'name' | 'status' | 'clientOrg' | 'managerName' | 'department' | 'type'
>;

export interface PortalProjectReadModel {
  projectId: string;
  projectName: string;
  statusLabel: string;
  projectMetaLabel: string;
  ready: boolean;
  source: 'bff' | 'store' | 'empty';
}

function normalizeProject(project: PortalReadModelProjectSummary | PortalFallbackProject | null | undefined) {
  if (!project) return null;

  const projectId = String(project.id || '').trim();
  const projectName = String(project.name || '').trim();
  const status = String(project.status || '').trim();
  const statusLabel = status
    ? PROJECT_STATUS_LABELS[status as keyof typeof PROJECT_STATUS_LABELS] || status
    : '';
  const projectMetaLabel = [
    String(project.clientOrg || '').trim(),
    String(project.managerName || '').trim(),
    String(project.department || '').trim(),
  ].filter(Boolean).join(' · ');

  return {
    projectId,
    projectName,
    statusLabel,
    projectMetaLabel,
  };
}

export function resolvePortalProjectReadModel(params: {
  summaryProject?: PortalReadModelProjectSummary | null;
  fallbackProject?: PortalFallbackProject | null;
  activeProjectId?: string | null;
}): PortalProjectReadModel {
  const activeProjectId = String(params.activeProjectId || '').trim();
  const preferred = normalizeProject(params.summaryProject);
  const fallback = normalizeProject(params.fallbackProject);
  const selected = preferred || fallback;

  if (!selected) {
    return {
      projectId: activeProjectId,
      projectName: '내 사업',
      statusLabel: '',
      projectMetaLabel: '',
      ready: Boolean(activeProjectId),
      source: 'empty',
    };
  }

  return {
    projectId: selected.projectId || activeProjectId,
    projectName: selected.projectName || '내 사업',
    statusLabel: selected.statusLabel,
    projectMetaLabel: selected.projectMetaLabel,
    ready: Boolean(selected.projectId || activeProjectId),
    source: preferred ? 'bff' : 'store',
  };
}
