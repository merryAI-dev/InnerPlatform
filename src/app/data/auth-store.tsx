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
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  loginAsDemo: (role: 'admin' | 'pm' | 'finance' | 'auditor') => void;
  registerPortalUser: (data: { name: string; email: string; password: string; role: string; projectId: string }) => Promise<{ success: boolean; error?: string }>;
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
  avatarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
}

const MOCK_PASSWORDS: Record<string, string> = {};
ORG_MEMBERS.forEach((m) => {
  MOCK_PASSWORDS[m.email] = 'mysc1234';
});

const portalRegisteredUsers: AuthUser[] = [];
const portalPasswords: Record<string, string> = {};

const AUTH_STORAGE_KEY = 'mysc-auth-user';
const ACTIVE_TENANT_KEY = 'MYSC_ACTIVE_TENANT';
const DEFAULT_ORG_ID = getDefaultOrgId();
const ALLOWED_EMAIL_DOMAINS = getAllowedEmailDomains(import.meta.env);

function parseBootstrapAdminEmails(env: Record<string, unknown> = import.meta.env): string[] {
  const raw = typeof env.VITE_BOOTSTRAP_ADMIN_EMAILS === 'string' ? env.VITE_BOOTSTRAP_ADMIN_EMAILS : '';
  const emails = raw
    .split(',')
    .map((v) => normalizeEmail(v))
    .filter(Boolean);
  console.log('[Auth] Bootstrap admin emails:', emails);
  return emails;
}

function isBootstrapAdminEmail(email: string, env: Record<string, unknown> = import.meta.env): boolean {
  if (!email) return false;
  const list = parseBootstrapAdminEmails(env);
  if (!list.length) return false;
  const normalized = normalizeEmail(email);
  const isAdmin = list.includes(normalized);
  console.log('[Auth] isBootstrapAdminEmail check:', { email, normalized, list, isAdmin });
  return isAdmin;
}

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
  const role =
    toUserRole(member?.role) ||
    resolveRoleFromDirectory(firebaseUser.email || '', ROLE_DIRECTORY);
  return {
    uid: firebaseUser.uid,
    name: member?.name || firebaseUser.displayName || '사용자',
    email: firebaseUser.email || member?.email || '',
    role,
    idToken,
    avatarUrl: member?.avatarUrl || firebaseUser.photoURL || undefined,
    projectId: member?.projectId || resolveProjectIdForManager(firebaseUser.uid, PROJECT_OWNERS),
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

  console.log('[Auth] upsertMemberFromFirebase:', {
    uid: firebaseUser.uid,
    email: normalizedEmail,
    bootstrapAdmin,
    roleFromClaims,
    existingRole: existing?.role,
  });

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
    projectId: existing?.projectId || resolveProjectIdForManager(firebaseUser.uid, PROJECT_OWNERS),
    avatarUrl: firebaseUser.photoURL || existing?.avatarUrl,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastLoginAt: now,
  };
  if (department) merged.department = department;

  console.log('[Auth] Final merged role:', merged.role);

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

  const login = useCallback(async (
    email: string,
    password: string,
  ): Promise<{ success: boolean; error?: string }> => {
    if (featureFlags.firebaseAuthEnabled) {
      return { success: false, error: 'Google 로그인을 사용해 주세요.' };
    }

    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 600));

    const emailLower = normalizeEmail(email);

    const orgMember = ORG_MEMBERS.find((m) => normalizeEmail(m.email) === emailLower);
    if (orgMember) {
      if (MOCK_PASSWORDS[orgMember.email] === password) {
        const authUser: AuthUser = {
          uid: orgMember.uid,
          name: orgMember.name,
          email: orgMember.email,
          role: orgMember.role,
          avatarUrl: orgMember.avatarUrl,
          projectId: resolveProjectIdForManager(orgMember.uid, PROJECT_OWNERS),
          tenantId: DEFAULT_ORG_ID,
        };
        setUser(authUser);
        saveUser(authUser);
        setIsLoading(false);
        return { success: true };
      }
      setIsLoading(false);
      return { success: false, error: '비밀번호가 올바르지 않습니다' };
    }

    const portalUser = portalRegisteredUsers.find((u) => normalizeEmail(u.email) === emailLower);
    if (portalUser) {
      if (portalPasswords[portalUser.email] === password) {
        setUser(portalUser);
        saveUser(portalUser);
        setIsLoading(false);
        return { success: true };
      }
      setIsLoading(false);
      return { success: false, error: '비밀번호가 올바르지 않습니다' };
    }

    setIsLoading(false);
    return { success: false, error: '등록되지 않은 이메일입니다' };
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

  const loginAsDemo = useCallback((role: 'admin' | 'pm' | 'finance' | 'auditor') => {
    const demoUsers: Record<string, AuthUser> = {
      admin: {
        uid: 'u001',
        name: '관리자',
        email: 'admin@mysc.co.kr',
        role: 'admin',
        projectId: resolveProjectIdForManager('u001', PROJECT_OWNERS),
        tenantId: DEFAULT_ORG_ID,
      },
      pm: { uid: 'u002', name: '데이나', email: 'dana@mysc.co.kr', role: 'pm', projectId: 'p001', tenantId: DEFAULT_ORG_ID },
      finance: { uid: 'u019', name: '재무팀', email: 'finance@mysc.co.kr', role: 'finance', tenantId: DEFAULT_ORG_ID },
      auditor: { uid: 'u020', name: '감사팀', email: 'audit@mysc.co.kr', role: 'auditor', tenantId: DEFAULT_ORG_ID },
    };

    const selected = demoUsers[role];
    setUser(selected);
    saveUser(selected);
  }, []);

  const registerPortalUser = useCallback(async (
    data: { name: string; email: string; password: string; role: string; projectId: string },
  ): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 300));

    // Admin 계정은 포털 회원가입 불가
    const emailLower = normalizeEmail(data.email);
    if (isBootstrapAdminEmail(emailLower)) {
      setIsLoading(false);
      return { success: false, error: '관리자 계정은 별도 회원가입 없이 Google 로그인을 이용해주세요.' };
    }

    if (featureFlags.firebaseAuthEnabled && user) {
      const db = getDb();
      if (!db) {
        setIsLoading(false);
        return { success: false, error: 'Firestore 연결이 필요합니다.' };
      }

      try {
        const now = new Date().toISOString();
        const tenantId = resolveTenantId({
          savedTenantId: user.tenantId,
          envTenantId: DEFAULT_ORG_ID,
          strict: featureFlags.tenantIsolationStrict,
        });
        const memberRef = doc(db, getOrgDocumentPath(tenantId, 'members', user.uid));
        await setDoc(memberRef, {
          uid: user.uid,
          name: data.name,
          email: normalizeEmail(data.email),
          role: 'pm',
          tenantId,
          status: 'ACTIVE',
          projectId: data.projectId,
          updatedAt: now,
          createdAt: user.registeredAt || now,
          lastLoginAt: now,
        }, { merge: true });

        const updatedUser: AuthUser = {
          ...user,
          name: data.name,
          email: normalizeEmail(data.email),
          role: 'pm',
          projectId: data.projectId,
          tenantId,
          registeredAt: user.registeredAt || now,
        };

        setUser(updatedUser);
        saveUser(updatedUser);
        setIsLoading(false);
        return { success: true };
      } catch (err: any) {
        setIsLoading(false);
        return { success: false, error: err?.message || '포털 사용자 등록에 실패했습니다.' };
      }
    }

    const existsOrg = ORG_MEMBERS.find((m) => normalizeEmail(m.email) === emailLower);
    const existsPortal = portalRegisteredUsers.find((u) => normalizeEmail(u.email) === emailLower);

    if (existsOrg || existsPortal) {
      setIsLoading(false);
      return { success: false, error: '이미 등록된 이메일입니다. 로그인 페이지에서 로그인해 주세요.' };
    }

    const newUser: AuthUser = {
      uid: `pu-${Date.now()}`,
      name: data.name,
      email: emailLower,
      role: 'pm',
      projectId: data.projectId,
      tenantId: DEFAULT_ORG_ID,
      registeredAt: new Date().toISOString(),
    };

    portalRegisteredUsers.push(newUser);
    portalPasswords[emailLower] = data.password;

    setUser(newUser);
    saveUser(newUser);
    setIsLoading(false);
    return { success: true };
  }, [user]);

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
    login,
    loginWithGoogle,
    loginAsDemo,
    registerPortalUser,
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
