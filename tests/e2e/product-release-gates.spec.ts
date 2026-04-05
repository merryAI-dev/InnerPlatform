import { test, expect, type Page } from '@playwright/test';

async function completeWorkspaceSelectionIfNeeded(page: Page) {
  if (!page.url().includes('/workspace-select')) return;

  if (await page.getByRole('button', { name: '관리자 공간으로 계속' }).count()) {
    await page.getByRole('button', { name: '관리자 공간으로 계속' }).click();
    return;
  }

  await page.getByRole('button', { name: 'PM 포털로 계속' }).click();
}

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '관리자 샘플 로그인' }).click();
  await completeWorkspaceSelectionIfNeeded(page);
}

async function loginAsPm(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'PM 샘플 로그인' }).click();
  await completeWorkspaceSelectionIfNeeded(page);
}

test('release gate: admin requested route survives login redirect', async ({ page }) => {
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole('button', { name: '관리자 샘플 로그인' }).click();
  await completeWorkspaceSelectionIfNeeded(page);

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText('사업 통합 관리').first()).toBeVisible();
});

test('release gate: PM requested portal route survives login redirect', async ({ page }) => {
  await page.goto('/portal/budget');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole('button', { name: 'PM 샘플 로그인' }).click();
  await completeWorkspaceSelectionIfNeeded(page);

  await expect(page).toHaveURL(/\/portal\/budget$/);
  await expect(page.getByRole('heading', { name: '예산 편집' })).toBeVisible();
});

test('release gate: PM dashboard shows guided mission flow', async ({ page }) => {
  await loginAsPm(page);
  await page.goto('/portal');

  await expect(page.getByTestId('portal-mission-guide')).toBeVisible();
  await expect(page.getByText('이번 주 미션')).toBeVisible();
  await expect(page.getByTestId('portal-mission-active-step')).toBeVisible();
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

  const projectName = (await firstProjectRow.locator('td').nth(3).innerText()).trim();
  expect(projectName).not.toBe('');

  await firstProjectRow.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  await expect(page.getByTestId('project-detail-trash')).toBeVisible();

  await page.getByTestId('project-detail-trash').click();
  const trashDialog = page.getByRole('alertdialog');
  await expect(trashDialog.getByText('프로젝트를 휴지통으로 이동하시겠습니까?')).toBeVisible();
  await trashDialog.getByRole('button', { name: '휴지통 이동' }).click();

  await expect(page).toHaveURL(/\/projects$/);
  await page.getByTestId('projects-tab-trash').click();
  await page.getByPlaceholder('사업명, 발주기관, 담당자 검색...').fill(projectName);

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
  await page.getByPlaceholder('사업명, 발주기관, 담당자 검색...').fill(projectName);
  await expect(page.getByTestId(`project-trash-row-${projectId}`)).toHaveCount(0);
});
