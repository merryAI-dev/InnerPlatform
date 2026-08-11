import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, FolderKanban, BarChart3,
  Building2, Shield, UserCog,
  ListChecks, ArrowLeftRight, Hash,
} from 'lucide-react';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  accent?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: '인사이트',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: '대시보드' },
    ],
  },
  {
    label: '프로젝트 관리',
    items: [
      { to: '/projects', icon: FolderKanban, label: '통합 관리' },
      { to: '/projects/migration-audit', icon: ArrowLeftRight, label: '프로젝트 등록/승인' },
      { to: '/cashflow', icon: BarChart3, label: '주간 입력 이력' },
      { to: '/participation', icon: Shield, label: '참여율 대시보드' },
    ],
  },
  {
    label: '경영기획실',
    items: [
      { to: '/cashflow/export', icon: BarChart3, label: '통합 관리' },
      { to: '/approvals', icon: ListChecks, label: '등록/승인', accent: true },
      { to: '/management-planning/project-codes', icon: Hash, label: '프로젝트 코드 부여', accent: true },
    ],
  },
  {
    label: '시스템 관리',
    items: [
      { to: '/users', icon: UserCog, label: '권한 관리' },
      { to: '/settings?tab=members', icon: UserCog, label: '멤버DB' },
      { to: '/settings?tab=tenants', icon: Building2, label: '조직DB' },
    ],
  },
];
