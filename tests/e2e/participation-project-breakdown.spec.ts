import { expect, test, type Page } from '@playwright/test';

type RuleId = 'all' | 'saved-rule';

const ruleOptions = [
  { id: 'all', alias: '전체 인력', clientOrgs: [], settlementSystems: [] },
  { id: 'saved-rule', alias: '저장 View', clientOrgs: ['기관'], settlementSystems: ['system'] },
];

const month = (yearMonth: string, overrides: Record<string, unknown> = {}) => ({
  yearMonth,
  label: `${Number(yearMonth.slice(5))}월`,
  rate: 0,
  isConfirmed: false,
  hasMissing: false,
  isWarning: false,
  ...overrides,
});

const monthsFor = (year: string) => Array.from({ length: 12 }, (_, index) => month(`${year}-${String(index + 1).padStart(2, '0')}`));

function snapshot(ruleId: RuleId, year = '2026', includeProjects = true) {
  const memberMonths = monthsFor(year);
  memberMonths[0] = month(`${year}-01`, { rate: 0, isConfirmed: true });
  memberMonths[1] = month(`${year}-02`, { hasMissing: true });
  memberMonths[3] = month(`${year}-04`, { rate: 30, isConfirmed: true, hasMissing: true });
  const projectMonths = memberMonths.map((value) => ({ ...value }));
  const members = [
    {
      memberId: 'member-a', memberName: '김메리', projectLabel: '가 사업 · 나 사업', projectCount: 2,
      months: memberMonths, warnings: [],
      ...(includeProjects ? { projects: [
        { projectId: 'project-a', projectName: '가 사업', months: projectMonths },
        { projectId: 'project-b', projectName: '나 사업', months: monthsFor(year) },
      ] } : {}),
    },
    {
      memberId: 'member-b', memberName: '이메리', projectLabel: '다 사업', projectCount: 1,
      months: monthsFor(year), warnings: [],
      ...(includeProjects ? { projects: [{ projectId: 'project-c', projectName: '다 사업', months: monthsFor(year) }] } : {}),
    },
  ];
  return {
    version: 1, generatedAt: '2026-08-24T00:00:00.000Z', availableYears: ['2026', '2027'], selectedYear: year,
    months: monthsFor(year).map(({ yearMonth, label }) => ({ yearMonth, label })),
    selectedRule: ruleOptions.find((rule) => rule.id === ruleId), ruleOptions, userRuleOptions: ruleOptions.slice(1),
    members, warnings: [], warningCount: 0, hasWarnings: false, unlinkedEntryCount: 0,
    filterOptions: { clientOrgs: ['기관'], settlementSystems: [{ value: 'system', label: '정산', projectCount: 0 }] },
    projects: [],
  };
}

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: '관리자 샘플 로그인' }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/');
}

test('saved-rule project rows disclose accessibly without extra dashboard requests', async ({ page }) => {
  const dashboardRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.route('**/api/v1/participation-dashboard*', async (route) => {
    const url = new URL(route.request().url());
    dashboardRequests.push(url.search);
    const ruleId = url.searchParams.get('ruleId') === 'saved-rule' ? 'saved-rule' : 'all';
    await route.fulfill({ json: snapshot(ruleId, url.searchParams.get('year') || '2026') });
  });
  await loginAsAdmin(page);
  await page.goto('/participation');
  await expect(page.getByRole('heading', { name: '참여인력 대시보드' })).toBeVisible();

  await expect(page.getByRole('button', { name: /프로젝트 .* (펼치기|접기)/ })).toHaveCount(0);
  await expect(page.getByText('프로젝트 2개', { exact: true })).toBeVisible();

  await page.getByLabel('참여율 View').selectOption('saved-rule');
  const first = page.getByRole('button', { name: /김메리의 프로젝트 2개/ });
  const second = page.getByRole('button', { name: /이메리의 프로젝트 1개/ });
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(second).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('가 사업', { exact: true }).last()).toBeHidden();

  const controls = await page.getByRole('button', { name: /의 프로젝트 .* 펼치기/ }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-controls')));
  expect(new Set(controls).size).toBe(controls.length);
  for (const id of controls) {
    expect(id).toBeTruthy();
    expect(await page.locator(`[id="${id}"]`).count()).toBe(1);
  }

  const requestsBeforeToggle = dashboardRequests.length;
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(second).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('나 사업', { exact: true }).last()).toBeVisible();
  await second.press('Enter');
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await first.press('Enter');
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await first.press('Space');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  expect(dashboardRequests.length).toBe(requestsBeforeToggle);

  const firstDetails = page.locator('#participation-projects-member-a');
  await expect(firstDetails.getByText('0%', { exact: true }).first()).toBeVisible();
  await expect(firstDetails.getByText('미입력', { exact: true }).first()).toBeVisible();
  await expect(firstDetails.getByText('—', { exact: true }).first()).toBeVisible();
  await expect(firstDetails.getByText('미입력 있음', { exact: true }).first()).toBeVisible();

  await page.getByLabel('참여율 연도').selectOption('2027');
  await expect(page.getByRole('button', { name: '김메리의 프로젝트 2개 펼치기' })).toHaveAttribute('aria-expanded', 'false');

  const requestsBeforeRuleEdit = dashboardRequests.length;
  await page.getByRole('button', { name: '규칙 관리' }).click();
  await page.getByRole('button', { name: '새 규칙 만들기' }).click();
  const zeroCountSettlement = page.getByRole('checkbox', { name: '정산 · 0개' });
  await expect(zeroCountSettlement).toBeVisible();
  await expect(zeroCountSettlement).toBeEnabled();
  await zeroCountSettlement.click();
  await expect(zeroCountSettlement).toBeChecked();
  expect(dashboardRequests.length).toBe(requestsBeforeRuleEdit);
  expect(consoleErrors.filter((message) => message.includes('validateDOMNesting'))).toEqual([]);
});

test('old dashboard response without projects renders the plain aggregate count', async ({ page }) => {
  await page.route('**/api/v1/participation-dashboard*', async (route) => {
    await route.fulfill({ json: snapshot('saved-rule', '2026', false) });
  });
  await loginAsAdmin(page);
  await page.goto('/participation');
  await expect(page.getByText('프로젝트 2개', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /김메리의 프로젝트/ })).toHaveCount(0);
});
