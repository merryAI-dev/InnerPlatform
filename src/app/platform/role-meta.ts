import type { UserRole } from '../data/types';
import type { LucideIcon } from 'lucide-react';
import {
  ShieldCheck, Activity, FolderKanban,
} from 'lucide-react';

export interface RoleMeta {
  label: string;
  badgeClass: string;
  Icon: LucideIcon;
}

export const ROLE_META: Record<UserRole, RoleMeta> = {
  admin:  { label: '관리자', badgeClass: 'bg-slate-200 text-slate-800', Icon: ShieldCheck },
  finance: { label: '재무팀', badgeClass: 'bg-blue-100 text-blue-900', Icon: Activity },
  pm:     { label: 'PM', badgeClass: 'bg-slate-100 text-slate-800', Icon: FolderKanban },
  viewer: { label: 'PM', badgeClass: 'bg-slate-100 text-slate-800', Icon: FolderKanban },
};
