// @vitest-environment happy-dom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  useParams,
} from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setProjectSpy = vi.hoisted(() => vi.fn());

vi.mock('./portal-store', async () => {
  const React = await import('react');
  const projects = [
    { id: 'p1', name: '프로젝트 1' },
    { id: 'p2', name: '프로젝트 2' },
  ];
  const PortalStoreContext = React.createContext<any>(null);

  function PortalProvider({ children }: { children: React.ReactNode }) {
    const [activeProjectId, setActiveProjectId] = React.useState('p1');
    const setSessionActiveProject = React.useCallback(async (projectId: string) => {
      setProjectSpy(projectId);
      setActiveProjectId(projectId);
      return true;
    }, []);
    const value = React.useMemo(() => ({
      activeProjectId,
      isLoading: false,
      portalUser: { id: 'u1', name: '사용자', role: 'pm', projectIds: ['p1', 'p2'] },
      myProject: projects[0],
      logout: vi.fn(),
      changeRequests: [],
      projects,
      setSessionActiveProject,
    }), [activeProjectId, setSessionActiveProject]);
    return React.createElement(PortalStoreContext.Provider, { value }, children);
  }

  return {
    PortalProvider,
    usePortalStore: () => React.useContext(PortalStoreContext),
  };
});

vi.mock('./auth-store', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: {
      uid: 'u1',
      name: '사용자',
      role: 'pm',
      projectIds: ['p1', 'p2'],
      lastWorkspace: 'portal',
    },
    logout: vi.fn(),
    setWorkspacePreference: vi.fn(async () => undefined),
  }),
}));
vi.mock('./hr-announcements-store', () => ({ useHrAnnouncements: () => ({ getUnacknowledgedCount: () => 0 }) }));
vi.mock('./payroll-store', () => ({ usePayroll: () => ({ runs: [] }) }));

vi.mock('../components/ui/button', () => ({ Button: (props: any) => React.createElement('button', props) }));
vi.mock('../components/ui/badge', () => ({ Badge: (props: any) => React.createElement('span', props) }));
vi.mock('../components/ui/select', () => ({
  Select: ({ children }: any) => React.createElement(React.Fragment, null, children),
  SelectContent: ({ children }: any) => React.createElement(React.Fragment, null, children),
  SelectItem: ({ children }: any) => React.createElement(React.Fragment, null, children),
  SelectTrigger: ({ children }: any) => React.createElement(React.Fragment, null, children),
  SelectValue: () => null,
}));
vi.mock('../components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => React.createElement(React.Fragment, null, children),
  TooltipContent: ({ children }: any) => React.createElement(React.Fragment, null, children),
  TooltipProvider: ({ children }: any) => React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));
vi.mock('../components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => React.createElement(React.Fragment, null, children),
  DropdownMenuContent: ({ children }: any) => React.createElement(React.Fragment, null, children),
  DropdownMenuGroup: ({ children }: any) => React.createElement(React.Fragment, null, children),
  DropdownMenuItem: ({ children }: any) => React.createElement(React.Fragment, null, children),
  DropdownMenuLabel: ({ children }: any) => React.createElement(React.Fragment, null, children),
  DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));
vi.mock('../components/ui/command', () => ({
  CommandDialog: ({ children, open }: any) => open ? React.createElement('div', null, children) : null,
  CommandEmpty: ({ children }: any) => React.createElement(React.Fragment, null, children),
  CommandGroup: ({ children }: any) => React.createElement(React.Fragment, null, children),
  CommandInput: () => null,
  CommandItem: ({ children, onSelect }: any) => React.createElement('button', { onClick: onSelect }, children),
  CommandList: ({ children }: any) => React.createElement(React.Fragment, null, children),
  CommandSeparator: () => null,
  CommandShortcut: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));
vi.mock('../components/layout/DarkModeToggle', () => ({ DarkModeToggle: () => null }));
vi.mock('../components/layout/PageTransition', () => ({ PageTransition: ({ children }: any) => React.createElement(React.Fragment, null, children) }));
vi.mock('../components/layout/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: any) => React.createElement(React.Fragment, null, children) }));
vi.mock('../components/brand/MyscWordmark', () => ({ MyscWordmark: () => React.createElement('span', null, 'MYSC') }));

import { PortalLayout } from '../components/portal/PortalLayout';
import { usePortalStore } from './portal-store';

function ProjectProbe() {
  const { projectId } = useParams();
  const location = useLocation();
  const { activeProjectId } = usePortalStore();
  return React.createElement(
    'output',
    { 'data-testid': 'project-state' },
    `${location.pathname}|URL:${projectId}|STORE:${activeProjectId}`,
  );
}

function createPortalRouter(initialEntry: string) {
  return createMemoryRouter([{
    path: '/portal',
    element: React.createElement(PortalLayout),
    children: [
      { path: 'cashflow/:projectId', element: React.createElement(ProjectProbe) },
      { path: 'edit-project/:projectId', element: React.createElement(ProjectProbe) },
      { path: 'project-select', element: React.createElement('output', { 'data-testid': 'project-select' }, '프로젝트 선택') },
    ],
  }], { initialEntries: [initialEntry] });
}

async function waitFor(assertion: () => void) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await act(async () => undefined);
    }
  }
  assertion();
}

describe('PortalProvider URL project synchronization', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('keeps URL, content, and store aligned after switching projects and going back', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const router = createPortalRouter('/portal/cashflow/p1');
    const navigateSpy = vi.spyOn(router, 'navigate');

    await act(async () => root.render(React.createElement(RouterProvider, { router })));
    await waitFor(() => expect(container.querySelector('[data-testid="project-state"]')?.textContent)
      .toBe('/portal/cashflow/p1|URL:p1|STORE:p1'));

    await act(async () => {
      (container.querySelector('[data-testid="portal-project-switch-trigger"]') as HTMLButtonElement).click();
    });
    await waitFor(() => expect(container.textContent).toContain('프로젝트 2'));
    const projectTwoButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('프로젝트 2')) as HTMLButtonElement;
    await act(async () => projectTwoButton.click());

    await waitFor(() => expect(container.querySelector('[data-testid="project-state"]')?.textContent)
      .toBe('/portal/cashflow/p2|URL:p2|STORE:p2'));
    expect(navigateSpy.mock.calls.filter(([to]) => to === '/portal/cashflow/p2')).toHaveLength(1);

    await act(async () => { await router.navigate(-1); });
    await waitFor(() => expect(container.querySelector('[data-testid="project-state"]')?.textContent)
      .toBe('/portal/cashflow/p1|URL:p1|STORE:p1'));

    await act(async () => root.unmount());
  });

  it.each(['/portal/cashflow/p2', '/portal/edit-project/p2'])(
    'makes a direct project deep link authoritative: %s',
    async (initialEntry) => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const router = createPortalRouter(initialEntry);

      await act(async () => root.render(React.createElement(RouterProvider, { router })));
      await waitFor(() => expect(container.querySelector('[data-testid="project-state"]')?.textContent)
        .toContain('URL:p2|STORE:p2'));

      await act(async () => root.unmount());
    },
  );

  it('redirects an out-of-scope route project to project selection without backfilling', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const router = createPortalRouter('/portal/cashflow/outside');

    await act(async () => root.render(React.createElement(RouterProvider, { router })));
    await waitFor(() => expect(container.querySelector('[data-testid="project-select"]')?.textContent)
      .toBe('프로젝트 선택'));
    expect(setProjectSpy).not.toHaveBeenCalledWith('outside');

    await act(async () => root.unmount());
  });
});
