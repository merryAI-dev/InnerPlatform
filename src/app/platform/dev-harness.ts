import type { UserRole } from '../data/types';
import { ORG_MEMBERS, PROJECTS } from '../data/mock-data';
import { parseFeatureFlag } from '../config/feature-flags';

export const DEV_AUTH_HARNESS_STORAGE_KEY = 'mysc-dev-auth-harness';

export type DevHarnessPreset = 'pm' | 'admin';

export interface DevHarnessSession {
  source: 'dev_harness';
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string;
  projectId?: string;
  projectIds?: string[];
  defaultWorkspace?: 'admin' | 'portal';
  lastWorkspace?: 'admin' | 'portal';
}

interface LocationLike {
  hostname?: string;
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]';
}

export function readDevAuthHarnessConfig(
  env: Record<string, unknown> = import.meta.env,
  locationLike?: LocationLike,
): { enabled: boolean; localhost: boolean } {
  const hostname = typeof locationLike?.hostname === 'string'
    ? locationLike.hostname
    : (typeof window !== 'undefined' ? window.location.hostname : '');
  const localhost = isLocalhostHost(hostname);
  const enabled = parseFeatureFlag(env.VITE_DEV_AUTH_HARNESS_ENABLED, false) && localhost;
  return { enabled, localhost };
}

function resolvePmProjectId(): string {
  return PROJECTS.find((project) => project.status === 'CONTRACT_PENDING')?.id
    || PROJECTS[0]?.id
    || '';
}

export function createDevHarnessSession(
  preset: DevHarnessPreset,
  tenantId: string,
): DevHarnessSession {
  if (preset === 'admin') {
    const adminMember = ORG_MEMBERS.find((member) => member.role === 'admin') || ORG_MEMBERS[0];
    return {
      source: 'dev_harness',
      uid: adminMember?.uid || 'dev-admin',
      name: adminMember?.name || '개발용 관리자',
      email: adminMember?.email || 'admin@mysc.co.kr',
      role: 'admin',
      tenantId,
      defaultWorkspace: 'admin',
      lastWorkspace: 'admin',
    };
  }

  const pmMember = ORG_MEMBERS.find((member) => member.role === 'pm') || ORG_MEMBERS[0];
  const projectId = resolvePmProjectId();
  return {
    source: 'dev_harness',
    uid: pmMember?.uid || 'dev-pm',
    name: pmMember?.name || '개발용 PM',
    email: pmMember?.email || 'pm@mysc.co.kr',
    role: 'pm',
    tenantId,
    projectId,
    projectIds: projectId ? [projectId] : [],
    defaultWorkspace: 'portal',
    lastWorkspace: 'portal',
  };
}

export function readDevHarnessSession(storage: Pick<Storage, 'getItem'> | undefined = typeof window !== 'undefined' ? window.localStorage : undefined): DevHarnessSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(DEV_AUTH_HARNESS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DevHarnessSession>;
    if (parsed?.source !== 'dev_harness' || typeof parsed.uid !== 'string' || typeof parsed.email !== 'string') {
      return null;
    }
    return parsed as DevHarnessSession;
  } catch {
    return null;
  }
}

export function persistDevHarnessSession(
  session: DevHarnessSession,
  storage: Pick<Storage, 'setItem'> | undefined = typeof window !== 'undefined' ? window.localStorage : undefined,
): void {
  if (!storage) return;
  storage.setItem(DEV_AUTH_HARNESS_STORAGE_KEY, JSON.stringify(session));
}

export function clearDevHarnessSession(
  storage: Pick<Storage, 'removeItem'> | undefined = typeof window !== 'undefined' ? window.localStorage : undefined,
): void {
  if (!storage) return;
  storage.removeItem(DEV_AUTH_HARNESS_STORAGE_KEY);
}
