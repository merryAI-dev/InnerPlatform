import { describe, expect, it, vi } from 'vitest';
import { createAuditChainService } from './audit-chain.mjs';
import {
  applyCumulativeCloseHeadPlan,
  applyCumulativeCloseResetToReclose,
  assertLinkedActivePeopleUid,
  buildCumulativeCloseHeadPlan,
  buildCumulativeCloseResetToReclosePlan,
  executeCumulativeCloseHeadMigration,
  parseCumulativeCloseHeadMigrationArgs,
  validateCumulativeCloseHeadMigrationOptions,
} from '../../scripts/cashflow-cumulative-close-head-migration.mjs';

const ROOT_HASH = `sha256:${'a'.repeat(64)}`;
const SNAPSHOT_HASH = `sha256:${'b'.repeat(64)}`;
const SOURCE_REVISION = `sha256:${'c'.repeat(64)}`;

function completeEvidence({ projectId = 'project-a' } = {}) {
  const requestId = `${projectId}-2026-08`;
  const versionId = `${projectId}-2026-08-r1`;
  const monthShards = [];
  for (let cursor = new Date(Date.UTC(2023, 0, 1)), index = 0;
    cursor <= new Date(Date.UTC(2026, 6, 1));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1), index += 1) {
    monthShards.push({
      yearMonth: cursor.toISOString().slice(0, 7),
      shardHash: `sha256:${(index % 16).toString(16).repeat(64)}`,
    });
  }
  const snapshot = {
    schemaVersion: 2,
    contractVersion: 'cashflow-cumulative-close-v2',
    projectId,
    yearMonth: '2026-08',
    requestId,
    requestRevision: 1,
    manifestHash: ROOT_HASH,
    rootHash: ROOT_HASH,
    headRevision: 4,
    approvalId: `approval-${projectId}`,
    operationId: `operation-${projectId}`,
    monthShards,
    closedAt: '2026-08-11T10:00:00.000Z',
    closedByUid: 'head-uid',
  };
  return {
    monthlyCloses: [{
      id: `${projectId}-2026-08`,
      data: {
        contractVersion: 'cashflow-month-close-v1',
        tenantId: 'tenant-a',
        projectId,
        yearMonth: '2026-08',
        status: 'CLOSED',
        revision: 1,
        latestVersionId: versionId,
        snapshotHash: SNAPSHOT_HASH,
        snapshot,
        closedAt: snapshot.closedAt,
        closedByUid: snapshot.closedByUid,
      },
    }],
    monthlyCloseVersions: [{
      id: versionId,
      data: {
        contractVersion: 'cashflow-month-close-v1',
        tenantId: 'tenant-a',
        projectId,
        yearMonth: '2026-08',
        status: 'CLOSED',
        revision: 1,
        snapshotHash: SNAPSHOT_HASH,
        sourceRevision: SOURCE_REVISION,
        snapshot,
        closedAt: snapshot.closedAt,
        closedByUid: snapshot.closedByUid,
      },
    }],
    requests: [{
      id: requestId,
      data: {
        contractVersion: 'cashflow-cumulative-close-v2',
        tenantId: 'tenant-a',
        projectId,
        requestId,
        yearMonth: '2026-08',
        fromMonth: '2023-01',
        throughMonth: '2026-07',
        scope: {
          contractVersion: 'cashflow-cumulative-close-v2',
          fromMonth: '2023-01',
          throughMonth: '2026-07',
        },
        status: 'APPROVED',
        revision: 2,
        manifestHash: ROOT_HASH,
        monthCount: monthShards.length,
        approvalId: snapshot.approvalId,
        operationId: snapshot.operationId,
      },
    }],
    heads: [],
  };
}

function planFor(input = completeEvidence()) {
  return buildCumulativeCloseHeadPlan({ tenantId: 'tenant-a', ...input });
}

function firestoreEvidence(input = completeEvidence()) {
  return {
    ...Object.fromEntries([
      ...input.monthlyCloses.map((document) => [
        `orgs/tenant-a/monthly_closes/${document.id}`,
        document.data,
      ]),
      ...input.monthlyCloseVersions.map((document) => [
        `orgs/tenant-a/monthly_close_versions/${document.id}`,
        document.data,
      ]),
      ...input.requests.map((document) => [
        `orgs/tenant-a/cashflow_month_close_requests/${document.id}`,
        document.data,
      ]),
    ]),
    'orgs/tenant-a/persons/person-operator': {
      personId: 'person-operator', uid: 'operator-uid', name: 'Migration Operator',
    },
    'orgs/tenant-a/members/operator-uid': {
      uid: 'operator-uid', status: 'ACTIVE', role: 'admin',
    },
  };
}

function fakeDb(initial = {}) {
  const documents = new Map(Object.entries(initial));
  let transactionCount = 0;
  function collection(path, filters = [], queryLimit = null) {
    return {
      kind: 'query',
      where(field, operator, value) {
        if (operator !== '==') throw new Error(`unsupported operator: ${operator}`);
        return collection(path, [...filters, { field, value }], queryLimit);
      },
      limit(value) {
        return collection(path, filters, value);
      },
      async get() {
        const prefix = `${path}/`;
        let docs = [...documents.entries()]
          .filter(([candidate]) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/'))
          .filter(([, value]) => filters.every((filter) => value?.[filter.field] === filter.value))
          .map(([candidate, value]) => ({
            id: candidate.slice(prefix.length), exists: true, data: () => value,
          }));
        if (Number.isSafeInteger(queryLimit)) docs = docs.slice(0, queryLimit);
        return { docs, size: docs.length };
      },
    };
  }
  const db = {
    documents,
    collection,
    doc(path) {
      return {
        kind: 'doc',
        path,
        async get() {
          return { exists: documents.has(path), data: () => documents.get(path) };
        },
      };
    },
    async runTransaction(handler) {
      transactionCount += 1;
      const staged = new Map();
      const transaction = {
        async get(ref) {
          if (ref.kind === 'query') return ref.get();
          const value = staged.has(ref.path) ? staged.get(ref.path) : documents.get(ref.path);
          return { exists: value !== undefined, data: () => value };
        },
        create(ref, value) {
          if (documents.has(ref.path) || staged.has(ref.path)) throw new Error(`already exists: ${ref.path}`);
          staged.set(ref.path, value);
        },
        set(ref, value, options) {
          const current = staged.has(ref.path) ? staged.get(ref.path) : documents.get(ref.path);
          staged.set(ref.path, options?.merge ? { ...(current || {}), ...value } : value);
        },
        delete(ref) {
          staged.set(ref.path, undefined);
        },
      };
      const result = await handler(transaction);
      for (const [path, value] of staged) {
        if (value === undefined) documents.delete(path);
        else documents.set(path, value);
      }
      return result;
    },
  };
  return { db, documents, transactionCount: () => transactionCount };
}

describe('cashflow cumulative close head migration', () => {
  it('builds a head only from complete immutable run and explicit cumulative request evidence', () => {
    const [row] = planFor();

    expect(row.status).toBe('READY');
    expect(row.head).toEqual({
      contractVersion: 'cashflow-cumulative-close-v2',
      tenantId: 'tenant-a',
      projectId: 'project-a',
      status: 'CLOSED',
      fromMonth: '2023-01',
      closedThrough: '2026-07',
      settlementMonth: '2026-08',
      rootHash: ROOT_HASH,
      revision: 4,
      requestId: 'project-a-2026-08',
      requestRevision: 1,
      approvalId: 'approval-project-a',
      operationId: 'operation-project-a',
      closedAt: '2026-08-11T10:00:00.000Z',
      closedByUid: 'head-uid',
    });
    expect(row.source).toMatchObject({
      monthlyCloseVersionId: 'project-a-2026-08-r1',
      sourceRevision: SOURCE_REVISION,
      snapshotHash: SNAPSHOT_HASH,
    });
  });

  it.each([
    ['monthly close', 'MONTHLY_CLOSE_IDENTITY_INVALID', (input) => {
      input.monthlyCloses[0].id = 'project-a-2026-07';
    }],
    ['monthly close version', 'MONTHLY_CLOSE_VERSION_IDENTITY_INVALID', (input) => {
      input.monthlyCloseVersions[0].id = 'project-a-2026-07-r1';
      input.monthlyCloses[0].data.latestVersionId = 'project-a-2026-07-r1';
    }],
    ['cumulative request', 'CUMULATIVE_REQUEST_IDENTITY_INVALID', (input) => {
      input.requests[0].id = 'project-a-2026-07';
      input.requests[0].data.requestId = 'project-a-2026-07';
      input.monthlyCloses[0].data.snapshot.requestId = 'project-a-2026-07';
    }],
  ])('rejects a cross-cycle %s document identity instead of borrowing its embedded scope', (_label, reason, mutate) => {
    const input = completeEvidence();
    mutate(input);

    const [row] = planFor(input);

    expect(row).toMatchObject({
      status: 'UNREPAIRABLE',
      head: null,
      source: null,
      reasons: expect.arrayContaining([reason]),
    });
  });

  it.each([
    ['monthly close', (input) => {
      input.monthlyCloses[0].id = 'project-b-2026-08';
    }],
    ['monthly close version', (input) => {
      input.monthlyCloseVersions[0].data.projectId = 'project-b';
    }],
    ['cumulative request', (input) => {
      input.requests[0].data.projectId = 'project-b';
    }],
  ])('does not offer destructive reset for a cross-project %s candidate', (_label, mutate) => {
    const input = completeEvidence();
    delete input.monthlyCloseVersions[0].data.sourceRevision;
    input.heads = [{
      id: 'project-a',
      data: {
        contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'tenant-a', projectId: 'project-a',
        status: 'CLOSED', fromMonth: '2023-01', closedThrough: 'broken', settlementMonth: 'broken',
        revision: 99, rootHash: 'broken',
      },
    }];
    mutate(input);

    const row = buildCumulativeCloseResetToReclosePlan({
      tenantId: 'tenant-a',
      projectIds: ['project-a'],
      ...input,
    }).find((candidate) => candidate.projectId === 'project-a');

    expect(row).toMatchObject({
      status: 'RESET_CYCLE_EVIDENCE_REQUIRED',
      expectedEvidence: null,
      cycleCandidates: [],
    });
  });

  it('marks a non-canonical fromMonth UNREPAIRABLE instead of creating a head that JVM would never write', () => {
    const input = completeEvidence();
    input.requests[0].data.fromMonth = '2026-05';
    input.requests[0].data.scope.fromMonth = '2026-05';
    const [row] = planFor(input);

    expect(row).toMatchObject({
      status: 'UNREPAIRABLE',
      reasons: expect.arrayContaining(['CUMULATIVE_FROM_MONTH_INVALID']),
    });
  });

  it.each([
    ['explicit throughMonth', (input) => { delete input.requests[0].data.throughMonth; }],
    ['nested scope', (input) => { delete input.requests[0].data.scope; }],
    ['root hash', (input) => { input.requests[0].data.manifestHash = `sha256:${'0'.repeat(64)}`; }],
    ['head revision', (input) => { delete input.monthlyCloseVersions[0].data.snapshot.headRevision; }],
    ['source revision', (input) => { delete input.monthlyCloseVersions[0].data.sourceRevision; }],
  ])('reports UNREPAIRABLE instead of inferring missing %s evidence', (_label, mutate) => {
    const input = completeEvidence();
    mutate(input);

    const [row] = planFor(input);

    expect(row.status).toBe('UNREPAIRABLE');
    expect(row.head).toBeNull();
    expect(row.reasons.length).toBeGreaterThan(0);
  });

  it('plans reset-to-reclose from exact document identity without inventing malformed header fields', () => {
    const input = completeEvidence();
    delete input.monthlyCloseVersions[0].data.sourceRevision;
    input.monthlyCloses[0].data = {
      tenantId: 'tenant-a',
      projectId: 'project-a',
      yearMonth: '2026-08',
      status: 'BROKEN',
      rawLegacyValue: 'preserve-only-in-audit',
    };
    input.heads = [{
      id: 'project-a',
      data: {
        contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'tenant-a', projectId: 'project-a',
        status: 'CLOSED', fromMonth: '2023-01', closedThrough: 'broken', revision: 99,
        rootHash: 'broken', legacyField: 'preserve-only-in-audit',
      },
    }];

    const [row] = buildCumulativeCloseResetToReclosePlan({ tenantId: 'tenant-a', ...input });

    expect(row).toMatchObject({
      projectId: 'project-a',
      status: 'RESET_TO_RECLOSE_READY',
      monthlyCloseId: 'project-a-2026-08',
      yearMonth: '2026-08',
      expectedEvidence: {
        contractVersion: 'cashflow-cumulative-close-reset-to-reclose-evidence-v1',
        authorityFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        monthlyCloseFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        immutableEvidenceFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        monthlyCloseId: 'project-a-2026-08',
        yearMonth: '2026-08',
      },
    });
    expect(row.after).toBeNull();
  });

  it('never offers reset-to-reclose for a valid authority or an ambiguous exact cycle candidate', () => {
    const validInput = completeEvidence();
    const canonicalHead = planFor(validInput)[0].head;
    validInput.heads = [{ id: 'project-a', data: canonicalHead }];
    expect(buildCumulativeCloseResetToReclosePlan({ tenantId: 'tenant-a', ...validInput })[0])
      .toMatchObject({ status: 'NORMAL_REOPEN_REQUIRED', expectedEvidence: null });

    const ambiguousInput = completeEvidence();
    delete ambiguousInput.monthlyCloseVersions[0].data.sourceRevision;
    ambiguousInput.monthlyCloses.push({
      id: 'project-a-2026-08-copy',
      data: { status: 'CLOSED' },
    });
    expect(buildCumulativeCloseResetToReclosePlan({ tenantId: 'tenant-a', ...ambiguousInput })[0])
      .toMatchObject({
        status: 'RESET_TO_RECLOSE_READY',
        monthlyCloseId: 'project-a-2026-08',
      });
  });

  it.each(['OPEN', 'REOPEN_REQUESTED'])('never treats a healthy %s mutable header as a destructive reset candidate', async (status) => {
    const input = completeEvidence();
    input.heads = [];
    input.monthlyCloseVersions = [];
    input.requests = [];
    input.monthlyCloses[0].data.status = status;

    const [plan] = buildCumulativeCloseResetToReclosePlan({
      tenantId: 'tenant-a',
      projectIds: ['project-a'],
      ...input,
    });

    expect(plan).toMatchObject({
      projectId: 'project-a',
      status: 'RECLOSE_READY',
      expectedEvidence: null,
    });
    expect(plan.cycleCandidates).toEqual([]);

    const evidence = firestoreEvidence(input);
    const harness = fakeDb(evidence);
    const auditEntries = [];
    await expect(applyCumulativeCloseResetToReclose({
      db: harness.db,
      tenantId: 'tenant-a',
      projectId: 'project-a',
      peopleUid: 'operator-uid',
      reason: '정상 문서는 격리하지 않음',
      expectedEvidence: {
        contractVersion: 'cashflow-cumulative-close-reset-to-reclose-evidence-v1',
        authorityFingerprint: `sha256:${'0'.repeat(64)}`,
        monthlyCloseFingerprint: `sha256:${'0'.repeat(64)}`,
        immutableEvidenceFingerprint: `sha256:${'0'.repeat(64)}`,
        monthlyCloseId: 'project-a-2026-08',
        yearMonth: '2026-08',
      },
      auditChainService: {
        appendManyInTransaction: async (_transaction, entries) => { auditEntries.push(...entries); },
      },
    })).rejects.toThrow('evidence changed');
    expect(harness.documents.get('orgs/tenant-a/monthly_closes/project-a-2026-08'))
      .toMatchObject({ status });
    expect(auditEntries).toEqual([]);
  });

  it('uses exact immutable settlement-month evidence when an invalid head remains after the current header is already absent', async () => {
    const input = completeEvidence();
    input.monthlyCloses = [];
    delete input.monthlyCloseVersions[0].data.sourceRevision;
    const invalidHead = {
      contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'tenant-a', projectId: 'project-a',
      status: 'CLOSED', fromMonth: '2023-01', closedThrough: 'broken', settlementMonth: 'broken',
      revision: 99, rootHash: 'broken', rawLegacyValue: 'head-before',
    };
    input.heads = [{ id: 'project-a', data: invalidHead }];

    const [plan] = buildCumulativeCloseResetToReclosePlan({ tenantId: 'tenant-a', ...input });

    expect(plan).toMatchObject({
      projectId: 'project-a',
      status: 'RESET_TO_RECLOSE_READY',
      monthlyCloseId: 'project-a-2026-08',
      yearMonth: '2026-08',
      expectedEvidence: {
        contractVersion: 'cashflow-cumulative-close-reset-to-reclose-evidence-v1',
        monthlyCloseFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });

    const evidence = firestoreEvidence(input);
    evidence['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'] = invalidHead;
    const harness = fakeDb(evidence);
    const auditEntries = [];
    const result = await applyCumulativeCloseResetToReclose({
      db: harness.db,
      tenantId: 'tenant-a',
      projectId: 'project-a',
      peopleUid: 'operator-uid',
      reason: '남은 손상 authority를 격리하고 정상 재결산 준비',
      expectedEvidence: plan.expectedEvidence,
      auditChainService: {
        appendManyInTransaction: async (_transaction, entries) => { auditEntries.push(...entries); },
      },
    });

    expect(result).toMatchObject({ status: 'RESET_TO_RECLOSE_COMPLETED', yearMonth: '2026-08' });
    expect(harness.documents.has('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toBe(false);
    expect(harness.documents.has('orgs/tenant-a/monthly_closes/project-a-2026-08')).toBe(false);
    expect(auditEntries[0]).toMatchObject({
      metadata: {
        before: {
          authority: { exists: true, value: invalidHead },
          monthlyClose: { exists: false, id: 'project-a-2026-08' },
        },
        after: { authority: { exists: false }, monthlyClose: { exists: false } },
      },
    });
  });

  it('treats an already absent authority and mutable header as reclose-ready without another destructive reset', async () => {
    const input = completeEvidence();
    input.monthlyCloses = [];
    input.heads = [];
    delete input.monthlyCloseVersions[0].data.sourceRevision;

    const [plan] = buildCumulativeCloseResetToReclosePlan({ tenantId: 'tenant-a', ...input });

    expect(plan).toMatchObject({
      projectId: 'project-a',
      status: 'RECLOSE_READY',
      expectedEvidence: null,
      cycleCandidates: [
        { yearMonth: '2026-08', monthlyCloseId: 'project-a-2026-08' },
      ],
    });
  });

  it('reports a server-scoped project with no authority, header, or immutable close evidence as writable without inventing a cycle', () => {
    const [plan] = buildCumulativeCloseResetToReclosePlan({
      tenantId: 'tenant-a',
      projectIds: ['project-a'],
      monthlyCloses: [],
      monthlyCloseVersions: [],
      requests: [],
      heads: [],
    });

    expect(plan).toMatchObject({
      projectId: 'project-a',
      status: 'RECLOSE_READY',
      monthlyCloseId: null,
      yearMonth: null,
      expectedEvidence: null,
      cycleCandidates: [],
    });
  });

  it('semantically replays a lost reset response after authority and header are already absent with zero duplicate audit', async () => {
    const input = completeEvidence();
    delete input.monthlyCloseVersions[0].data.sourceRevision;
    input.monthlyCloses[0].data = {
      tenantId: 'tenant-a', projectId: 'project-a', yearMonth: '2026-08',
      status: 'BROKEN', rawLegacyValue: 'header-before',
    };
    input.heads = [{
      id: 'project-a',
      data: {
        contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'tenant-a', projectId: 'project-a',
        status: 'CLOSED', fromMonth: '2023-01', closedThrough: 'broken', settlementMonth: 'broken',
        revision: 99, rootHash: 'broken', rawLegacyValue: 'head-before',
      },
    }];
    const [plan] = buildCumulativeCloseResetToReclosePlan({ tenantId: 'tenant-a', ...input });
    const evidence = firestoreEvidence(input);
    evidence['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'] = input.heads[0].data;
    const harness = fakeDb(evidence);
    const auditEntries = [];
    const command = {
      db: harness.db,
      tenantId: 'tenant-a',
      projectId: 'project-a',
      peopleUid: 'operator-uid',
      reason: '손상 authority와 header 격리',
      expectedEvidence: plan.expectedEvidence,
      auditChainService: {
        appendManyInTransaction: async (_transaction, entries) => { auditEntries.push(...entries); },
      },
    };

    await expect(applyCumulativeCloseResetToReclose(command))
      .resolves.toMatchObject({ status: 'RESET_TO_RECLOSE_COMPLETED', yearMonth: '2026-08' });
    await expect(applyCumulativeCloseResetToReclose(command))
      .resolves.toMatchObject({ status: 'RESET_TO_RECLOSE_REPLAYED', yearMonth: '2026-08' });
    expect(auditEntries).toHaveLength(1);
  });

  it('revalidates and executes the exact server-owned cycle selected from multiple immutable candidates', async () => {
    const input = completeEvidence();
    input.monthlyCloses = [];
    input.monthlyCloseVersions[0] = {
      id: 'project-a-2026-07-r1',
      data: {
        ...input.monthlyCloseVersions[0].data,
        yearMonth: '2026-07',
        sourceRevision: null,
      },
    };
    const invalidHead = {
      contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'tenant-a', projectId: 'project-a',
      status: 'CLOSED', fromMonth: '2023-01', closedThrough: 'broken', settlementMonth: 'broken',
      revision: 99, rootHash: 'broken',
    };
    input.heads = [{ id: 'project-a', data: invalidHead }];
    const [plan] = buildCumulativeCloseResetToReclosePlan({ tenantId: 'tenant-a', ...input });
    expect(plan).toMatchObject({
      status: 'RESET_CYCLE_SELECTION_REQUIRED',
      expectedEvidence: null,
      cycleCandidates: [
        { yearMonth: '2026-08', expectedEvidence: { yearMonth: '2026-08' } },
        { yearMonth: '2026-07', expectedEvidence: { yearMonth: '2026-07' } },
      ],
    });

    const evidence = firestoreEvidence(input);
    evidence['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'] = invalidHead;
    const harness = fakeDb(evidence);
    const auditEntries = [];
    const selected = plan.cycleCandidates.find((candidate) => candidate.yearMonth === '2026-08');

    await expect(applyCumulativeCloseResetToReclose({
      db: harness.db,
      tenantId: 'tenant-a',
      projectId: 'project-a',
      peopleUid: 'operator-uid',
      reason: '서버 후보 중 2026년 8월 회차 선택',
      expectedEvidence: selected.expectedEvidence,
      auditChainService: {
        appendManyInTransaction: async (_transaction, entries) => { auditEntries.push(...entries); },
      },
    })).resolves.toMatchObject({ status: 'RESET_TO_RECLOSE_COMPLETED', yearMonth: '2026-08' });
    expect(harness.documents.has('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toBe(false);
    expect(auditEntries).toHaveLength(1);
  });

  it('does not backfill a REOPEN_REQUESTED monthly run', () => {
    const input = completeEvidence();
    input.monthlyCloses[0].data.status = 'REOPEN_REQUESTED';

    expect(planFor(input)[0]).toMatchObject({
      status: 'UNREPAIRABLE',
      reasons: ['MONTHLY_CLOSE_NOT_CLOSED'],
    });
  });

  it('recognizes an exact existing head and makes a complete-evidence conflict explicitly repairable', () => {
    const ready = planFor()[0];
    const exactInput = completeEvidence();
    exactInput.heads = [{ id: 'project-a', data: ready.head }];
    expect(planFor(exactInput)[0].status).toBe('AUTHORITY_PRESENT');

    const conflictInput = completeEvidence();
    const conflictingHead = { ...ready.head, closedThrough: '2026-06', legacyField: 'preserve-in-audit' };
    conflictInput.heads = [{ id: 'project-a', data: conflictingHead }];
    expect(planFor(conflictInput)[0]).toMatchObject({
      status: 'REPAIR_READY',
      reasons: ['HEAD_CONFLICT'],
      head: ready.head,
      source: ready.source,
      expectedEvidence: {
        contractVersion: 'cashflow-cumulative-close-head-recovery-evidence-v1',
        authorityFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        monthlyCloseId: 'project-a-2026-08',
        monthlyCloseVersionId: 'project-a-2026-08-r1',
        requestId: 'project-a-2026-08',
      },
    });
  });

  it('rejects duplicate latest monthly runs instead of choosing one', () => {
    const input = completeEvidence();
    input.monthlyCloses.push({
      id: 'duplicate-project-a-2026-08',
      data: { ...input.monthlyCloses[0].data },
    });

    expect(planFor(input)[0]).toMatchObject({
      status: 'UNREPAIRABLE',
      reasons: ['LATEST_MONTHLY_CLOSE_AMBIGUOUS'],
    });
  });

  it('defaults to read-only and requires apply, a concrete project allowlist, People UID, and reason', () => {
    const dryRun = parseCumulativeCloseHeadMigrationArgs([]);
    expect(dryRun.apply).toBe(false);
    expect(() => validateCumulativeCloseHeadMigrationOptions(dryRun)).not.toThrow();

    expect(() => validateCumulativeCloseHeadMigrationOptions(
      parseCumulativeCloseHeadMigrationArgs(['--apply']),
    )).toThrow(/allow-projects/);
    expect(() => validateCumulativeCloseHeadMigrationOptions(
      parseCumulativeCloseHeadMigrationArgs(['--apply', '--allow-projects', '*', '--people-uid', 'person-uid', '--reason', '복구']),
    )).toThrow(/wildcard/i);
    expect(() => validateCumulativeCloseHeadMigrationOptions(
      parseCumulativeCloseHeadMigrationArgs(['--apply', '--allow-projects', 'project-a']),
    )).toThrow(/people-uid/);
    expect(() => validateCumulativeCloseHeadMigrationOptions(
      parseCumulativeCloseHeadMigrationArgs(['--apply', '--allow-projects', 'project-a', '--people-uid', 'person-uid']),
    )).toThrow(/reason/);

    expect(validateCumulativeCloseHeadMigrationOptions(parseCumulativeCloseHeadMigrationArgs([
      '--apply',
      '--allow-projects', 'project-a,project-b',
      '--people-uid', 'person-uid',
      '--reason', '승인된 기간 권한 복구',
    ]))).toMatchObject({
      apply: true,
      allowedProjectIds: ['project-a', 'project-b'],
      peopleUid: 'person-uid',
    });
  });

  it('does not open a transaction in the default dry-run path', async () => {
    const harness = fakeDb();
    const result = await executeCumulativeCloseHeadMigration({
      db: harness.db,
      plan: planFor(),
      options: parseCumulativeCloseHeadMigrationArgs([]),
    });

    expect(result).toEqual({ mode: 'DRY_RUN', applied: [], replayed: [] });
    expect(harness.transactionCount()).toBe(0);
  });

  it('rejects non-contract head fields before they can synthesize period data', async () => {
    const harness = fakeDb(firestoreEvidence());
    const options = validateCumulativeCloseHeadMigrationOptions(parseCumulativeCloseHeadMigrationArgs([
      '--apply', '--allow-projects', 'project-a', '--people-uid', 'operator-uid', '--reason', '권한 head 복구',
      '--tenant', 'tenant-a',
    ]));
    const plan = planFor();
    plan[0].head = {
      ...plan[0].head,
      periods: [{ yearMonth: '2023-01', amount: 0 }],
    };

    await expect(applyCumulativeCloseHeadPlan({
      db: harness.db,
      tenantId: 'tenant-a',
      plan,
      options,
      auditChainService: { appendManyInTransaction: vi.fn() },
    })).rejects.toThrow(/head contract invalid/i);
    expect(harness.transactionCount()).toBe(0);
    expect(harness.documents.has('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toBe(false);
  });

  it('creates the authority head and append-only People UID audit atomically, then replays idempotently', async () => {
    const harness = fakeDb(firestoreEvidence());
    const auditEntries = [];
    const auditChainService = {
      appendManyInTransaction: vi.fn(async (transaction, entries) => {
        auditEntries.push(...entries);
        for (const entry of entries) {
          transaction.create(
            harness.db.doc(`orgs/${entry.tenantId}/audit_logs/audit-${entry.entityId}`),
            entry,
          );
        }
      }),
    };
    const options = validateCumulativeCloseHeadMigrationOptions(parseCumulativeCloseHeadMigrationArgs([
      '--apply', '--allow-projects', 'project-a', '--people-uid', 'operator-uid', '--reason', '권한 head 복구',
      '--tenant', 'tenant-a',
    ]));
    const plan = planFor();

    const first = await applyCumulativeCloseHeadPlan({
      db: harness.db, tenantId: 'tenant-a', plan, options, auditChainService,
    });
    const replay = await applyCumulativeCloseHeadPlan({
      db: harness.db, tenantId: 'tenant-a', plan, options, auditChainService,
    });

    expect(first).toEqual({ mode: 'APPLY', applied: ['project-a'], replayed: [] });
    expect(replay).toEqual({ mode: 'APPLY', applied: [], replayed: ['project-a'] });
    expect(harness.documents.get('orgs/tenant-a/cashflow_cumulative_close_heads/project-a'))
      .toEqual(plan[0].head);
    expect(auditChainService.appendManyInTransaction).toHaveBeenCalledTimes(1);
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      entityType: 'cashflow_cumulative_close_head',
      entityId: 'project-a',
      action: 'CASHFLOW_CUMULATIVE_CLOSE_HEAD_BACKFILLED',
      actorId: 'operator-uid',
      actorRole: 'admin',
      metadata: {
        reason: '권한 head 복구',
        before: { exists: false },
        after: plan[0].head,
        sourceRevision: SOURCE_REVISION,
      },
    });
  });

  it('exactly repairs a conflicting head, preserves full before/after audit evidence, and replays without duplicate audit', async () => {
    const ready = planFor()[0];
    const conflictingHead = {
      ...ready.head,
      closedThrough: '2026-06',
      revision: 99,
      legacyField: 'must-remain-in-audit',
    };
    const input = completeEvidence();
    input.heads = [{ id: 'project-a', data: conflictingHead }];
    const plan = planFor(input);
    const evidence = firestoreEvidence(input);
    evidence['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'] = conflictingHead;
    const harness = fakeDb(evidence);
    const auditEntries = [];
    const auditChainService = {
      appendManyInTransaction: vi.fn(async (_transaction, entries) => {
        auditEntries.push(...entries);
      }),
    };
    const options = validateCumulativeCloseHeadMigrationOptions(parseCumulativeCloseHeadMigrationArgs([
      '--apply', '--allow-projects', 'project-a', '--people-uid', 'operator-uid', '--reason', '손상 authority 정확 복구',
      '--tenant', 'tenant-a',
    ]));

    const first = await applyCumulativeCloseHeadPlan({
      db: harness.db, tenantId: 'tenant-a', plan, options, auditChainService,
    });
    const replay = await applyCumulativeCloseHeadPlan({
      db: harness.db, tenantId: 'tenant-a', plan, options, auditChainService,
    });

    expect(first).toEqual({ mode: 'APPLY', applied: ['project-a'], replayed: [] });
    expect(replay).toEqual({ mode: 'APPLY', applied: [], replayed: ['project-a'] });
    expect(harness.documents.get('orgs/tenant-a/cashflow_cumulative_close_heads/project-a'))
      .toEqual(ready.head);
    expect(harness.documents.get('orgs/tenant-a/cashflow_cumulative_close_heads/project-a'))
      .not.toHaveProperty('legacyField');
    expect(auditChainService.appendManyInTransaction).toHaveBeenCalledTimes(1);
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      action: 'CASHFLOW_CUMULATIVE_CLOSE_HEAD_REPAIRED',
      actorId: 'operator-uid',
      metadata: {
        reason: '손상 authority 정확 복구',
        before: { exists: true, value: conflictingHead },
        after: ready.head,
        sourceRevision: SOURCE_REVISION,
      },
    });
  });

  it('atomically quarantines invalid authority and current mutable header for reclose without touching immutable evidence', async () => {
    const input = completeEvidence();
    delete input.monthlyCloseVersions[0].data.sourceRevision;
    const rawHeader = {
      tenantId: 'tenant-a', projectId: 'project-a', yearMonth: '2026-08',
      status: 'BROKEN', rawLegacyValue: 'header-before',
    };
    const invalidHead = {
      contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'tenant-a', projectId: 'project-a',
      status: 'CLOSED', fromMonth: '2023-01', closedThrough: 'broken', revision: 99,
      rootHash: 'broken', rawLegacyValue: 'head-before',
    };
    input.monthlyCloses[0].data = rawHeader;
    input.heads = [{ id: 'project-a', data: invalidHead }];
    const [plan] = buildCumulativeCloseResetToReclosePlan({ tenantId: 'tenant-a', ...input });
    const evidence = firestoreEvidence(input);
    evidence['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'] = invalidHead;
    const harness = fakeDb(evidence);
    const immutableBefore = {
      version: structuredClone(evidence['orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1']),
      request: structuredClone(evidence['orgs/tenant-a/cashflow_month_close_requests/project-a-2026-08']),
    };
    const auditEntries = [];

    const result = await applyCumulativeCloseResetToReclose({
      db: harness.db,
      tenantId: 'tenant-a',
      projectId: 'project-a',
      peopleUid: 'operator-uid',
      reason: '손상 권한을 격리하고 정상 재결산 준비',
      expectedEvidence: plan.expectedEvidence,
      auditChainService: {
        appendManyInTransaction: async (_transaction, entries) => { auditEntries.push(...entries); },
      },
    });

    expect(result).toMatchObject({ status: 'RESET_TO_RECLOSE_COMPLETED', projectId: 'project-a', yearMonth: '2026-08' });
    expect(harness.documents.has('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toBe(false);
    expect(harness.documents.has('orgs/tenant-a/monthly_closes/project-a-2026-08')).toBe(false);
    expect(harness.documents.get('orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1'))
      .toEqual(immutableBefore.version);
    expect(harness.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-08'))
      .toEqual(immutableBefore.request);
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      action: 'CASHFLOW_CUMULATIVE_CLOSE_RESET_TO_RECLOSE',
      actorId: 'operator-uid',
      metadata: {
        reason: '손상 권한을 격리하고 정상 재결산 준비',
        before: {
          authority: { exists: true, value: invalidHead },
          monthlyClose: { exists: true, id: 'project-a-2026-08', value: rawHeader },
        },
        after: {
          authority: { exists: false },
          monthlyClose: { exists: false },
        },
      },
    });
  });

  it('keeps the head absent when append-only audit creation fails', async () => {
    const harness = fakeDb(firestoreEvidence());
    const options = validateCumulativeCloseHeadMigrationOptions(parseCumulativeCloseHeadMigrationArgs([
      '--apply', '--allow-projects', 'project-a', '--people-uid', 'operator-uid', '--reason', '복구',
      '--tenant', 'tenant-a',
    ]));

    await expect(applyCumulativeCloseHeadPlan({
      db: harness.db,
      tenantId: 'tenant-a',
      plan: planFor(),
      options,
      auditChainService: {
        appendManyInTransaction: async () => { throw new Error('audit unavailable'); },
      },
    })).rejects.toThrow('audit unavailable');
    expect(harness.documents.has('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toBe(false);
  });

  it('aborts when canonical source evidence changes between dry-run planning and apply transaction', async () => {
    const input = completeEvidence();
    const plan = planFor(input);
    const evidence = firestoreEvidence(input);
    evidence['orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1'] = {
      ...evidence['orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1'],
      sourceRevision: `sha256:${'9'.repeat(64)}`,
    };
    const harness = fakeDb(evidence);
    const options = validateCumulativeCloseHeadMigrationOptions(parseCumulativeCloseHeadMigrationArgs([
      '--apply', '--allow-projects', 'project-a', '--people-uid', 'operator-uid', '--reason', '복구',
      '--tenant', 'tenant-a',
    ]));

    await expect(applyCumulativeCloseHeadPlan({
      db: harness.db,
      tenantId: 'tenant-a',
      plan,
      options,
      auditChainService: { appendManyInTransaction: vi.fn() },
    })).rejects.toThrow(/source evidence changed/i);
    expect(harness.documents.has('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toBe(false);
  });

  it.each([
    ['monthly close', (evidence) => {
      evidence['orgs/tenant-a/monthly_closes/project-a-2026-07'] =
        evidence['orgs/tenant-a/monthly_closes/project-a-2026-08'];
      delete evidence['orgs/tenant-a/monthly_closes/project-a-2026-08'];
    }],
    ['monthly close version', (evidence) => {
      evidence['orgs/tenant-a/monthly_close_versions/project-a-2026-07-r1'] =
        evidence['orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1'];
      evidence['orgs/tenant-a/monthly_closes/project-a-2026-08'] = {
        ...evidence['orgs/tenant-a/monthly_closes/project-a-2026-08'],
        latestVersionId: 'project-a-2026-07-r1',
      };
      delete evidence['orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1'];
    }],
    ['cumulative request', (evidence) => {
      const requestId = 'project-a-2026-07';
      evidence[`orgs/tenant-a/cashflow_month_close_requests/${requestId}`] = {
        ...evidence['orgs/tenant-a/cashflow_month_close_requests/project-a-2026-08'],
        requestId,
      };
      for (const path of [
        'orgs/tenant-a/monthly_closes/project-a-2026-08',
        'orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1',
      ]) {
        evidence[path] = {
          ...evidence[path],
          snapshot: { ...evidence[path].snapshot, requestId },
        };
      }
      delete evidence['orgs/tenant-a/cashflow_month_close_requests/project-a-2026-08'];
    }],
  ])('revalidates canonical %s document identity inside apply transaction before audit or head write', async (_label, mutate) => {
    const input = completeEvidence();
    const plan = planFor(input);
    const evidence = firestoreEvidence(input);
    mutate(evidence);
    const harness = fakeDb(evidence);
    const auditChainService = { appendManyInTransaction: vi.fn() };
    const options = validateCumulativeCloseHeadMigrationOptions(parseCumulativeCloseHeadMigrationArgs([
      '--apply', '--allow-projects', 'project-a', '--people-uid', 'operator-uid', '--reason', '복구',
      '--tenant', 'tenant-a',
    ]));

    await expect(applyCumulativeCloseHeadPlan({
      db: harness.db,
      tenantId: 'tenant-a',
      plan,
      options,
      auditChainService,
    })).rejects.toThrow(/source evidence changed/i);
    expect(harness.documents.has('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toBe(false);
    expect(auditChainService.appendManyInTransaction).not.toHaveBeenCalled();
  });

  it('integrates with the repository audit chain in the same transaction', async () => {
    const harness = fakeDb(firestoreEvidence());
    const pathsBeforeApply = new Set(harness.documents.keys());
    const options = validateCumulativeCloseHeadMigrationOptions(parseCumulativeCloseHeadMigrationArgs([
      '--apply', '--allow-projects', 'project-a', '--people-uid', 'operator-uid', '--reason', '승인 복구',
      '--tenant', 'tenant-a',
    ]));

    await applyCumulativeCloseHeadPlan({
      db: harness.db,
      tenantId: 'tenant-a',
      plan: planFor(),
      options,
      auditChainService: createAuditChainService(harness.db, { now: () => '2026-08-14T01:02:03.000Z' }),
    });

    const addedPaths = [...harness.documents.keys()].filter((path) => !pathsBeforeApply.has(path));
    const auditLogs = [...harness.documents.entries()]
      .filter(([path]) => path.startsWith('orgs/tenant-a/audit_logs/'))
      .map(([, value]) => value);
    expect(addedPaths).toHaveLength(3);
    expect(addedPaths).toContain('orgs/tenant-a/cashflow_cumulative_close_heads/project-a');
    expect(addedPaths).toContain('orgs/tenant-a/audit_chain/head');
    expect(addedPaths.filter((path) => path.startsWith('orgs/tenant-a/audit_logs/'))).toHaveLength(1);
    expect(addedPaths).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/\/(?:monthly_closes|monthly_close_versions|cashflow_month_close_requests|periods|amounts|shards)\//),
    ]));
    expect(addedPaths.every((path) => !path.includes('2023-01'))).toBe(true);
    expect(harness.documents.get('orgs/tenant-a/cashflow_cumulative_close_heads/project-a'))
      .toMatchObject({ fromMonth: '2023-01', closedThrough: '2026-07' });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      action: 'CASHFLOW_CUMULATIVE_CLOSE_HEAD_BACKFILLED',
      userId: 'operator-uid',
      userRole: 'admin',
      metadata: {
        reason: '승인 복구',
        before: { exists: false },
        sourceRevision: SOURCE_REVISION,
      },
      chainSeq: 1,
      hashAlg: 'sha256',
    });
    expect(harness.documents.get('orgs/tenant-a/audit_chain/head')).toMatchObject({ lastSeq: 1 });
  });

  it('accepts only one linked People UID with an ACTIVE runtime admin member record', async () => {
    const query = (docs) => ({
      where: () => ({ limit: () => ({ get: async () => ({ docs, size: docs.length }) }) }),
    });
    const db = {
      collection: () => query([{ id: 'person-1' }]),
      doc: () => ({
        get: async () => ({
          exists: true,
          data: () => ({ uid: 'operator-uid', status: 'ACTIVE', role: 'admin' }),
        }),
      }),
    };
    await expect(assertLinkedActivePeopleUid({
      db, tenantId: 'tenant-a', peopleUid: 'operator-uid',
    })).resolves.toEqual({ personId: 'person-1', peopleUid: 'operator-uid' });

    await expect(assertLinkedActivePeopleUid({
      db: { ...db, collection: () => query([{ id: 'person-1' }, { id: 'person-2' }]) },
      tenantId: 'tenant-a',
      peopleUid: 'operator-uid',
    })).rejects.toMatchObject({
      code: 'RUNTIME_SUPERADMIN_REQUIRED',
      message: expect.stringMatching(/exactly one People record/),
    });

    await expect(assertLinkedActivePeopleUid({
      db: {
        ...db,
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({ uid: 'operator-uid', status: 'ACTIVE', role: 'viewer' }),
          }),
        }),
      },
      tenantId: 'tenant-a',
      peopleUid: 'operator-uid',
    })).rejects.toMatchObject({
      code: 'RUNTIME_SUPERADMIN_REQUIRED',
      message: expect.stringMatching(/ACTIVE runtime admin member/),
    });
  });

  it('refuses an ACTIVE non-admin operator at the execute boundary without writing a head', async () => {
    const evidence = firestoreEvidence();
    evidence['orgs/tenant-a/members/operator-uid'] = {
      uid: 'operator-uid', status: 'ACTIVE', role: 'finance',
    };
    const harness = fakeDb(evidence);
    const auditChainService = { appendManyInTransaction: vi.fn() };
    const options = parseCumulativeCloseHeadMigrationArgs([
      '--apply', '--allow-projects', 'project-a', '--people-uid', 'operator-uid', '--reason', '복구',
      '--tenant', 'tenant-a',
    ]);

    await expect(executeCumulativeCloseHeadMigration({
      db: harness.db,
      tenantId: 'tenant-a',
      plan: planFor(),
      options,
      auditChainService,
    })).rejects.toThrow(/ACTIVE runtime admin member/);
    expect(harness.transactionCount()).toBe(1);
    expect(harness.documents.has('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toBe(false);
    expect(auditChainService.appendManyInTransaction).not.toHaveBeenCalled();
  });

  it('refuses allowlisted non-ready projects before any write', async () => {
    const input = completeEvidence();
    delete input.requests[0].data.throughMonth;
    const harness = fakeDb();
    const options = validateCumulativeCloseHeadMigrationOptions(parseCumulativeCloseHeadMigrationArgs([
      '--apply', '--allow-projects', 'project-a', '--people-uid', 'operator-uid', '--reason', '복구',
      '--tenant', 'tenant-a',
    ]));

    await expect(applyCumulativeCloseHeadPlan({
      db: harness.db,
      tenantId: 'tenant-a',
      plan: planFor(input),
      options,
      auditChainService: { appendManyInTransaction: vi.fn() },
    })).rejects.toThrow(/UNREPAIRABLE/);
    expect(harness.transactionCount()).toBe(0);
    expect(harness.documents.size).toBe(0);
  });
});
