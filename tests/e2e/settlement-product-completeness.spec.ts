import { test, expect } from '@playwright/test';

const TEST_PROJECT_ID = 'p001';
const TEST_USER = {
  source: 'dev_harness',
  uid: 'u002',
  name: '데이나',
  email: 'dana@mysc.co.kr',
  role: 'pm',
  tenantId: 'org001',
  projectId: TEST_PROJECT_ID,
  projectIds: [TEST_PROJECT_ID],
  defaultWorkspace: 'portal',
  lastWorkspace: 'portal',
};

async function loginAsPm(page: import('@playwright/test').Page) {
  await seedHarnessProject(page);
  await page.goto('/portal');
  await page.waitForURL((url) => url.pathname.startsWith('/portal'));
}

async function seedHarnessProject(page: import('@playwright/test').Page) {
  await page.addInitScript((session) => {
    window.localStorage.setItem('mysc-auth-user', JSON.stringify(session));
    window.localStorage.setItem('mysc-dev-auth-harness', JSON.stringify(session));
    window.localStorage.setItem('MYSC_ACTIVE_TENANT', session.tenantId);
    window.sessionStorage.setItem(`mysc-portal-active-project:${session.uid}`, session.projectId);
  }, TEST_USER);
}

async function ensureProjectSelected(page: import('@playwright/test').Page) {
  if (page.url().includes('/portal/project-select')) {
    const startButton = page.locator('[data-testid^="portal-project-start-"]').first();
    await expect(startButton).toBeVisible();
    await startButton.click();
  }
  await expect(page).toHaveURL(/\/portal(?!\/project-select)(?:$|\/)/);
}

async function openPortalPath(page: import('@playwright/test').Page, path: string) {
  await page.goto(path);
  await ensureProjectSelected(page);
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

async function applySampleExpenseSheet(page: import('@playwright/test').Page) {
  await openPortalPath(page, '/portal/bank-statements');
  await expect(page.getByRole('heading', { name: '통장내역' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'bank-statement.csv',
    mimeType: 'text/csv',
    buffer: buildBankCsv([
      {
        account: '111-222-333',
        dateTime: '2026-04-07 10:00',
        memo: 'KTX 예매',
        counterparty: 'KTX',
        withdrawal: '15000',
        balance: '500000',
      },
      {
        account: '111-222-333',
        dateTime: '2026-04-07 13:30',
        memo: '회의비',
        counterparty: '카페 메리',
        withdrawal: '22000',
        balance: '478000',
      },
    ]),
  });
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('button', { name: '사업비 입력(주간)으로 이어가기' })).toBeVisible();
  await page.getByRole('button', { name: '사업비 입력(주간)으로 이어가기' }).click();
  await expect(page.getByRole('heading', { name: '사업비 입력(주간)' })).toBeVisible();
}

async function expectSampleRowsVisible(page: import('@playwright/test').Page) {
  await expect(page.locator('[value="KTX"]').first()).toBeVisible();
  await expect(page.locator('[value="카페 메리"]').first()).toBeVisible();
  await expect(page.getByText('예기치 못한 오류가 발생했습니다')).toHaveCount(0);
}

test('settlement product completeness: imported rows survive reload and restore editable cells', async ({ page }) => {
  await loginAsPm(page);
  await applySampleExpenseSheet(page);

  await expectSampleRowsVisible(page);

  await page.reload();
  await expect(page.getByRole('heading', { name: '사업비 입력(주간)' })).toBeVisible();
  await expectSampleRowsVisible(page);
});

test('settlement product completeness: PM can continue to weekly cashflow after import apply', async ({ page }) => {
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

  await page.locator('[value="KTX-수정"]').first().fill('KTX-재수정');
  await page.getByTestId('weekly-expense-bank-statement-action').click();
  await expect(page.getByTestId('weekly-expense-unsaved-dialog')).toBeVisible();
  await page.getByRole('button', { name: '변경 버리고 이동' }).click();
  await expect(page).toHaveURL(/\/portal\/bank-statements$/);
});

test('settlement product completeness: dirty weekly expense edits require confirmation before secondary route navigation', async ({ page }) => {
  await loginAsPm(page);
  await applySampleExpenseSheet(page);

  const firstCounterpartyCell = page.locator('[value="KTX"]').first();
  await firstCounterpartyCell.fill('KTX-사이드바수정');

  const settingsButton = page.getByRole('button', { name: '설정 열기' });

  await settingsButton.click();
  await expect(page.getByTestId('weekly-expense-unsaved-dialog')).toBeVisible();
  await page.getByRole('button', { name: '계속 편집' }).click();
  await expect(page.getByTestId('weekly-expense-unsaved-dialog')).toBeHidden();
  await expect(page).toHaveURL(/\/portal\/weekly-expenses$/);

  await page.locator('[value="KTX-사이드바수정"]').first().fill('KTX-사이드바재수정');
  await settingsButton.click();
  await expect(page.getByTestId('weekly-expense-unsaved-dialog')).toBeVisible();
  await page.getByRole('button', { name: '변경 버리고 이동' }).click();
  await expect(page).toHaveURL(/\/portal\/project-settings$/);
});
