import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, FolderKanban, BarChart3,
  FileCheck, Settings, Shield, ClipboardList, ClipboardCheck,
  Calculator, Wallet, ExternalLink, UserCog,
  ListChecks, MessagesSquare,
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
    label: '메인',
    items: [
      { to: '/', icon: LayoutDashboard, label: '대시보드' },
      { to: '/projects', icon: FolderKanban, label: '프로젝트' },
      { to: '/projects/migration-audit', icon: ArrowLeftRight, label: '사업이관' },
      { to: '/board', icon: MessagesSquare, label: '전사 게시판' },
    ],
  },
  {
    label: '재무관리',
    items: [
      { to: '/cashflow', icon: BarChart3, label: '캐시플로 모니터링' },
      { to: '/evidence', icon: FileCheck, label: '증빙/정산' },
      { to: '/bank-reconciliation', icon: ArrowLeftRight, label: '은행 대조' },
      { to: '/payroll', icon: CircleDollarSign, label: '인건비/월간정산', accent: true },
      { to: '/budget-summary', icon: Calculator, label: '예산총괄' },
      { to: '/expense-management', icon: Wallet, label: '사업비 관리' },
    ],
  },
  {
    label: '인력/참여율',
    items: [
      { to: '/participation', icon: Shield, label: '참여율 관리' },
      { to: '/koica-personnel', icon: ClipboardList, label: 'KOICA 인력배치' },
      { to: '/personnel-changes', icon: ClipboardCheck, label: '인력변경 관리' },
    ],
  },
  {
    label: '시스템',
    items: [
      { to: '/approvals', icon: ListChecks, label: '승인 대기열', accent: true },
      { to: '/users', icon: UserCog, label: '권한/사용자' },
      { to: '/settings', icon: Settings, label: '설정' },
      { to: '/portal', icon: ExternalLink, label: '사용자 포털' },
    ],
  },
];
