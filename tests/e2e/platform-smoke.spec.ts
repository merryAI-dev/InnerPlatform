import { test, expect } from '@playwright/test';

// ── Helper: dev auth harness login ──
async function loginAsPm(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'PM 샘플 로그인' }).click();
  if (page.url().includes('/workspace-select')) {
    await page.getByRole('button', { name: 'PM 포털로 계속' }).click();
  }
  await expect(page).toHaveURL(/\/portal(?:$|\/)/);
}

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '관리자 샘플 로그인' }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe('/');
}

// ── 1. Login ──
test('1. PM can login via dev auth harness', async ({ page }) => {
  await loginAsPm(page);
  await expect(page.locator('body')).toBeVisible();
  await expect(page.getByTestId('portal-mission-guide')).toBeVisible();
});

test('2. Admin can login via dev auth harness', async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.locator('body')).toBeVisible();
});

// ── 3. Dashboard ──
test('3. Admin dashboard loads with project stats', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/');
  await expect(page.getByText('대시보드').first()).toBeVisible({ timeout: 15_000 });
});

// ── 4. Project list ──
test('4. Admin can view project list', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/projects');
  await expect(page.getByText('프로젝트').first()).toBeVisible({ timeout: 15_000 });
});

// ── 5. Cashflow ──
test('5. Admin can navigate to cashflow page', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/cashflow');
  await expect(page.locator('body')).toBeVisible({ timeout: 15_000 });
});

// ── 6. Portal weekly expenses ──
test('6. PM can access weekly expense page', async ({ page }) => {
  await loginAsPm(page);
  await page.goto('/portal/weekly-expenses');
  await expect(page.getByRole('heading', { name: '사업비 입력(주간)' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('weekly-expense-setup-panel')).toBeVisible();
  await expect(page.locator('[data-testid^="weekly-accounting-product-status-"]').first()).toBeVisible();
});

// ── 7. Portal bank statement -> other pages ──
test('7. PM can navigate away from bank statement page', async ({ page }) => {
  await loginAsPm(page);
  await page.goto('/portal/bank-statements');
  await expect(page.getByRole('heading', { name: '통장내역' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('portal-mission-guide')).toBeVisible();
  await expect(page.getByTestId('bank-statement-trust-surface')).toBeVisible();

  await page.getByRole('link', { name: '예산 편집' }).click();
  await expect(page).toHaveURL(/\/portal\/budget$/);
  await expect(page.getByRole('heading', { name: '예산 편집' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('link', { name: '캐시플로(주간)' }).click();
  await expect(page).toHaveURL(/\/portal\/cashflow$/);
  await expect(page.getByRole('heading', { name: '프로젝트 캐시플로(주간)' })).toBeVisible({ timeout: 15_000 });
});

// ── 8. Portal budget ──
test('8. PM can access budget page', async ({ page }) => {
  await loginAsPm(page);
  await page.goto('/portal/budget');
  await expect(page.getByTestId('portal-budget-guide')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('portal-mission-guide')).toBeVisible();
});

test('8-1. PM can access submissions page with guided status surface', async ({ page }) => {
  await loginAsPm(page);
  await page.goto('/portal/submissions');
  await expect(page.getByTestId('portal-submissions-guide')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('portal-mission-guide')).toBeVisible();
});

// ── 9. Audit log ──
test('9. Admin can view audit log', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/audit');
  await expect(page.getByText('감사 로그').first()).toBeVisible({ timeout: 15_000 });
});

// ── 10. Settings ──
test('10. Admin can access settings', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/settings');
  await expect(page.locator('body')).toBeVisible({ timeout: 15_000 });
});

// ── 11. 404 handling ──
test('11. Unknown route shows 404 page', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/nonexistent-page');
  await expect(page.getByText(/404|찾을 수 없|존재하지 않/).first()).toBeVisible({ timeout: 15_000 });
});
