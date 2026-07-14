import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, FolderKanban, BarChart3,
  FileCheck, Building2, Shield, ClipboardList, ClipboardCheck,
  Calculator, Wallet, UserCog,
  ListChecks, MessagesSquare, UserRoundCheck,
  CircleDollarSign, ArrowLeftRight,
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
      { to: '/cashflow', icon: BarChart3, label: '캐시플로 모니터링' },
      { to: '/participation', icon: Shield, label: '인력 투입(참여율)' },
    ],
  },
  {
    label: '경영기획실',
    items: [
      { to: '/cashflow/analytics', icon: BarChart3, label: '통합 관리' },
      { to: '/approvals', icon: ListChecks, label: '등록/승인', accent: true },
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
  {
    label: '운영 도구',
    items: [
      { to: '/board', icon: MessagesSquare, label: '전사 게시판' },
      { to: '/evidence', icon: FileCheck, label: '증빙/정산' },
      { to: '/bank-reconciliation', icon: ArrowLeftRight, label: '은행 대조' },
      { to: '/payroll', icon: CircleDollarSign, label: '인건비/월간정산', accent: true },
      { to: '/budget-summary', icon: Calculator, label: '예산총괄' },
      { to: '/expense-management', icon: Wallet, label: '사업비 관리' },
      { to: '/koica-personnel', icon: ClipboardList, label: 'KOICA 인력배치' },
      { to: '/personnel-changes', icon: ClipboardCheck, label: '인력변경 관리' },
      { to: '/business-cards', icon: UserRoundCheck, label: '명함 DB' },
    ],
  },
];
