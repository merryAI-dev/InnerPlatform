import { expect, test } from '@playwright/test';

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '관리자 샘플 로그인' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
}

test('review inbox opens a groupware-style registration approval document', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/projects/migration-audit');

  await expect(page.getByTestId('migration-review-search-bar')).toBeVisible();
  await expect(page.getByText('검토함', { exact: true })).toBeVisible();
  await expect(page.getByText('CIC 필터', { exact: true })).toBeVisible();
  await expect(page.getByText('상태 필터', { exact: true })).toBeVisible();
  await expect(page.getByText('검토대기', { exact: true })).toBeVisible();
  await expect(page.getByText('승인완료', { exact: true })).toBeVisible();
  await expect(page.getByText('반려', { exact: true })).toBeVisible();

  await page.getByRole('combobox').nth(2).click();
  await page.getByRole('option', { name: '전체 상태' }).click();

  const openDocument = page.getByRole('button', { name: '문서 열기' }).first();
  await expect(openDocument).toBeVisible();
  await openDocument.click();

  const document = page.getByTestId('migration-review-document');
  await expect(document).toBeVisible();
  await expect(document.getByText('프로젝트 등록 및 승인서', { exact: true })).toBeVisible();
  await expect(document.getByText('기안', { exact: true })).toBeVisible();
  await expect(document.getByText('조직장 승인', { exact: true })).toBeVisible();
  await expect(document.getByText('기본정보', { exact: true })).toBeVisible();
  await expect(document.getByText('계약 및 정산 정보', { exact: true })).toBeVisible();
});
