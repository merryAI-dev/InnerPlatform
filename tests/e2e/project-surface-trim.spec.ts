import { expect, test } from '@playwright/test';

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '관리자 샘플 로그인' }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe('/');
}

test('project list keeps 3 tabs but removes direct registration CTAs', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/projects');

  await expect(page.getByTestId('projects-tab-confirmed')).toBeVisible();
  await expect(page.getByTestId('projects-tab-prospect')).toBeVisible();
  await expect(page.getByTestId('projects-tab-trash')).toBeVisible();
  await expect(page.getByRole('button', { name: '예정 등록' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '확정 등록' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: '총 사업비' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '2026년 예산' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: '수익률' })).toHaveCount(0);
});

test('projects new redirects admins to the portal project registration flow', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/projects/new?phase=PROSPECT');

  await expect(page).toHaveURL(/\/portal\/register-project\?phase=PROSPECT$/);
});

test('approval queue promotes project registration review as a decision console', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/approvals');

  await expect(page.getByText('사업 등록 심사').first()).toBeVisible();
  await expect(page.getByTestId('project-request-inbox')).toBeVisible();
  await expect(page.getByTestId('project-request-detail')).toBeVisible();
  await expect(page.getByTestId('project-request-decision-rail')).toBeVisible();
  await expect(page.getByText('결정 패널').first()).toBeVisible();
});

test('settings migration tab links to the maintenance-only migration audit surface', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/settings?tab=migration');

  await expect(page.getByRole('link', { name: '이관 점검 열기' })).toBeVisible();
  await page.getByRole('link', { name: '이관 점검 열기' }).click();
  await expect(page).toHaveURL(/\/projects\/migration-audit$/);
});

test('admin navigation restores the migration audit menu', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/');

  await expect(page.getByRole('link', { name: '사업이관' })).toBeVisible();
  await page.getByRole('link', { name: '사업이관' }).click();
  await expect(page).toHaveURL(/\/projects\/migration-audit$/);
});

test('project detail defaults to summary and ledger while secondary sections stay collapsed', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/projects');
  await page.locator('[data-testid^="project-list-row-"]').first().click();

  await expect(page.getByText('원장 목록').first()).toBeVisible();
  await expect(page.getByText('세금계산서 금액')).toHaveCount(0);
  await expect(page.getByText('연동된 참여 인력이 없습니다.')).toHaveCount(0);
});
