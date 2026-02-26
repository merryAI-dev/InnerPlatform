import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { onIdTokenChanged, signInWithPopup, signOut, type User as FirebaseUser } from 'firebase/auth';
import type { UserRole } from './types';
import { ORG_MEMBERS, PROJECTS } from './mock-data';
import { featureFlags } from '../config/feature-flags';
import {
  getAuthInstance,
  getDb,
  getDefaultOrgId,
  getGoogleAuthProvider,
  getOrgDocumentPath,
  initFirebase,
} from '../lib/firebase';
import {
  normalizeEmail,
  resolveProjectIdForManager,
  resolveRoleFromDirectory,
  type ProjectOwnerEntry,
  type RoleDirectoryEntry,
} from './auth-helpers';
import { isBootstrapAdminEmail } from './auth-bootstrap';
import { normalizeProjectIds, resolvePrimaryProjectId } from './project-assignment';
import { extractAuthContextFromClaims } from '../platform/rbac';
import { isAdminSpaceRole } from '../platform/navigation';
import { resolveTenantId } from '../platform/tenant';
import { formatAllowedDomains, getAllowedEmailDomains, isAllowedEmail } from '../platform/email-allowlist';

export interface AuthUser {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  idToken?: string;
  avatarUrl?: string;
  projectId?: string;
  projectIds?: string[];
  tenantId?: string;
  department?: string;
  registeredAt?: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isLoading: boolean;
  isFirebaseAuthEnabled: boolean;
}

interface AuthActions {
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isAdmin: () => boolean;
  isPortalUser: () => boolean;
}

interface MemberDoc {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId?: string;
  department?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'PENDING';
  projectId?: string;
  projectIds?: string[];
  avatarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
}

const AUTH_STORAGE_KEY = 'mysc-auth-user';
const ACTIVE_TENANT_KEY = 'MYSC_ACTIVE_TENANT';
const DEFAULT_ORG_ID = getDefaultOrgId();
const ALLOWED_EMAIL_DOMAINS = getAllowedEmailDomains(import.meta.env);

const ROLE_DIRECTORY: RoleDirectoryEntry[] = ORG_MEMBERS.map((member) => ({
  uid: member.uid,
  email: member.email,
  role: member.role,
}));

const PROJECT_OWNERS: ProjectOwnerEntry[] = PROJECTS.map((project) => ({
  id: project.id,
  managerId: project.managerId,
}));

function loadSavedUser(): AuthUser | null {
  try {
    const saved = localStorage.getItem(AUTH_STORAGE_KEY);
    return saved ? (JSON.parse(saved) as AuthUser) : null;
  } catch {
    return null;
  }
}

function saveUser(user: AuthUser | null) {
  if (user) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
    if (user.tenantId) {
      localStorage.setItem(ACTIVE_TENANT_KEY, user.tenantId);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mysc:tenant-changed', { detail: { tenantId: user.tenantId } }),
        );
      }
    }
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_TENANT_KEY);
  }
}

function toUserRole(role: string | undefined): UserRole | undefined {
  if (
    role === 'admin' ||
    role === 'tenant_admin' ||
    role === 'finance' ||
    role === 'pm' ||
    role === 'viewer' ||
    role === 'auditor' ||
    role === 'support' ||
    role === 'security'
  ) {
    return role;
  }
  return undefined;
}

function mapFirebaseUserToAuthUser(
  firebaseUser: FirebaseUser,
  member: Partial<MemberDoc> | undefined,
  tenantId: string,
  idToken?: string,
): AuthUser {
  const normalizedEmail = normalizeEmail(firebaseUser.email || member?.email || '');
  const mergedProjectIds = normalizeProjectIds([
    ...(Array.isArray(member?.projectIds) ? member?.projectIds : []),
    member?.projectId,
    resolveProjectIdForManager(firebaseUser.uid, PROJECT_OWNERS),
  ]);
  const primaryProjectId = resolvePrimaryProjectId(mergedProjectIds, member?.projectId);
  // Bootstrap admin은 Firestore 쓰기 실패해도 항상 admin role 부여
  const role =
    isBootstrapAdminEmail(normalizedEmail)
      ? 'admin'
      : toUserRole(member?.role) ||
        resolveRoleFromDirectory(firebaseUser.email || '', ROLE_DIRECTORY);
  return {
    uid: firebaseUser.uid,
    name: member?.name || firebaseUser.displayName || '사용자',
    email: normalizedEmail,
    role,
    idToken,
    avatarUrl: member?.avatarUrl || firebaseUser.photoURL || undefined,
    projectId: primaryProjectId,
    projectIds: mergedProjectIds,
    tenantId,
    department: member?.department,
    registeredAt: member?.createdAt,
  };
}

async function upsertMemberFromFirebase(
  firebaseUser: FirebaseUser,
  tenantId: string,
  roleFromClaims?: string,
  department?: string,
): Promise<MemberDoc | undefined> {
  const db = getDb();
  if (!db) return undefined;

  const memberPath = getOrgDocumentPath(tenantId, 'members', firebaseUser.uid);
  const memberRef = doc(db, memberPath);
  const snap = await getDoc(memberRef);
  const existing = snap.exists() ? (snap.data() as MemberDoc) : undefined;
  const now = new Date().toISOString();
  const normalizedEmail = normalizeEmail(firebaseUser.email || existing?.email || '');
  const bootstrapAdmin = isBootstrapAdminEmail(normalizedEmail);
  const mergedProjectIds = normalizeProjectIds([
    ...(Array.isArray(existing?.projectIds) ? existing?.projectIds : []),
    existing?.projectId,
    resolveProjectIdForManager(firebaseUser.uid, PROJECT_OWNERS),
  ]);
  const primaryProjectId = resolvePrimaryProjectId(mergedProjectIds, existing?.projectId);

  const merged: MemberDoc = {
    uid: firebaseUser.uid,
    name: firebaseUser.displayName || existing?.name || '사용자',
    email: normalizedEmail,
    role:
      bootstrapAdmin
        ? 'admin'
        : toUserRole(roleFromClaims) ||
          existing?.role ||
          resolveRoleFromDirectory(firebaseUser.email || '', ROLE_DIRECTORY),
    tenantId,
    status: existing?.status || 'ACTIVE',
    projectId: primaryProjectId,
    projectIds: mergedProjectIds,
    avatarUrl: firebaseUser.photoURL || existing?.avatarUrl,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastLoginAt: now,
  };
  if (department) merged.department = department;

  await setDoc(memberRef, merged, { merge: true });
  return merged;
}

const _g = globalThis as any;
if (!_g.__MYSC_AUTH_CTX__) {
  _g.__MYSC_AUTH_CTX__ = createContext<(AuthState & AuthActions) | null>(null);
}
const AuthContext: React.Context<(AuthState & AuthActions) | null> = _g.__MYSC_AUTH_CTX__;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(
    featureFlags.firebaseAuthEnabled ? null : loadSavedUser,
  );
  const [isLoading, setIsLoading] = useState(featureFlags.firebaseAuthEnabled);

  useEffect(() => {
    if (!featureFlags.firebaseAuthEnabled) {
      setIsLoading(false);
      return;
    }

    const initialized = initFirebase();
    const auth = initialized?.auth || getAuthInstance();
    if (!auth) {
      setIsLoading(false);
      return;
    }

    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        saveUser(null);
        setIsLoading(false);
        return;
      }

      if (!isAllowedEmail(firebaseUser.email, ALLOWED_EMAIL_DOMAINS)) {
        console.warn('[Auth] blocked sign-in for disallowed email:', firebaseUser.email);
        await signOut(auth).catch(() => {});
        setUser(null);
        saveUser(null);
        setIsLoading(false);
        return;
      }

      try {
        const token = await firebaseUser.getIdTokenResult().catch(() => null);
        const claimsContext = extractAuthContextFromClaims(token?.claims);
        const tenantId = resolveTenantId({
          claimTenantId: claimsContext.tenantId,
          envTenantId: DEFAULT_ORG_ID,
          strict: featureFlags.tenantIsolationStrict,
        });
        const member = await upsertMemberFromFirebase(
          firebaseUser,
          tenantId,
          claimsContext.role,
          claimsContext.department,
        );
        const mapped = mapFirebaseUserToAuthUser(firebaseUser, member, tenantId, token?.token);
        setUser(mapped);
        saveUser(mapped);
      } catch (err) {
        console.error('[Auth] Failed to sync member profile:', err);
        const fallbackTenantId = resolveTenantId({
          envTenantId: DEFAULT_ORG_ID,
          strict: false,
        });
        const token = await firebaseUser.getIdTokenResult().catch(() => null);
        const fallback = mapFirebaseUserToAuthUser(firebaseUser, undefined, fallbackTenantId, token?.token);
        setUser(fallback);
        saveUser(fallback);
      } finally {
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!featureFlags.firebaseAuthEnabled) {
      return { success: false, error: 'Firebase Auth 기능이 비활성화되어 있습니다.' };
    }

    setIsLoading(true);

    try {
      const initialized = initFirebase();
      const auth = initialized?.auth || getAuthInstance();
      if (!auth) {
        setIsLoading(false);
        return { success: false, error: 'Firebase 인증 구성을 찾을 수 없습니다.' };
      }

      const cred = await signInWithPopup(auth, getGoogleAuthProvider());
      const email = cred?.user?.email || '';
      if (!isAllowedEmail(email, ALLOWED_EMAIL_DOMAINS)) {
        await signOut(auth).catch(() => {});
        setIsLoading(false);
        return {
          success: false,
          error: `회사 계정(${formatAllowedDomains(ALLOWED_EMAIL_DOMAINS)})만 로그인할 수 있습니다.`,
        };
      }

      return { success: true };
    } catch (err: any) {
      setIsLoading(false);
      const code = String(err?.code || '').trim();
      if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        return {
          success: false,
          error: `Firebase Auth에서 허용되지 않은 도메인입니다. Firebase Console > Authentication > Settings > Authorized domains에 ${host || '현재 도메인'}을 추가해 주세요.`,
        };
      }
      if (code === 'auth/popup-closed-by-user') {
        return { success: false, error: '로그인을 취소했습니다.' };
      }
      return { success: false, error: err?.message || 'Google 로그인에 실패했습니다.' };
    }
  }, []);

  const logout = useCallback(() => {
    if (featureFlags.firebaseAuthEnabled) {
      const auth = getAuthInstance();
      if (auth) {
        signOut(auth).catch((err) => {
          console.error('[Auth] signOut failed:', err);
        });
      }
    }

    setUser(null);
    saveUser(null);
    localStorage.removeItem(ACTIVE_TENANT_KEY);
    localStorage.removeItem('mysc-portal-user');
  }, []);

  const isAdmin = useCallback(() => {
    return !!user && isAdminSpaceRole(user.role);
  }, [user]);

  const isPortalUser = useCallback(() => {
    return !!user && (user.role === 'pm' || user.role === 'viewer');
  }, [user]);

  const value: AuthState & AuthActions = {
    isAuthenticated: !!user,
    user,
    isLoading,
    isFirebaseAuthEnabled: featureFlags.firebaseAuthEnabled,
    loginWithGoogle,
    logout,
    isAdmin,
    isPortalUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
