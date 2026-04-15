import { test, expect, type Page } from '@playwright/test';

const TEST_TENANT_ID = 'org001';
const PM_TEST_PROJECT_ID = 'p001';
const PM_TEST_USER = {
  source: 'dev_harness' as const,
  uid: 'u002',
  name: '데이나',
  email: 'dana@mysc.co.kr',
  role: 'pm' as const,
  tenantId: TEST_TENANT_ID,
  projectId: PM_TEST_PROJECT_ID,
  projectIds: [PM_TEST_PROJECT_ID],
  defaultWorkspace: 'portal' as const,
  lastWorkspace: 'portal' as const,
};
const ADMIN_TEST_USER = {
  source: 'dev_harness' as const,
  uid: 'u001',
  name: '변민욱',
  email: 'admin@mysc.co.kr',
  role: 'admin' as const,
  tenantId: TEST_TENANT_ID,
  defaultWorkspace: 'admin' as const,
  lastWorkspace: 'admin' as const,
};

async function seedHarnessSession(page: Page, session: typeof PM_TEST_USER | typeof ADMIN_TEST_USER) {
  await page.addInitScript((payload) => {
    window.localStorage.setItem('mysc-auth-user', JSON.stringify(payload));
    window.localStorage.setItem('mysc-dev-auth-harness', JSON.stringify(payload));
    window.localStorage.setItem('MYSC_ACTIVE_TENANT', payload.tenantId);
    if (payload.projectId) {
      window.sessionStorage.setItem(`mysc-portal-active-project:${payload.uid}`, payload.projectId);
    }
  }, session);
}

async function completeWorkspaceSelectionIfNeeded(page: Page) {
  if (!page.url().includes('/workspace-select')) return;

  if (await page.getByRole('button', { name: '관리자 공간으로 계속' }).count()) {
    await page.getByRole('button', { name: '관리자 공간으로 계속' }).click();
    return;
  }

  await page.getByRole('button', { name: 'PM 포털로 계속' }).click();
}

async function ensurePortalProjectSelected(page: Page) {
  if (!page.url().includes('/portal/project-select')) return;
  const startButton = page.locator('[data-testid^="portal-project-start-"]').first();
  await expect(startButton).toBeVisible();
  await startButton.click();
}

async function loginAsAdmin(page: Page) {
  await seedHarnessSession(page, ADMIN_TEST_USER);
  await page.goto('/');
  await completeWorkspaceSelectionIfNeeded(page);
}

async function loginAsPm(page: Page) {
  await seedHarnessSession(page, PM_TEST_USER);
  await page.goto('/portal');
  await completeWorkspaceSelectionIfNeeded(page);
  await ensurePortalProjectSelected(page);
}

test('release gate: admin requested route survives login redirect', async ({ page }) => {
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login$/);

  await seedHarnessSession(page, ADMIN_TEST_USER);
  await page.goto('/projects');
  await completeWorkspaceSelectionIfNeeded(page);

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText('사업 통합 관리').first()).toBeVisible();
});

test('release gate: PM requested portal route survives login redirect', async ({ page }) => {
  await page.goto('/portal/budget');
  await expect(page).toHaveURL(/\/login$/);

  await seedHarnessSession(page, PM_TEST_USER);
  await page.goto('/portal/budget');
  await completeWorkspaceSelectionIfNeeded(page);
  await ensurePortalProjectSelected(page);

  await expect(page).toHaveURL(/\/portal\/budget$/);
  await expect(page.getByRole('heading', { name: '예산 편집' })).toBeVisible();
});

test('release gate: admin can switch from portal to admin home', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/portal');

  await expect(page.getByRole('button', { name: '관리자 공간' })).toBeVisible();
  await page.getByRole('button', { name: '관리자 공간' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: '사업 통합 대시보드' })).toBeVisible();
});

test('release gate: PM dashboard shows unified project and submission surface', async ({ page }) => {
  await loginAsPm(page);
  await page.goto('/portal');

  await expect(page.getByTestId('portal-mission-guide')).toHaveCount(0);
  await expect(page.getByText('프로젝트 상세')).toBeVisible();
  await expect(page.getByText('이번 주 작업 상태')).toBeVisible();
  await expect(page.getByRole('heading', { name: '내 제출 현황' })).toBeVisible();
});

test('release gate: PM weekly expense keeps compact setup and status surfaces visible', async ({ page }) => {
  await loginAsPm(page);
  await page.goto('/portal/weekly-expenses');

  await expect(page.getByTestId('portal-mission-guide')).toHaveCount(0);
  await expect(page.getByTestId('weekly-expense-setup-panel')).toBeVisible();
  await expect(page.locator('[data-testid^="weekly-accounting-product-status-"]').first()).toBeVisible();
});

test('release gate: admin can move a project to trash and restore it', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/projects');
  await expect(page.getByText('사업 통합 관리').first()).toBeVisible();

  const firstProjectRow = page.locator('[data-testid^="project-list-row-"]').first();
  await expect(firstProjectRow).toBeVisible();

  const rowTestId = await firstProjectRow.getAttribute('data-testid');
  const projectId = rowTestId?.replace('project-list-row-', '') || '';
  expect(projectId).not.toBe('');

  await firstProjectRow.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  await expect(page.getByTestId('project-detail-trash')).toBeVisible();

  await page.getByTestId('project-detail-trash').click();
  const trashDialog = page.getByRole('alertdialog');
  await expect(trashDialog.getByText('프로젝트를 휴지통으로 이동하시겠습니까?')).toBeVisible();
  await trashDialog.getByRole('button', { name: '휴지통 이동' }).click();

  await expect(page).toHaveURL(/\/projects$/);
  await page.getByTestId('projects-tab-trash').click();

  const trashRow = page.getByTestId(`project-trash-row-${projectId}`);
  await expect(trashRow).toBeVisible();
  await trashRow.click();

  await expect(page.getByText('휴지통 보관 중인 프로젝트입니다.')).toBeVisible();
  await expect(page.getByTestId('project-detail-restore')).toBeVisible();

  await page.getByTestId('project-detail-restore').click();
  const restoreDialog = page.getByRole('alertdialog');
  await expect(restoreDialog.getByText('프로젝트를 복구하시겠습니까?')).toBeVisible();
  await restoreDialog.getByRole('button', { name: '복구' }).click();

  await expect(page.getByText('휴지통 보관 중인 프로젝트입니다.')).toHaveCount(0);
  await expect(page.getByTestId('project-detail-trash')).toBeVisible();

  await page.goto('/projects');
  await page.getByTestId('projects-tab-trash').click();
  await expect(page.getByTestId(`project-trash-row-${projectId}`)).toHaveCount(0);
});
