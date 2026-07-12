import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'routes.tsx'), 'utf8');
const cashflowSource = readFileSync(resolve(import.meta.dirname, 'components/portal/PortalCashflowPage.tsx'), 'utf8');
const projectEditSource = readFileSync(resolve(import.meta.dirname, 'components/portal/PortalProjectEdit.tsx'), 'utf8');
const sheetLabSource = readFileSync(resolve(import.meta.dirname, 'features/cashflow-sheet-compare/CashflowSheetLabPage.tsx'), 'utf8');

describe('portal canonical edit resource routes', () => {
  it('registers project and draft identities in canonical portal URLs', () => {
    expect(source).toContain("{ path: 'register-project/:draftId', element: <S C={PortalProjectRegister} /> }");
    expect(source).toContain("{ path: 'edit-project/:projectId', element: <S C={PortalProjectEdit} /> }");
    expect(source).toContain("{ path: 'cashflow/:projectId', element: <S C={PortalCashflowPage} /> }");
    expect(source).toContain("{ path: 'cashflow/:projectId/sheets-lab', element: <S C={CashflowSheetLabPage} /> }");
  });

  it('keeps ID-less legacy entry routes available for SPA migration', () => {
    expect(source).toContain("{ path: 'register-project', element: <S C={PortalProjectRegister} /> }");
    expect(source).toContain("{ path: 'edit-project', element: <S C={PortalProjectEdit} /> }");
    expect(source).toContain("{ path: 'cashflow', element: <S C={PortalCashflowPage} /> }");
    expect(source).toContain("{ path: 'cashflow/sheets-lab', element: <S C={CashflowSheetLabPage} /> }");
  });

  it('lets the route project win and replaces ID-less cashflow URLs in the SPA', () => {
    expect(cashflowSource).toContain('useParams');
    expect(cashflowSource).toContain('resolvePortalProjectResourceId(routeProjectId');
    expect(cashflowSource).toContain("navigate(resolvePortalProjectResourcePath(currentPath, projectId), { replace: true })");
    expect(sheetLabSource).toContain('useParams');
    expect(sheetLabSource).toContain('routeProjectId');
    expect(sheetLabSource).toContain("navigate(resolvePortalProjectResourcePath(currentPath, projectId), { replace: true })");
  });

  it('resolves project edit from the exact route resource without stale session fallback', () => {
    expect(projectEditSource).toContain('useParams');
    expect(projectEditSource).toContain('myProject: sessionProject');
    expect(projectEditSource).toContain('projects.find((project) => project.id === routeProjectId)');
    expect(projectEditSource).toContain('routeProjectId ? routeProject : fallbackProject');
    expect(projectEditSource).toContain("navigate(resolvePortalProjectResourcePath(currentPath, myProject.id), { replace: true })");
  });
});
