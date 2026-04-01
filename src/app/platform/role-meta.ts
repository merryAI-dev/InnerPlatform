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
  admin:        { label: '관리자',       badgeClass: 'bg-purple-100 text-purple-800', Icon: ShieldCheck },
  finance:      { label: '재무',         badgeClass: 'bg-blue-100 text-blue-800',     Icon: Activity },
  pm:           { label: 'PM',           badgeClass: 'bg-green-100 text-green-800',   Icon: FolderKanban },
  viewer:       { label: 'PM',           badgeClass: 'bg-green-100 text-green-800',   Icon: FolderKanban },
};
