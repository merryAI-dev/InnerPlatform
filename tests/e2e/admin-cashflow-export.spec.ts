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

test('admin can access cashflow export page and trigger workbook download', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/cashflow/export');

  await expect(page).toHaveURL(/\/cashflow\/export$/);
  await expect(page.getByTestId('cashflow-export-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: '캐시플로 내보내기' })).toBeVisible();
  await expect(page.getByTestId('cashflow-export-step-range')).toBeVisible();
  await expect(page.getByTestId('cashflow-export-step-period')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '이번주 작성' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '최근 업데이트(Projection)' })).toBeVisible();
  await expect(page.getByTestId('cashflow-export-download')).toBeEnabled();
  await expect(page.locator('[data-testid^="cashflow-export-row-"]').first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('cashflow-export-download').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('캐시플로_추출');
});

test('admin cashflow export controls have strong field boundaries and visible dropdown affordances', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/cashflow/export');

  const scopeTrigger = page.getByTestId('cashflow-export-scope');
  const variantTrigger = page.getByTestId('cashflow-export-variant');

  await expect(scopeTrigger).toHaveCSS('border-top-width', '2px');
  await expect(variantTrigger).toHaveCSS('border-top-width', '2px');
  await expect(scopeTrigger.locator('svg').last()).toHaveCSS('opacity', '1');
  await expect(variantTrigger.locator('svg').last()).toHaveCSS('opacity', '1');
});

test('admin can reach the cashflow monitoring hub before using export tools', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/cashflow');

  await expect(page).toHaveURL(/\/cashflow$/);
  await expect(page.getByRole('heading', { name: '캐시플로 모니터링 허브' })).toBeVisible();
  await expect(page.getByRole('button', { name: '열기' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '엑셀 내보내기 열기' })).toBeVisible();
});

test('admin can filter cashflow export targets by account type', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/cashflow/export');

  await page.getByTestId('cashflow-export-account-type').click();
  await page.getByRole('option', { name: '일반 사업' }).click();

  await expect(page.getByTestId('cashflow-export-step-account-type')).toContainText('일반 사업');
  await expect(page.locator('[data-testid^="cashflow-export-row-"]').first()).toBeVisible();
});

test('admin cashflow export uses a monochrome hierarchy for filter cards', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/cashflow/export');

  await expect(page.getByTestId('cashflow-export-step-range')).toHaveClass(/bg-stone-50/);
  await expect(page.getByTestId('cashflow-export-step-project')).toHaveClass(/bg-stone-50/);
  await expect(page.getByTestId('cashflow-export-step-range')).toHaveClass(/border-stone-200/);
});

test('pm is redirected away from admin cashflow export route', async ({ page }) => {
  await loginAsPm(page);
  await page.goto('/cashflow');

  await expect(page).toHaveURL(/\/portal\/project-select\?redirect=%2Fportal$/);
  await expect(page.getByTestId('cashflow-export-page')).toHaveCount(0);
});
