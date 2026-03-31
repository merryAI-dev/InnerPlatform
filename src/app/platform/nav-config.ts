import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, FolderKanban, BookOpen, BarChart3,
  FileCheck, Settings, Plus, Shield, ClipboardList, ClipboardCheck,
  Calculator, Wallet, ExternalLink,
  ListChecks, Users, Megaphone, MessagesSquare,
  CircleDollarSign, GraduationCap, ArrowLeftRight,
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
      { to: '/projects/migration-audit', icon: ListChecks, label: '이관 점검' },
      { to: '/board', icon: MessagesSquare, label: '전사 게시판' },
      { to: '/projects/new', icon: Plus, label: '사업 등록', accent: true },
    ],
  },
  {
    label: '재무관리',
    items: [
      { to: '/cashflow', icon: BarChart3, label: '캐시플로' },
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
      { to: '/hr-announcements', icon: Megaphone, label: '인사 공지', accent: true },
      { to: '/training', icon: GraduationCap, label: '사내 교육 관리' },
    ],
  },
  {
    label: '시스템',
    items: [
      { to: '/approvals', icon: ListChecks, label: '승인 대기열', accent: true },
      { to: '/users', icon: Users, label: '사용자 관리' },
      { to: '/audit', icon: BookOpen, label: '감사로그' },
      { to: '/settings', icon: Settings, label: '설정' },
      { to: '/portal', icon: ExternalLink, label: '사용자 포털' },
    ],
  },
];
