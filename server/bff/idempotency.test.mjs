import { describe, expect, it } from 'vitest';
import { createIdempotencyService } from './idempotency.mjs';
import { buildRequestFingerprint } from './utils.mjs';

function createDb() {
  const documents = new Map();
  const snapshot = (path) => ({
    exists: documents.has(path),
    data: () => structuredClone(documents.get(path)),
  });
  const doc = (path) => ({
    path,
    get: async () => snapshot(path),
    set: async (value, options = {}) => {
      const current = documents.get(path);
      documents.set(path, options.merge && current ? { ...current, ...structuredClone(value) } : structuredClone(value));
    },
  });
  return {
    documents,
    doc,
    async runTransaction(callback) {
      const writes = [];
      const tx = {
        get: async (ref) => snapshot(ref.path),
        set: (ref, value, options = {}) => writes.push({ ref, value: structuredClone(value), options }),
        update: (ref, value) => writes.push({ ref, value: structuredClone(value), options: { merge: true } }),
      };
      const result = await callback(tx);
      for (const { ref, value, options } of writes) {
        const current = documents.get(ref.path);
        documents.set(ref.path, options.merge && current ? { ...current, ...value } : value);
      }
      return result;
    },
  };
}

const request = {
  tenantId: 'tenant-a',
  idempotencyKey: 'shared-key',
  method: 'PUT',
  path: '/api/v1/persons/person-a/professional-profile',
  body: { expectedRevision: 0, profile: {} },
  requestId: 'request-a',
};

describe('idempotency actor binding', () => {
  it('does not replay a generic completed command to a different actor', async () => {
    const db = createDb();
    const service = createIdempotencyService(db, { now: () => new Date('2026-08-24T09:00:00.000Z') });
    const started = await service.begin({ ...request, actorId: 'actor-a' });
    await service.complete({
      tenantId: request.tenantId,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: started.requestFingerprint,
      responseStatus: 200,
      responseBody: { changed: true },
      requestId: request.requestId,
    });

    expect(await service.begin({ ...request, actorId: 'actor-a' })).toMatchObject({
      mode: 'replay',
      body: { changed: true },
    });
    expect(await service.begin({ ...request, actorId: 'actor-b' })).toMatchObject({
      mode: 'conflict',
    });
  });

  it('does not replay an atomic completed command to a different actor', async () => {
    const db = createDb();
    const nowDate = new Date('2026-08-24T09:00:00.000Z');
    const service = createIdempotencyService(db, { now: () => nowDate });
    const requestFingerprint = buildRequestFingerprint(request);

    await db.runTransaction(async (tx) => {
      const lock = await service.checkInTransaction(tx, {
        tenantId: request.tenantId,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint,
        actorId: 'actor-a',
        nowDate,
      });
      expect(lock.mode).toBe('started');
      service.completeInTransaction(tx, {
        ref: lock.ref,
        tenantId: request.tenantId,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint,
        responseStatus: 200,
        responseBody: { changed: true },
        actorId: 'actor-a',
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        nowDate,
      });
    });

    const sameActor = await db.runTransaction((tx) => service.checkInTransaction(tx, {
      tenantId: request.tenantId,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint,
      actorId: 'actor-a',
      nowDate,
    }));
    const otherActor = await db.runTransaction((tx) => service.checkInTransaction(tx, {
      tenantId: request.tenantId,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint,
      actorId: 'actor-b',
      nowDate,
    }));

    expect(sameActor).toMatchObject({ mode: 'replay', body: { changed: true } });
    expect(otherActor).toMatchObject({ mode: 'conflict' });
  });
});
