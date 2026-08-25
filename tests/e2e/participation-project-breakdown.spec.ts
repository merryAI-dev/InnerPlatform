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

function snapshot(
  ruleId: RuleId,
  year = '2026',
  includeProjects = true,
  includeProfessionalProfile = true,
  selectedEducation: string | null = null,
  options: {
    selectedEnglishEvidence?: string | null;
    selectedCertifications?: string[];
    certificationOptions?: Array<{ value: string; label: string; memberCount: number }>;
    professionalProfileAccess?: boolean;
    members?: Array<Record<string, unknown>>;
  } = {},
) {
  const memberMonths = monthsFor(year);
  memberMonths[0] = month(`${year}-01`, { rate: 0, isConfirmed: true });
  memberMonths[1] = month(`${year}-02`, { hasMissing: true });
  memberMonths[3] = month(`${year}-04`, { rate: 30, isConfirmed: true, hasMissing: true });
  const projectMonths = memberMonths.map((value) => ({ ...value }));
  const members = [
    {
      memberId: 'member-a', memberName: '김메리', projectLabel: '가 사업 · 나 사업', projectCount: 2,
      months: memberMonths, warnings: [],
      profileSummary: {
        highestEducationDisplayText: '석사 졸업 · University of Sussex',
        englishEvidenceDisplayText: 'TOEIC 920 · 해외 대학',
        certificationsDisplayText: 'PMP',
      },
      ...(includeProjects ? { projects: [
        { projectId: 'project-a', projectName: '가 사업', months: projectMonths },
        { projectId: 'project-b', projectName: '나 사업', months: monthsFor(year) },
      ] } : {}),
    },
    {
      memberId: 'member-b', memberName: '이메리', projectLabel: '다 사업', projectCount: 1,
      months: monthsFor(year), warnings: [], profileSummary: {},
      ...(includeProjects ? { projects: [{ projectId: 'project-c', projectName: '다 사업', months: monthsFor(year) }] } : {}),
    },
  ];
  return {
    version: 1, generatedAt: '2026-08-24T00:00:00.000Z', availableYears: ['2026', '2027'], selectedYear: year,
    months: monthsFor(year).map(({ yearMonth, label }) => ({ yearMonth, label })),
    selectedRule: ruleOptions.find((rule) => rule.id === ruleId), ruleOptions, userRuleOptions: ruleOptions.slice(1),
    members: options.members || (selectedEducation
      ? selectedEducation === 'MASTER_GRADUATED' ? members.slice(0, 1) : []
      : members),
    warnings: [], warningCount: 0, hasWarnings: false, unlinkedEntryCount: 10,
    filterOptions: { clientOrgs: ['기관'], settlementSystems: [{ value: 'system', label: '정산', projectCount: 0 }] },
    projects: [],
    ...(includeProfessionalProfile ? {
      professionalProfileAccess: options.professionalProfileAccess ?? true,
      selectedProfileFilters: {
        education: selectedEducation,
        englishEvidence: options.selectedEnglishEvidence ?? null,
        certifications: options.selectedCertifications || [],
      },
      profileFilterOptions: {
        education: [
          { value: 'MASTER_GRADUATED', label: '석사 졸업', memberCount: 1 },
          { value: 'DOCTOR_GRADUATED', label: '박사 졸업', memberCount: 0 },
          { value: '__MISSING__', label: '미입력', memberCount: 1 },
        ],
        englishEvidence: [
          { value: 'TOEIC', label: 'TOEIC', memberCount: 1 },
          { value: 'TOEFL', label: 'TOEFL', memberCount: 0 },
          { value: '__MISSING__', label: '미입력', memberCount: 1 },
        ],
        certifications: options.certificationOptions || [
          { value: '__MISSING__', label: '미입력', memberCount: 1 },
          { value: 'pmp', label: 'PMP', memberCount: 1 },
          { value: 'oda 전문가', label: 'ODA 전문가', memberCount: 0 },
        ],
      },
    } : {}),
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
    await route.fulfill({ json: snapshot(
      ruleId,
      url.searchParams.get('year') || '2026',
      true,
      true,
      url.searchParams.get('education'),
    ) });
  });
  await loginAsAdmin(page);
  await page.goto('/participation');
  await expect(page.getByRole('heading', { name: '참여인력 대시보드' })).toBeVisible();
  await expect(page.getByRole('columnheader')).toHaveText([
    '사람', '참여 사업', '최종학력', '영어', '자격증',
    '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월',
  ]);
  await expect(page.getByText('연결 대기 10건', { exact: true })).toBeVisible();
  await expect(page.getByText('참여율 시트 확인', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('최종학력 필터')).toBeVisible();
  await expect(page.getByLabel('영어 필터')).toBeVisible();
  await expect(page.getByLabel('자격증 필터')).toBeVisible();
  await expect(page.getByText('조회 결과 2명', { exact: true })).toBeVisible();
  await expect(page.getByLabel('최종학력 필터').locator('option[value="DOCTOR_GRADUATED"]')).toHaveText('박사 졸업 · 0명');

  await page.getByLabel('최종학력 필터').selectOption('DOCTOR_GRADUATED');
  await expect(page.getByText('조회 결과 0명', { exact: true })).toBeVisible();
  await expect(page.getByText('선택한 데이터 필터에 맞는 참여자가 없습니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '데이터 필터 초기화' })).toBeVisible();
  expect(dashboardRequests.at(-1)).toContain('education=DOCTOR_GRADUATED');
  await page.getByRole('button', { name: '초기화', exact: true }).click();
  await expect(page.getByText('김메리', { exact: true })).toBeVisible();

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

  const firstMemberRow = page.getByText('김메리', { exact: true }).locator('xpath=ancestor::tr');
  await expect(firstMemberRow.locator('td')).toHaveCount(17);
  await expect(firstMemberRow.locator('td').nth(2)).toHaveText('석사 졸업 · University of Sussex');
  await expect(firstMemberRow.locator('td').nth(3)).toHaveText('TOEIC 920 · 해외 대학');
  await expect(firstMemberRow.locator('td').nth(4)).toHaveText('PMP');
  const missingProfileRow = page.getByText('이메리', { exact: true }).locator('xpath=ancestor::tr');
  await expect(missingProfileRow.locator('td').nth(2)).toHaveAttribute('aria-label', '미입력');
  await expect(missingProfileRow.locator('td').nth(3)).toHaveAttribute('aria-label', '미입력');
  await expect(missingProfileRow.locator('td').nth(4)).toHaveAttribute('aria-label', '미입력');

  const firstDetails = page.locator('#participation-projects-member-a');
  const firstProjectRow = firstDetails.getByRole('row').first();
  await expect(firstProjectRow.locator('td')).toHaveCount(17);
  await expect(firstProjectRow.getByRole('cell')).toHaveCount(17);
  await expect(firstProjectRow.locator('td').nth(0)).toHaveText('');
  await expect(firstProjectRow.locator('td').nth(1)).toContainText('가 사업');
  await expect(firstProjectRow.locator('td').nth(2)).toHaveText('');
  await expect(firstProjectRow.locator('td').nth(3)).toHaveText('');
  await expect(firstProjectRow.locator('td').nth(4)).toHaveText('');
  const detailStyles = await firstProjectRow.locator('td').nth(5).evaluate((cell) => {
    const style = getComputedStyle(cell);
    return { backgroundColor: style.backgroundColor, fontSize: style.fontSize };
  });
  await expect(firstProjectRow.locator('td').nth(5)).toHaveClass(/bg-slate-50/);
  expect(detailStyles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(detailStyles.fontSize).toBe('11px');
  await expect(firstProjectRow.locator('td').nth(6)).toHaveClass(/bg-amber-50/);
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
    await route.fulfill({ json: snapshot('saved-rule', '2026', false, true, null, { professionalProfileAccess: false }) });
  });
  await loginAsAdmin(page);
  await page.goto('/participation');
  await expect(page.getByText('프로젝트 2개', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /김메리의 프로젝트/ })).toHaveCount(0);
  await expect(page.getByRole('columnheader')).toHaveCount(14);
  await expect(page.getByLabel('전문 프로필 필터')).toHaveCount(0);
});

test('profile filters stay mounted, cap certifications at 20, and follow browser history without request loops', async ({ page }) => {
  const requests: URL[] = [];
  const certificationOptions = [
    ...Array.from({ length: 21 }, (_, index) => ({
      value: `certificate-${String(index + 1).padStart(2, '0')}`,
      label: `자격 ${String(index + 1).padStart(2, '0')}`,
      memberCount: index === 20 ? 0 : 1,
    })),
    { value: '__MISSING__', label: '미입력', memberCount: 0 },
  ];
  await page.route('**/api/v1/participation-dashboard*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    await route.fulfill({
      json: snapshot(
        url.searchParams.get('ruleId') === 'saved-rule' ? 'saved-rule' : 'all',
        url.searchParams.get('year') || '2026',
        true,
        true,
        url.searchParams.get('education'),
        {
          selectedEnglishEvidence: url.searchParams.get('englishEvidence'),
          selectedCertifications: url.searchParams.getAll('certification'),
          certificationOptions,
        },
      ),
    });
  });
  await loginAsAdmin(page);
  await page.goto('/participation');
  await expect(page.getByText('조회 결과 2명', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);

  await page.getByLabel('최종학력 필터').selectOption('MASTER_GRADUATED');
  await expect(page.getByLabel('최종학력 필터')).toHaveClass(/border-sky-300/);
  await expect.poll(() => requests.length).toBe(2);
  await page.getByLabel('영어 필터').selectOption('TOEIC');
  await expect(page.getByLabel('영어 필터')).toHaveClass(/border-sky-300/);
  await expect.poll(() => requests.length).toBe(3);
  await page.getByLabel('자격증 필터').click();

  const certificationChecks = page.getByRole('checkbox', { name: /자격 \d{2}/ });
  await certificationChecks.evaluateAll(async (elements) => {
    for (const element of elements.slice(0, 20)) {
      (element as HTMLElement).click();
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    }
  });
  await expect(page.getByLabel('자격증 필터')).toBeVisible();
  await expect(page.getByLabel('자격증 필터')).toContainText('20개 선택');
  await expect(page.getByLabel('자격증 필터')).toHaveClass(/border-sky-300/);
  await expect(page.getByText('최대 20개', { exact: true })).toBeVisible();
  await expect(certificationChecks.nth(20)).toBeDisabled();
  await expect.poll(() => requests.at(-1)?.searchParams.getAll('certification').length).toBe(20);
  expect(requests).toHaveLength(4);
  const requestsAtLimit = requests.length;
  await certificationChecks.nth(20).click({ force: true });
  await page.waitForTimeout(100);
  expect(requests).toHaveLength(requestsAtLimit);
  expect(new URL(page.url()).searchParams.getAll('certification')).toHaveLength(20);

  const combined = requests.at(-1)!;
  expect(combined.searchParams.get('education')).toBe('MASTER_GRADUATED');
  expect(combined.searchParams.get('englishEvidence')).toBe('TOEIC');
  expect(combined.searchParams.getAll('certification')).toEqual(certificationOptions.slice(0, 20).map(({ value }) => value));

  await page.goBack();
  await expect(page.getByLabel('자격증 필터')).toContainText('19개 선택');
  await expect.poll(() => requests.at(-1)?.searchParams.getAll('certification').length).toBe(19);
  await page.goForward();
  await expect(page.getByLabel('자격증 필터')).toContainText('20개 선택');
  await expect.poll(() => requests.at(-1)?.searchParams.getAll('certification').length).toBe(20);
  const settledRequestCount = requests.length;
  await page.waitForTimeout(100);
  expect(requests).toHaveLength(settledRequestCount);

  await page.getByRole('checkbox', { name: /미입력/ }).click();
  await expect(page.getByLabel('자격증 필터')).toContainText('1개 선택');
  await expect.poll(() => requests.at(-1)?.searchParams.getAll('certification')).toEqual(['__MISSING__']);
  await certificationChecks.nth(0).click();
  await expect(page.getByLabel('자격증 필터')).toContainText('1개 선택');
  await expect.poll(() => requests.at(-1)?.searchParams.getAll('certification')).toEqual(['certificate-01']);
});

test('late responses never restore stale rows and active-filter errors can retry or clear poisoned URL state', async ({ page }) => {
  let doctorFailuresRemaining = 1;
  const requests: string[] = [];
  await page.route('**/api/v1/participation-dashboard*', async (route) => {
    const url = new URL(route.request().url());
    const education = url.searchParams.get('education');
    requests.push(url.search);
    if (education === 'MASTER_GRADUATED') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({ json: snapshot('all', '2026', true, true, education) }).catch(() => undefined);
      return;
    }
    if (education === 'DOCTOR_GRADUATED' && doctorFailuresRemaining > 0) {
      doctorFailuresRemaining -= 1;
      await route.fulfill({ status: 422, json: { error: 'invalid filter' } });
      return;
    }
    if (education === 'POISON') {
      await route.fulfill({ status: 422, json: { error: 'invalid filter' } });
      return;
    }
    await route.fulfill({ json: snapshot('all', '2026', true, true, education) });
  });
  await loginAsAdmin(page);
  await page.goto('/participation');

  await page.getByLabel('최종학력 필터').selectOption('MASTER_GRADUATED');
  await expect(page.getByText('참여율 결과를 불러오는 중입니다.')).toBeVisible();
  await expect(page.getByText('김메리', { exact: true })).toHaveCount(0);
  await expect.poll(() => requests.some((search) => search.includes('MASTER_GRADUATED'))).toBe(true);
  await page.getByLabel('최종학력 필터').selectOption('DOCTOR_GRADUATED');
  await expect(page.getByRole('heading', { name: '참여율 스냅샷을 표시할 수 없습니다' })).toBeVisible();
  await expect(page.getByLabel('최종학력 필터')).toHaveValue('DOCTOR_GRADUATED');
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
  await expect(page.getByRole('button', { name: '데이터 필터를 초기화하고 다시 조회' })).toBeVisible();
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('조회 결과 0명', { exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  await expect(page.getByText('김메리', { exact: true })).toHaveCount(0);

  await page.goto('/participation?education=POISON');
  await expect(page.getByRole('heading', { name: '참여율 스냅샷을 표시할 수 없습니다' })).toBeVisible();
  await page.getByRole('button', { name: '데이터 필터를 초기화하고 다시 조회' }).click();
  await expect(page.getByText('조회 결과 2명', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has('education')).toBe(false);
  expect(requests.at(-1)).not.toContain('POISON');
});

test('empty states are distinct and the 17-column profile table stays aligned at 375px', async ({ page }) => {
  await page.route('**/api/v1/participation-dashboard*', async (route) => {
    const url = new URL(route.request().url());
    const education = url.searchParams.get('education');
    await route.fulfill({
      json: snapshot('all', '2026', true, true, education, {
        members: education ? [] : [],
      }),
    });
  });
  await loginAsAdmin(page);
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto('/participation');
  await expect(page.getByText('선택한 범위에 등록된 프로젝트 참여자가 없습니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '데이터 필터 초기화' })).toHaveCount(0);
  await expect(page.getByRole('columnheader')).toHaveCount(17);

  const tableRegion = page.getByRole('region', { name: '참여인력 월별 참여율 표' });
  const widths = await tableRegion.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewportWidth: window.innerWidth,
    pageWidth: document.documentElement.scrollWidth,
  }));
  expect(widths.scrollWidth).toBeGreaterThan(widths.clientWidth);
  expect(widths.pageWidth).toBeLessThanOrEqual(widths.viewportWidth);
  await tableRegion.focus();
  await expect(tableRegion).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => tableRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  await page.getByLabel('최종학력 필터').selectOption('DOCTOR_GRADUATED');
  await expect(page.getByText('선택한 데이터 필터에 맞는 참여자가 없습니다.')).toBeVisible();
  await expect(page.getByRole('button', { name: '데이터 필터 초기화' })).toBeVisible();
});

test('tenant scope change immediately hides the previous profile facets and fails closed on denied access', async ({ page }) => {
  const requestedTenants: string[] = [];
  await page.route('**/api/v1/participation-dashboard*', async (route) => {
    const tenantId = route.request().headers()['x-tenant-id'] || '';
    requestedTenants.push(tenantId);
    if (tenantId === 'org002') {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({ status: 403, json: { error: 'forbidden' } });
      return;
    }
    await route.fulfill({ json: snapshot('all') });
  });
  await loginAsAdmin(page);
  await page.goto('/participation');
  await expect(page.getByLabel('전문 프로필 필터')).toBeVisible();
  await expect(page.getByText('조회 결과 2명', { exact: true })).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('mysc:tenant-changed', { detail: { tenantId: 'org002' } }));
  });
  await expect(page.getByLabel('전문 프로필 필터')).toHaveCount(0);
  await expect(page.getByText('조회 결과 2명', { exact: true })).toHaveCount(0);
  await expect(page.getByText('참여율 스냅샷을 불러오는 중입니다.')).toBeVisible();
  await expect(page.getByRole('heading', { name: '참여율 스냅샷을 표시할 수 없습니다' })).toBeVisible();
  await expect(page.getByLabel('전문 프로필 필터')).toHaveCount(0);
  expect(requestedTenants).toContain('org002');
});
