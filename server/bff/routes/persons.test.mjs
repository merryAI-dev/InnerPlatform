import { describe, expect, it } from 'vitest';
import { applyEmploymentChange } from './persons.mjs';
import {
  addEmployment,
  changeEmployment,
} from '../../../src/app/platform/person-employment.ts';

/**
 * BFF 는 .mjs 라 도메인 모듈(.ts)을 런타임에 못 읽어서 전환 규칙이 양쪽에 한 번씩 있다.
 * 이 파일이 그 둘을 같은 입력으로 돌려 결과가 같은지 붙잡는다. 한쪽만 고치면 여기서 깨진다.
 */

const 노성진 = [{
  id: 'emp-ft', type: 'FULL_TIME', state: 'WORKING',
  startDate: '2022-03-02', endDate: null, note: '',
}];

function asPerson(employments) {
  return {
    personId: 'psn-nosj', name: '노성진', nickname: '', email: '',
    departmentTop: '', departmentMid: '', departmentSub: '',
    title: '', grade: '', workLocation: '', joinedAt: '2022-03-02',
    uid: null, employments,
  };
}

describe('applyEmploymentChange — 계약 변경', () => {
  it('기존 계약을 적용일 직전에 닫고 새 계약을 잇는다', () => {
    const next = applyEmploymentChange(노성진, {
      mode: 'change', id: 'emp-partner', type: 'PARTNER', state: 'WORKING',
      effectiveFrom: '2026-01-01', note: '퇴사 후 파트너 전환',
    });
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: 'emp-ft', endDate: '2025-12-31' });
    expect(next[1]).toMatchObject({ id: 'emp-partner', type: 'PARTNER', startDate: '2026-01-01', endDate: null });
  });

  it('적용일보다 늦게 시작하는 계약이 있으면 400 과 안내를 준다', () => {
    const future = [{ id: 'f', type: 'FULL_TIME', state: 'WORKING', startDate: '2027-01-01', endDate: null, note: '' }];
    expect(() => applyEmploymentChange(future, {
      mode: 'change', id: 'x', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-01-01',
    })).toThrow(/이미 있습니다/);
  });

  it('종료일이 적용일보다 빠르면 거절한다', () => {
    expect(() => applyEmploymentChange(노성진, {
      mode: 'change', id: 'x', type: 'PARTNER', state: 'WORKING',
      effectiveFrom: '2026-06-01', endDate: '2026-01-01',
    })).toThrow(/종료일이 적용일보다 빠릅니다/);
  });

  it('던지는 오류에 사람이 읽을 안내와 코드가 함께 붙는다', () => {
    try {
      applyEmploymentChange(노성진, {
        mode: 'change', id: 'x', type: 'PARTNER', state: 'WORKING',
        effectiveFrom: '2026-06-01', endDate: '2026-01-01',
      });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('person_employment_change_invalid');
      expect(error.message).not.toMatch(/[a-z_]+_[a-z_]+/);
    }
  });
});

describe('applyEmploymentChange — 계약 추가', () => {
  const 종료된계약 = [{
    id: 'a', type: 'FULL_TIME', state: 'WORKING',
    startDate: '2020-01-01', endDate: '2024-12-31', note: '',
  }];

  it('겹치지 않으면 시작일 순으로 끼워 넣는다', () => {
    const next = applyEmploymentChange(종료된계약, {
      mode: 'add', id: 'b', type: 'PARTNER', state: 'WORKING',
      effectiveFrom: '2026-01-01', endDate: '2026-12-31',
    });
    expect(next.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('겹치면 변경을 쓰라고 안내한다', () => {
    expect(() => applyEmploymentChange(종료된계약, {
      mode: 'add', id: 'b', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2024-06-01',
    })).toThrow(/겹칩니다/);
  });
});

describe('BFF ↔ 도메인 모듈 동등성', () => {
  const cases = [
    { mode: 'change', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-01-01', note: '파트너 전환' },
    { mode: 'change', type: 'FULL_TIME', state: 'PARENTAL_LEAVE', effectiveFrom: '2026-05-01' },
    { mode: 'change', type: 'FULL_TIME', state: 'WORKING', effectiveFrom: '2026-08-12', endDate: '2026-12-31' },
  ];

  it.each(cases)('change $type/$state $effectiveFrom 결과가 같다', (input) => {
    const fromBff = applyEmploymentChange(노성진, { ...input, id: 'fixed-id' });
    const fromDomain = changeEmployment(asPerson(노성진), { ...input, id: 'fixed-id' });
    expect(fromBff).toEqual(fromDomain);
  });

  it('add 결과도 같다', () => {
    const closed = [{ id: 'a', type: 'FULL_TIME', state: 'WORKING', startDate: '2020-01-01', endDate: '2024-12-31', note: '' }];
    const input = { type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-01-01', endDate: '2026-12-31', id: 'fixed-id' };
    expect(applyEmploymentChange(closed, { ...input, mode: 'add' }))
      .toEqual(addEmployment(asPerson(closed), input));
  });

  it('두 구현이 같은 입력에서 같은 이유로 거절한다', () => {
    const input = { type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-06-01', endDate: '2026-01-01', id: 'x' };
    const bffError = (() => { try { applyEmploymentChange(노성진, { ...input, mode: 'change' }); return null; } catch (error) { return error.message; } })();
    const domainError = (() => { try { changeEmployment(asPerson(노성진), input); return null; } catch (error) { return error.message; } })();
    expect(bffError).toBe(domainError);
    expect(bffError).toBeTruthy();
  });
});

// ── 라우트 레벨 ──
// 순수 함수만 테스트하면 마운트가 깨져도 초록불이 뜬다. 실제로 응답이 나오는지,
// 권한이 걸리는지, 계약 이력이 지워지지 않는지를 여기서 붙잡는다.

const { default: express } = await import('express');
const { default: request } = await import('supertest');
const { mountPersonRoutes } = await import('./persons.mjs');

function createApp({ role = 'admin', documents = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'tenant-a', actorId: 'actor-a', actorRole: role,
      actorEmail: 'a@example.com', requestId: 'req-1', idempotencyKey: `key-${Math.random()}`,
    };
    next();
  });

  const store = { ...documents };
  const audit = [];
  const collectionDocs = (prefix) => Object.entries(store)
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, data]) => ({ id: path.slice(prefix.length), exists: true, data: () => data }));

  const db = {
    collection: (path) => ({ get: async () => ({ docs: collectionDocs(`${path}/`) }) }),
    doc: (path) => ({
      get: async () => ({ exists: Object.hasOwn(store, path), data: () => store[path] }),
    }),
    runTransaction: async (fn) => fn({
      get: async (ref) => ref.get(),
      set: (ref, value, options) => {
        const path = ref.__path;
        store[path] = options?.merge ? { ...store[path], ...value } : value;
      },
    }),
  };
  const wrapDoc = db.doc;
  db.doc = (path) => Object.assign(wrapDoc(path), { __path: path });

  mountPersonRoutes(app, {
    db,
    now: () => '2026-08-12T00:00:00.000Z',
    idempotencyService: { begin: async () => ({ mode: 'new' }), complete: async () => {}, fail: async () => {} },
    auditChainService: { append: async (entry) => { audit.push(entry); } },
    piiProtector: { encryptText: async (text) => ({ ciphertext: `enc:${text}` }) },
  });
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code, message: error.message }));
  return { app, store, audit };
}

const 노성진Doc = {
  personId: 'psn-nosj', name: '노성진', nickname: '', email: '',
  joinedAt: '2022-03-02',
  employments: [{ id: 'emp-ft', type: 'FULL_TIME', state: 'WORKING', startDate: '2022-03-02', endDate: null, note: '' }],
};

describe('라우트 — 인력 명부', () => {
  it('목록을 이름순으로 돌려준다', async () => {
    const { app } = createApp({ documents: {
      'orgs/tenant-a/persons/psn-b': { name: '홍길동', employments: [] },
      'orgs/tenant-a/persons/psn-a': { name: '강감찬', employments: [] },
    } });
    const response = await request(app).get('/api/v1/persons');
    expect(response.status).toBe(200);
    expect(response.body.items.map((item) => item.name)).toEqual(['강감찬', '홍길동']);
  });

  it('viewer 는 계약을 바꿀 수 없다', async () => {
    const { app } = createApp({ role: 'viewer', documents: { 'orgs/tenant-a/persons/psn-nosj': 노성진Doc } });
    const response = await request(app)
      .post('/api/v1/persons/psn-nosj/employments')
      .send({ mode: 'change', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-01-01' });
    expect(response.status).toBe(403);
  });

  it('재경팀(finance)은 계약을 바꿀 수 있다 — 실제로 기입하는 사람이다', async () => {
    const { app } = createApp({ role: 'finance', documents: { 'orgs/tenant-a/persons/psn-nosj': 노성진Doc } });
    const response = await request(app)
      .post('/api/v1/persons/psn-nosj/employments')
      .send({ mode: 'change', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-01-01' });
    expect(response.status).toBe(200);
  });

  it('정규직 → 파트너 전환이 이력을 지우지 않고 이어 붙는다', async () => {
    const { app, store } = createApp({ documents: { 'orgs/tenant-a/persons/psn-nosj': 노성진Doc } });
    const response = await request(app)
      .post('/api/v1/persons/psn-nosj/employments')
      .send({ mode: 'change', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-01-01', note: '퇴사 후 파트너' });

    expect(response.status).toBe(200);
    expect(response.body.employments).toHaveLength(2);
    expect(response.body.employments[0]).toMatchObject({ id: 'emp-ft', type: 'FULL_TIME', endDate: '2025-12-31' });
    expect(response.body.employments[1]).toMatchObject({ type: 'PARTNER', startDate: '2026-01-01', endDate: null });
    expect(store['orgs/tenant-a/persons/psn-nosj'].employments).toHaveLength(2);
  });

  it('명부에 없는 사람은 404 와 한국어 안내를 준다', async () => {
    const { app } = createApp();
    const response = await request(app)
      .post('/api/v1/persons/psn-nope/employments')
      .send({ mode: 'change', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-01-01' });
    expect(response.status).toBe(404);
    expect(response.body.message).toContain('명부에 없는 인력입니다');
  });

  it('잘못된 날짜는 400 과 고칠 방법을 준다', async () => {
    const { app } = createApp({ documents: { 'orgs/tenant-a/persons/psn-nosj': 노성진Doc } });
    const response = await request(app)
      .post('/api/v1/persons/psn-nosj/employments')
      .send({ mode: 'change', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026/01/01' });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('YYYY-MM-DD');
  });

  it('파트너를 새 인력으로 등록하면 첫 계약이 함께 생긴다', async () => {
    const { app, store } = createApp();
    const response = await request(app).post('/api/v1/persons').send({
      name: '강에나', nickname: '하에나',
      employment: { type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-07-01' },
    });
    expect(response.status).toBe(201);
    expect(response.body.person.employments[0]).toMatchObject({ type: 'PARTNER', startDate: '2026-07-01' });
    expect(response.body.person.source.origin).toBe('manual');
    expect(store['orgs/tenant-a/persons/psn-x-강에나하에나']).toBeTruthy();
  });

  it('같은 사람을 두 번 등록하면 409 로 막는다 — 명부가 갈라지면 안 된다', async () => {
    const { app } = createApp({ documents: { 'orgs/tenant-a/persons/psn-x-강에나하에나': { name: '강에나' } } });
    const response = await request(app).post('/api/v1/persons').send({
      name: '강에나', nickname: '하에나',
      employment: { type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-07-01' },
    });
    expect(response.status).toBe(409);
  });

  it('알 수 없는 근로형태는 스키마에서 걸린다', async () => {
    const { app } = createApp({ documents: { 'orgs/tenant-a/persons/psn-nosj': 노성진Doc } });
    const response = await request(app)
      .post('/api/v1/persons/psn-nosj/employments')
      .send({ mode: 'change', type: 'CONTRACTOR', state: 'WORKING', effectiveFrom: '2026-01-01' });
    expect(response.status).toBe(400);
  });
});
