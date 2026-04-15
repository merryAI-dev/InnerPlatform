# Portal Project Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated portal project-selection step, a session-scoped active project context, a project-only header switcher, and a trimmed `사업 배정 수정` surface without overwriting the stored primary project on every switch.

**Architecture:** Routing will send portal entries through `/portal/project-select`, while the portal store separates persisted `portalUser.projectId` from session `activeProjectId`. A new pure helper module will own candidate-project resolution and route preservation rules so the login flow, header switcher, and portal guard all share the same contract.

**Tech Stack:** React 18, React Router 7, Context-based portal store, Firebase/Firestore-backed auth state, Vitest (node environment), Playwright harness.

---

## File Structure

- Create: `src/app/platform/portal-project-selection.ts`
  - Owns `resolvePortalProjectCandidates`, `resolveActivePortalProjectId`, `resolvePortalProjectSelectPath`, and `resolvePortalProjectSwitchPath`.
- Create: `src/app/platform/portal-project-selection.test.ts`
  - Unit-tests role-based candidate pools, active-project fallback order, and route-preservation helpers.
- Create: `src/app/components/portal/PortalProjectSelectPage.tsx`
  - Renders the login-time project chooser and sets session `activeProjectId` only.
- Create: `src/app/components/portal/PortalProjectSelectPage.shell.test.ts`
  - Source-contract test for the new chooser page because Vitest runs in `node`, not `jsdom`.
- Create: `src/app/components/portal/PortalProjectSettings.shell.test.ts`
  - Source-contract test proving the drive/recent-project blocks are gone.
- Modify: `src/app/routes.tsx`
  - Registers the lazy `/portal/project-select` route.
- Modify: `src/app/platform/navigation.ts`
  - Adds `resolvePortalEntryPath` and treats `/portal/project-select` as a valid portal bypass route.
- Modify: `src/app/platform/navigation.test.ts`
  - Covers post-login routing into `/portal/project-select` and onboarding bypass behavior.
- Modify: `src/app/data/portal-store.tsx`
  - Adds `activeProjectId`, hydrates it from session storage, resolves `myProject` from session-first state, and replaces `setActiveProject` with `setSessionActiveProject`.
- Modify: `src/app/components/auth/LoginPage.tsx`
  - Uses the new portal-entry helper instead of sending portal users straight to `/portal`.
- Modify: `src/app/components/auth/WorkspaceSelectPage.tsx`
  - Sends the portal workspace path through `/portal/project-select`.
- Modify: `src/app/components/portal/PortalLayout.tsx`
  - Enforces the “show once per session” gate, switches the header trigger copy, uses `setSessionActiveProject`, and keeps the current route on project switch.
- Modify: `src/app/platform/portal-shell-actions.ts`
  - Drops menu-navigation items from the command palette and emits project-only switch items plus the admin escape hatch.
- Modify: `src/app/platform/portal-shell-actions.test.ts`
  - Verifies the palette now emits project-switch items only.
- Modify: `src/app/components/portal/PortalLayout.shell.test.ts`
  - Locks the dialog title, placeholder, and switch-only behavior.
- Modify: `src/app/components/portal/PortalProjectSettings.tsx`
  - Removes recent-project and evidence-drive surfaces, keeps only assignment/primary-project editing, and shortens copy.
- Modify: `tests/e2e/platform-smoke.spec.ts`
  - Adds the portal project-selection and route-preserving switch regressions.

### Task 1: Build Portal Project Selection Helpers

**Files:**
- Create: `src/app/platform/portal-project-selection.ts`
- Create: `src/app/platform/portal-project-selection.test.ts`

- [ ] **Step 1: Write the failing helper tests**

```ts
import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import {
  resolveActivePortalProjectId,
  resolvePortalProjectCandidates,
  resolvePortalProjectSelectPath,
  resolvePortalProjectSwitchPath,
} from './portal-project-selection';

const projects = [
  { id: 'p-assigned', name: '2026 더큰 제주', managerId: 'uid-other', status: 'CONTRACT_PENDING' },
  { id: 'p-managed', name: '2026 CTS2', managerId: 'uid-pm', status: 'IN_PROGRESS' },
  { id: 'p-other', name: '외부 사업', managerId: 'uid-else', status: 'CONTRACT_PENDING' },
] as unknown as Project[];

describe('portal project selection helpers', () => {
  it('pm sees assigned and manager-owned projects only', () => {
    const result = resolvePortalProjectCandidates({
      role: 'pm',
      authUid: 'uid-pm',
      assignedProjectIds: ['p-assigned'],
      projects,
    });

    expect(result.priorityProjects.map((project) => project.id)).toEqual(['p-assigned', 'p-managed']);
    expect(result.searchProjects.map((project) => project.id)).toEqual(['p-assigned', 'p-managed']);
  });

  it('admin and finance can search all projects', () => {
    const result = resolvePortalProjectCandidates({
      role: 'admin',
      authUid: 'uid-admin',
      assignedProjectIds: [],
      projects,
    });

    expect(result.searchProjects.map((project) => project.id)).toEqual(['p-assigned', 'p-managed', 'p-other']);
  });

  it('prefers session active project over the stored primary project', () => {
    expect(resolveActivePortalProjectId({
      activeProjectId: 'p-managed',
      primaryProjectId: 'p-assigned',
      candidateProjectIds: ['p-assigned', 'p-managed'],
    })).toBe('p-managed');
  });

  it('wraps requested portal routes with /portal/project-select and preserves current work routes', () => {
    expect(resolvePortalProjectSelectPath('/portal/budget')).toBe('/portal/project-select?redirect=%2Fportal%2Fbudget');
    expect(resolvePortalProjectSelectPath('/portal/project-select')).toBe('/portal/project-select');
    expect(resolvePortalProjectSwitchPath('/portal/cashflow')).toBe('/portal/cashflow');
    expect(resolvePortalProjectSwitchPath('/portal/project-select')).toBe('/portal');
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `npx vitest run src/app/platform/portal-project-selection.test.ts`

Expected: FAIL with module-not-found for `./portal-project-selection` or missing exports such as `resolvePortalProjectCandidates`.

- [ ] **Step 3: Implement the helper module**

```ts
import type { Project, UserRole } from '../data/types';
import { normalizeProjectIds } from '../data/project-assignment';

const PROJECT_SELECT_PATH = '/portal/project-select';
const PROJECT_SWITCH_FALLBACK_PATH = '/portal';
const ADMIN_PROJECT_ROLES = new Set<UserRole>(['admin', 'finance']);

function normalizeRole(role: unknown): UserRole | null {
  const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (value === 'viewer') return 'pm';
  if (value === 'admin' || value === 'finance' || value === 'pm') return value;
  return null;
}

function dedupeProjects(projects: Project[]): Project[] {
  const seen = new Set<string>();
  return projects.filter((project) => {
    if (!project?.id || seen.has(project.id)) return false;
    seen.add(project.id);
    return true;
  });
}

export function resolvePortalProjectCandidates(input: {
  role: unknown;
  authUid?: string | null;
  assignedProjectIds?: string[];
  projects: Project[];
}) {
  const role = normalizeRole(input.role);
  const assignedIds = new Set(normalizeProjectIds(input.assignedProjectIds || []));
  const sortedProjects = [...(input.projects || [])].sort((left, right) => left.name.localeCompare(right.name, 'ko'));

  if (role && ADMIN_PROJECT_ROLES.has(role)) {
    return {
      priorityProjects: dedupeProjects(sortedProjects),
      searchProjects: dedupeProjects(sortedProjects),
    };
  }

  const priorityProjects = dedupeProjects(sortedProjects.filter((project) => (
    assignedIds.has(project.id) || (!!input.authUid && project.managerId === input.authUid)
  )));

  return {
    priorityProjects,
    searchProjects: priorityProjects,
  };
}

export function resolveActivePortalProjectId(input: {
  activeProjectId?: string | null;
  primaryProjectId?: string | null;
  candidateProjectIds?: string[];
}): string {
  const candidates = normalizeProjectIds(input.candidateProjectIds || []);
  const active = String(input.activeProjectId || '').trim();
  if (active && candidates.includes(active)) return active;
  const primary = String(input.primaryProjectId || '').trim();
  if (primary && candidates.includes(primary)) return primary;
  return candidates[0] || '';
}

export function resolvePortalProjectSelectPath(requestedPath?: string): string {
  const normalized = typeof requestedPath === 'string' ? requestedPath.trim() : '';
  if (!normalized.startsWith('/portal') || normalized === PROJECT_SELECT_PATH) return PROJECT_SELECT_PATH;
  return `${PROJECT_SELECT_PATH}?redirect=${encodeURIComponent(normalized)}`;
}

export function resolvePortalProjectSwitchPath(pathname?: string): string {
  const normalized = typeof pathname === 'string' ? pathname.trim() : '';
  if (!normalized.startsWith('/portal')) return PROJECT_SWITCH_FALLBACK_PATH;
  if (normalized === PROJECT_SELECT_PATH || normalized.startsWith(`${PROJECT_SELECT_PATH}/`)) return PROJECT_SWITCH_FALLBACK_PATH;
  return normalized || PROJECT_SWITCH_FALLBACK_PATH;
}
```

- [ ] **Step 4: Run the helper tests again**

Run: `npx vitest run src/app/platform/portal-project-selection.test.ts`

Expected: PASS with 4 tests green.

- [ ] **Step 5: Commit the helper layer**

```bash
git add src/app/platform/portal-project-selection.ts src/app/platform/portal-project-selection.test.ts
git commit -m "feat(portal): add project selection helpers"
```

### Task 2: Split Portal Primary Project From Session Active Project

**Files:**
- Modify: `src/app/data/portal-store.tsx`
- Test: `src/app/platform/portal-project-selection.test.ts`

- [ ] **Step 1: Extend helper coverage for session-first resolution**

```ts
it('falls back from a stale session project to the stored primary project and then the first candidate', () => {
  expect(resolveActivePortalProjectId({
    activeProjectId: 'missing-project',
    primaryProjectId: 'p-assigned',
    candidateProjectIds: ['p-assigned', 'p-managed'],
  })).toBe('p-assigned');

  expect(resolveActivePortalProjectId({
    activeProjectId: '',
    primaryProjectId: '',
    candidateProjectIds: ['p-managed', 'p-assigned'],
  })).toBe('p-managed');
});
```

- [ ] **Step 2: Run the updated helper tests and verify the new case fails**

Run: `npx vitest run src/app/platform/portal-project-selection.test.ts`

Expected: FAIL until `resolveActivePortalProjectId` and store hydration rules are wired for the empty/stale cases.

- [ ] **Step 3: Wire session active project into the portal store**

```ts
interface PortalState {
  isRegistered: boolean;
  isLoading: boolean;
  portalUser: PortalUser | null;
  activeProjectId: string;
  projects: Project[];
  myProject: Project | null;
}

interface PortalActions {
  register: (
    user: Omit<PortalUser, 'id' | 'registeredAt' | 'projectId' | 'projectIds'> & {
      projectId?: string;
      projectIds?: string[];
    },
  ) => Promise<boolean>;
  setSessionActiveProject: (projectId: string) => Promise<boolean>;
  logout: () => void;
}

const ACTIVE_PROJECT_SESSION_KEY = 'mysc-portal-active-project';
const [activeProjectId, setActiveProjectId] = useState('');

const candidateProjects = useMemo(() => resolvePortalProjectCandidates({
  role: authUser?.role,
  authUid: authUser?.uid,
  assignedProjectIds: normalizeProjectIds([
    ...(Array.isArray(portalUser?.projectIds) ? portalUser.projectIds : []),
    portalUser?.projectId,
    ...(Array.isArray(authUser?.projectIds) ? authUser.projectIds : []),
    authUser?.projectId,
  ]),
  projects,
}), [authUser?.projectId, authUser?.projectIds, authUser?.role, authUser?.uid, portalUser?.projectId, portalUser?.projectIds, projects]);

const candidateProjectIds = useMemo(
  () => candidateProjects.searchProjects.map((project) => project.id),
  [candidateProjects.searchProjects],
);

useEffect(() => {
  if (typeof sessionStorage === 'undefined' || !authUser?.uid) return;
  const saved = sessionStorage.getItem(`${ACTIVE_PROJECT_SESSION_KEY}:${authUser.uid}`) || '';
  setActiveProjectId(saved);
}, [authUser?.uid]);

const resolvedActiveProjectId = useMemo(() => resolveActivePortalProjectId({
  activeProjectId,
  primaryProjectId: portalUser?.projectId || authUser?.projectId || '',
  candidateProjectIds,
}), [activeProjectId, authUser?.projectId, candidateProjectIds, portalUser?.projectId]);

useEffect(() => {
  if (typeof sessionStorage === 'undefined' || !authUser?.uid) return;
  if (!resolvedActiveProjectId) {
    sessionStorage.removeItem(`${ACTIVE_PROJECT_SESSION_KEY}:${authUser.uid}`);
    return;
  }
  sessionStorage.setItem(`${ACTIVE_PROJECT_SESSION_KEY}:${authUser.uid}`, resolvedActiveProjectId);
}, [authUser?.uid, resolvedActiveProjectId]);

const myProject = useMemo(
  () => projects.find((project) => project.id === resolvedActiveProjectId) || null,
  [projects, resolvedActiveProjectId],
);

const setSessionActiveProject = useCallback(async (projectId: string): Promise<boolean> => {
  const target = projectId.trim();
  if (!target) return false;
  if (!candidateProjectIds.includes(target)) {
    toast.error('선택 가능한 사업이 아닙니다.');
    return false;
  }
  setActiveProjectId(target);
  return true;
}, [candidateProjectIds]);
```

- [ ] **Step 4: Re-run the helper tests after the store split**

Run: `npx vitest run src/app/platform/portal-project-selection.test.ts`

Expected: PASS, including the stale-session fallback case.

- [ ] **Step 5: Commit the store split**

```bash
git add src/app/data/portal-store.tsx src/app/platform/portal-project-selection.test.ts
git commit -m "feat(portal): split primary and session active project"
```

### Task 3: Add `/portal/project-select` And Route Portal Entry Through It

**Files:**
- Create: `src/app/components/portal/PortalProjectSelectPage.tsx`
- Create: `src/app/components/portal/PortalProjectSelectPage.shell.test.ts`
- Modify: `src/app/routes.tsx`
- Modify: `src/app/platform/navigation.ts`
- Modify: `src/app/platform/navigation.test.ts`
- Modify: `src/app/components/auth/LoginPage.tsx`
- Modify: `src/app/components/auth/WorkspaceSelectPage.tsx`
- Modify: `src/app/components/portal/PortalLayout.tsx`

- [ ] **Step 1: Add failing routing and page-contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { resolvePortalEntryPath, shouldForcePortalOnboarding } from '../../platform/navigation';

it('routes portal logins through /portal/project-select while preserving the requested portal path', () => {
  expect(resolvePortalEntryPath('pm', undefined, '/portal/budget')).toBe('/portal/project-select?redirect=%2Fportal%2Fbudget');
  expect(resolvePortalEntryPath('admin', 'portal', '/portal/cashflow')).toBe('/portal/project-select?redirect=%2Fportal%2Fcashflow');
  expect(resolvePortalEntryPath('admin', 'admin', '/settings')).toBe('/settings');
});

it('does not force onboarding on the project-select route', () => {
  expect(shouldForcePortalOnboarding({
    isAuthenticated: true,
    role: 'pm',
    isRegistered: false,
    pathname: '/portal/project-select',
  })).toBe(false);
});
```

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalProjectSelectPage.tsx'), 'utf8');

describe('PortalProjectSelectPage shell', () => {
  it('keeps the page focused on current-session project choice only', () => {
    expect(source).toContain('오늘 작업할 사업 선택');
    expect(source).toContain('이 사업으로 시작');
    expect(source).toContain('data-testid="portal-project-select-page"');
    expect(source).not.toContain('주사업으로 지정');
    expect(source).not.toContain('증빙 드라이브 연결');
  });
});
```

- [ ] **Step 2: Run the routing and shell tests and verify they fail**

Run: `npx vitest run src/app/platform/navigation.test.ts src/app/components/portal/PortalProjectSelectPage.shell.test.ts`

Expected: FAIL because `resolvePortalEntryPath` and `PortalProjectSelectPage.tsx` do not exist yet.

- [ ] **Step 3: Implement the new route, page, and portal-entry guard**

```ts
// src/app/platform/navigation.ts
import { resolvePortalProjectSelectPath } from './portal-project-selection';

export function resolvePortalEntryPath(
  role: unknown,
  preferredWorkspace: WorkspaceId | unknown,
  requestedPath?: unknown,
): string {
  const target = resolvePostLoginPath(role, preferredWorkspace, requestedPath);
  if (target === '/portal' || target.startsWith('/portal/')) {
    return resolvePortalProjectSelectPath(target);
  }
  return target;
}

const bypassPaths = [
  '/portal/onboarding',
  '/portal/project-settings',
  '/portal/project-select',
  '/portal/register-project',
  '/portal/weekly-expenses',
];
```

```tsx
// src/app/components/auth/LoginPage.tsx + WorkspaceSelectPage.tsx
const target = resolvePortalEntryPath(user.role, activeWorkspace, redirectFrom);
navigate(target, { replace: true });
```

```tsx
// src/app/routes.tsx
const PortalProjectSelectPage = lazy(() => import('./components/portal/PortalProjectSelectPage').then(m => ({ default: m.PortalProjectSelectPage })));

{ path: 'project-select', element: <S C={PortalProjectSelectPage} /> },
```

```tsx
// src/app/components/portal/PortalProjectSelectPage.tsx
export function PortalProjectSelectPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isLoading: authLoading, user: authUser } = useAuth();
  const { isRegistered, isLoading: portalLoading, portalUser, activeProjectId, projects, setSessionActiveProject } = usePortalStore();
  const redirectTo = resolveRequestedRedirectPath(undefined, location.search) || '/portal';
  const assignedProjectIds = normalizeProjectIds([
    ...(Array.isArray(portalUser?.projectIds) ? portalUser.projectIds : []),
    portalUser?.projectId,
    ...(Array.isArray(authUser?.projectIds) ? authUser.projectIds : []),
    authUser?.projectId,
  ]);
  const candidates = resolvePortalProjectCandidates({
    role: authUser?.role,
    authUid: authUser?.uid,
    assignedProjectIds,
    projects,
  });

  useEffect(() => {
    if (authLoading || portalLoading) return;
    if (!isAuthenticated) {
      navigate('/login', { replace: true, state: { from: '/portal/project-select' } });
      return;
    }
    if (!canEnterPortalWorkspace(authUser?.role)) {
      navigate('/', { replace: true });
      return;
    }
    if (!isRegistered && authUser?.role === 'pm') {
      navigate('/portal/onboarding', { replace: true });
    }
  }, [authLoading, authUser?.role, isAuthenticated, isRegistered, navigate, portalLoading]);

  return (
    <div data-testid="portal-project-select-page">
      <h1>오늘 작업할 사업 선택</h1>
      <Input placeholder="사업명, 클라이언트, 유형, 담당자로 검색" />
      {candidates.priorityProjects.map((project) => (
        <Button
          key={project.id}
          data-testid={`portal-project-start-${project.id}`}
          variant={activeProjectId === project.id ? 'default' : 'outline'}
          onClick={() => void setSessionActiveProject(project.id).then((ok) => {
            if (ok) navigate(redirectTo, { replace: true });
          })}
        >
          이 사업으로 시작
        </Button>
      ))}
    </div>
  );
}
```

```tsx
// src/app/components/portal/PortalLayout.tsx
useEffect(() => {
  if (authLoading || portalLoading) return;
  if (!isAuthenticated || !canEnterPortalWorkspace(authUser?.role)) return;
  if (!isRegistered && authUser?.role === 'pm') return;
  if (activeProjectId) return;
  if (location.pathname === '/portal/project-select') return;
  navigate(resolvePortalProjectSelectPath(currentPath), { replace: true });
}, [activeProjectId, authLoading, authUser?.role, currentPath, isAuthenticated, isRegistered, location.pathname, navigate, portalLoading]);
```

- [ ] **Step 4: Run the routing and shell suite again**

Run: `npx vitest run src/app/platform/navigation.test.ts src/app/components/portal/PortalProjectSelectPage.shell.test.ts`

Expected: PASS with the new `/portal/project-select` contract locked in.

- [ ] **Step 5: Commit the entry-flow work**

```bash
git add src/app/components/portal/PortalProjectSelectPage.tsx src/app/components/portal/PortalProjectSelectPage.shell.test.ts src/app/routes.tsx src/app/platform/navigation.ts src/app/platform/navigation.test.ts src/app/components/auth/LoginPage.tsx src/app/components/auth/WorkspaceSelectPage.tsx src/app/components/portal/PortalLayout.tsx
git commit -m "feat(portal): route portal entry through project select"
```

### Task 4: Convert The Header Search Into A Project Switcher

**Files:**
- Modify: `src/app/platform/portal-shell-actions.ts`
- Modify: `src/app/platform/portal-shell-actions.test.ts`
- Modify: `src/app/components/portal/PortalLayout.tsx`
- Modify: `src/app/components/portal/PortalLayout.shell.test.ts`

- [ ] **Step 1: Write the failing palette tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildPortalShellCommandItems } from './portal-shell-actions';

describe('portal shell actions', () => {
  it('builds project switch items only plus the admin escape hatch', () => {
    const items = buildPortalShellCommandItems({
      role: 'admin',
      currentPath: '/portal/budget',
      currentProject: { id: 'project-1', name: '2026 더큰 제주' },
      availableProjects: [
        { id: 'project-1', name: '2026 더큰 제주' },
        { id: 'project-2', name: '현대 모비스 CSV OI 컨설팅' },
      ],
    });

    expect(items.some((item) => item.kind === 'portal')).toBe(false);
    expect(items.find((item) => item.id === 'project:project-2')?.to).toBe('/portal/budget');
    expect(items.some((item) => item.id === 'admin:home')).toBe(true);
  });
});
```

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalLayoutSource = readFileSync(resolve(import.meta.dirname, 'PortalLayout.tsx'), 'utf8');

describe('PortalLayout shell actions', () => {
  it('turns the top search into a project switcher', () => {
    expect(portalLayoutSource).toContain('title="사업 전환"');
    expect(portalLayoutSource).toContain('담당 사업 검색 또는 전환');
    expect(portalLayoutSource).toContain('일치하는 사업이 없습니다.');
    expect(portalLayoutSource).toContain('data-testid="portal-project-switch-trigger"');
    expect(portalLayoutSource).toContain("item.kind === 'project'");
    expect(portalLayoutSource).not.toContain('포털 빠른 이동');
    expect(portalLayoutSource).not.toContain('빠른 이동, 담당 사업, 화면 검색');
  });
});
```

- [ ] **Step 2: Run the palette tests and verify they fail**

Run: `npx vitest run src/app/platform/portal-shell-actions.test.ts src/app/components/portal/PortalLayout.shell.test.ts`

Expected: FAIL because nav items still exist and the old copy is still present.

- [ ] **Step 3: Replace menu search with project switching**

```ts
// src/app/platform/portal-shell-actions.ts
import { resolvePortalProjectSwitchPath } from './portal-project-selection';

export function buildPortalShellCommandItems(input: {
  role: string | null | undefined;
  currentPath: string;
  currentProject?: PortalShellProjectItem | null;
  availableProjects: PortalShellProjectItem[];
}): PortalShellCommandItem[] {
  const projectItems = input.availableProjects.map((project) => ({
    id: `project:${project.id}`,
    label: project.name,
    description: input.currentProject?.id === project.id ? '현재 작업 사업입니다.' : '현재 화면을 유지한 채 이 사업으로 전환',
    category: '사업' as const,
    kind: 'project' as const,
    to: resolvePortalProjectSwitchPath(input.currentPath),
    projectId: project.id,
    keywords: [project.name, project.id, '사업 전환', '담당 사업'],
  }));

  const adminItems = String(input.role || '').toLowerCase() === 'admin' || String(input.role || '').toLowerCase() === 'finance'
    ? [{
      id: 'admin:home',
      label: '관리자 공간',
      description: '전사 운영 화면으로 이동',
      category: '관리' as const,
      kind: 'admin' as const,
      to: '/',
      keywords: ['admin', '관리자', '대시보드'],
    }]
    : [];

  return [...projectItems, ...adminItems];
}
```

```tsx
// src/app/components/portal/PortalLayout.tsx
const {
  activeProjectId,
  isRegistered,
  myProject,
  portalUser,
  projects,
  setSessionActiveProject,
} = usePortalStore();

const candidateProjects = useMemo(() => resolvePortalProjectCandidates({
  role: authUser?.role,
  authUid: authUser?.uid,
  assignedProjectIds: normalizeProjectIds([
    ...(Array.isArray(portalUser?.projectIds) ? portalUser.projectIds : []),
    portalUser?.projectId,
    ...(Array.isArray(authUser?.projectIds) ? authUser.projectIds : []),
    authUser?.projectId,
  ]),
  projects,
}), [authUser?.projectId, authUser?.projectIds, authUser?.role, authUser?.uid, portalUser?.projectId, portalUser?.projectIds, projects]);

const selectedProjectOptionValue = currentProject?.id || '';
const shellCommandItems = buildPortalShellCommandItems({
  role: authUser?.role,
  currentPath: currentPath,
  currentProject: currentProject ? { id: currentProject.id, name: currentProject.name } : null,
  availableProjects: candidateProjects.searchProjects.map((project) => ({ id: project.id, name: project.name })),
});

<button
  type="button"
  data-testid="portal-project-switch-trigger"
  onClick={() => setCommandOpen(true)}
>
  <span className="truncate text-[12px] text-slate-300">담당 사업 검색 또는 전환</span>
</button>

<CommandDialog title="사업 전환" description="지금 보고 있는 화면을 유지한 채 다른 사업으로 전환합니다.">
  <CommandInput placeholder="담당 사업 검색 또는 전환..." />
  <CommandEmpty>일치하는 사업이 없습니다.</CommandEmpty>
  <CommandGroup heading="사업 전환">
    {shellCommandItems.map((item) => (
      <CommandItem
        key={item.id}
        onSelect={() => {
          setCommandOpen(false);
          if (item.kind === 'admin') {
            requestAdminNavigation();
            return;
          }
          if (item.projectId) {
            void setSessionActiveProject(item.projectId).then((ok) => {
              if (ok) requestPortalNavigation(item.to, item.label);
            });
          }
        }}
      />
    ))}
  </CommandGroup>
</CommandDialog>
```

- [ ] **Step 4: Re-run the palette and shell tests**

Run: `npx vitest run src/app/platform/portal-shell-actions.test.ts src/app/components/portal/PortalLayout.shell.test.ts`

Expected: PASS with the old menu-search copy removed.

- [ ] **Step 5: Commit the header switcher**

```bash
git add src/app/platform/portal-shell-actions.ts src/app/platform/portal-shell-actions.test.ts src/app/components/portal/PortalLayout.tsx src/app/components/portal/PortalLayout.shell.test.ts
git commit -m "feat(portal): turn header search into project switcher"
```

### Task 5: Trim `사업 배정 수정` Down To Assignment And Primary Project Only

**Files:**
- Create: `src/app/components/portal/PortalProjectSettings.shell.test.ts`
- Modify: `src/app/components/portal/PortalProjectSettings.tsx`

- [ ] **Step 1: Add the failing project-settings shell test**

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalProjectSettings.tsx'), 'utf8');

describe('PortalProjectSettings shell', () => {
  it('keeps only assignment and primary-project controls', () => {
    expect(source).toContain('사업 배정 수정');
    expect(source).toContain('주사업으로 지정');
    expect(source).toContain('선택 취소');
    expect(source).not.toContain('최근 사용한 사업');
    expect(source).not.toContain('증빙 드라이브 연결');
    expect(source).not.toContain('Google Drive 폴더 링크 또는 폴더 ID');
  });
});
```

- [ ] **Step 2: Run the shell test and verify it fails**

Run: `npx vitest run src/app/components/portal/PortalProjectSettings.shell.test.ts`

Expected: FAIL because the current page still renders recent projects and the evidence-drive editor.

- [ ] **Step 3: Remove the extra surfaces and tighten the save flow**

```tsx
// src/app/components/portal/PortalProjectSettings.tsx
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FolderKanban, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { toast } from 'sonner';

const { register, isRegistered, isLoading, portalUser, projects } = usePortalStore();
const [projectSearch, setProjectSearch] = useState('');
const [showSelectedOnly, setShowSelectedOnly] = useState(false);
const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>('ALL');

<h1 className="text-[22px]" style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>사업 배정 수정</h1>
<p className="text-[12px] text-muted-foreground">내 사업을 선택하고 주사업을 지정하세요.</p>

<div className="rounded-xl border border-teal-200/70 bg-teal-50/80 px-4 py-3">
  <p className="text-[11px] text-teal-700" style={{ fontWeight: 700 }}>현재 선택 상태</p>
  <p className="text-[13px] text-slate-900" style={{ fontWeight: 700 }}>
    {projectIds.length > 0 ? `${projectIds.length}개 사업 선택됨` : '아직 선택한 사업이 없습니다'}
  </p>
  <p className="mt-2 text-[11px] text-teal-800/80">저장하면 주사업과 내 사업 목록이 바로 포털에 반영됩니다.</p>
</div>

const handleSave = async () => {
  setError('');

  if (!authUser) {
    setError('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.');
    return;
  }

  const normalized = normalizeProjectIds(projectIds);
  if (normalized.length === 0) {
    setError('최소 1개 이상의 사업을 선택해 주세요.');
    return;
  }

  const primary = resolvePrimaryProjectId(normalized, primaryProjectId || normalized[0]);
  if (!primary) {
    setError('주사업을 선택해 주세요.');
    return;
  }

  setSaving(true);
  const ok = await register({
    name: authUser.name,
    email: authUser.email,
    role: authUser.role || 'pm',
    projectId: primary,
    projectIds: normalized,
  });
  setSaving(false);

  if (!ok) {
    setError('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    return;
  }
  toast.success(primary ? `주사업 저장 완료: ${allProjects.find((project) => project.id === primary)?.name || primary}` : '사업 배정 저장 완료');
  navigate('/portal', { replace: true });
};
```

- [ ] **Step 4: Re-run the project-settings shell test**

Run: `npx vitest run src/app/components/portal/PortalProjectSettings.shell.test.ts`

Expected: PASS with the drive/recent strings removed.

- [ ] **Step 5: Commit the simplified settings surface**

```bash
git add src/app/components/portal/PortalProjectSettings.tsx src/app/components/portal/PortalProjectSettings.shell.test.ts
git commit -m "feat(portal): simplify project settings surface"
```

### Task 6: Add End-To-End Portal Selection And Switch Regressions

**Files:**
- Modify: `tests/e2e/platform-smoke.spec.ts`
- Test: `src/app/platform/portal-project-selection.test.ts`
- Test: `src/app/platform/navigation.test.ts`
- Test: `src/app/platform/portal-shell-actions.test.ts`
- Test: `src/app/components/portal/PortalLayout.shell.test.ts`
- Test: `src/app/components/portal/PortalProjectSelectPage.shell.test.ts`
- Test: `src/app/components/portal/PortalProjectSettings.shell.test.ts`

- [ ] **Step 1: Add the failing Playwright coverage**

```ts
test('PM requested route waits for project selection before landing on weekly expenses', async ({ page }) => {
  await page.goto('/login?redirect=%2Fportal%2Fweekly-expenses');
  await page.getByRole('button', { name: 'PM 샘플 로그인' }).click();
  await expect(page).toHaveURL(/\/portal\/project-select\?redirect=%2Fportal%2Fweekly-expenses$/);
  await page.getByTestId(/^portal-project-start-/).first().click();
  await expect(page).toHaveURL(/\/portal\/weekly-expenses$/);
});

test('project switch keeps the current portal route', async ({ page }) => {
  await page.goto('/login?redirect=%2Fportal%2Fbudget');
  await page.getByRole('button', { name: 'PM 샘플 로그인' }).click();
  await page.getByTestId(/^portal-project-start-/).first().click();
  await expect(page).toHaveURL(/\/portal\/budget$/);

  await page.getByTestId('portal-project-switch-trigger').click();
  await page.getByText('현대 모비스 CSV OI 컨설팅').click();
  await expect(page).toHaveURL(/\/portal\/budget$/);
});
```

- [ ] **Step 2: Run the targeted Playwright test and verify it fails**

Run: `npm run test:e2e -- tests/e2e/platform-smoke.spec.ts --grep "project selection|project switch"`

Expected: FAIL because the new chooser page and `data-testid` hooks are not fully wired yet.

- [ ] **Step 3: Add any missing test hooks and polish the route-preserving switch behavior**

```tsx
// src/app/components/portal/PortalProjectSelectPage.tsx
<div data-testid="portal-project-select-page">
  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="사업명, 클라이언트, 유형, 담당자로 검색" />
  {visibleProjects.map((project) => (
    <Button
      key={project.id}
      data-testid={`portal-project-start-${project.id}`}
      variant={activeProjectId === project.id ? 'default' : 'outline'}
      onClick={() => void setSessionActiveProject(project.id).then((ok) => {
        if (ok) navigate(redirectTo, { replace: true });
      })}
    >
      이 사업으로 시작
    </Button>
  ))}
</div>

// src/app/components/portal/PortalLayout.tsx
<button
  type="button"
  data-testid="portal-project-switch-trigger"
  onClick={() => setCommandOpen(true)}
  className="flex h-10 w-full max-w-xl items-center gap-2 rounded-xl border border-white/15 bg-white/8 px-3 text-left text-slate-200 transition-colors hover:bg-white/12"
>
  <span className="truncate text-[12px] text-slate-300">담당 사업 검색 또는 전환</span>
</button>
```

- [ ] **Step 4: Run the full targeted regression bundle**

Run: `npx vitest run src/app/platform/portal-project-selection.test.ts src/app/platform/navigation.test.ts src/app/platform/portal-shell-actions.test.ts src/app/components/portal/PortalLayout.shell.test.ts src/app/components/portal/PortalProjectSelectPage.shell.test.ts src/app/components/portal/PortalProjectSettings.shell.test.ts`

Expected: PASS for all targeted Vitest files.

Run: `npm run test:e2e -- tests/e2e/platform-smoke.spec.ts --grep "project selection|project switch"`

Expected: PASS for the new portal-selection and route-preserving switch tests.

- [ ] **Step 5: Commit the regressions and final portal-switch flow**

```bash
git add tests/e2e/platform-smoke.spec.ts src/app/platform/portal-project-selection.test.ts src/app/platform/navigation.test.ts src/app/platform/portal-shell-actions.test.ts src/app/components/portal/PortalLayout.shell.test.ts src/app/components/portal/PortalProjectSelectPage.shell.test.ts src/app/components/portal/PortalProjectSettings.shell.test.ts src/app/components/portal/PortalProjectSelectPage.tsx src/app/components/portal/PortalLayout.tsx
git commit -m "test(portal): cover project selection and switching flow"
```

## Self-Review

- Spec coverage:
  - Login/workspace-select to project-select: Task 3
  - Session `activeProjectId` separated from stored primary project: Task 2
  - Header search becomes project switcher with route preservation: Tasks 1 and 4
  - `사업 배정 수정` trimmed to assignment/primary only: Task 5
  - PM/admin/finance candidate access rules: Tasks 1 and 2
  - Requested portal route restoration and regression coverage: Tasks 3 and 6
- Placeholder scan:
  - No `TODO`, `TBD`, “appropriate handling”, or unspecified “write tests later” placeholders remain.
- Type consistency:
  - `activeProjectId`, `setSessionActiveProject`, `resolvePortalProjectCandidates`, `resolvePortalProjectSelectPath`, and `resolvePortalEntryPath` are named consistently across tasks.
