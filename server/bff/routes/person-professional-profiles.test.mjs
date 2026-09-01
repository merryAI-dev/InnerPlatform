import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createBffApp } from '../app.mjs';
import { createIdempotencyService } from '../idempotency.mjs';
import { loadRbacPolicy } from '../rbac-policy.mjs';
import { mountPersonProfessionalProfileRoutes } from './person-professional-profiles.mjs';

const NOW = '2026-08-24T09:00:00.000Z';
const PERSON_PATH = 'orgs/tenant-a/persons/person-a';

function policyFor({ read = ['admin', 'finance'], write = ['admin', 'finance'] } = {}) {
  const roles = Array.from(new Set([...read, ...write, 'admin', 'finance', 'pm', 'viewer']));
  return {
    roles,
    permissions: ['person:professional_profile:read', 'person:professional_profile:write'],
    rolePermissions: Object.fromEntries(roles.map((role) => [role, [
      ...(read.includes(role) ? ['person:professional_profile:read'] : []),
      ...(write.includes(role) ? ['person:professional_profile:write'] : []),
    ]])),
  };
}

function emptyProfileInput() {
  return { educationRecords: [], englishEvidence: [], certifications: [] };
}

function profileInput(overrides = {}) {
  return {
    educationRecords: [{
      attainmentCode: 'MASTER_GRADUATED',
      institutionName: 'University of Sussex',
      countryCode: 'GB',
      major: 'Development Studies', admissionYear: null, degreeYear: null, evidence: null,
    }],
    englishEvidence: [{
      testCode: 'TOEIC',
      scaleCode: 'TOEIC_990',
      resultValue: '920',
      otherTestName: null,
      testedAt: '2026-06', evidence: null,
    }],
    certifications: [{ label: 'PMP' }],
    ...overrides,
  };
}

function createHarness({
  role = 'admin',
  rbacPolicy = loadRbacPolicy(),
  documents = { [PERSON_PATH]: { personId: 'person-a', name: '김정태' } },
  auditFailure = false,
  completionFailure = false,
  piiFailure = false,
  catalog = { catalogVersion: 77, educationAttainments: [], englishTests: [], countryCodes: [] },
} = {}) {
  const app = express();
  const actor = {
    actorId: 'actor-a',
    actorRole: role,
    actorEmail: 'actor@example.com',
    requestId: 'request-a',
  };
  let shouldFailCompletion = completionFailure;
  let shouldFailPii = piiFailure;
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'tenant-a',
      ...actor,
      idempotencyKey: req.header('idempotency-key') || undefined,
    };
    next();
  });

  const store = structuredClone(documents);
  const audit = [];
  const auditHead = { lastSeq: 0 };
  const transactionOperations = [];
  const personReads = [];
  const idempotencyRecords = new Map();

  const makeSnapshot = (path, source = store) => ({
    exists: Object.hasOwn(source, path),
    data: () => source[path],
  });
  const applyWrite = ({ path, value, merge }) => {
    store[path] = merge
      ? { ...(store[path] || {}), ...structuredClone(value) }
      : structuredClone(value);
    if (path.includes('/idempotency_keys/')) {
      idempotencyRecords.set(path, structuredClone(store[path]));
    }
  };
  const db = {
    collection(path) {
      return {
        where(field, _op, value) {
          return {
            limit(count) {
              return {
                get: async () => {
                  const docs = Object.entries(store)
                    .filter(([key, doc]) => key.startsWith(`${path}/`) && doc?.[field] === value)
                    .slice(0, count)
                    .map(([key, doc]) => ({ id: key.split('/').pop(), data: () => doc, ref: db.doc(key) }));
                  return { empty: docs.length === 0, docs };
                },
              };
            },
          };
        },
      };
    },
    doc(path) {
      return {
        __path: path,
        path,
        get: async () => {
          if (path.includes('/persons/')) personReads.push(path);
          return makeSnapshot(path);
        },
        set: async (value, options) => applyWrite({
          path,
          value,
          merge: options?.merge === true,
        }),
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const pendingAudit = [];
      const tx = {
        async get(ref) {
          transactionOperations.push(`get:${ref.__path}`);
          if (ref.__path.includes('/persons/')) personReads.push(ref.__path);
          return makeSnapshot(ref.__path);
        },
        set(ref, value, options) {
          transactionOperations.push(`set:${ref.__path}`);
          writes.push({ path: ref.__path, value: structuredClone(value), merge: options?.merge === true });
        },
        __appendAudit(entries) {
          transactionOperations.push('audit');
          pendingAudit.push(...structuredClone(entries));
        },
      };
      const result = await callback(tx);
      for (const write of writes) applyWrite(write);
      audit.push(...pendingAudit);
      auditHead.lastSeq += pendingAudit.length;
      return result;
    },
  };

  const auditChainService = {
    appendManyInTransaction: vi.fn(async (tx, entries) => {
      if (auditFailure) throw new Error('audit unavailable');
      tx.__appendAudit(entries);
    }),
  };
  const productionIdempotencyService = createIdempotencyService(db, {
    now: () => new Date(NOW),
  });
  const idempotencyService = {
    ...productionIdempotencyService,
    complete: vi.fn(async (input) => {
      if (shouldFailCompletion) throw new Error('idempotency completion unavailable');
      return productionIdempotencyService.complete(input);
    }),
    completeInTransaction: vi.fn((tx, input) => {
      if (shouldFailCompletion) throw new Error('idempotency completion unavailable');
      return productionIdempotencyService.completeInTransaction(tx, input);
    }),
  };
  const encryptText = vi.fn(async (value) => {
    if (shouldFailPii) throw new Error('kms unavailable');
    return { ciphertext: `enc:${value}` };
  });

  mountPersonProfessionalProfileRoutes(app, {
    db,
    now: () => NOW,
    idempotencyService,
    auditChainService,
    piiProtector: { encryptText },
    rbacPolicy,
    catalog,
  });
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({
    error: error.code || 'internal_error',
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  }));

  return {
    app,
    store,
    audit,
    auditHead,
    transactionOperations,
    personReads,
    idempotencyRecords,
    auditChainService,
    encryptText,
    setActor(patch) { Object.assign(actor, patch); },
    setCompletionFailure(value) { shouldFailCompletion = value; },
    setPiiFailure(value) { shouldFailPii = value; },
  };
}

async function putProfile(app, {
  expectedRevision = 0,
  profile = profileInput(),
  key = 'profile-save-a',
} = {}) {
  return request(app)
    .put('/api/v1/persons/person-a/professional-profile')
    .set('idempotency-key', key)
    .send({ expectedRevision, profile });
}

describe('professional profile catalog and read routes', () => {
  it('returns the injected catalog without person data and prevents caching', async () => {
    const { app, personReads } = createHarness();
    const response = await request(app).get('/api/v1/person-professional-profile/catalog');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual({
      catalogVersion: 77,
      educationAttainments: [],
      englishTests: [],
      countryCodes: [],
    });
    expect(personReads).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain('person-a');
  });

  it('normalizes a legacy missing profile to empty arrays and revision zero', async () => {
    const { app } = createHarness();
    const response = await request(app).get('/api/v1/persons/person-a/professional-profile');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual({
      profile: {
        schemaVersion: 1,
        ...emptyProfileInput(),
        provenance: {
          source: 'PEOPLE_MANUAL',
          revision: 0,
          updatedAt: null,
          updatedBy: null,
        },
      },
      revision: 0,
    });
  });

  it.each(['pm', 'viewer', 'tenant_admin', 'support'])('denies %s on someone else\'s profile', async (role) => {
    const { app, personReads } = createHarness({ role });
    const catalog = await request(app).get('/api/v1/person-professional-profile/catalog');
    const profile = await request(app).get('/api/v1/persons/person-a/professional-profile');
    const save = await putProfile(app, { key: `denied-${role}` });

    expect(catalog.status).toBe(403);
    expect(profile.status).toBe(403);
    expect(save.status).toBe(403);
    // 거부하기 전에 본인인지만 본다 - 다른 사람 문서는 읽지 않는다.
    expect(personReads.every((path) => path === PERSON_PATH)).toBe(true);
  });

  /**
   * 마이페이지에서 본인이 자기 학력·어학·자격을 넣는 경로.
   * 통과 기준은 역할이 아니라 대상 person 문서의 uid 가 로그인 계정과 같은지다.
   */
  it.each(['pm', 'viewer', 'support'])('lets %s read and write their own profile', async (role) => {
    const { app } = createHarness({
      role,
      documents: { [PERSON_PATH]: { personId: 'person-a', name: '김정태', uid: 'actor-a' } },
    });

    expect((await request(app).get('/api/v1/person-professional-profile/catalog')).status).toBe(200);
    expect((await request(app).get('/api/v1/persons/person-a/professional-profile')).status).toBe(200);
    expect((await putProfile(app, { key: `self-${role}` })).status).toBe(200);
  });

  it('본인 판정은 uid 가 정확히 같을 때만 통과한다', async () => {
    const { app } = createHarness({
      role: 'pm',
      documents: { [PERSON_PATH]: { personId: 'person-a', name: '김정태', uid: 'someone-else' } },
    });

    expect((await request(app).get('/api/v1/persons/person-a/professional-profile')).status).toBe(403);
    expect((await putProfile(app, { key: 'not-me' })).status).toBe(403);
  });

  it('명부에 연결되지 않은 계정은 카탈로그도 못 받는다', async () => {
    const { app } = createHarness({ role: 'pm', documents: {} });
    expect((await request(app).get('/api/v1/person-professional-profile/catalog')).status).toBe(403);
  });

  it.each(['admin', 'finance'])('allows %s to read and write through the injected production policy', async (role) => {
    const { app } = createHarness({ role });
    expect((await request(app).get('/api/v1/person-professional-profile/catalog')).status).toBe(200);
    expect((await request(app).get('/api/v1/persons/person-a/professional-profile')).status).toBe(200);
    expect((await putProfile(app, { key: `allowed-${role}` })).status).toBe(200);
  });

  it('uses the injected policy rather than role names for catalog, GET, and PUT', async () => {
    const oppositePolicy = policyFor({ read: ['pm'], write: ['pm'] });
    const denied = createHarness({ role: 'admin', rbacPolicy: oppositePolicy });
    expect((await request(denied.app).get('/api/v1/person-professional-profile/catalog')).status).toBe(403);
    expect((await request(denied.app).get('/api/v1/persons/person-a/professional-profile')).status).toBe(403);
    expect((await putProfile(denied.app)).status).toBe(403);
    // 거부하기 전에 본인인지 한 번 확인한다. 값을 돌려주지는 않는다.
    expect(denied.personReads.every((path) => path === PERSON_PATH)).toBe(true);

    const allowed = createHarness({ role: 'pm', rbacPolicy: oppositePolicy });
    expect((await request(allowed.app).get('/api/v1/person-professional-profile/catalog')).status).toBe(200);
    expect((await request(allowed.app).get('/api/v1/persons/person-a/professional-profile')).status).toBe(200);
    expect((await putProfile(allowed.app)).status).toBe(200);
  });

  it('returns a tenant-safe 404 for a missing person', async () => {
    const { app } = createHarness({ documents: {} });
    const response = await request(app).get('/api/v1/persons/person-a/professional-profile');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('person_not_found');
    expect(JSON.stringify(response.body)).not.toContain('tenant-a');
  });
});

describe('professional profile full-replacement command', () => {
  it('writes revision one atomically, returns canonical profile, and re-reads canonical data', async () => {
    const harness = createHarness();
    const response = await putProfile(harness.app);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual({
      profile: expect.objectContaining({
        schemaVersion: 1,
        educationRecords: [expect.objectContaining({ institutionName: 'University of Sussex' })],
        englishEvidence: [expect.objectContaining({ resultValue: '920' })],
        certifications: [{ key: 'pmp', label: 'PMP', acquiredAt: null, evidence: null }],
      }),
      revision: 1,
      changed: true,
    });
    expect(harness.transactionOperations).toEqual([
      expect.stringMatching(/^get:orgs\/tenant-a\/idempotency_keys\//),
      `get:${PERSON_PATH}`,
      'audit',
      `set:${PERSON_PATH}`,
      expect.stringMatching(/^set:orgs\/tenant-a\/idempotency_keys\//),
    ]);

    const stored = harness.store[PERSON_PATH].professionalProfile;
    expect(stored).toMatchObject({
      schemaVersion: 1,
      educationRecords: [expect.objectContaining({ institutionName: 'University of Sussex' })],
      englishEvidence: [expect.objectContaining({ resultValue: '920' })],
      certifications: [{ key: 'pmp', label: 'PMP', acquiredAt: null, evidence: null }],
      provenance: {
        source: 'PEOPLE_MANUAL',
        revision: 1,
        updatedAt: NOW,
        updatedBy: 'actor-a',
      },
    });

    const reread = await request(harness.app).get('/api/v1/persons/person-a/professional-profile');
    expect(reread.status).toBe(200);
    expect(reread.body.profile).toEqual(stored);
    expect(reread.body.revision).toBe(1);
  });

  it('keeps person, audit, and head byte-for-byte unchanged for identical and stale-but-same saves', async () => {
    const harness = createHarness();
    expect((await putProfile(harness.app, { key: 'initial' })).status).toBe(200);
    const before = structuredClone({
      person: harness.store[PERSON_PATH],
      audit: harness.audit,
      head: harness.auditHead,
    });
    const operationStart = harness.transactionOperations.length;

    const identical = await putProfile(harness.app, { expectedRevision: 1, key: 'identical' });
    const staleSame = await putProfile(harness.app, { expectedRevision: 0, key: 'stale-same' });

    expect(identical.body).toEqual({
      profile: harness.store[PERSON_PATH].professionalProfile,
      revision: 1,
      changed: false,
    });
    expect(staleSame.body).toEqual(identical.body);
    expect({ person: harness.store[PERSON_PATH], audit: harness.audit, head: harness.auditHead })
      .toEqual(before);
    expect(harness.transactionOperations.slice(operationStart)).toEqual([
      expect.stringMatching(/^get:orgs\/tenant-a\/idempotency_keys\//),
      `get:${PERSON_PATH}`,
      expect.stringMatching(/^set:orgs\/tenant-a\/idempotency_keys\//),
      expect.stringMatching(/^get:orgs\/tenant-a\/idempotency_keys\//),
      `get:${PERSON_PATH}`,
      expect.stringMatching(/^set:orgs\/tenant-a\/idempotency_keys\//),
    ]);
  });

  it('returns only the current revision on stale-different input and performs no write', async () => {
    const harness = createHarness();
    await putProfile(harness.app, { key: 'initial' });
    const before = structuredClone({ person: harness.store[PERSON_PATH], audit: harness.audit, head: harness.auditHead });

    const response = await putProfile(harness.app, {
      expectedRevision: 0,
      profile: profileInput({ certifications: [{ label: 'ODA 전문가' }] }),
      key: 'stale-different',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('professional_profile_revision_conflict');
    expect(response.body.details).toEqual({ currentRevision: 1 });
    expect(JSON.stringify(response.body)).not.toMatch(/Sussex|920|PMP|ODA/);
    expect({ person: harness.store[PERSON_PATH], audit: harness.audit, head: harness.auditHead })
      .toEqual(before);
  });

  it.each([
    ['unknown top-level field', { expectedRevision: 0, profile: emptyProfileInput(), extra: true }],
    ['unknown nested field', { expectedRevision: 0, profile: { ...emptyProfileInput(), certifications: [{ label: 'PMP', issuer: 'PMI' }] } }],
    ['unknown catalog code', { expectedRevision: 0, profile: { ...emptyProfileInput(), educationRecords: [{ attainmentCode: 'UNKNOWN' }] } }],
    ['over-limit array', { expectedRevision: 0, profile: { ...emptyProfileInput(), certifications: Array.from({ length: 21 }, (_, index) => ({ label: `자격 ${index}` })) } }],
  ])('rejects %s with 400 and no write', async (_label, body) => {
    const harness = createHarness();
    const response = await request(harness.app)
      .put('/api/v1/persons/person-a/professional-profile')
      .set('idempotency-key', `invalid-${_label}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(harness.store[PERSON_PATH]).toEqual({ personId: 'person-a', name: '김정태' });
    expect(harness.audit).toEqual([]);
    expect(harness.auditHead).toEqual({ lastSeq: 0 });
    expect(harness.idempotencyRecords.size).toBe(0);
  });

  it('returns tenant-safe 404 for PUT without writing or auditing', async () => {
    const harness = createHarness({ documents: {} });
    const response = await putProfile(harness.app);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('person_not_found');
    expect(JSON.stringify(response.body)).not.toContain('tenant-a');
    expect(harness.audit).toEqual([]);
  });

  it('does not cross the tenant boundary when the same personId exists only in another tenant', async () => {
    const foreignPath = 'orgs/tenant-b/persons/person-a';
    const foreignPerson = {
      personId: 'person-a',
      tenantId: 'tenant-b',
      name: '다른 테넌트',
      professionalProfile: {
        schemaVersion: 1,
        ...profileInput(),
        provenance: {
          source: 'PEOPLE_MANUAL',
          revision: 7,
          updatedAt: NOW,
          updatedBy: 'foreign-actor',
        },
      },
    };
    const harness = createHarness({ documents: { [foreignPath]: foreignPerson } });
    const before = structuredClone(harness.store);

    const read = await request(harness.app).get('/api/v1/persons/person-a/professional-profile');
    const write = await putProfile(harness.app, { key: 'foreign-tenant-write' });

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
    expect(read.body.error).toBe('person_not_found');
    expect(write.body.error).toBe('person_not_found');
    expect(JSON.stringify([read.body, write.body])).not.toMatch(/tenant-a|tenant-b|다른 테넌트|Sussex|920|PMP/);
    expect(harness.store).toEqual(before);
    expect(harness.audit).toEqual([]);
    expect(harness.idempotencyRecords.size).toBe(0);
  });

  it('redacts profile values from audit details and metadata', async () => {
    const harness = createHarness();
    await putProfile(harness.app);

    expect(harness.audit).toHaveLength(1);
    expect(harness.audit[0]).toMatchObject({
      entityType: 'person',
      entityId: 'person-a',
      action: 'PROFILE_UPDATE',
      metadata: {
        source: 'bff',
        fields: ['educationRecords', 'englishEvidence', 'certifications'],
        previousRevision: 0,
        nextRevision: 1,
      },
    });
    expect(JSON.stringify(harness.audit)).not.toMatch(/Sussex|Development Studies|TOEIC|920|2026-06|PMP/);
  });

  it('rolls back the person write when transactional audit append fails', async () => {
    const harness = createHarness({ auditFailure: true });
    const before = structuredClone(harness.store);
    const response = await putProfile(harness.app);

    expect(response.status).toBe(500);
    expect(harness.store).toEqual(before);
    expect(harness.audit).toEqual([]);
    expect(harness.auditHead).toEqual({ lastSeq: 0 });
  });

  it('replays the same safe receipt with no-store and never persists profile PII in responseBody', async () => {
    const harness = createHarness();
    const first = await putProfile(harness.app, { key: 'stable-key' });
    const canonicalProfile = {
      ...harness.store[PERSON_PATH].professionalProfile,
      certifications: [{ key: 'aws', label: 'AWS', acquiredAt: null, evidence: null }],
      provenance: {
        ...harness.store[PERSON_PATH].professionalProfile.provenance,
        revision: 2,
      },
    };
    harness.store[PERSON_PATH].professionalProfile = canonicalProfile;
    const replay = await putProfile(harness.app, { key: 'stable-key' });

    expect(first.body).toMatchObject({
      profile: { certifications: [{ key: 'pmp', label: 'PMP', acquiredAt: null, evidence: null }] },
      revision: 1,
      changed: true,
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ profile: canonicalProfile, revision: 2, changed: true });
    expect(replay.headers['x-idempotency-replayed']).toBe('1');
    expect(replay.headers['cache-control']).toBe('private, no-store');
    expect([...harness.idempotencyRecords.values()].map(({ responseBody }) => responseBody))
      .toEqual([{ personId: 'person-a', revision: 1, changed: true }]);
    const idempotencyJson = JSON.stringify([...harness.idempotencyRecords.values()]);
    expect(idempotencyJson).not.toMatch(/Sussex|Development Studies|TOEIC|920|2026-06|PMP/);
    expect(harness.audit).toHaveLength(1);
    expect(harness.store[PERSON_PATH].professionalProfile.provenance.revision).toBe(2);
  });

  it('checks current profile-write permission before replaying a completed PUT', async () => {
    const harness = createHarness();
    const first = await putProfile(harness.app, { key: 'permission-before-replay' });
    expect(first.status).toBe(200);
    const before = structuredClone({
      person: harness.store[PERSON_PATH],
      audit: harness.audit,
      head: harness.auditHead,
      operations: harness.transactionOperations,
    });

    harness.setActor({ actorRole: 'viewer' });
    const replay = await putProfile(harness.app, { key: 'permission-before-replay' });

    expect(replay.status).toBe(403);
    expect(replay.body.error).toBe('forbidden');
    expect({
      person: harness.store[PERSON_PATH],
      audit: harness.audit,
      head: harness.auditHead,
      operations: harness.transactionOperations,
    }).toEqual(before);
  });

  it('does not replay a completed PUT to a different authorized actor', async () => {
    const harness = createHarness();
    expect((await putProfile(harness.app, { key: 'actor-bound-put' })).status).toBe(200);

    harness.setActor({ actorId: 'actor-b', requestId: 'request-b' });
    const replay = await putProfile(harness.app, { key: 'actor-bound-put' });

    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe('idempotency_conflict');
    expect(replay.headers['x-idempotency-replayed']).toBeUndefined();
    expect(harness.audit).toHaveLength(1);
    expect(harness.store[PERSON_PATH].professionalProfile.provenance.revision).toBe(1);
  });

  it('rolls back person, audit, head, and receipt when PUT completion fails, then retries normally', async () => {
    const harness = createHarness({ completionFailure: true });
    const beforePerson = structuredClone(harness.store[PERSON_PATH]);

    const failed = await putProfile(harness.app, { key: 'completion-retry-put' });

    expect(failed.status).toBe(500);
    expect(harness.store[PERSON_PATH]).toEqual(beforePerson);
    expect(harness.audit).toEqual([]);
    expect(harness.auditHead).toEqual({ lastSeq: 0 });
    expect(harness.idempotencyRecords.size).toBe(0);

    harness.setCompletionFailure(false);
    const retried = await putProfile(harness.app, { key: 'completion-retry-put' });

    expect(retried.status).toBe(200);
    expect(retried.body).toEqual({
      profile: harness.store[PERSON_PATH].professionalProfile,
      revision: 1,
      changed: true,
    });
    expect(retried.headers['x-idempotency-replayed']).toBeUndefined();
    expect(harness.audit).toHaveLength(1);
    expect(harness.auditHead).toEqual({ lastSeq: 1 });
    expect(harness.idempotencyRecords.size).toBe(1);
  });

  it('does not call KMS for no-op, stale-different, or missing-person PUT outcomes', async () => {
    const harness = createHarness();
    expect((await putProfile(harness.app, { key: 'kms-initial' })).status).toBe(200);
    expect(harness.encryptText).toHaveBeenCalledTimes(1);
    harness.setPiiFailure(true);

    const identical = await putProfile(harness.app, {
      expectedRevision: 1,
      key: 'kms-identical',
    });
    const staleSame = await putProfile(harness.app, {
      expectedRevision: 0,
      key: 'kms-stale-same',
    });
    const staleDifferent = await putProfile(harness.app, {
      expectedRevision: 0,
      profile: profileInput({ certifications: [{ label: 'ODA 전문가' }] }),
      key: 'kms-stale-different',
    });

    expect(identical.status).toBe(200);
    expect(identical.body.changed).toBe(false);
    expect(staleSame.status).toBe(200);
    expect(staleSame.body.changed).toBe(false);
    expect(staleDifferent.status).toBe(409);
    expect(staleDifferent.body.error).toBe('professional_profile_revision_conflict');
    expect(harness.encryptText).toHaveBeenCalledTimes(1);

    const missing = createHarness({ documents: {}, piiFailure: true });
    const missingResponse = await putProfile(missing.app, { key: 'kms-missing' });
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body.error).toBe('person_not_found');
    expect(missing.encryptText).not.toHaveBeenCalled();
  });
});

describe('production route reachability', () => {
  it('serves the injected catalog and policy through the production BFF app', async () => {
    const missingSnapshot = { exists: false, data: () => undefined };
    const db = {
      doc: (path) => ({
        __path: path,
        get: async () => missingSnapshot,
        set: async () => {},
      }),
      collection: () => ({ get: async () => ({ docs: [] }) }),
      runTransaction: async (callback) => callback({
        get: async () => missingSnapshot,
        set: () => {},
        create: () => {},
        update: () => {},
      }),
    };
    const catalog = {
      catalogVersion: 88,
      educationAttainments: [],
      englishTests: [],
      countryCodes: [],
    };
    const app = createBffApp({
      projectId: 'demo-profile-api',
      db,
      authMode: 'headers',
      tokenVerifier: async () => ({}),
      authAdminService: {},
      piiProtector: { encryptText: async (value) => ({ ciphertext: `enc:${value}` }) },
      rbacPolicy: policyFor({ read: ['pm'], write: ['pm'] }),
      professionalProfileCatalog: catalog,
      env: {
        BFF_DEPLOY_ENV: 'local',
        NODE_ENV: 'test',
        BFF_AUTH_MODE: 'headers',
        BFF_SCHEDULER_OWNER: 'disabled',
      },
    });

    const response = await request(app)
      .get('/api/v1/person-professional-profile/catalog')
      .set({
        'x-tenant-id': 'tenant-a',
        'x-actor-id': 'actor-a',
        'x-actor-role': 'pm',
      });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toEqual(catalog);
  });
});
