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
  // Least privilege: unknown users should not get write access by default.
  return found?.role ?? 'viewer';
}

export function resolveProjectIdForManager(uid: string, projects: ProjectOwnerEntry[]): string | undefined {
  const found = projects.find((project) => project.managerId === uid);
  return found?.id;
}

export function isPrivilegedRole(role: UserRole): boolean {
  return role === 'admin' || role === 'finance' || role === 'auditor';
}
