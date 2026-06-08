import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertApplyAllowed,
  assertPlanAllowedForApply,
  computeJsonlSha,
  dedupeRecordsForRestore,
  filterRecords,
  loadBackupFromDir,
  parseArgs,
  parseGsUri,
  rewriteRecordForTarget,
  rewriteTenantPath,
  safeReportSegment,
  restorePayloadForRecord,
  sha256,
  stableStringify,
  summarizePlan,
} from './restore_project_sheet_backups.mjs';

async function createBackupFixture(records) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'innerplatform-restore-test-'));
  const backupRunId = 'backup_mysc_20260601T105613Z_unknown';
  const jsonlPath = path.join(dir, 'inner-platform-project-backup-mysc-p1-20260601T105613Z-unknown.jsonl');
  const manifestPath = path.join(dir, 'inner-platform-project-backup-mysc-p1-20260601T105613Z-unknown.manifest.json');
  const normalized = records.map((record) => ({
    backupRunId,
    백업ID: backupRunId,
    조직ID: 'mysc',
    사업ID: 'p1',
    컬렉션: 'projects',
    문서경로: 'orgs/mysc/projects/p1',
    문서ID: 'p1',
    JSON해시: sha256(stableStringify(record.data)),
    ...record,
  }));
  await fs.writeFile(jsonlPath, `${normalized.map((record) => JSON.stringify(record)).join('\n')}\n`);
  await fs.writeFile(manifestPath, JSON.stringify({
    backupRunId,
    tenantId: 'mysc',
    projectId: 'p1',
    documentCount: normalized.length,
    jsonlSha256: computeJsonlSha(normalized),
  }, null, 2));
  return { dir, backupRunId, records: normalized };
}

test('parseGsUri accepts backup prefixes', () => {
  assert.deepEqual(parseGsUri('gs://bucket/a/b/c'), {
    bucket: 'bucket',
    prefix: 'a/b/c',
  });
  assert.throws(() => parseGsUri('https://example.com'), /Invalid GCS URI/);
});

test('safeReportSegment keeps restore reports target-scoped', () => {
  assert.equal(safeReportSegment('(default)'), 'default');
  assert.equal(safeReportSegment('inner-platform-qa-20260310'), 'inner-platform-qa-20260310');
  assert.equal(safeReportSegment('mysc/restore full'), 'mysc_restore_full');
});

test('loadBackupFromDir validates manifest and record hashes', async () => {
  const fixture = await createBackupFixture([
    { data: { id: 'p1', name: '테스트사업', nested: { b: 2, a: 1 } } },
  ]);
  try {
    const loaded = await loadBackupFromDir(fixture.dir, 'mysc');
    assert.equal(loaded.backupRunId, fixture.backupRunId);
    assert.equal(loaded.records.length, 1);
    assert.equal(loaded.records[0].문서경로, 'orgs/mysc/projects/p1');
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('loadBackupFromDir rejects out-of-tenant records', async () => {
  const fixture = await createBackupFixture([
    {
      문서경로: 'orgs/other/projects/p1',
      data: { id: 'p1', name: 'wrong tenant' },
    },
  ]);
  try {
    await assert.rejects(() => loadBackupFromDir(fixture.dir, 'mysc'), /Refusing out-of-tenant/);
  } finally {
    await fs.rm(fixture.dir, { recursive: true, force: true });
  }
});

test('filterRecords narrows by project collection and document path', () => {
  const records = [
    { 사업ID: 'p1', 컬렉션: 'projects', 문서경로: 'orgs/mysc/projects/p1' },
    { 사업ID: 'p2', 컬렉션: 'transactions', 문서경로: 'orgs/mysc/transactions/t1' },
  ];
  const args = parseArgs(['--project', 'p2', '--collection', 'transactions']);
  assert.deepEqual(filterRecords(records, args), [records[1]]);
  const docArgs = parseArgs(['--doc-path', 'orgs/mysc/projects/p1']);
  assert.deepEqual(filterRecords(records, docArgs), [records[0]]);
});

test('rewriteRecordForTarget restores into an isolated target tenant path', () => {
  assert.equal(
    rewriteTenantPath('orgs/mysc/projects/p1', 'mysc', 'mysc-restore'),
    'orgs/mysc-restore/projects/p1',
  );
  assert.equal(
    rewriteTenantPath('tenants/mysc/settings/default', 'mysc', 'mysc-restore'),
    'tenants/mysc-restore/settings/default',
  );
  assert.equal(
    rewriteTenantPath('orgs/other/projects/p1', 'mysc', 'mysc-restore'),
    'orgs/other/projects/p1',
  );

  const record = rewriteRecordForTarget({
    문서경로: 'orgs/mysc/projects/p1/expense_sheets/s1',
    조직ID: 'mysc',
    data: {
      tenantId: 'mysc',
      orgId: 'mysc',
      projectPath: 'orgs/mysc/projects/p1',
      untouched: 'mysc',
    },
    firestoreData: {
      ownerRef: { __firestoreType: 'reference', path: 'orgs/mysc/members/u1' },
    },
  }, { tenantId: 'mysc', targetTenantId: 'mysc-restore' });

  assert.equal(record.sourceDocPath, 'orgs/mysc/projects/p1/expense_sheets/s1');
  assert.equal(record.targetDocPath, 'orgs/mysc-restore/projects/p1/expense_sheets/s1');
  assert.equal(record.targetData.tenantId, 'mysc-restore');
  assert.equal(record.targetData.orgId, 'mysc-restore');
  assert.equal(record.targetData.projectPath, 'orgs/mysc-restore/projects/p1');
  assert.equal(record.targetData.untouched, 'mysc');
  assert.equal(record.targetFirestoreData.ownerRef.path, 'orgs/mysc-restore/members/u1');
});

test('restorePayloadForRecord uses rewritten target tenant references', () => {
  const refs = [];
  const fakeDb = {
    doc(pathValue) {
      refs.push(pathValue);
      return { path: pathValue, isRef: true };
    },
  };
  const record = rewriteRecordForTarget({
    문서경로: 'orgs/mysc/projects/p1',
    data: { tenantId: 'mysc' },
    firestoreData: {
      tenantId: 'mysc',
      ownerRef: { __firestoreType: 'reference', path: 'orgs/mysc/members/u1' },
    },
  }, { tenantId: 'mysc', targetTenantId: 'mysc-restore' });
  const payload = restorePayloadForRecord(record, fakeDb);
  assert.equal(payload.tenantId, 'mysc-restore');
  assert.equal(payload.ownerRef.isRef, true);
  assert.deepEqual(refs, ['orgs/mysc-restore/members/u1']);
});

test('dedupeRecordsForRestore collapses identical target docs and rejects conflicting duplicates', () => {
  const first = {
    문서경로: 'orgs/mysc/projects/p1',
    sourceDocPath: 'orgs/mysc/projects/p1',
    targetDocPath: 'orgs/mysc-restore/projects/p1',
    data: { id: 'p1', tenantId: 'mysc-restore' },
    targetData: { id: 'p1', tenantId: 'mysc-restore' },
  };
  const identical = {
    ...first,
    sourceDocPath: 'orgs/mysc/projects/p1-duplicate-source',
  };
  const deduped = dedupeRecordsForRestore([first, identical]);
  assert.equal(deduped.records.length, 1);
  assert.equal(deduped.duplicateCount, 1);
  assert.equal(deduped.records[0], first);

  assert.throws(() => dedupeRecordsForRestore([
    first,
    { ...identical, targetData: { id: 'p1', tenantId: 'mysc-restore', changed: true } },
  ]), /Conflicting duplicate target document/);
});

test('assertApplyAllowed requires explicit confirmations', () => {
  const args = parseArgs(['--apply', '--target-project', 'prod']);
  assert.throws(
    () => assertApplyAllowed(args, 'backup_mysc_1', 1),
    /--confirm-backup-run-id backup_mysc_1/,
  );

  const confirmed = parseArgs([
    '--apply',
    '--target-project', 'prod',
    '--target-database', 'restore-rehearsal',
    '--confirm-backup-run-id', 'backup_mysc_1',
    '--confirm-target-project', 'prod',
    '--restore-all',
  ]);
  assert.doesNotThrow(() => assertApplyAllowed(confirmed, 'backup_mysc_1', 1));

  const defaultDb = parseArgs([
    '--apply',
    '--target-project', 'prod',
    '--confirm-backup-run-id', 'backup_mysc_1',
    '--confirm-target-project', 'prod',
    '--restore-all',
  ]);
  assert.throws(() => assertApplyAllowed(defaultDb, 'backup_mysc_1', 1), /--allow-default-database/);

  const qaDefaultDb = parseArgs([
    '--apply',
    '--target-project', 'qa',
    '--confirm-backup-run-id', 'backup_mysc_1',
    '--confirm-target-project', 'qa',
    '--restore-all',
    '--allow-default-database',
  ]);
  assert.doesNotThrow(() => assertApplyAllowed(qaDefaultDb, 'backup_mysc_1', 1));
});

test('assertPlanAllowedForApply is create-only by default', () => {
  const args = parseArgs([
    '--apply',
    '--target-project', 'prod',
    '--target-database', 'restore-rehearsal',
    '--confirm-backup-run-id', 'backup_mysc_1',
    '--confirm-target-project', 'prod',
    '--restore-all',
  ]);
  assert.doesNotThrow(() => assertPlanAllowedForApply(args, [
    { action: 'create', docPath: 'orgs/mysc/projects/p1' },
  ]));
  assert.throws(() => assertPlanAllowedForApply(args, [
    { action: 'skip-identical', docPath: 'orgs/mysc/projects/p1' },
  ]), /target already contains 1 selected document/);
  assert.throws(() => assertPlanAllowedForApply(args, [
    { action: 'overwrite', docPath: 'orgs/mysc/projects/p1' },
  ]), /target already contains 1 selected document/);
});

test('assertPlanAllowedForApply separates identical from overwrite permission', () => {
  const identicalAllowed = parseArgs([
    '--apply',
    '--target-project', 'prod',
    '--target-database', 'restore-rehearsal',
    '--confirm-backup-run-id', 'backup_mysc_1',
    '--confirm-target-project', 'prod',
    '--restore-all',
    '--allow-existing-target-data',
  ]);
  assert.doesNotThrow(() => assertPlanAllowedForApply(identicalAllowed, [
    { action: 'skip-identical', docPath: 'orgs/mysc/projects/p1' },
  ]));
  assert.throws(() => assertPlanAllowedForApply(identicalAllowed, [
    { action: 'overwrite', docPath: 'orgs/mysc/projects/p1' },
  ]), /would be overwritten/);

  const overwriteAllowed = parseArgs([
    '--apply',
    '--target-project', 'prod',
    '--target-database', 'restore-rehearsal',
    '--confirm-backup-run-id', 'backup_mysc_1',
    '--confirm-target-project', 'prod',
    '--restore-all',
    '--allow-overwrite',
  ]);
  assert.doesNotThrow(() => assertPlanAllowedForApply(overwriteAllowed, [
    { action: 'overwrite', docPath: 'orgs/mysc/projects/p1' },
  ]));
});


test('summarizePlan groups actions and collections', () => {
  assert.deepEqual(summarizePlan([
    { action: 'create', collection: 'projects' },
    { action: 'create', collection: 'projects' },
    { action: 'overwrite', collection: 'transactions' },
  ]), {
    total: 3,
    byAction: { create: 2, overwrite: 1 },
    byCollection: { projects: 2, transactions: 1 },
  });
});

test('restorePayloadForRecord prefers Firestore typed payloads', () => {
  const refs = [];
  const fakeDb = {
    doc(pathValue) {
      refs.push(pathValue);
      return { path: pathValue, isRef: true };
    },
  };
  const payload = restorePayloadForRecord({
    data: { createdAt: '2026-06-01T00:00:00.000Z' },
    firestoreData: {
      createdAt: { __firestoreType: 'timestamp', value: '2026-06-01T00:00:00.000Z' },
      ownerRef: { __firestoreType: 'reference', path: 'orgs/mysc/members/u1' },
      location: { __firestoreType: 'geoPoint', latitude: 37.5, longitude: 127.0 },
      bytes: { __firestoreType: 'bytes', base64: Buffer.from('abc').toString('base64') },
    },
  }, fakeDb);
  assert.equal(payload.createdAt.toDate().toISOString(), '2026-06-01T00:00:00.000Z');
  assert.deepEqual(refs, ['orgs/mysc/members/u1']);
  assert.equal(payload.ownerRef.isRef, true);
  assert.equal(payload.location.latitude, 37.5);
  assert.equal(payload.bytes.toString('utf8'), 'abc');
});
