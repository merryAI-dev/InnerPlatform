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

test('admin can access cashflow export page and sees the disabled-server fallback', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/cashflow/export');

  await expect(page).toHaveURL(/\/cashflow\/export$/);
  await expect(page.getByTestId('cashflow-export-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: '경영기획실 통합 관리' })).toBeVisible();
  await expect(page.getByTestId('cashflow-export-step-range')).toBeVisible();
  await expect(page.getByTestId('cashflow-export-step-period')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '상태' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '누적 Projection-Actual' })).toBeVisible();
  await expect(page.locator('tbody tr').first()).toBeVisible();

  await expect(page.getByText('내보내기 서버 연결을 확인해 주세요.')).toBeVisible();
  await expect(page.getByTestId('cashflow-export-download')).toBeDisabled();
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
  await expect(page.getByRole('heading', { name: '전사 현금흐름 현황' })).toBeVisible();
  await expect(page.getByRole('button', { name: '현금흐름 보기' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: '통합 관리' })).toBeVisible();
});

test('admin can cross-filter exports by several account types and choose department sorting', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/cashflow/export');

  await page.getByTestId('cashflow-export-account-type').click();
  await page.getByRole('option', { name: '전용계좌 사업(이나라도움)' }).click();
  await page.getByRole('option', { name: '기타' }).click();
  await page.keyboard.press('Escape');
  await page.getByTestId('cashflow-export-sort').click();
  await page.getByRole('option', { name: '소속(CIC/센터)' }).click();

  await expect(page.getByTestId('cashflow-export-step-account-type')).toContainText('2개 유형 선택');
  await expect(page.getByTestId('cashflow-export-download')).toBeDisabled();
});

test('admin cashflow export uses a monochrome hierarchy for filter cards', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/cashflow/export');

  await expect(page.getByTestId('cashflow-export-step-range')).toHaveClass(/bg-stone-50/);
  await expect(page.getByTestId('cashflow-export-step-project')).toHaveClass(/bg-stone-50/);
  await expect(page.getByTestId('cashflow-export-step-range')).toHaveClass(/border-stone-200/);
});

test('pm sees the access boundary on the admin cashflow route', async ({ page }) => {
  await loginAsPm(page);
  await page.goto('/cashflow');

  await expect(page).toHaveURL(/\/cashflow$/);
  await expect(page.getByRole('heading', { name: '이 화면을 열 수 없습니다' })).toBeVisible();
  await expect(page.getByTestId('cashflow-export-page')).toHaveCount(0);
});
