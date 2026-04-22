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

async function seedHarnessProject(page) {
  await page.addInitScript((session) => {
    window.localStorage.setItem('mysc-auth-user', JSON.stringify(session));
    window.localStorage.setItem('mysc-dev-auth-harness', JSON.stringify(session));
    window.localStorage.setItem('MYSC_ACTIVE_TENANT', session.tenantId);
    window.sessionStorage.setItem(`mysc-portal-active-project:${session.uid}`, session.projectId);
  }, TEST_USER);
}

async function ensureProjectSelected(page) {
  if (page.url().includes('/portal/project-select')) {
    const startButton = page.locator('[data-testid^="portal-project-start-"]').first();
    await expect(startButton).toBeVisible();
    await startButton.click();
  }
  await expect(page).toHaveURL(/\/portal(?!\/project-select)(?:$|\/)/);
}

async function openPortalPath(page, path) {
  await page.goto(path);
  await ensureProjectSelected(page);
}

test.skip('dev auth harness can apply sample expense-sheet migration end-to-end', async ({ page }) => {
  await seedHarnessProject(page);
  await page.goto('/portal');
  await page.waitForURL((url) => url.pathname.startsWith('/portal'));
  await openPortalPath(page, '/portal/weekly-expenses');
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

  await expect(page.locator('[value=\"KTX\"]').first()).toBeVisible();
  await expect(page.locator('[value=\"카페 메리\"]').first()).toBeVisible();
  await expect(page.getByText('예기치 못한 오류가 발생했습니다')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: '사업비 입력(주간)' })).toBeVisible();
  await expect(page.locator('[value=\"KTX\"]').first()).toBeVisible();
  await expect(page.locator('[value=\"카페 메리\"]').first()).toBeVisible();
});
