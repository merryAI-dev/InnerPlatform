import { describe, expect, it } from 'vitest';

/**
 * 검증 화면의 라우트. 순수 함수만 테스트하면 마운트가 깨져도 초록불이 뜬다.
 * 여기서는 실제로 응답이 나오는지, 시트를 못 읽을 때 사람이 읽을 코드로 정규화되는지,
 * 그리고 이 화면이 정말 아무것도 쓰지 않는지를 붙잡는다.
 */

const { default: express } = await import('express');
const { default: request } = await import('supertest');
const { mountParticipationDashboardRoutes } = await import('./participation-dashboard.mjs');
const { PARTICIPATION_FORMAT_ID } = await import('../participation-sheet-ingest.mjs');

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
    '참조!F1': [[PARTICIPATION_FORMAT_ID]],
    '참여율!B1:D1': [['2026-01', '~', '2026-03']],
    '참여율!G2:DV2': [['2026-01', '2026-02', '2026-03']],
    '참여율!A3:F62': [['에이블', '김정태', '총괄책임자', '2026-01', '', '30']],
    '참여율!G3:DV62': [['30', '30', '30']],
    ...overrides,
  };
}

function createApp({ role = 'admin', documents = {}, ranges = sheetRanges(), sheetsError = null } = {}) {
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
  const googleSheetsService = {
    getSheetValues: async ({ rangeA1 }) => {
      requestedRanges.push(rangeA1);
      if (sheetsError) throw new Error(sheetsError);
      return ranges[rangeA1] || [];
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
    expect(requestedRanges.sort()).toEqual([
      '참여율!A3:F62', '참여율!B1:D1', '참여율!G2:DV2', '참여율!G3:DV62', '참조!F1',
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

  it('시트를 못 읽으면 원인이 무엇이든 한 코드로 정규화한다', async () => {
    const { app } = createApp({ documents: withProject(), sheetsError: 'quota exceeded' });
    const response = await request(app).get(url);
    expect(response.status).toBe(502);
    expect(response.body.code).toBe('participation_sheet_unreachable');
    expect(response.body.message).toContain('공유 권한');
  });

  it('사업이 없으면 404 다', async () => {
    const { app } = createApp({ documents: PEOPLE });
    expect((await request(app).get(url)).status).toBe(404);
  });

  it('양식이 다르면 행을 읽기 전에 막는다', async () => {
    const { app } = createApp({
      documents: withProject(),
      ranges: sheetRanges({ '참조!F1': [['OTHER-V9']] }),
    });
    const response = await request(app).get(url);
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(false);
    expect(response.body.blocking[0].code).toBe('participation_format_mismatch');
    expect(response.body.rows).toEqual([]);
  });

  it('시트 기간이 계약 기간과 다르면 막고 양쪽을 알려준다', async () => {
    const { app } = createApp({
      documents: withProject(),
      ranges: sheetRanges({
        '참여율!B1:D1': [['2026-01', '~', '2026-06']],
        '참여율!G2:DV2': [['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']],
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
      ranges: sheetRanges({ '참여율!G3:DV62': [['30', '', '']] }),
    });
    const response = await request(app).get(url);
    expect(response.body.ok).toBe(true);
    expect(response.body.missing.map((entry) => entry.month)).toEqual(['2026-02', '2026-03']);
  });

  it('People 에 없는 사람은 연결 대기로 두고 등록 후보로 올린다', async () => {
    const { app } = createApp({
      documents: withProject(),
      ranges: sheetRanges({ '참여율!A3:F62': [['테일러', '김혜령', '연구', '2026-01', '', '30']] }),
    });
    const response = await request(app).get(url);
    expect(response.body.ok).toBe(true);
    expect(response.body.rows[0].linkState).toBe('PENDING_LINK');
    expect(response.body.candidates[0]).toMatchObject({ name: '김혜령', nickname: '테일러' });
  });

  it('이름 없는 미정 자리는 후보가 아니다 - 등록할 사람이 아직 없다', async () => {
    const { app } = createApp({
      documents: withProject(),
      ranges: sheetRanges({ '참여율!A3:F62': [['미정-1', '', '운영', '2026-01', '', '30']] }),
    });
    const response = await request(app).get(url);
    expect(response.body.rows[0].linkState).toBe('PLACEHOLDER');
    expect(response.body.candidates).toEqual([]);
  });
});
