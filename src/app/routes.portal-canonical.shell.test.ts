import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'routes.tsx'), 'utf8');
const cashflowSource = readFileSync(resolve(import.meta.dirname, 'components/portal/PortalCashflowPage.tsx'), 'utf8');
const adminCashflowSource = readFileSync(resolve(import.meta.dirname, 'components/cashflow/ProjectCashflowSheetPage.tsx'), 'utf8');
const projectEditSource = readFileSync(resolve(import.meta.dirname, 'components/portal/PortalProjectEdit.tsx'), 'utf8');
const legacyProjectEditSource = readFileSync(resolve(import.meta.dirname, 'components/projects/ProjectWizardPage.tsx'), 'utf8');
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
    expect(source).toContain("{ path: 'project-approvals', element: <S C={ProjectAssigneeApprovalPage} /> }");
    expect(source).toContain("{ path: 'edit-project', element: <S C={PortalProjectEdit} /> }");
    expect(source).toContain("{ path: 'cashflow', element: <S C={PortalCashflowPage} /> }");
    expect(source).toContain("{ path: 'cashflow/sheets-lab', element: <S C={CashflowSheetLabPage} /> }");
  });

  it('lets the route project win and uses the session project for ID-less cashflow URLs', () => {
    expect(cashflowSource).toContain('useParams');
    expect(cashflowSource).toContain('activeProjectId');
    expect(cashflowSource).toContain('resolvePortalProjectResourceId(routeProjectId, activeProjectId);');
    expect(cashflowSource).toContain('<Navigate to="/portal/project-select" replace />');
    expect(cashflowSource).not.toContain('myProject');
    expect(sheetLabSource).toContain('useParams');
    expect(sheetLabSource).toContain('routeProjectId');
    // 시트 연동 화면은 route projectId와 상단 선택 프로젝트를 한 프로젝트로 맞춘 뒤 URL을 정규화한다.
    expect(sheetLabSource).toContain('resolvePortalProjectContextSync');
    expect(sheetLabSource).toContain('navigate(projectContextPath, { replace: true })');
  });

  it('remounts the finance screen when the project resource changes', () => {
    expect(cashflowSource).toContain('key={projectId}');
    expect(adminCashflowSource).toContain('key={projectId}');
  });

  it('resolves project edit from the exact route resource without stale session fallback', () => {
    expect(projectEditSource).toContain('useParams');
    expect(projectEditSource).toContain('myProject: sessionProject');
    expect(projectEditSource).toContain('projects.find((project) => project.id === routeProjectId)');
    expect(projectEditSource).toContain('routeProjectId ? routeProject : fallbackProject');
    expect(projectEditSource).toContain("navigate(resolvePortalProjectResourcePath(currentPath, project.id), { replace: true })");
  });

  it('redirects the legacy admin edit URL to the lease-protected canonical editor', () => {
    expect(legacyProjectEditSource).toContain('Navigate');
    expect(legacyProjectEditSource).toContain('/portal/edit-project/');
    expect(legacyProjectEditSource).not.toContain('<ProjectWizard');
    expect(legacyProjectEditSource).not.toContain('getProjectById');
  });
});
