import { expect, test, type Page, type Route } from '@playwright/test';

const TENANT_ID = 'org001';
const ADMIN_USER = {
  source: 'firebase' as const,
  uid: 'roster-push-e2e',
  name: '명단 관리자',
  email: 'roster-admin@mysc.co.kr',
  role: 'admin' as const,
  idToken: 'token-1',
  tenantId: TENANT_ID,
  defaultWorkspace: 'admin' as const,
  lastWorkspace: 'admin' as const,
};

const personA = {
  personId: 'person-a', name: '김메리', nickname: '메리', email: 'merry@mysc.co.kr',
  departmentTop: '임팩트 CIC', departmentMid: '', departmentSub: '', title: '매니저', grade: '',
  workLocation: '서울', joinedAt: '2025-01-02', uid: 'member-a', note: '',
  employments: [{
    id: 'employment-a', type: 'FULL_TIME', state: 'WORKING', startDate: '2025-01-02', endDate: null, note: '',
  }],
};

const ROSTER_STATUS = {
  statuses: [
    {
      spreadsheetId: 'sheet-ok', spreadsheetTitle: '참여율_사업하나 사본',
      sheetTabs: ['안내', '참조', '참여율 관리'],
      projects: [{ projectId: 'proj-1', projectName: '사업 하나' }],
      ok: true, active: true, reason: null, message: null,
      lastAttemptAt: '2026-08-25T02:30:00.000Z', lastSuccessAt: '2026-08-25T02:30:00.000Z', writtenRows: 101,
    },
    {
      spreadsheetId: 'sheet-bad', spreadsheetTitle: '참여율_사업둘 사본',
      sheetTabs: [],
      projects: [{ projectId: 'proj-2', projectName: '사업 둘' }],
      ok: false, active: true, reason: 'permission_denied', message: '공유 안 됨',
      lastAttemptAt: '2026-08-25T02:30:00.000Z', lastSuccessAt: null, writtenRows: null,
    },
  ],
  counts: { total: 2, ok: 1, failed: 1, inactive: 1 },
  pendingPush: { queued: 0, processing: 0, oldestQueuedAt: null },
};

async function seedUser(page: Page, overrides: Partial<typeof ADMIN_USER> = {}) {
  const user = { ...ADMIN_USER, ...overrides };
  await page.addInitScript((payload) => {
    window.localStorage.setItem('mysc-auth-user', JSON.stringify(payload));
    window.localStorage.setItem('MYSC_ACTIVE_TENANT', payload.tenantId);
  }, user);
}

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
}

function installApi(page: Page, options: {
  status?: unknown;
  pushes?: Array<{ idempotencyKey: string | undefined }>;
} = {}) {
  let statusGets = 0;
  const pushes = options.pushes ?? [];
  const handler = async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/persons' && route.request().method() === 'GET') {
      await fulfillJson(route, {
        items: [personA], total: 1,
        capabilities: { professionalProfileRead: false, professionalProfileWrite: false },
      });
      return;
    }
    if (url.pathname === '/api/v1/projects') {
      await fulfillJson(route, { items: [], nextCursor: null });
      return;
    }
    if (url.pathname === '/api/v1/participation-roster/push-status') {
      statusGets += 1;
      await fulfillJson(route, options.status ?? ROSTER_STATUS);
      return;
    }
    if (url.pathname === '/api/v1/participation-roster/push' && route.request().method() === 'POST') {
      pushes.push({ idempotencyKey: route.request().headers()['idempotency-key'] });
      await fulfillJson(route, { ok: true, eventId: 'evt-1', eventType: 'participation.roster.changed', processed: true, succeeded: true }, 200);
      return;
    }
    await fulfillJson(route, { code: 'e2e_unhandled', message: `${route.request().method()} ${url.pathname}` }, 500);
  };
  return page.route('**/api/v1/**', handler).then(() => ({ pushes, countStatusGets: () => statusGets }));
}

test('관리자는 시트별 동기화 상태를 보고 명단 갱신을 대기열에 넣는다', async ({ page }) => {
  await seedUser(page);
  const api = await installApi(page);

  await page.goto('/people');
  await expect(page.getByRole('heading', { name: '인력 명부' })).toBeVisible();

  // 상태는 ID 가 아니라 시트 제목 + 프로젝트명으로 말한다.
  await expect(page.getByText('참여율 시트 명단 동기화')).toBeVisible();
  await expect(page.getByText('참여율_사업하나 사본')).toBeVisible();
  await expect(page.getByText('반영됨 · 101행')).toBeVisible();
  await expect(page.getByText('탭 3개: 안내 · 참조 · 참여율 관리')).toBeVisible();
  await expect(page.getByText('편집 권한 없음 - 시스템 계정을 편집자로 공유해 주세요')).toBeVisible();
  await expect(page.getByText('연동 해제된 시트 이력 1건은 표시하지 않습니다.')).toBeVisible();

  const before = api.countStatusGets();
  await page.getByRole('button', { name: '명단 갱신 실행' }).click();
  await expect(page.getByText('명단을 시트에 즉시 반영했습니다', { exact: false })).toBeVisible();
  expect(api.pushes).toHaveLength(1);
  expect(api.pushes[0].idempotencyKey).toMatch(/^roster-push:/);
  await expect.poll(() => api.countStatusGets()).toBeGreaterThan(before);
});

// 실행 버튼의 역할 게이트(personWrite)는 roster-push-helpers.test.ts 가 고정한다.
// /people 은 admin 작업 공간이라 pm 시나리오는 이 페이지에 존재하지 않는다.
test('연동된 시트가 없으면 등록 안내가 뜨고, 대기 중 이벤트 수가 보인다', async ({ page }) => {
  await seedUser(page, { uid: 'roster-empty-e2e' });
  await installApi(page, {
    status: {
      statuses: [],
      counts: { total: 0, ok: 0, failed: 0, inactive: 0 },
      pendingPush: { queued: 1, processing: 0, oldestQueuedAt: '2026-08-25T08:50:00.000Z' },
    },
  });

  await page.goto('/people');
  await expect(page.getByText('참여율 시트 명단 동기화')).toBeVisible();
  await expect(page.getByText('아직 연동된 시트가 없습니다', { exact: false })).toBeVisible();
  await expect(page.getByText('대기 중 1건', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '명단 갱신 실행' })).toBeVisible();
});
