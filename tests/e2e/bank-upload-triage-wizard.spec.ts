import { test, expect, type Page } from '@playwright/test';

async function loginAsPm(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'PM 샘플 로그인' }).click();
  if (page.url().includes('/workspace-select')) {
    await page.getByRole('button', { name: 'PM 포털로 계속' }).click();
  }
  await expect(page).toHaveURL(/\/portal(?:$|\/)/);
}

function buildBankCsv(rows: Array<{
  account: string;
  dateTime: string;
  memo: string;
  counterparty: string;
  withdrawal?: string;
  deposit?: string;
  balance: string;
}>): Buffer {
  const header = ['통장번호', '거래일시', '적요', '의뢰인/수취인', '출금금액', '입금금액', '잔액'];
  const lines = rows.map((row) => [
    row.account,
    row.dateTime,
    row.memo,
    row.counterparty,
    row.withdrawal || '',
    row.deposit || '',
    row.balance,
  ]);
  return Buffer.from([header, ...lines].map((line) => line.join(',')).join('\n'));
}

async function uploadBankSheet(page: Page, rows: Parameters<typeof buildBankCsv>[0]) {
  await page.goto('/portal/bank-statements');
  await expect(page.getByRole('heading', { name: '통장내역' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'bank-statement.csv',
    mimeType: 'text/csv',
    buffer: buildBankCsv(rows),
  });
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByTestId('bank-import-queue-summary')).toBeVisible();
}

test('bank upload triage wizard projects rows and survives reupload with different order', async ({ page }) => {
  await loginAsPm(page);

  const originalRows = [
    {
      account: '111-222-333',
      dateTime: '2026-04-07 10:00',
      memo: 'KTX 예매',
      counterparty: '코레일',
      withdrawal: '15000',
      balance: '500000',
    },
    {
      account: '111-222-333',
      dateTime: '2026-04-07 13:30',
      memo: '택시',
      counterparty: '카카오T',
      withdrawal: '22000',
      balance: '478000',
    },
  ];

  await uploadBankSheet(page, originalRows);
  await expect(page.getByTestId('bank-import-queue-summary')).toContainText('총 2건');
  await expect(page.getByRole('button', { name: '분류/검토 열기' })).toBeVisible();

  await page.getByTestId('bank-import-open-wizard').click();
  await expect(page.getByTestId('bank-import-triage-wizard')).toBeVisible();
  const viewport = page.viewportSize();
  const wizardBox = await page.getByTestId('bank-import-triage-wizard').boundingBox();
  expect(viewport).not.toBeNull();
  expect(wizardBox).not.toBeNull();
  expect(wizardBox!.width).toBeGreaterThan((viewport?.width || 0) * 0.99);
  expect(wizardBox!.height).toBeGreaterThan((viewport?.height || 0) * 0.99);

  await page.getByTestId('bank-import-expense-amount').fill('15000');
  await page.getByTestId('bank-import-budget-category').fill('여비');
  await page.getByTestId('bank-import-budget-subcategory').fill('교통비');
  await page.getByTestId('bank-import-cashflow-category').selectOption('TRAVEL');
  await page.getByTestId('bank-import-evidence-completed').fill('출장신청서, 영수증');
  await page.getByTestId('bank-import-project-next').click();

  await page.getByTestId('bank-import-expense-amount').fill('22000');
  await page.getByTestId('bank-import-budget-category').fill('여비');
  await page.getByTestId('bank-import-budget-subcategory').fill('교통비');
  await page.getByTestId('bank-import-cashflow-category').selectOption('TRAVEL');
  await page.getByTestId('bank-import-evidence-completed').fill('출장신청서, 영수증');
  await page.getByTestId('bank-import-project-next').click();
  await page.getByRole('button', { name: '나중에 이어서 하기' }).click();

  await expect(page.getByTestId('bank-import-triage-wizard')).toBeHidden();

  await page.goto('/portal/weekly-expenses');
  await expect(page.getByRole('heading', { name: '사업비 입력(주간)' })).toBeVisible();
  await expect(page.getByText('거래: 2건')).toBeVisible();
  await expect(page.locator('input[value="코레일"]').first()).toBeVisible();
  await expect(page.locator('input[value="카카오T"]').first()).toBeVisible();
  await expect(page.getByText('여비', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('교통비', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('weekly-intake-queue-strip')).toContainText('증빙 미완료 2');

  await uploadBankSheet(page, [...originalRows].reverse());
  await expect(page.getByTestId('bank-import-queue-summary')).toContainText('총 2건');
  await expect(page.getByTestId('bank-import-queue-summary')).toContainText('증빙 미완료 2');

  await page.goto('/portal/weekly-expenses');
  await expect(page.getByText('거래: 2건')).toBeVisible();
  await expect(page.locator('input[value="코레일"]').first()).toBeVisible();
  await expect(page.locator('input[value="카카오T"]').first()).toBeVisible();
  await expect(page.getByText('여비', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('교통비', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('weekly-intake-queue-strip')).toContainText('증빙 미완료 2');
});

test('bank upload triage wizard lets PM project first and continue evidence later', async ({ page }) => {
  await loginAsPm(page);

  await uploadBankSheet(page, [
    {
      account: '111-222-333',
      dateTime: '2026-04-08 09:10',
      memo: 'KTX 예매',
      counterparty: '코레일',
      withdrawal: '18000',
      balance: '460000',
    },
  ]);

  await page.getByTestId('bank-import-open-wizard').click();
  await expect(page.getByTestId('bank-import-triage-wizard')).toBeVisible();

  await page.getByTestId('bank-import-expense-amount').fill('18000');
  await page.getByTestId('bank-import-budget-category').fill('여비');
  await page.getByTestId('bank-import-budget-subcategory').fill('교통비');
  await page.getByTestId('bank-import-cashflow-category').selectOption('TRAVEL');
  await page.getByTestId('bank-import-project-next').click();

  await expect(page.getByTestId('bank-import-triage-wizard')).toBeHidden();

  await page.goto('/portal/weekly-expenses');
  await expect(page.getByTestId('weekly-intake-queue-strip')).toContainText('증빙 미완료 1');
  await page.getByRole('button', { name: '증빙 이어서 하기' }).click();
  await expect(page.getByTestId('bank-import-triage-wizard')).toBeVisible();

  await page.getByTestId('bank-import-evidence-completed').fill('출장신청서, 영수증');
  await page.getByTestId('bank-import-project-next').click();
  await expect(page.getByTestId('bank-import-triage-wizard')).toBeHidden();

  await expect(page.getByTestId('weekly-intake-queue-strip')).toContainText('증빙 미완료 1');
  await expect(page.locator('input[value="코레일"]').first()).toBeVisible();
  await page.getByRole('button', { name: '증빙 이어서 하기' }).click();
  await expect(page.getByTestId('bank-import-triage-wizard')).toBeVisible();
  await expect(page.getByTestId('bank-import-evidence-completed')).toHaveValue('출장신청서, 영수증');
});
