import { describe, expect, it } from 'vitest';
import { createOutboxEvent, processOutboxEventById } from './outbox.mjs';

/**
 * 인라인 처리는 크론 배치와 같은 claim·마킹 계약을 쓴다. 여기서는 그 계약을 고정한다:
 * PENDING 을 집어 성공하면 DONE, 핸들러가 던지면 FAILED(재시도 예약), 이미 DONE 이면
 * 건드리지 않는다.
 */
function fakeDb(initialDocs = {}) {
  const store = new Map(Object.entries(initialDocs));
  const snapOf = (path) => ({
    exists: store.has(path),
    data: () => store.get(path),
    id: path.split('/').pop(),
  });
  const makeRef = (path) => ({
    path,
    get: async () => snapOf(path),
    create: async (value) => {
      if (store.has(path)) throw Object.assign(new Error('already exists'), { code: 6 });
      store.set(path, value);
    },
    set: async (value, options) => {
      const base = options?.merge ? (store.get(path) || {}) : {};
      store.set(path, { ...base, ...value });
    },
  });
  return {
    store,
    doc: (path) => makeRef(path),
    async runTransaction(fn) {
      const tx = {
        get: async (ref) => snapOf(ref.path),
        set: (ref, value, options) => {
          const base = options?.merge ? (store.get(ref.path) || {}) : {};
          store.set(ref.path, { ...base, ...value });
        },
        update: (ref, value) => {
          store.set(ref.path, { ...(store.get(ref.path) || {}), ...value });
        },
        create: (ref, value) => { store.set(ref.path, value); },
      };
      return fn(tx);
    },
  };
}

const NOW = '2026-08-25T10:00:00.000Z';

function seedEvent(overrides = {}) {
  const event = createOutboxEvent({
    tenantId: 'tenant-a', requestId: 'req-1',
    eventType: 'participation.roster.changed',
    entityType: 'participation_roster', entityId: 'tenant-a',
    payload: { trigger: 'manual' }, createdAt: NOW,
  });
  return { ...event, ...overrides };
}

describe('processOutboxEventById', () => {
  it('PENDING 이벤트를 집어 핸들러를 실행하고 DONE 으로 마킹한다', async () => {
    const event = seedEvent();
    const db = fakeDb({ [`outbox/${event.id}`]: event });
    const handled = [];
    const result = await processOutboxEventById(db, event.id, {
      now: () => NOW,
      eventHandlers: { 'participation.roster.changed': async (claimed) => { handled.push(claimed.id); } },
    });
    expect(result).toEqual({ processed: true, succeeded: true });
    expect(handled).toEqual([event.id]);
    expect(db.store.get(`outbox/${event.id}`).status).toBe('DONE');
  });

  it('핸들러가 던지면 FAILED 로 남겨 크론이 이어받게 한다', async () => {
    const event = seedEvent();
    const db = fakeDb({ [`outbox/${event.id}`]: event });
    const result = await processOutboxEventById(db, event.id, {
      now: () => NOW,
      eventHandlers: { 'participation.roster.changed': async () => { throw new Error('시트 API 오류'); } },
    });
    expect(result).toMatchObject({ processed: true, succeeded: false, error: '시트 API 오류' });
    const stored = db.store.get(`outbox/${event.id}`);
    expect(stored.status).toBe('FAILED');
    expect(stored.nextAttemptAt > NOW).toBe(true);
  });

  it('이미 DONE 인 이벤트는 집지 않는다 - 중복 실행 방지', async () => {
    const event = seedEvent({ status: 'DONE' });
    const db = fakeDb({ [`outbox/${event.id}`]: event });
    const result = await processOutboxEventById(db, event.id, {
      now: () => NOW,
      eventHandlers: { 'participation.roster.changed': async () => { throw new Error('불려선 안 됨'); } },
    });
    expect(result).toEqual({ processed: false, reason: 'not_claimable' });
  });

  it('없는 이벤트 id 는 조용히 처리 불가로 돌려준다', async () => {
    const db = fakeDb();
    const result = await processOutboxEventById(db, 'ob_none', { now: () => NOW, eventHandlers: {} });
    expect(result).toEqual({ processed: false, reason: 'not_claimable' });
  });
});
