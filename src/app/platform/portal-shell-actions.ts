import { resolvePortalProjectSwitchPath } from './portal-project-selection';
import { shouldShowShellRoute } from './shell-lab-visibility';

export interface PortalShellNavItem {
  to: string;
  label: string;
}

export interface PortalShellProjectItem {
  id: string;
  name: string;
}

export interface PortalShellCommandItem {
  id: string;
  label: string;
  description: string;
  category: '업무' | '프로젝트' | '관리';
  kind: 'portal' | 'admin' | 'project';
  to: string;
  keywords: string[];
  projectId?: string;
}

export interface PortalShellNotificationItem {
  id: string;
  label: string;
  description: string;
  to: string;
}

const PORTAL_DIRECT_COMMANDS = [
  {
    id: 'portal:cashflow',
    label: '캐시플로우',
    description: '프로젝트 캐시플로우 보기',
    to: '/portal/cashflow',
    keywords: ['cashflow', '캐시플로우', '현금흐름'],
  },
] as const;

export function buildPortalShellCommandItems(input: {
  role: string | null | undefined;
  currentPath: string;
  currentProject?: PortalShellProjectItem | null;
  availableProjects: PortalShellProjectItem[];
  fundInputMode?: string | null;
  labEnabled?: boolean;
}): PortalShellCommandItem[] {
  const switchPath = resolvePortalProjectSwitchPath(input.currentPath);
  const portalItems = PORTAL_DIRECT_COMMANDS
    .filter((item) => shouldShowShellRoute(item.to, 'portal', 'command', {
      fundInputMode: input.fundInputMode,
      labEnabled: input.labEnabled,
    }))
    .map((item) => ({
      ...item,
      category: '업무' as const,
      kind: 'portal' as const,
      projectId: undefined,
    }));
  const projectItems = input.availableProjects.map((project) => ({
    id: `project:${project.id}`,
    label: project.name,
    description: input.currentProject?.id === project.id ? '현재 작업 프로젝트입니다.' : '현재 화면을 유지한 채 이 프로젝트로 전환',
    category: '프로젝트' as const,
    kind: 'project' as const,
    to: switchPath,
    projectId: project.id,
    keywords: [project.name, project.id, '담당 프로젝트', '프로젝트 전환', '현재 화면 유지'],
  }));

  const adminItems = String(input.role || '').toLowerCase() === 'admin' || String(input.role || '').toLowerCase() === 'finance'
    ? [{
      id: 'admin:home',
      label: '관리자 공간',
      description: '전사 운영 화면으로 이동',
      category: '관리' as const,
      kind: 'admin' as const,
      to: '/',
      keywords: ['admin', '관리자', '대시보드'],
    }]
    : [];

  return [...portalItems, ...projectItems, ...adminItems];
}

export function buildPortalShellNotificationItems(input: {
  pendingChanges: number;
  hrAlertCount: number;
}): PortalShellNotificationItem[] {
  const items: PortalShellNotificationItem[] = [];
  const changeAndNoticeCount = input.pendingChanges + input.hrAlertCount;

  if (changeAndNoticeCount > 0) {
    items.push({
      id: 'changes',
      label: '인력변경/공지 확인',
      description: input.pendingChanges > 0
        ? `인력변경 요청 ${input.pendingChanges}건`
        : `미확인 공지 ${input.hrAlertCount}건`,
      to: '/portal/change-requests',
    });
  }

  return items;
}
