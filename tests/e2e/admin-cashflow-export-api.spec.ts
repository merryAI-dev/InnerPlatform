import { expect, test, type Page, type Route } from '@playwright/test';

const projects = [
  {
    id: 'cashflow-e2e-a',
    name: '가 사업',
    shortName: '가 사업',
    department: '센터A',
    accountType: 'DEDICATED',
    contractStart: '2026-01-01',
    contractEnd: '2027-12-31',
  },
  {
    id: 'cashflow-e2e-b',
    name: '나 사업',
    shortName: '나 사업',
    department: '센터A',
    accountType: 'OTHER',
    contractStart: '2026-01-01',
    contractEnd: '2028-12-31',
  },
  {
    id: 'cashflow-e2e-c',
    name: '다 사업',
    shortName: '다 사업',
    department: '센터B',
    accountType: 'OPERATING',
    contractStart: '2026-01-01',
    contractEnd: '2028-12-31',
  },
];

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function openCashflowExportWithPlatformApi(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('mysc-auth-user', JSON.stringify({
      uid: 'cashflow-e2e-admin',
      name: '캐시플로 테스트 관리자',
      email: 'cashflow-e2e-admin@mysc.co.kr',
      role: 'admin',
      source: 'dev_harness',
      tenantId: 'mysc',
      idToken: 'cashflow-e2e-id-token',
      defaultWorkspace: 'admin',
      lastWorkspace: 'admin',
    }));
  });

  await page.route('**/api/v1/projects?limit=200*', (route) => fulfillJson(route, {
    items: projects,
    nextCursor: null,
  }));
  await page.route('**/api/v1/persons', (route) => fulfillJson(route, { items: [] }));
  await page.route('**/api/v1/cashflow/projection-actual-summary/batch', async (route) => {
    const body = route.request().postDataJSON() as { projectIds?: string[] };
    await fulfillJson(route, {
      version: '2',
      items: [],
      errors: (body.projectIds || []).map((projectId) => ({
        projectId,
        code: 'SUMMARY_UNAVAILABLE',
      })),
    });
  });

  await page.goto('/cashflow/export');
  await expect(page.getByTestId('cashflow-export-page')).toBeVisible();
  await expect(page.getByRole('cell', { name: '가 사업' })).toBeVisible();
}

test('API-enabled export cross-filters two selected projects and downloads the posted workbook', async ({ page }) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route('**/api/v1/cashflow-exports', async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      headers: {
        'content-disposition': "attachment; filename=\"cashflow-export.xlsx\"; filename*=UTF-8''cashflow-filtered.xlsx",
      },
      body: 'test-workbook',
    });
  });
  await openCashflowExportWithPlatformApi(page);

  await page.getByTestId('cashflow-export-scope').click();
  await page.getByRole('option', { name: '사업 선택' }).click();
  await page.getByTestId('cashflow-export-department').click();
  await page.getByRole('option', { name: '센터A' }).click();

  await page.getByTestId('cashflow-export-project').click();
  await page.getByRole('option', { name: '가 사업' }).click();
  await page.getByRole('option', { name: '나 사업' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cashflow-export-step-project')).toContainText('2개 사업 선택');

  await page.getByTestId('cashflow-export-account-type').click();
  await expect(page.getByRole('option', { name: '전용계좌 사업(이나라도움) (1개)', exact: true })).toBeVisible();
  const zeroCountOption = page.getByRole('option', { name: '전용계좌(이나라도움x) (0개)', exact: true });
  await expect(zeroCountOption).toBeEnabled();
  await page.getByRole('option', { name: '전용계좌 사업(이나라도움) (1개)', exact: true }).click();
  await page.getByRole('option', { name: '기타 (1개)', exact: true }).click();
  await zeroCountOption.click();
  await expect(page.getByTestId('cashflow-export-step-account-type')).toContainText('3개 유형 선택');
  await zeroCountOption.click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('cashflow-export-step-account-type')).toContainText('2개 유형 선택');

  await page.getByTestId('cashflow-export-sort').click();
  await page.getByRole('option', { name: '소속(CIC/센터)' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('cashflow-export-download').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('cashflow-filtered.xlsx');
  expect(requestBody).toMatchObject({
    scope: 'selected',
    projectIds: ['cashflow-e2e-a', 'cashflow-e2e-b'],
    department: '센터A',
    accountTypes: ['DEDICATED', 'OTHER'],
    sortBy: 'DEPARTMENT',
  });
});
