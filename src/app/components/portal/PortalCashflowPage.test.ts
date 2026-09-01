import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type PortalStoreState = {
  isLoading: boolean;
  isProjectCatalogReady: boolean;
  activeProjectId: string;
  members: unknown[];
  portalUser: { role: string } | null;
  projects: Array<{ id: string; name: string }>;
  patchProjectSnapshot: ReturnType<typeof vi.fn>;
  upsertWeeklySubmissionStatus: ReturnType<typeof vi.fn>;
};

let portalStoreState: PortalStoreState;
let routeProjectId = '';

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return {
    ...actual,
    useParams: () => ({ projectId: routeProjectId }),
    Navigate: () => React.createElement('div', null, '프로젝트 선택'),
  };
});

vi.mock('../../data/portal-store', () => ({
  usePortalStore: () => portalStoreState,
}));

vi.mock('../cashflow/CashflowProjectSheet', () => ({
  CashflowProjectSheet: ({ projectId }: { projectId: string }) => React.createElement(
    'div',
    { 'data-testid': 'cashflow-project' },
    projectId,
  ),
}));

import { PortalCashflowPage } from './PortalCashflowPage';

function renderCashflow(path = '/portal/cashflow') {
  routeProjectId = path.startsWith('/portal/cashflow/')
    ? decodeURIComponent(path.slice('/portal/cashflow/'.length))
    : '';
  return renderToStaticMarkup(React.createElement(PortalCashflowPage));
}

describe('PortalCashflowPage', () => {
  beforeEach(() => {
    routeProjectId = '';
    portalStoreState = {
      isLoading: false,
      isProjectCatalogReady: true,
      activeProjectId: '',
      members: [],
      portalUser: { role: 'admin' },
      projects: [],
      patchProjectSnapshot: vi.fn(),
      upsertWeeklySubmissionStatus: vi.fn(),
    };
  });

  it('keeps the cashflow route during the gap before the project catalog query starts', () => {
    portalStoreState.isLoading = false;
    portalStoreState.isProjectCatalogReady = false;

    const html = renderCashflow();

    expect(html).toContain('프로젝트 목록을 불러오는 중');
    expect(html).not.toContain('프로젝트 선택');
  });

  it('renders the existing active project without changing the working account path', () => {
    portalStoreState.activeProjectId = 'project-a';
    portalStoreState.projects = [{ id: 'project-a', name: '사업 A' }];

    expect(renderCashflow()).toContain('project-a');
  });

  it('keeps an explicit project URL authoritative before the catalog finishes loading', () => {
    portalStoreState.isLoading = true;

    expect(renderCashflow('/portal/cashflow/project-direct')).toContain('project-direct');
  });

  it('redirects only after a completed catalog contains no projects', () => {
    portalStoreState.isProjectCatalogReady = true;

    expect(renderCashflow()).toContain('프로젝트 선택');
  });
});
