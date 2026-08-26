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
    executiveApproverId: 'person-head',
    managerId: 'person-manager',
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

const people = [
  {
    personId: 'head-record', uid: 'person-head', name: '김조직', nickname: '헤드', email: 'head@mysc.co.kr',
    departmentTop: 'MYSC', departmentMid: '센터A', departmentSub: '', title: '조직장', grade: '', workLocation: '',
    joinedAt: '2020-01-01', employments: [],
  },
  {
    personId: 'manager-record', uid: 'person-manager', name: '이담당', nickname: '', email: 'manager@mysc.co.kr',
    departmentTop: 'MYSC', departmentMid: '센터A', departmentSub: '', title: 'PM', grade: '', workLocation: '',
    joinedAt: '2021-01-01', employments: [],
  },
];

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function openCashflowExportWithPlatformApi(page: Page, role = 'admin') {
  await page.clock.setFixedTime(new Date('2026-09-01T03:00:00.000Z'));
  await page.addInitScript((actorRole) => {
    localStorage.setItem('mysc-auth-user', JSON.stringify({
      uid: 'cashflow-e2e-admin',
      name: '캐시플로 테스트 관리자',
      email: 'cashflow-e2e-admin@mysc.co.kr',
      role: actorRole,
      source: 'dev_harness',
      tenantId: 'mysc',
      idToken: 'cashflow-e2e-id-token',
      defaultWorkspace: 'admin',
      lastWorkspace: 'admin',
    }));
  }, role);

  const weeklyOverviewBodies: Array<{ projectIds?: string[]; yearMonth?: string }> = [];
  const settlementBatchBodies: Array<{ projectIds?: string[]; yearMonth?: string }> = [];
  await page.route('**/api/v1/projects?limit=200*', (route) => fulfillJson(route, {
    items: projects, nextCursor: null,
  }));
  await page.route('**/api/v1/persons', (route) => fulfillJson(route, {
    items: people, total: people.length,
    capabilities: { professionalProfileRead: true, professionalProfileWrite: true },
  }));
  let weeklyOverviewCalls = 0;
  let settlementBatchCalls = 0;
  let strictSummaryCalls = 0;
  await page.route('**/api/v1/cashflow/weekly-overview', async (route) => {
    weeklyOverviewCalls += 1;
    const body = route.request().postDataJSON() as { projectIds?: string[]; yearMonth?: string };
    weeklyOverviewBodies.push(body);
    const projectIds = body.projectIds || [];
    const statusFor = (projectId: string) => {
      if (projectId === 'cashflow-e2e-a') {
        return {
          projectId, yearMonth: '2026-09', items: [{
            period: 'WEEK_1', status: 'PENDING_APPROVAL',
            submittedAt: '2026-09-01T01:00:00.000Z', submittedBy: 'person-manager',
            approvedAt: '', approvedBy: '', revision: 1,
          }],
        };
      }
      if (projectId === 'cashflow-e2e-b') {
        return {
          projectId, yearMonth: '2026-09', items: [],
        };
      }
      return null;
    };
    const summaryFor = (projectId: string) => projectId === 'cashflow-e2e-a' ? {
      projectId, source: 'SHEET_FORMULA', sourceRevision: 'mirror-source-1', fromMonth: '2026-01',
      comparisonAsOfWeek: { yearMonth: '2026-09', weekNo: 1 },
      differenceAmount: -12_345, settlementDifferenceAmount: -12_345, settlementMatches: false,
      display: {
        periodLabel: '누적 2026-01~2026-09 1주차', statusLabel: '불일치',
        statusTone: 'danger', differenceLabel: '차액 -12,345원',
      },
      periods: ['MONTH', 'WEEK_1', 'WEEK_2', 'WEEK_3', 'WEEK_4', 'WEEK_5'].map((period) => ({
        period, differenceAmount: period === 'WEEK_1' ? -12_345 : null,
      })),
    } : null;
    await fulfillJson(route, {
      version: '4', yearMonth: body.yearMonth,
      monthCloseTargetYearMonth: '2026-08', monthCloseTargetLabel: '8월',
      items: projectIds.map((projectId) => ({
        projectId,
        settlementStatuses: statusFor(projectId),
        projectionActualSummary: summaryFor(projectId),
        sheetCapturedAt: projectId === 'cashflow-e2e-a' ? '2026-08-25T07:48:00.000Z' : null,
      })),
      errors: projectIds.flatMap((projectId) => projectId === 'cashflow-e2e-c' ? [
        { projectId, code: 'STATUS_UNAVAILABLE' },
        { projectId, code: 'SUMMARY_UNAVAILABLE' },
      ] : []),
    });
  });
  await page.route('**/api/v1/cashflow/settlement-statuses/batch', async (route) => {
    settlementBatchCalls += 1;
    const body = route.request().postDataJSON() as { projectIds?: string[]; yearMonth?: string };
    settlementBatchBodies.push(body);
    const projectIds = body.projectIds || [];
    await fulfillJson(route, {
      items: projectIds.flatMap((projectId) => {
        if (projectId === 'cashflow-e2e-c') return [];
        return [{
          projectId, yearMonth: body.yearMonth,
          items: [{
            period: 'WEEK_5',
            status: projectId === 'cashflow-e2e-a' ? 'COMPLETED' : 'WAITING_FOR_UPDATE',
            submittedAt: projectId === 'cashflow-e2e-a' ? '2026-08-31T01:00:00.000Z' : '',
            submittedBy: projectId === 'cashflow-e2e-a' ? 'person-manager' : '',
            approvedAt: projectId === 'cashflow-e2e-a' ? '2026-08-31T02:00:00.000Z' : '',
            approvedBy: projectId === 'cashflow-e2e-a' ? 'person-head' : '',
            revision: projectId === 'cashflow-e2e-a' ? 2 : 0,
          }],
        }];
      }),
      errors: projectIds.flatMap((projectId) => projectId === 'cashflow-e2e-c'
        ? [{ projectId, code: 'STATUS_UNAVAILABLE' }]
        : []),
    });
  });
  await page.route('**/api/v1/cashflow/projection-actual-summary/batch', async (route) => {
    strictSummaryCalls += 1;
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
  if (role === 'viewer') {
    await expect(page.getByRole('heading', { name: '이 화면을 열 수 없습니다' })).toBeVisible();
  } else {
    await expect(page.getByTestId('cashflow-export-page')).toBeVisible();
    await expect(page.getByRole('cell', { name: '가 사업' })).toBeVisible();
  }
  return {
    getWeeklyOverviewCalls: () => weeklyOverviewCalls,
    getWeeklyOverviewBodies: () => weeklyOverviewBodies,
    getSettlementBatchCalls: () => settlementBatchCalls,
    getSettlementBatchBodies: () => settlementBatchBodies,
    getStrictSummaryCalls: () => strictSummaryCalls,
  };
}

test('shows the canonical recent two-week operations snapshot without the legacy summary request', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const requests = await openCashflowExportWithPlatformApi(page);
  const table = page.getByTestId('cashflow-export-operations-table');
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '가 사업' }) });

  await expect(row).toContainText('김조직(헤드)');
  await expect(row).toContainText('이담당');
  await expect(row).toContainText('8월 5주차');
  await expect(row).toContainText('9월 1주차');
  await expect(row).toContainText('승인 완료');
  await expect(row).toContainText('조직장 승인 필요');
  await expect(row).toContainText('실무자 제출 완료');
  await expect(row).toContainText('조직장 승인 완료');
  await expect(row).toContainText('8/31(월) 10:00');
  await expect(row).toContainText('8/31(월) 11:00');
  await expect(row).toContainText('9/1(화) 10:00');
  await expect(row).toContainText('차액 -12,345원');
  await expect(row).toContainText('2026. 08. 25. 16:48');
  const missingRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '나 사업' }) });
  await expect(missingRow).toContainText('주정산 이전');
  await expect(missingRow).toContainText('주정산 정보를 불러오지 못함');
  await expect(missingRow).toContainText('제출 전');
  await expect(missingRow).toContainText('승인 전');
  await expect(missingRow).toContainText('시트 저장값 없음');
  await expect(missingRow).toContainText('불러온 기록 없음');
  const partialErrorRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: '다 사업' }) });
  await expect(partialErrorRow).toContainText('주정산 정보를 불러오지 못함');
  await expect(partialErrorRow).toContainText('시트 현황을 불러오지 못함');
  await expect(table.getByRole('columnheader').allTextContents()).resolves.toEqual([
    '사업명', '조직장', '담당자', '주정산 최근 2주', '누적 Projection-Actual', '시트 불러온 시각', '이동',
  ]);
  await expect(page.getByText('BFF 서버의 최신 현금흐름 데이터')).toHaveCount(0);
  await expect(page.getByText('확인 불가')).toHaveCount(0);
  expect(requests.getWeeklyOverviewCalls()).toBe(1);
  expect(requests.getWeeklyOverviewBodies()).toEqual([{
    projectIds: ['cashflow-e2e-a', 'cashflow-e2e-b', 'cashflow-e2e-c'], yearMonth: '2026-09',
  }]);
  expect(requests.getSettlementBatchCalls()).toBe(1);
  expect(requests.getSettlementBatchBodies()).toEqual([{
    projectIds: ['cashflow-e2e-a', 'cashflow-e2e-b', 'cashflow-e2e-c'], yearMonth: '2026-08',
  }]);
  expect(requests.getStrictSummaryCalls()).toBe(0);

  await page.setViewportSize({ width: 375, height: 800 });
  await expect.poll(() => table.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await table.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(consoleErrors).toEqual([]);
});

test('does not fetch operations data for a user without export permission', async ({ page }) => {
  const requests = await openCashflowExportWithPlatformApi(page, 'viewer');
  await page.waitForTimeout(250);
  expect(requests.getWeeklyOverviewCalls()).toBe(0);
  expect(requests.getSettlementBatchCalls()).toBe(0);
  expect(requests.getStrictSummaryCalls()).toBe(0);
});

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
