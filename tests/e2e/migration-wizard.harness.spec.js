import { test, expect } from '@playwright/test';

test('dev auth harness can apply sample expense-sheet migration end-to-end', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'PM 샘플 로그인' }).click();

  await expect(page).toHaveURL(/\/portal(?:$|\/)/);
  await page.goto('/portal/weekly-expenses');
  await expect(page.getByRole('heading', { name: '사업비 입력(주간)' })).toBeVisible();

  await page.getByRole('button', { name: 'Migration Wizard' }).click();
  await expect(page.getByText('Google Sheets Migration Wizard')).toBeVisible();

  await page.getByPlaceholder(/docs\.google\.com\/spreadsheets/).fill('sample://migration');
  await page.getByRole('button', { name: '워크북 스캔 시작' }).click();
  await expect(page.getByText('개발용 사업비 관리 시트 샘플').first()).toBeVisible();

  await page.getByRole('button', { name: /사용내역\(통장내역기준취소내역,불인정포함\)/ }).click();

  await expect(page.getByText('KTX')).toBeVisible();
  await expect(page.getByText('카페 메리')).toBeVisible();

  await page.getByRole('button', { name: /^다음$/ }).click();
  await page.getByRole('button', { name: /기본 탭에 안전 반영/ }).click();

  await expect(page.getByText(/Google Sheets 2건을 .*에 반영했습니다\./)).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.locator('[value=\"KTX\"]').first()).toBeVisible();
  await expect(page.locator('[value=\"카페 메리\"]').first()).toBeVisible();
});
