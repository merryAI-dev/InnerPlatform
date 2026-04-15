import { test, expect, type Page } from '@playwright/test';

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

async function loginAsPm(page: Page) {
  await seedHarnessProject(page);
  await page.goto('/portal');
  await page.waitForURL((url) => url.pathname.startsWith('/portal'));
}

async function seedHarnessProject(page: Page) {
  await page.addInitScript((session) => {
    window.localStorage.setItem('mysc-auth-user', JSON.stringify(session));
    window.localStorage.setItem('mysc-dev-auth-harness', JSON.stringify(session));
    window.localStorage.setItem('MYSC_ACTIVE_TENANT', session.tenantId);
    window.sessionStorage.setItem(`mysc-portal-active-project:${session.uid}`, session.projectId);
  }, TEST_USER);
}

async function ensureProjectSelected(page: Page) {
  if (page.url().includes('/portal/project-select')) {
    const startButton = page.locator('[data-testid^="portal-project-start-"]').first();
    await expect(startButton).toBeVisible();
    await startButton.click();
  }
  await expect(page).toHaveURL(/\/portal(?!\/project-select)(?:$|\/)/);
}

async function openPortalPath(page: Page, path: string) {
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

async function uploadBankSheet(page: Page, rows: Parameters<typeof buildBankCsv>[0]) {
  await openPortalPath(page, '/portal/bank-statements');
  await expect(page.getByRole('heading', { name: '통장내역' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'bank-statement.csv',
    mimeType: 'text/csv',
    buffer: buildBankCsv(rows),
  });
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByRole('button', { name: '사업비 입력(주간)으로 이어가기' })).toBeVisible();
}

test('bank upload flows directly into weekly expenses and survives reupload with different order', async ({ page }) => {
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
  await expect(page.getByText('신규 거래 처리 Queue')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '분류/검토 열기' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '증빙 이어서 하기' })).toHaveCount(0);
  await page.getByRole('button', { name: '사업비 입력(주간)으로 이어가기' }).click();
  await expect(page.getByRole('heading', { name: '사업비 입력(주간)' })).toBeVisible();
  await expect(page.getByText('거래: 2건')).toBeVisible();
  await expect(page.locator('input[value="코레일"]').first()).toBeVisible();
  await expect(page.locator('input[value="카카오T"]').first()).toBeVisible();
  await expect(page.getByText('신규 거래 처리 Queue')).toHaveCount(0);

  await uploadBankSheet(page, [...originalRows].reverse());
  await page.getByRole('button', { name: '사업비 입력(주간)으로 이어가기' }).click();
  await expect(page.getByText('거래: 2건')).toBeVisible();
  await expect(page.locator('input[value="코레일"]').first()).toBeVisible();
  await expect(page.locator('input[value="카카오T"]').first()).toBeVisible();
});

test('bank upload keeps direct handoff CTA and removes queue actions', async ({ page }) => {
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

  await expect(page.getByRole('button', { name: '사업비 입력(주간)으로 이어가기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '분류/검토 열기' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '증빙 이어서 하기' })).toHaveCount(0);
  await expect(page.getByText('신규 거래 처리 Queue')).toHaveCount(0);
});

test('bank upload empty and saved states stay on direct handoff flow', async ({ page }) => {
  await loginAsPm(page);
  await openPortalPath(page, '/portal/bank-statements');
  await expect(page.getByTestId('bank-statement-empty-state')).toBeVisible();
  await expect(page.getByRole('button', { name: '사업비 입력(주간)으로 이어가기' })).toBeVisible();
  await expect(page.getByText('신규 거래 처리 Queue')).toHaveCount(0);

  await uploadBankSheet(page, [
    {
      account: '111-222-333',
      dateTime: '2026-04-14 11:10',
      memo: '회의비',
      counterparty: '카페 메리',
      withdrawal: '12000',
      balance: '448000',
    },
  ]);

  await expect(page.getByText(/업로드 기준본 저장 완료|현재 저장본 사용 중/)).toBeVisible();
  await expect(page.getByText('신규 거래 처리 Queue')).toHaveCount(0);
});
