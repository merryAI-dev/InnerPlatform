import type { UserRole } from './types';

export interface RoleDirectoryEntry {
  uid: string;
  email: string;
  role: UserRole;
}

export interface ProjectOwnerEntry {
  id: string;
  managerId: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function resolveRoleFromDirectory(email: string, directory: RoleDirectoryEntry[]): UserRole {
  const normalized = normalizeEmail(email);
  const found = directory.find((entry) => normalizeEmail(entry.email) === normalized);
  // Runtime policy currently treats legacy viewer access as PM access.
  return found?.role ?? 'pm';
}

export function resolveProjectIdForManager(uid: string, projects: ProjectOwnerEntry[]): string | undefined {
  const found = projects.find((project) => project.managerId === uid);
  return found?.id;
}
