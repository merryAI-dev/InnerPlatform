import { expect, test } from '@playwright/test';

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '관리자 샘플 로그인' }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe('/');
}

test('settings keeps only operational tabs on the primary surface', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/settings');

  await expect(page.getByRole('tab', { name: '조직 정보' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '구성원' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '원장 템플릿' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '데이터 마이그레이션' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '권한 설정' })).toBeVisible();

  await expect(page.getByRole('tab', { name: 'Firebase' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '사업비 가이드' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '테넌트 관리' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '브랜딩/기능' })).toHaveCount(0);
});

test('approval queue is a single operator surface without history tab', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/approvals');

  await expect(page.getByText('승인 대기 항목').first()).toBeVisible();
  await expect(page.getByText('사업비 승인 대기').first()).toBeVisible();
  await expect(page.getByText('인력변경 승인 대기').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: /처리 이력/ })).toHaveCount(0);
});
