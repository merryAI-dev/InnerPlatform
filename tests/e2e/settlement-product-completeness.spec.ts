import { test, expect } from '@playwright/test';

async function loginAsPm(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'PM 샘플 로그인' }).click();
  if (page.url().includes('/workspace-select')) {
    await page.getByRole('button', { name: 'PM 포털로 계속' }).click();
  }
  await expect(page).toHaveURL(/\/portal(?:$|\/)/);
}

async function applySampleExpenseSheet(page: import('@playwright/test').Page) {
  await page.goto('/portal/weekly-expenses');
  await expect(page.getByRole('heading', { name: '사업비 입력(주간)' })).toBeVisible();

  await page.getByRole('button', { name: 'Migration Wizard' }).click();
  await expect(page.getByText('Google Sheets Migration Wizard')).toBeVisible();

  await page.getByPlaceholder(/docs\.google\.com\/spreadsheets/).fill('sample://migration');
  await page.getByRole('button', { name: '워크북 스캔 시작' }).click();
  await expect(page.getByText('개발용 사업비 관리 시트 샘플').first()).toBeVisible();
  await page.getByRole('button', { name: /사용내역\(통장내역기준취소내역,불인정포함\)/ }).click();

  await expect(page.getByRole('cell', { name: 'KTX' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '카페 메리' }).first()).toBeVisible();

  await page.getByRole('button', { name: /^다음$/ }).click();
  await page.getByRole('button', { name: /기본 탭에 안전 반영/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Google Sheets Migration Wizard' })).toBeHidden();
}

async function expectSampleRowsVisible(page: import('@playwright/test').Page) {
  await expect(page.locator('[value="KTX"]').first()).toBeVisible();
  await expect(page.locator('[value="카페 메리"]').first()).toBeVisible();
  await expect(page.getByText('예기치 못한 오류가 발생했습니다')).toHaveCount(0);
}

test('settlement product completeness: wizard apply survives reload and restores editable rows', async ({ page }) => {
  await loginAsPm(page);
  await applySampleExpenseSheet(page);

  await expectSampleRowsVisible(page);

  await page.reload();
  await expect(page.getByRole('heading', { name: '사업비 입력(주간)' })).toBeVisible();
  await expectSampleRowsVisible(page);
});

test('settlement product completeness: PM can continue to weekly cashflow after wizard apply', async ({ page }) => {
  await loginAsPm(page);
  await applySampleExpenseSheet(page);

  await page.goto('/portal/cashflow');
  await expect(page.getByRole('heading', { name: '프로젝트 캐시플로(주간)' })).toBeVisible();
  await expect(page.getByText('예기치 못한 오류가 발생했습니다')).toHaveCount(0);
});

test('settlement product completeness: dirty weekly expense edits require confirmation before route navigation', async ({ page }) => {
  await loginAsPm(page);
  await applySampleExpenseSheet(page);

  const firstCounterpartyCell = page.locator('[value="KTX"]').first();
  await firstCounterpartyCell.fill('KTX-수정');

  await page.getByTestId('weekly-expense-bank-statement-action').click();
  await expect(page.getByTestId('weekly-expense-unsaved-dialog')).toBeVisible();
  await page.getByRole('button', { name: '계속 편집' }).click();
  await expect(page.getByTestId('weekly-expense-unsaved-dialog')).toBeHidden();
  await expect(page).toHaveURL(/\/portal\/weekly-expenses$/);

  await firstCounterpartyCell.fill('KTX-재수정');
  await page.getByTestId('weekly-expense-bank-statement-action').click();
  await expect(page.getByTestId('weekly-expense-unsaved-dialog')).toBeVisible();
  await page.getByRole('button', { name: '변경 버리고 이동' }).click();
  await expect(page).toHaveURL(/\/portal\/bank-statements$/);
});
