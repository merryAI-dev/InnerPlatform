import type { UserRole } from '../data/types';
import type { LucideIcon } from 'lucide-react';
import {
  ShieldCheck, Activity, FolderKanban, Eye, ShieldAlert, UserCog, Key,
} from 'lucide-react';

export interface RoleMeta {
  label: string;
  badgeClass: string;
  Icon: LucideIcon;
}

export const ROLE_META: Record<UserRole, RoleMeta> = {
  admin:        { label: '관리자',       badgeClass: 'bg-purple-100 text-purple-800', Icon: ShieldCheck },
  tenant_admin: { label: '테넌트 관리자', badgeClass: 'bg-violet-100 text-violet-800', Icon: ShieldCheck },
  finance:      { label: '재무',         badgeClass: 'bg-blue-100 text-blue-800',     Icon: Activity },
  pm:           { label: 'PM',           badgeClass: 'bg-green-100 text-green-800',   Icon: FolderKanban },
  viewer:       { label: '뷰어',         badgeClass: 'bg-gray-100 text-gray-700',     Icon: Eye },
  auditor:      { label: '감사',         badgeClass: 'bg-amber-100 text-amber-800',   Icon: ShieldAlert },
  support:      { label: '지원',         badgeClass: 'bg-slate-100 text-slate-700',   Icon: UserCog },
  security:     { label: '보안',         badgeClass: 'bg-rose-100 text-rose-800',     Icon: Key },
};
