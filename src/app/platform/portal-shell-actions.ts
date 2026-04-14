import { resolvePortalProjectSwitchPath } from './portal-project-selection';

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
  category: '업무' | '사업' | '관리';
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

export function buildPortalShellCommandItems(input: {
  role: string | null | undefined;
  currentPath: string;
  currentProject?: PortalShellProjectItem | null;
  availableProjects: PortalShellProjectItem[];
}): PortalShellCommandItem[] {
  const switchPath = resolvePortalProjectSwitchPath(input.currentPath);
  const projectItems = input.availableProjects.map((project) => ({
    id: `project:${project.id}`,
    label: project.name,
    description: input.currentProject?.id === project.id ? '현재 작업 사업입니다.' : '현재 화면을 유지한 채 이 사업으로 전환',
    category: '사업' as const,
    kind: 'project' as const,
    to: switchPath,
    projectId: project.id,
    keywords: [project.name, project.id, '담당 사업', '사업 전환', '현재 화면 유지'],
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

  return [...projectItems, ...adminItems];
}

export function buildPortalShellNotificationItems(input: {
  pendingChanges: number;
  hrAlertCount: number;
  payrollPendingCount: number;
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

  if (input.payrollPendingCount > 0) {
    items.push({
      id: 'payroll',
      label: '인건비 확인',
      description: `확인 필요한 지급/월마감 ${input.payrollPendingCount}건`,
      to: '/portal/payroll',
    });
  }

  return items;
}
