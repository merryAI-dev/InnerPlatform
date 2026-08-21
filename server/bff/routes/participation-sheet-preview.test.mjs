import { describe, expect, it } from 'vitest';

/**
 * 검증 화면의 라우트. 순수 함수만 테스트하면 마운트가 깨져도 초록불이 뜬다.
 * 여기서는 실제로 응답이 나오는지, 시트를 못 읽을 때 사람이 읽을 코드로 정규화되는지,
 * 그리고 이 화면이 정말 아무것도 쓰지 않는지를 붙잡는다.
 */

const { default: express } = await import('express');
const { default: request } = await import('supertest');
const { mountParticipationDashboardRoutes } = await import('./participation-dashboard.mjs');
const { PARTICIPATION_FORMAT_V1_ID: PARTICIPATION_FORMAT_ID } = await import('../participation-sheet-ingest.mjs');
const PARTICIPATION_FORMAT_V2 = 'MYSC-PARTICIPATION-V2';

const PROJECT = {
  name: 'JLIN IBS',
  contractStart: '2026-01-01',
  contractEnd: '2026-03-31',
  participationSheetLink: 'https://docs.google.com/spreadsheets/d/sheet-abc/edit',
};

const PEOPLE = {
  'orgs/tenant-a/persons/p-kim': { personId: 'p-kim', name: '김정태', nickname: '에이블' },
};

/** 표준양식 다섯 범위의 기본값. 필요한 것만 바꿔 쓴다. */
function sheetRanges(overrides = {}) {
  return {
    "'참조'!F1": [[PARTICIPATION_FORMAT_ID]],
    "'참여율 관리'!B1:D1": [['2026-01', '~', '2026-03']],
    "'참여율 관리'!G2:DV2": [['2026-01', '2026-02', '2026-03']],
    "'참여율 관리'!A3:F62": [['에이블', '김정태', '총괄책임자', '2026-01', '', '30']],
    "'참여율 관리'!G3:DV62": [['30', '30', '30']],
    ...overrides,
  };
}

function longContractMonths() {
  return Array.from({ length: 123 }, (_, index) => {
    const absoluteMonth = 3 + index;
    const year = 2025 + Math.floor(absoluteMonth / 12);
    const month = (absoluteMonth % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  });
}

function v2SheetRanges() {
  const months = longContractMonths();
  return {
    "'참조'!F1": [[PARTICIPATION_FORMAT_V2]],
    "'참여율 관리'!B1:D1": [['2025-04', '~', '2035-06']],
    "'참여율 관리'!G2:IX2": [months],
    "'참여율 관리'!A3:F62": [['에이블', '김정태', '총괄책임자', '2025-04', '2035-06', '30']],
    "'참여율 관리'!G3:IX62": [months.map(() => '30')],
  };
}

function createApp({
  role = 'admin',
  documents = {},
  ranges = sheetRanges(),
  sheetsError = null,
  requireFormatBeforeBody = false,
} = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = { tenantId: 'tenant-a', actorId: 'actor-a', actorRole: role, requestId: 'req-1' };
    next();
  });

  const store = { ...documents };
  const writes = [];
  const db = {
    collection: (path) => ({
      get: async () => ({
        docs: Object.entries(store)
          .filter(([key]) => key.startsWith(`${path}/`))
          .map(([key, data]) => ({ id: key.slice(path.length + 1), exists: true, data: () => data })),
      }),
    }),
    doc: (path) => ({
      get: async () => ({ id: path.split('/').pop(), exists: Object.hasOwn(store, path), data: () => store[path] }),
      set: (value) => { writes.push({ path, value }); },
      update: (value) => { writes.push({ path, value }); },
    }),
  };

  const requestedRanges = [];
  let formatResolved = false;
  const googleSheetsService = {
    getServiceAccountEmail: () => 'mysc-sheets@mysc.iam.gserviceaccount.com',
    getSheetValues: async ({ sheetName, rangeA1 }) => {
      const quotedRange = `'${sheetName}'!${rangeA1}`;
      requestedRanges.push({ sheetName, rangeA1 });
      if (sheetsError) throw new Error(sheetsError);
      if (quotedRange === "'참조'!F1") {
        // Promise.all 목록에 F1을 첫 번째로 두는 것만으로는 부족하다.
        // 마커 값을 실제로 받은 뒤에야 V1/V2 본문 좌표를 고를 수 있다.
        if (requireFormatBeforeBody) await Promise.resolve();
        formatResolved = true;
        return ranges[quotedRange] || [];
      }
      if (requireFormatBeforeBody && !formatResolved) {
        throw new Error('body range requested before participation format marker resolved');
      }
      return ranges[quotedRange] || [];
    },
  };

  mountParticipationDashboardRoutes(app, {
    db,
    now: () => '2026-08-21T00:00:00.000Z',
    googleSheetsService,
    idempotencyService: { begin: async () => ({ mode: 'new' }), complete: async () => {}, fail: async () => {} },
  });
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code, message: error.message }));
  return { app, writes, requestedRanges };
}

const url = '/api/v1/participation-dashboard/projects/p1/sheet-preview';
const withProject = (extra = {}) => ({ 'orgs/tenant-a/projects/p1': { ...PROJECT, ...extra }, ...PEOPLE });

describe('참여율 시트 검증 - 읽기 전용', () => {
  it('정상 시트를 요약·행·월과 함께 돌려준다', async () => {
    const { app } = createApp({ documents: withProject() });
    const response = await request(app).get(url);
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.months).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(response.body.summary).toMatchObject({ rowCount: 1, linkedCount: 1, missingCount: 0 });
    expect(response.body.rows[0]).toMatchObject({ nickname: '에이블', name: '김정태', linkState: 'LINKED' });
  });

  it('아무것도 쓰지 않는다 - 확인하는 것만으로 값이 바뀌면 안 된다', async () => {
    const { app, writes } = createApp({ documents: withProject() });
    await request(app).get(url);
    expect(writes).toEqual([]);
  });

  it('반영 재료(참여행)는 돌려주지 않는다 - 이 화면은 확인용이다', async () => {
    const { app } = createApp({ documents: withProject() });
    const response = await request(app).get(url);
    expect(response.body.entries).toBeUndefined();
  });

  it('계약이 고정한 다섯 범위만 읽는다', async () => {
    const { app, requestedRanges } = createApp({ documents: withProject() });
    await request(app).get(url);
    expect(requestedRanges.sort((left, right) => `${left.sheetName}!${left.rangeA1}`.localeCompare(`${right.sheetName}!${right.rangeA1}`))).toEqual([
      { sheetName: '참여율 관리', rangeA1: 'A3:F62' },
      { sheetName: '참여율 관리', rangeA1: 'B1:D1' },
      { sheetName: '참여율 관리', rangeA1: 'G2:DV2' },
      { sheetName: '참여율 관리', rangeA1: 'G3:DV62' },
      { sheetName: '참조', rangeA1: 'F1' },
    ]);
  });

  it('F1 마커를 먼저 해석한 뒤 V2 본문을 252개월 G:IX 좌표에서 읽는다', async () => {
    const { app, requestedRanges } = createApp({
      documents: withProject({ contractStart: '2025-04-01', contractEnd: '2035-06-30' }),
      ranges: v2SheetRanges(),
      requireFormatBeforeBody: true,
    });

    const response = await request(app).get(url);

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.months).toHaveLength(123);
    expect(response.body.months[0]).toBe('2025-04');
    expect(response.body.months[122]).toBe('2035-06');
    expect(requestedRanges[0]).toEqual({ sheetName: '참조', rangeA1: 'F1' });
    expect(requestedRanges.slice(1).sort((left, right) => left.rangeA1.localeCompare(right.rangeA1))).toEqual([
      { sheetName: '참여율 관리', rangeA1: 'A3:F62' },
      { sheetName: '참여율 관리', rangeA1: 'B1:D1' },
      { sheetName: '참여율 관리', rangeA1: 'G2:IX2' },
      { sheetName: '참여율 관리', rangeA1: 'G3:IX62' },
    ]);
  });
});

describe('막히는 경우 - 조용히 끝나지 않는다', () => {
  it('시트 링크가 없으면 어디서 저장하는지 알려준다', async () => {
    const { app } = createApp({ documents: withProject({ participationSheetLink: '' }) });
    const response = await request(app).get(url);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('participation_sheet_link_missing');
    expect(response.body.message).toContain('등록·수정');
  });

  // 가장 흔한 원인은 공유 누락이다. 주소를 모르면 사람은 무엇을 고쳐야 할지 알 수 없고
  // "잠시 후 다시 시도" 만 되풀이하게 된다.
  it('시트를 못 읽으면 한 코드로 정규화하고 누구에게 공유할지 알려준다', async () => {
    const { app } = createApp({ documents: withProject(), sheetsError: 'quota exceeded' });
    const response = await request(app).get(url);
    expect(response.status).toBe(502);
    expect(response.body.code).toBe('participation_sheet_unreachable');
    expect(response.body.message).toContain('mysc-sheets@mysc.iam.gserviceaccount.com');
    expect(response.body.message).toContain('quota exceeded');
  });

  it('공유해야 할 계정을 따로 물어볼 수 있다 - 링크를 넣는 자리에서 보여 준다', async () => {
    const { app } = createApp({ documents: withProject() });
    const response = await request(app).get('/api/v1/participation-dashboard/system-account');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      systemAccountEmail: 'mysc-sheets@mysc.iam.gserviceaccount.com',
      configured: true,
    });
  });

  it('사업이 없으면 404 다', async () => {
    const { app } = createApp({ documents: PEOPLE });
    expect((await request(app).get(url)).status).toBe(404);
  });

  it('양식이 다르면 행을 읽기 전에 막는다', async () => {
    const { app, requestedRanges } = createApp({
      documents: withProject(),
      ranges: sheetRanges({ "'참조'!F1": [['OTHER-V9']] }),
    });
    const response = await request(app).get(url);
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.blocking[0].code).toBe('participation_format_mismatch');
    expect(response.body.rows).toEqual([]);
    expect(requestedRanges).toEqual([{ sheetName: '참조', rangeA1: 'F1' }]);
  });

  it('시트 기간이 계약 기간과 다르면 막고 양쪽을 알려준다', async () => {
    const { app } = createApp({
      documents: withProject(),
      ranges: sheetRanges({
        "'참여율 관리'!B1:D1": [['2026-01', '~', '2026-06']],
        "'참여율 관리'!G2:DV2": [['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']],
      }),
    });
    const response = await request(app).get(url);
    expect(response.body.ok).toBe(false);
    expect(response.body.blocking[0].code).toBe('participation_period_mismatch');
    expect(response.body.blocking[0].message).toContain('2026-03');
  });
});

describe('사람이 확인할 것', () => {
  it('미입력을 막지 않고 목록으로 돌려준다', async () => {
    const { app } = createApp({
      documents: withProject(),
      ranges: sheetRanges({ "'참여율 관리'!G3:DV62": [['30', '', '']] }),
    });
    const response = await request(app).get(url);
    expect(response.body.ok).toBe(true);
    expect(response.body.missing.map((entry) => entry.month)).toEqual(['2026-02', '2026-03']);
  });

  it('People 에 없는 사람은 연결 대기로 두고 등록 후보로 올린다', async () => {
    const { app } = createApp({
      documents: withProject(),
      ranges: sheetRanges({ "'참여율 관리'!A3:F62": [['테일러', '김혜령', '연구', '2026-01', '', '30']] }),
    });
    const response = await request(app).get(url);
    expect(response.body.ok).toBe(true);
    expect(response.body.rows[0].linkState).toBe('PENDING_LINK');
    expect(response.body.candidates[0]).toMatchObject({ name: '김혜령', nickname: '테일러' });
  });

  it('이름 없는 미정 자리는 후보가 아니다 - 등록할 사람이 아직 없다', async () => {
    const { app } = createApp({
      documents: withProject(),
      ranges: sheetRanges({ "'참여율 관리'!A3:F62": [['미정-1', '', '운영', '2026-01', '', '30']] }),
    });
    const response = await request(app).get(url);
    expect(response.body.rows[0].linkState).toBe('PLACEHOLDER');
    expect(response.body.candidates).toEqual([]);
  });
});


// 등록 중에는 사업 문서가 아직 없고, 수정 중에는 화면의 링크가 저장본과 다를 수 있다.
// 그래서 저장 전에도 확인할 수 있어야 한다 - 저장해야만 확인되면 사람이 저장부터 하게 된다.
describe('저장 전 연동 - 링크와 기간을 요청에 담는다', () => {
  // 조회이므로 GET 이다. POST 면 BFF 가 mutating 으로 보고 idempotency-key 를 요구해
  // 요청이 컨텍스트 미들웨어에서 끊긴다(라이브에서 본문 없는 502 로 나타났다).
  const base = '/api/v1/participation-dashboard/sheet-preview';
  const query = (extra = {}) => {
    const params = new URLSearchParams({
      sheetLink: 'https://docs.google.com/spreadsheets/d/sheet-abc/edit',
      contractStart: '2026-01-01',
      contractEnd: '2026-03-31',
      ...extra,
    });
    return `${base}?${params}`;
  };

  it('사업이 저장돼 있지 않아도 확인된다', async () => {
    const { app } = createApp({ documents: PEOPLE });
    const response = await request(app).get(query());
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.rows[0]).toMatchObject({ name: '김정태', linkState: 'LINKED' });
  });

  it('명단을 채울 수 있게 personId 와 기본투입률을 함께 준다', async () => {
    const { app } = createApp({ documents: PEOPLE });
    const response = await request(app).get(query());
    expect(response.body.rows[0]).toMatchObject({ personId: 'p-kim', baseRate: 30 });
  });

  it('화면의 계약 기간과 다르면 막는다 - 저장본이 아니라 지금 값과 맞춰야 한다', async () => {
    const { app } = createApp({ documents: PEOPLE });
    const response = await request(app).get(query({ contractEnd: '2026-06-30' }));
    expect(response.body.ok).toBe(false);
    expect(response.body.blocking[0].code).toBe('participation_period_mismatch');
  });

  it('링크가 없으면 무엇을 넣어야 하는지 알려준다', async () => {
    const { app } = createApp({ documents: PEOPLE });
    const response = await request(app).get(query({ sheetLink: '' }));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('participation_sheet_link_missing');
  });

  it('확인만으로 아무것도 쓰지 않는다', async () => {
    const { app, writes } = createApp({ documents: PEOPLE });
    await request(app).get(query());
    expect(writes).toEqual([]);
  });
});
