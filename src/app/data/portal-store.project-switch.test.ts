// @vitest-environment happy-dom
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authUser = {
  uid: 'u1',
  name: '사용자',
  email: 'user@example.com',
  role: 'pm',
  projectId: '',
  projectIds: ['p1', 'p2'],
};
const db = {};

vi.mock('./auth-store', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: authUser }),
}));

vi.mock('../lib/firebase-context', () => ({
  useFirebase: () => ({ db, isOnline: true, orgId: 'org1' }),
}));

vi.mock('./firestore-realtime-mode', () => ({
  useFirestoreAccessPolicy: () => ({ allowRealtimeListeners: true }),
}));

vi.mock('../lib/firestore-service', () => ({
  listenMembers: (_db: unknown, _orgId: string, onData: (rows: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  },
}));

vi.mock('firebase/firestore', () => {
  const pathOf = (target: any) => target?.path || target?.base?.path || '';
  const projectIdOf = (target: any) => target?.constraints?.find((item: any) => item?.field === 'projectId')?.value || '';
  const listSnap = (rows: any[]) => ({
    docs: rows.map((row) => ({ id: row.id, data: () => row })),
  });
  const emptyDoc = { exists: () => false, data: () => undefined };

  return {
    collection: (_db: unknown, path: string) => ({ path }),
    doc: (_db: unknown, path: string) => ({ path }),
    documentId: () => '__name__',
    limit: (value: number) => ({ limit: value }),
    where: (field: string, op: string, value: string) => ({ field, op, value }),
    query: (base: unknown, ...constraints: unknown[]) => ({ base, constraints }),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    getDoc: vi.fn(async (ref: any) => {
      if (pathOf(ref).includes('/members/')) {
        return {
          exists: () => true,
          data: () => ({
            name: authUser.name,
            email: authUser.email,
            role: authUser.role,
            projectIds: authUser.projectIds,
            projectId: '',
            status: 'ACTIVE',
          }),
        };
      }
      return emptyDoc;
    }),
    onSnapshot: vi.fn((target: any, onData: (snap: any) => void) => {
      const path = pathOf(target);
      const projectId = projectIdOf(target);
      if (path.endsWith('/projects')) {
        onData(listSnap([
          { id: 'p1', name: '프로젝트 1' },
          { id: 'p2', name: '프로젝트 2' },
        ]));
      } else if (path.endsWith('/ledgers') && projectId === 'p1') {
        onData(listSnap([{ id: 'p1-ledger', projectId: 'p1', name: 'P1 원장' }]));
      } else if (!path.endsWith('/ledgers') || projectId !== 'p2') {
        onData(path.includes('evidence') || path.includes('budget') || path.includes('bank_statement')
          ? emptyDoc
          : listSnap([]));
      }
      return () => undefined;
    }),
  };
});

import { PortalProvider, usePortalStore } from './portal-store';

function Probe() {
  const { activeProjectId, isLoading, ledgers, projects, setSessionActiveProject } = usePortalStore();

  useEffect(() => {
    if (!activeProjectId && projects.some((project) => project.id === 'p1')) {
      void setSessionActiveProject('p1');
    }
  }, [activeProjectId, projects, setSessionActiveProject]);

  return React.createElement(
    'div',
    null,
    React.createElement('output', { 'data-testid': 'project' }, activeProjectId),
    React.createElement('output', { 'data-testid': 'loading' }, isLoading ? 'loading' : 'ready'),
    React.createElement('output', { 'data-testid': 'rows' }, ledgers.map((ledger) => ledger.name).join(',')),
    React.createElement('button', { onClick: () => void setSessionActiveProject('p2') }, 'P2 전환'),
  );
}

async function waitFor(assertion: () => void) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  assertion();
}

describe('PortalProvider project switch', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('hides P1 rows and exposes loading immediately after switching to P2', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    root.render(React.createElement(PortalProvider, null, React.createElement(Probe)));
    await waitFor(() => {
      expect(container.querySelector('[data-testid="project"]')?.textContent).toBe('p1');
      expect(container.querySelector('[data-testid="rows"]')?.textContent).toContain('P1 원장');
      expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe('ready');
    });

    (container.querySelector('button') as HTMLButtonElement).click();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="project"]')?.textContent).toBe('p2');
    });

    expect(container.querySelector('[data-testid="project"]')?.textContent).toBe('p2');
    expect(container.querySelector('[data-testid="rows"]')?.textContent).not.toContain('P1 원장');
    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe('loading');

    root.unmount();
  });
});
