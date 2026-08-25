import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

const TENANT_ID = 'org001';
const ADMIN_USER = {
  source: 'firebase' as const,
  uid: 'admin-profile-e2e',
  name: '프로필 관리자',
  email: 'profile-admin@mysc.co.kr',
  role: 'admin' as const,
  idToken: 'token-1',
  tenantId: TENANT_ID,
  defaultWorkspace: 'admin' as const,
  lastWorkspace: 'admin' as const,
};

const catalog = {
  catalogVersion: 1,
  educationAttainments: [
    { code: 'BACHELOR_GRADUATED', label: '학사 졸업', rank: 30 },
    { code: 'MASTER_GRADUATED', label: '석사 졸업', rank: 40 },
  ],
  englishTests: [
    {
      code: 'TOEIC', label: 'TOEIC', displayLabel: 'TOEIC',
      scales: [{ code: 'SCORE', label: '10–990점', resultType: 'NUMBER', min: 10, max: 990, step: 5 }],
    },
    {
      code: 'TOEFL', label: 'TOEFL', displayLabel: 'TOEFL',
      scales: [{ code: 'IBT', label: 'iBT 120점', resultType: 'NUMBER', min: 0, max: 120, step: 1 }],
    },
  ],
  countryCodes: ['KR', 'GB'],
};

const personA = {
  personId: 'person-a', name: '김메리', nickname: '', email: 'merry@mysc.co.kr',
  departmentTop: '임팩트 CIC', departmentMid: '', departmentSub: '', title: '매니저', grade: '',
  workLocation: '서울', joinedAt: '2025-01-02', uid: 'member-a', note: '',
  employments: [{
    id: 'employment-a', type: 'FULL_TIME', state: 'WORKING', startDate: '2025-01-02', endDate: null, note: '',
  }],
};

const personB = {
  ...personA,
  personId: 'person-b', name: '이메리', email: 'merry-b@mysc.co.kr', uid: 'member-b',
};

type ProfileInput = {
  educationRecords: Array<Record<string, unknown>>;
  englishEvidence: Array<Record<string, unknown>>;
  certifications: Array<{ label: string }>;
};

function storedProfile(options: {
  revision?: number;
  certifications?: string[];
  institutionName?: string;
  resultValue?: string;
} = {}) {
  const revision = options.revision ?? 1;
  return {
    schemaVersion: 1,
    educationRecords: [{
      attainmentCode: 'MASTER_GRADUATED',
      institutionName: options.institutionName ?? 'University of Sussex',
      countryCode: 'GB',
      major: 'Development Studies',
    }],
    englishEvidence: [{
      testCode: 'TOEIC', scaleCode: 'SCORE', resultValue: options.resultValue ?? '920',
      otherTestName: null, testedAt: '2026-03',
    }],
    certifications: (options.certifications ?? ['PMP']).map((label) => ({
      key: label.trim().toLocaleLowerCase('ko-KR'), label,
    })),
    provenance: {
      source: 'PEOPLE_MANUAL', revision, updatedAt: '2026-08-25T00:00:00.000Z', updatedBy: ADMIN_USER.uid,
    },
  };
}

function canonicalFromInput(profile: ProfileInput, revision: number) {
  return {
    schemaVersion: 1,
    educationRecords: profile.educationRecords,
    englishEvidence: profile.englishEvidence,
    certifications: profile.certifications.map(({ label }) => ({
      key: label.trim().toLocaleLowerCase('ko-KR'), label: label.trim(),
    })),
    provenance: {
      source: 'PEOPLE_MANUAL', revision, updatedAt: '2026-08-25T00:00:00.000Z', updatedBy: ADMIN_USER.uid,
    },
  };
}

async function seedAdmin(page: Page, overrides: Partial<typeof ADMIN_USER> = {}) {
  const user = { ...ADMIN_USER, ...overrides };
  await page.addInitScript((payload) => {
    window.localStorage.setItem('mysc-auth-user', JSON.stringify(payload));
    window.localStorage.setItem('MYSC_ACTIVE_TENANT', payload.tenantId);
  }, user);
}

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
}

async function installBaseApi(page: Page, options: {
  capabilities?: { professionalProfileRead: boolean; professionalProfileWrite: boolean };
  onApi?: (route: Route, url: URL) => Promise<boolean>;
} = {}) {
  const capabilities = options.capabilities ?? { professionalProfileRead: true, professionalProfileWrite: true };
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (await options.onApi?.(route, url)) return;
    if (url.pathname === '/api/v1/persons' && route.request().method() === 'GET') {
      await fulfillJson(route, { items: [personA], total: 1, capabilities });
      return;
    }
    if (url.pathname === '/api/v1/projects') {
      await fulfillJson(route, { items: [], nextCursor: null });
      return;
    }
    if (url.pathname === '/api/v1/person-professional-profile/catalog') {
      await fulfillJson(route, catalog);
      return;
    }
    await fulfillJson(route, { code: 'e2e_unhandled', message: `${route.request().method()} ${url.pathname}` }, 500);
  });
}

async function openPeople(page: Page) {
  await page.goto('/people');
  await expect(page.getByRole('heading', { name: '인력 명부' })).toBeVisible();
  await expect(page.getByText(personA.name, { exact: true })).toBeVisible();
}

test('prefill, stable PUT retry, 400/500/conflict recovery, canonical save and close/reopen work at 375px', async ({ page }, testInfo: TestInfo) => {
  await seedAdmin(page);
  let canonical = { profile: storedProfile(), revision: 1 };
  let profileGets = 0;
  let releaseSuccessfulPut: (() => void) | null = null;
  const puts: Array<{ key: string; body: { expectedRevision: number; profile: ProfileInput } }> = [];

  await installBaseApi(page, {
    onApi: async (route, url) => {
      if (url.pathname !== '/api/v1/persons/person-a/professional-profile') return false;
      if (route.request().method() === 'GET') {
        profileGets += 1;
        await fulfillJson(route, canonical);
        return true;
      }
      const body = route.request().postDataJSON() as { expectedRevision: number; profile: ProfileInput };
      puts.push({ key: route.request().headers()['idempotency-key'], body });
      if (puts.length === 1) {
        await fulfillJson(route, { code: 'internal_error', message: 'raw server detail' }, 500);
      } else if (puts.length === 2) {
        await fulfillJson(route, {
          code: 'professional_profile_invalid',
          message: 'certifications.1.label: 자격증 이름을 확인해 주세요.',
        }, 400);
      } else if (puts.length === 3) {
        await fulfillJson(route, { code: 'person_state_conflict', message: '현재 상태에서는 저장할 수 없습니다.' }, 409);
      } else if (puts.length === 4) {
        canonical = {
          profile: storedProfile({ revision: 2, certifications: ['서버 최신 자격'] }),
          revision: 2,
        };
        await fulfillJson(route, {
          code: 'professional_profile_revision_conflict',
          message: 'revision changed',
        }, 409);
      } else {
        await new Promise<void>((resolve) => { releaseSuccessfulPut = resolve; });
        const revision = body.expectedRevision + 1;
        canonical = { profile: canonicalFromInput(body.profile, revision), revision };
        await fulfillJson(route, { ...canonical, changed: true });
      }
      return true;
    },
  });

  await openPeople(page);
  await page.getByRole('button', { name: `${personA.name} 전문 프로필` }).click();
  const dialog = page.getByRole('dialog', { name: /김메리 — 전문 프로필/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#education-attainment-0')).toContainText('석사 졸업');
  await expect(dialog.locator('#education-institution-0')).toHaveValue('University of Sussex');
  await expect(dialog.locator('#english-scale-0')).toContainText('10–990점');
  await expect(dialog.locator('#english-scale-0')).not.toContainText('SCORE');
  await expect(dialog.locator('#english-result-0')).toHaveValue('920');
  const certifications = dialog.getByLabel('자격증 이름');
  await expect(certifications).toHaveValue('PMP');

  await certifications.fill('PMP, ODA 전문가');
  const saveButton = dialog.getByRole('button', { name: '전문 프로필 저장' });
  await saveButton.click();
  await expect(dialog.getByRole('alert')).toContainText('요청을 처리하는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  await expect(certifications).toHaveValue('PMP, ODA 전문가');

  await saveButton.click();
  await expect(dialog.getByRole('alert')).toContainText('certifications.1.label: 자격증 이름을 확인해 주세요.');
  await expect(certifications).toHaveValue('PMP, ODA 전문가');

  await saveButton.click();
  await expect(dialog.getByRole('alert')).toContainText('현재 상태에서는 저장할 수 없습니다.');
  await expect(dialog.getByText('다른 사용자가 먼저 수정했습니다.', { exact: false })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '최신 정보 다시 불러오기' })).toHaveCount(0);

  await saveButton.click();
  await expect(dialog.getByRole('alert')).toContainText('다른 사용자가 먼저 수정했습니다. 입력한 내용은 그대로 두었어요.');
  await expect(certifications).toHaveValue('PMP, ODA 전문가');
  expect(new Set(puts.slice(0, 4).map(({ key }) => key)).size).toBe(1);

  await dialog.getByRole('button', { name: '최신 정보 다시 불러오기' }).click();
  await expect(certifications).toHaveValue('서버 최신 자격');
  expect(profileGets).toBe(2);

  await certifications.fill('최종 저장 자격');
  await saveButton.click();
  await expect(dialog.getByRole('button', { name: '저장 중…' })).toBeVisible();
  await expect.poll(() => releaseSuccessfulPut !== null).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  releaseSuccessfulPut!();
  await expect(certifications).toHaveValue('최종 저장 자격');
  await expect(page.getByText('김메리님의 전문 프로필을 저장했습니다.')).toBeVisible();
  expect(puts[4].key).not.toBe(puts[3].key);
  expect(profileGets).toBe(2);

  await certifications.fill('닫으면 버릴 내용');
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: `${personA.name} 전문 프로필` }).click();
  const reopened = page.getByRole('dialog', { name: /김메리 — 전문 프로필/ });
  await expect(reopened.getByLabel('자격증 이름')).toHaveValue('최종 저장 자격');
  expect(profileGets).toBe(3);

  await page.setViewportSize({ width: 375, height: 812 });
  const box = await reopened.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  await expect(reopened.getByRole('button', { name: '전문 프로필 저장' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('people-professional-profile-375.png'), fullPage: true });
});

test('new-person POST omits an empty profile and keeps one idempotency key across uncertain retries', async ({ page }, testInfo: TestInfo) => {
  await seedAdmin(page);
  const creates: Array<{ key: string; body: Record<string, unknown> }> = [];
  let releaseOldScopeCreate: (() => void) | null = null;
  let oldScopeCreateFulfilled = false;
  await installBaseApi(page, {
    onApi: async (route, url) => {
      if (url.pathname !== '/api/v1/persons' || route.request().method() !== 'POST') return false;
      const request = { key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() };
      creates.push(request);
      if (creates.length <= 2) {
        await route.abort('failed');
        return true;
      }
      if (creates.length === 5) {
        await new Promise<void>((resolve) => { releaseOldScopeCreate = resolve; });
      }
      await fulfillJson(route, { person: personB, ...(request.body.professionalProfile ? {
        professionalProfile: { revision: 1, changed: true },
      } : {}) }, 201);
      if (creates.length === 5) oldScopeCreateFulfilled = true;
      return true;
    },
  });

  await openPeople(page);
  await page.getByRole('button', { name: '인력 등록' }).click();
  let dialog = page.getByRole('dialog', { name: '인력 등록' });
  await expect(dialog.getByRole('region', { name: '신규 인력 전문 프로필' })).toBeVisible();
  await dialog.getByText('이름', { exact: true }).locator('..').getByRole('textbox').fill('네트워크 재시도');
  const register = dialog.getByRole('button', { name: '등록', exact: true });
  await register.click();
  await expect(register).toBeEnabled();
  await register.click();
  await expect(register).toBeEnabled();
  expect(creates[0].key).toBe(creates[1].key);
  expect(creates[0].body).not.toHaveProperty('professionalProfile');
  expect(creates[1].body).not.toHaveProperty('professionalProfile');

  await dialog.getByText('이름', { exact: true }).locator('..').getByRole('textbox').fill('payload 변경');
  await register.click();
  await expect(dialog).toHaveCount(0);
  expect(creates[2].key).not.toBe(creates[1].key);
  expect(creates[2].body).not.toHaveProperty('professionalProfile');

  await page.locator('[data-sonner-toast] [data-close-button]').evaluateAll((buttons) => {
    buttons.forEach((button) => (button as HTMLButtonElement).click());
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole('button', { name: '인력 등록' }).click();
  dialog = page.getByRole('dialog', { name: '인력 등록' });
  const mobileDialogBox = await dialog.boundingBox();
  expect(mobileDialogBox).not.toBeNull();
  expect(mobileDialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(mobileDialogBox!.y + mobileDialogBox!.height).toBeLessThanOrEqual(812);
  const profileRegion = dialog.getByRole('region', { name: '신규 인력 전문 프로필' });
  await profileRegion.scrollIntoViewIfNeeded();
  await expect(profileRegion).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('new-person-professional-profile-375.png'), fullPage: true });
  await dialog.getByText('이름', { exact: true }).locator('..').getByRole('textbox').fill('프로필 동시 등록');
  await dialog.getByRole('button', { name: '최종학력·학력 이력 추가' }).click();
  await dialog.locator('#education-institution-0').fill('서울대학교');
  await dialog.getByRole('button', { name: '등록', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(creates[3].key).not.toBe(creates[2].key);
  expect(creates[3].body.professionalProfile).toMatchObject({
    educationRecords: [{ institutionName: '서울대학교' }],
  });

  await page.getByRole('button', { name: '인력 등록' }).click();
  dialog = page.getByRole('dialog', { name: '인력 등록' });
  await dialog.getByText('이름', { exact: true }).locator('..').getByRole('textbox').fill('예전 tenant 요청');
  await dialog.getByRole('button', { name: '등록', exact: true }).click();
  await expect.poll(() => releaseOldScopeCreate !== null).toBe(true);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('mysc:tenant-changed', { detail: { tenantId: 'org002' } }));
  });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(personA.name, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '인력 등록' }).click();
  const newScopeDialog = page.getByRole('dialog', { name: '인력 등록' });
  const newScopeName = newScopeDialog.getByText('이름', { exact: true }).locator('..').getByRole('textbox');
  await newScopeName.fill('새 tenant draft');
  releaseOldScopeCreate!();
  await expect.poll(() => oldScopeCreateFulfilled).toBe(true);
  await expect(newScopeDialog).toBeVisible();
  await expect(newScopeName).toHaveValue('새 tenant draft');
  await expect(page.getByText('예전 tenant 요청님을 명부에 등록했습니다.')).toHaveCount(0);
});

test('server capabilities fail closed and a tenant change aborts a stale people response', async ({ page }) => {
  await seedAdmin(page);
  let capabilities = { professionalProfileRead: true, professionalProfileWrite: false };
  let slowOldResponse = false;
  const oldTenantAssignee = '구테넌트담당자';
  const oldTenantProject = '구테넌트사업';
  const oldTenantSearch = '구테넌트 검색어';

  await installBaseApi(page, {
    capabilities,
    onApi: async (route, url) => {
      if (url.pathname === '/api/v1/projects' && route.request().method() === 'GET') {
        const tenantId = route.request().headers()['x-tenant-id'];
        await fulfillJson(route, {
          items: tenantId === TENANT_ID ? [{
            id: 'old-tenant-project',
            name: oldTenantProject,
            shortName: oldTenantProject,
            teamMembersDetailed: [{
              memberName: oldTenantAssignee,
              memberNickname: '구담당',
              role: '운영매니저',
              participationRate: 40,
            }],
          }] : [],
          nextCursor: null,
        });
        return true;
      }
      if (url.pathname === '/api/v1/persons/person-a/professional-profile' && route.request().method() === 'GET') {
        await fulfillJson(route, { profile: storedProfile(), revision: 1 });
        return true;
      }
      if (url.pathname !== '/api/v1/persons' || route.request().method() !== 'GET') return false;
      const tenantId = route.request().headers()['x-tenant-id'];
      if (tenantId === TENANT_ID && slowOldResponse) {
        slowOldResponse = false;
        await new Promise((resolve) => setTimeout(resolve, 450));
        await fulfillJson(route, {
          items: [personA], total: 1,
          capabilities: { professionalProfileRead: true, professionalProfileWrite: true },
        });
        return true;
      }
      if (tenantId === 'org002') {
        await fulfillJson(route, {
          items: [personB], total: 1,
          capabilities: { professionalProfileRead: false, professionalProfileWrite: false },
        });
        return true;
      }
      await fulfillJson(route, { items: [personA], total: 1, capabilities });
      return true;
    },
  });

  await openPeople(page);
  await expect(page.getByText(oldTenantAssignee, { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: `${personA.name} 전문 프로필` })).toBeVisible();
  await page.getByRole('button', { name: `${personA.name} 전문 프로필` }).click();
  const readOnlyDialog = page.getByRole('dialog', { name: /김메리 — 전문 프로필/ });
  await expect(readOnlyDialog.getByText('조회 전용')).toBeVisible();
  await expect(readOnlyDialog.getByRole('button', { name: '전문 프로필 저장' })).toHaveCount(0);
  await readOnlyDialog.getByRole('button', { name: '닫기', exact: true }).click();

  capabilities = { professionalProfileRead: false, professionalProfileWrite: false };
  await page.getByRole('button', { name: '새로고침' }).click();
  await expect(page.getByRole('button', { name: /전문 프로필$/ })).toHaveCount(0);
  await page.getByRole('button', { name: '인력 등록' }).click();
  const createDialog = page.getByRole('dialog', { name: '인력 등록' });
  await expect(createDialog.getByRole('region', { name: '신규 인력 전문 프로필' })).toHaveCount(0);
  await createDialog.getByRole('button', { name: '취소' }).click();

  capabilities = { professionalProfileRead: true, professionalProfileWrite: true };
  await page.getByRole('button', { name: '새로고침' }).click();
  await expect(page.getByRole('button', { name: `${personA.name} 전문 프로필` })).toBeVisible();

  await page.getByPlaceholder('이름·별명·소속 검색…').fill(oldTenantSearch);
  slowOldResponse = true;
  await page.getByRole('button', { name: '새로고침' }).click();
  await expect(page.getByText(personA.name, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /전문 프로필$/ })).toHaveCount(0);
  await page.getByRole('button', { name: '인력 등록' }).click();
  const scopedCreateDialog = page.getByRole('dialog', { name: '인력 등록' });
  await scopedCreateDialog.getByText('이름', { exact: true }).locator('..').getByRole('textbox').fill('이 tenant에 남으면 안 됨');
  await page.evaluate(({ oldAssignee, oldProject, oldSearch }) => {
    (window as any).__directoryScopeLeaks = [];
    const observer = new MutationObserver(() => {
      const text = document.body.textContent || '';
      const searchValue = (document.querySelector('input[placeholder="이름·별명·소속 검색…"]') as HTMLInputElement | null)?.value;
      if (text.includes(oldAssignee) || text.includes(oldProject) || searchValue === oldSearch) {
        (window as any).__directoryScopeLeaks.push({ oldAssignee, oldProject, oldSearch, searchValue });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    (window as any).__directoryScopeObserver = observer;
  }, { oldAssignee: oldTenantAssignee, oldProject: oldTenantProject, oldSearch: oldTenantSearch });
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('mysc:tenant-changed', { detail: { tenantId: 'org002' } }));
  });
  await expect(scopedCreateDialog).toHaveCount(0);
  await expect(page.getByText(personB.name, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__directoryScopeLeaks)).toEqual([]);
  await page.waitForTimeout(550);
  await expect(page.getByText(personA.name, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /전문 프로필$/ })).toHaveCount(0);
});

for (const outcome of ['success', 'error'] as const) {
  test(`A-B-A scope transition ignores the old non-abort PUT ${outcome}`, async ({ page }) => {
    let personAGetCount = 0;
    let releaseOldSave: (() => void) | null = null;

    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/person-professional-profile/catalog') {
        await fulfillJson(route, catalog);
        return;
      }
      const match = url.pathname.match(/^\/api\/v1\/persons\/([^/]+)\/professional-profile$/);
      if (!match) {
        await fulfillJson(route, { code: 'e2e_unhandled', message: url.pathname }, 500);
        return;
      }
      const personId = decodeURIComponent(match[1]);
      if (route.request().method() === 'PUT') {
        await new Promise<void>((resolve) => { releaseOldSave = resolve; });
        if (outcome === 'success') {
          await fulfillJson(route, {
            profile: storedProfile({
              revision: 2,
              certifications: ['OLD A RESPONSE'],
              institutionName: 'Old A response',
            }),
            revision: 2,
            changed: true,
          });
        } else {
          await fulfillJson(route, { code: 'old_a_save_failed', message: 'old A save failed' }, 500);
        }
        return;
      }
      if (personId === 'person-a') {
        personAGetCount += 1;
        const returnedToA = personAGetCount > 1;
        await fulfillJson(route, {
          profile: storedProfile(returnedToA ? {
            revision: 9,
            certifications: ['A latest'],
            institutionName: 'A latest canonical',
          } : {}),
          revision: returnedToA ? 9 : 1,
        });
        return;
      }
      await fulfillJson(route, {
        profile: storedProfile({ certifications: ['B canonical'], institutionName: 'B canonical' }),
        revision: 1,
      });
    });

    await page.goto('/login');
    await page.evaluate(async () => {
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const ReactDom = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      const { ProfessionalProfileEditor } = await import('/src/app/components/people/ProfessionalProfileEditor.tsx');
      const host = document.createElement('div');
      document.body.append(host);
      const root = ReactDom.createRoot(host);
      function Harness() {
        const [person, setPerson] = React.useState({ id: 'person-a', name: '김메리' });
        (window as any).__abaProfileHarness = {
          switchPerson: (id: string, name: string) => setPerson({ id, name }),
        };
        return React.createElement(ProfessionalProfileEditor, {
          tenantId: 'org001',
          actor: { uid: 'actor-a', role: 'admin', idToken: 'token-1' },
          personId: person.id,
          personName: person.name,
          canWrite: true,
          onClose: () => root.unmount(),
        });
      }
      root.render(React.createElement(Harness));
    });

    let dialog = page.getByRole('dialog', { name: /김메리 — 전문 프로필/ });
    const firstDraft = dialog.getByLabel('자격증 이름');
    await expect(firstDraft).toHaveValue('PMP');
    await firstDraft.fill('old A pending save');
    await dialog.getByRole('button', { name: '전문 프로필 저장' }).click();
    await expect.poll(() => releaseOldSave !== null).toBe(true);

    await page.evaluate(() => (window as any).__abaProfileHarness.switchPerson('person-b', '이메리'));
    dialog = page.getByRole('dialog', { name: /이메리 — 전문 프로필/ });
    await expect(dialog.getByLabel('자격증 이름')).toHaveValue('B canonical');
    await page.evaluate(() => (window as any).__abaProfileHarness.switchPerson('person-a', '김메리'));
    dialog = page.getByRole('dialog', { name: /김메리 — 전문 프로필/ });
    await expect(dialog.getByLabel('자격증 이름')).toHaveValue('A latest');

    const response = page.waitForResponse((candidate) => (
      candidate.request().method() === 'PUT'
      && candidate.url().includes('/api/v1/persons/person-a/professional-profile')
    ));
    releaseOldSave!();
    await response;
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    await expect(dialog.getByLabel('자격증 이름')).toHaveValue('A latest');
    await expect(dialog.locator('#education-institution-0')).toHaveValue('A latest canonical');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('김메리님의 전문 프로필을 저장했습니다.')).toHaveCount(0);
  });
}

test('token refresh preserves the live draft, while person change and close abort scoped GETs', async ({ page }) => {
  const authHeaders: string[] = [];
  let profileGets = 0;
  let slowPersonB = false;
  let slowPersonCReload = false;

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/person-professional-profile/catalog') {
      await fulfillJson(route, catalog);
      return;
    }
    const match = url.pathname.match(/^\/api\/v1\/persons\/([^/]+)\/professional-profile$/);
    if (!match) {
      await fulfillJson(route, { code: 'e2e_unhandled', message: url.pathname }, 500);
      return;
    }
    const personId = decodeURIComponent(match[1]);
    if (route.request().method() === 'PUT') {
      authHeaders.push(route.request().headers().authorization || '');
      const body = route.request().postDataJSON() as { expectedRevision: number; profile: ProfileInput };
      const revision = body.expectedRevision + 1;
      await fulfillJson(route, { profile: canonicalFromInput(body.profile, revision), revision, changed: true });
      return;
    }
    profileGets += 1;
    if (personId === 'person-b' && slowPersonB) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await fulfillJson(route, { profile: storedProfile({ institutionName: 'B 서버값' }), revision: 1 });
      return;
    }
    if (personId === 'person-c') {
      if (slowPersonCReload) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        await fulfillJson(route, { profile: storedProfile({ institutionName: 'C reload' }), revision: 1 });
      } else {
        await fulfillJson(route, { code: 'profile_load_failed', message: 'C 프로필을 불러오지 못했습니다.' }, 500);
      }
      return;
    }
    await fulfillJson(route, { profile: storedProfile(), revision: 1 });
  });

  await page.goto('/login');
  await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const ReactDom = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const { ProfessionalProfileEditor } = await import('/src/app/components/people/ProfessionalProfileEditor.tsx');
    const originalFetch = window.fetch.bind(window);
    (window as any).__profileAborts = [];
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/professional-profile') && init?.signal) {
        init.signal.addEventListener('abort', () => (window as any).__profileAborts.push(url), { once: true });
      }
      return originalFetch(input, init);
    }) as typeof window.fetch;

    const host = document.createElement('div');
    host.id = 'people-profile-e2e-harness';
    document.body.append(host);
    const root = ReactDom.createRoot(host);
    function Harness() {
      const [actor, setActor] = React.useState({ uid: 'actor-a', role: 'admin', idToken: 'token-1' });
      const [person, setPerson] = React.useState({ id: 'person-a', name: '김메리' });
      (window as any).__profileHarness = {
        refreshToken: (idToken: string) => setActor((current: Record<string, unknown>) => ({ ...current, idToken })),
        switchPerson: (id: string, name: string) => setPerson({ id, name }),
        close: () => root.unmount(),
      };
      return React.createElement(ProfessionalProfileEditor, {
        tenantId: 'org001', actor, personId: person.id, personName: person.name, canWrite: true,
        onClose: () => root.unmount(),
      });
    }
    root.render(React.createElement(Harness));
  });

  let dialog = page.getByRole('dialog', { name: /김메리 — 전문 프로필/ });
  const certifications = dialog.getByLabel('자격증 이름');
  await expect(certifications).toHaveValue('PMP');
  await certifications.fill('token refresh draft');
  const getsBeforeRefresh = profileGets;
  const abortsBeforeRefresh = await page.evaluate(() => (window as any).__profileAborts.length);
  await page.evaluate(() => (window as any).__profileHarness.refreshToken('token-2'));
  await expect(certifications).toHaveValue('token refresh draft');
  expect(profileGets).toBe(getsBeforeRefresh);
  expect(await page.evaluate(() => (window as any).__profileAborts.length)).toBe(abortsBeforeRefresh);
  await dialog.getByRole('button', { name: '전문 프로필 저장' }).click();
  await expect(certifications).toHaveValue('token refresh draft');
  expect(authHeaders.at(-1)).toBe('Bearer token-2');

  slowPersonB = true;
  await page.evaluate(() => {
    (window as any).__profileScopeLeaks = [];
    const observer = new MutationObserver(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog?.textContent?.includes('이메리 — 전문 프로필')) return;
      const values = Array.from(dialog.querySelectorAll('input, textarea'))
        .map((field) => (field as HTMLInputElement | HTMLTextAreaElement).value);
      if (values.includes('token refresh draft')) {
        (window as any).__profileScopeLeaks.push({ title: '이메리', values });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    (window as any).__profileScopeObserver = observer;
  });
  await page.evaluate(() => (window as any).__profileHarness.switchPerson('person-b', '이메리'));
  dialog = page.getByRole('dialog', { name: /이메리 — 전문 프로필/ });
  await expect(dialog.getByText('전문 프로필을 불러오는 중…')).toBeVisible();
  await expect(dialog.getByText('token refresh draft', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__profileScopeLeaks)).toEqual([]);
  await expect(dialog.getByRole('button', { name: '전문 프로필 저장' })).toBeDisabled();
  await expect.poll(() => profileGets).toBeGreaterThan(getsBeforeRefresh);

  await page.evaluate(() => (window as any).__profileHarness.switchPerson('person-c', '최메리'));
  dialog = page.getByRole('dialog', { name: /최메리 — 전문 프로필/ });
  await expect(dialog.getByRole('alert')).toContainText('C 프로필을 불러오지 못했습니다.');
  await page.waitForTimeout(500);
  await expect(dialog.getByText('B 서버값', { exact: true })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__profileAborts.some((url: string) => url.includes('/person-b/'))
  ))).toBe(true);

  slowPersonCReload = true;
  await dialog.getByRole('button', { name: '다시 불러오기' }).click();
  await expect(dialog.getByText('전문 프로필을 불러오는 중…')).toBeVisible();
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /최메리 — 전문 프로필/ })).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => (
    (window as any).__profileAborts.some((url: string) => url.includes('/person-c/'))
  ))).toBe(true);
});
