#!/usr/bin/env node

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { settlementCycleRequestNormalizationCandidates } from '../server/bff/cashflow-settlement-cycle-rollout.mjs';
import { sha256, stableStringify } from '../server/bff/utils.mjs';

const TRANSITIONS = new Map([
  ['START:candidate_verified', 'CANDIDATE'],
  ['CANDIDATE:maintenance_aliased', 'MAINTENANCE'],
  ['MAINTENANCE:legacy_invocations_drained', 'DRAINED'],
  ['DRAINED:migration_started', 'MIGRATING'],
  ['MIGRATING:inventory_verified', 'MIGRATED'],
  ['MIGRATED:jvm_promoted', 'JVM_LIVE'],
  ['JVM_LIVE:final_web_aliased', 'COMPLETE'],
]);
const PHASES = new Set([
  'START', 'CANDIDATE', 'MAINTENANCE', 'DRAINED', 'MIGRATING', 'MIGRATED', 'JVM_LIVE', 'COMPLETE',
]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const AXR_ARCHIVE_REQUEST_ID = 'p1773817948751-2026-08';
const AXR_ARCHIVE_REVISION = 10;
const AXR_ARCHIVE_DATA_HASH = 'sha256:9a9b17f6cbc458076f305ffd9a2a6b6a980e216059e7576563a6023474762db6';
const EXPECTED_MIGRATION_PROJECTS = [
  'p1773817948751', 'p1776054335896', 'p1782702681869',
];
const EXPECTED_NORMALIZATION_PROJECTS = [
  'p1773817948751', 'p1775209262483', 'p1780662870530',
];
const EXPECTED_HISTORICAL_REQUESTS = [
  'p1773651024850-2026-08', 'p1773817948751-2026-08',
  'p1774869407448-2026-08', 'p1775040544761-2026-08',
  'p1775123221342-2026-08', 'p1775173797667-2026-08',
  'p1775182201215-2026-08', 'p1775182504320-2026-08',
  'p1775183713143-2026-08', 'p1775202100607-2026-08',
  'p1775209262483-2026-08', 'p1775710502280-2026-08',
  'p1778219766945-2026-08', 'p1780636846974-2026-08',
  'p1780662870530-2026-08', 'p1784700960534-2026-08',
];

function validState(state) {
  return state
    && typeof state === 'object'
    && !Array.isArray(state)
    && Object.keys(state).length === 1
    && PHASES.has(state.phase);
}

export function advanceCashflowSettlementCutover(state, event) {
  if (!validState(state) || typeof event !== 'string') {
    throw new Error('Invalid cutover transition input.');
  }
  const phase = TRANSITIONS.get(`${state.phase}:${event}`);
  if (!phase) throw new Error(`Invalid cutover transition: ${state.phase} -> ${event}`);
  return { phase };
}

export function resumeCashflowSettlementFinalWebCutover() {
  return { phase: 'JVM_LIVE' };
}

export function cashflowSettlementCutoverFailurePlan(state) {
  if (!validState(state)) throw new Error('Invalid cutover state.');
  const migrationStarted = ['MIGRATING', 'MIGRATED', 'JVM_LIVE'].includes(state.phase);
  return {
    restoreOriginalAlias: !migrationStarted && state.phase !== 'COMPLETE',
    keepMaintenance: migrationStarted && state.phase !== 'COMPLETE',
    rollbackJvm: !migrationStarted && state.phase !== 'COMPLETE',
  };
}

export function assertCashflowSettlementPreMigrationReady(summary) {
  const counts = summary?.counts?.before || summary?.counts;
  const blockers = [
    'invalidHeads', 'invalidActiveRequests', 'invalidCoordinators',
  ]
    .filter((name) => !Number.isSafeInteger(counts?.[name]) || counts[name] !== 0);
  if (blockers.length) throw new Error(`Settlement migration is blocked: ${blockers.join(', ')}`);
  return { ready: true };
}

function sortedUniqueIds(values) {
  const ids = values.map((value) => String(value || '').trim());
  if (ids.some((id) => !SAFE_ID.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error('Cutover inventory contains invalid or duplicate project IDs.');
  }
  return ids.sort();
}

export function buildCashflowSettlementCutoverPreflight(report) {
  if (report?.mode !== 'READ_ONLY') throw new Error('Cutover preflight must use a read-only audit report.');
  const inventory = report?.before;
  assertCashflowSettlementPreMigrationReady(inventory);
  const migrationCandidateProjects = sortedUniqueIds([
    ...(inventory?.legacyHeads || []).map(({ projectId }) => projectId),
    ...(inventory?.recoverableHeads || []).map(({ projectId }) => projectId),
  ]);
  if (stableStringify(migrationCandidateProjects) !== stableStringify(EXPECTED_MIGRATION_PROJECTS)) {
    throw new Error('Settlement head migration candidates do not match the approved projects.');
  }
  const normalizationRequests = settlementCycleRequestNormalizationCandidates(inventory);
  const completedNormalizations = normalizationRequests.filter(({ alreadyNormalized }) => alreadyNormalized);
  if (completedNormalizations.length !== (inventory?.canonicalActiveRequests || []).length) {
    throw new Error('Canonical active requests are not approved normalization records.');
  }
  const completedKeys = completedNormalizations.map((row) => (
    `${row.projectId}\n${row.cycleYearMonth}\n${row.requestId}\n${row.workflowRevision}`
  )).sort();
  const coordinatorKeys = (inventory?.activeCoordinatorRecords || []).map((row) => (
    `${row.projectId}\n${row.cycleYearMonth}\n${row.requestId}\n${row.workflowRevision}`
  )).sort();
  if (stableStringify(completedKeys) !== stableStringify(coordinatorKeys)) {
    throw new Error('Normalized active requests and coordinators do not match.');
  }
  const normalizationProjects = sortedUniqueIds(normalizationRequests.map(({ projectId }) => projectId));
  if (stableStringify(normalizationProjects) !== stableStringify(EXPECTED_NORMALIZATION_PROJECTS)) {
    throw new Error('Settlement request normalization candidates do not match the approved projects.');
  }
  const historicalRequestIds = sortedUniqueIds(
    (inventory?.historicalActiveRequests || []).map(({ requestId }) => requestId),
  );
  const archiveRequest = (inventory?.historicalActiveRequests || [])
    .find(({ requestId }) => requestId === AXR_ARCHIVE_REQUEST_ID);
  const archivedCanonicalRequest = (inventory?.canonicalState?.requests || []).find((request) => (
    request.documentId === AXR_ARCHIVE_REQUEST_ID
      && request.requestId === AXR_ARCHIVE_REQUEST_ID
      && request.documentType === 'REQUEST'
      && request.contractVersion === 'cashflow-cumulative-close-v2'
      && request.cycleYearMonth === '2026-08'
      && request.monthCloseTargetYearMonth === '2026-07'
      && request.status === 'APPROVED'
      && request.revision === 8
  ));
  const expectedHistoricalRequests = archiveRequest
    ? EXPECTED_HISTORICAL_REQUESTS
    : EXPECTED_HISTORICAL_REQUESTS.filter((requestId) => requestId !== AXR_ARCHIVE_REQUEST_ID);
  if (stableStringify(historicalRequestIds) !== stableStringify(expectedHistoricalRequests)
    || (!archiveRequest && !archivedCanonicalRequest)) {
    throw new Error('Historical active requests do not match the approved read-only records.');
  }
  if (archiveRequest && (archiveRequest.revision !== AXR_ARCHIVE_REVISION
    || archiveRequest.dataHash !== AXR_ARCHIVE_DATA_HASH)) {
    throw new Error('AXR historical request archive evidence is invalid.');
  }
  const settlements = inventory?.canonicalState?.settlements;
  if (!Array.isArray(settlements)) throw new Error('Cutover inventory is missing settlement status data.');
  const protectedCompletedMonthProjects = sortedUniqueIds([...new Set(settlements
    .filter(({ month }) => month?.status === 'COMPLETED')
    .map(({ projectId }) => projectId))]);
  if (migrationCandidateProjects.some((projectId) => !protectedCompletedMonthProjects.includes(projectId))) {
    throw new Error('Migration candidates must be protected completed MONTH projects.');
  }
  const protectedStatusDocumentCount = inventory?.protectedSettlementStatuses?.length;
  if (!Number.isSafeInteger(protectedStatusDocumentCount) || protectedStatusDocumentCount < 1) {
    throw new Error('Protected settlement status inventory is invalid.');
  }
  return {
    migrationCandidateProjects,
    normalizationProjects,
    normalizationRequests: normalizationRequests.map((row) => ({
      projectId: row.projectId,
      requestId: row.requestId,
      requestedAt: row.requestedAt,
      requestedByUid: row.requestedByUid,
      alreadyNormalized: row.alreadyNormalized === true,
    })),
    historicalRequestIds,
    archiveRequest: {
      projectId: 'p1773817948751',
      requestId: AXR_ARCHIVE_REQUEST_ID,
      revision: AXR_ARCHIVE_REVISION,
      dataHash: AXR_ARCHIVE_DATA_HASH,
    },
    protectedCompletedMonthProjects,
    protectedStatusDocumentCount,
    inventoryFingerprint: `sha256:${sha256(stableStringify(inventory))}`,
  };
}

export function assertCashflowSettlementCutoverPreflightUnchanged(expected, report) {
  const actual = buildCashflowSettlementCutoverPreflight(report);
  if (stableStringify(expected) !== stableStringify(actual)) {
    throw new Error('Settlement cutover inventory changed before migration.');
  }
  return { unchanged: true, ...actual };
}

export function vercelMutationDrainSeconds(configuration) {
  const seconds = configuration?.functions?.['api/bff.js']?.maxDuration;
  if (seconds !== 300) throw new Error('Vercel BFF maxDuration must remain exactly 300 seconds for cutover drain.');
  return seconds;
}

function documentRecord(document) {
  const seconds = Number(document?.updateTime?.seconds ?? document?.updateTime?._seconds);
  const nanoseconds = Number(document?.updateTime?.nanoseconds ?? document?.updateTime?._nanoseconds);
  if (!document?.id || !Number.isSafeInteger(seconds) || !Number.isSafeInteger(nanoseconds)) {
    throw new Error('Protected Firestore document metadata is invalid.');
  }
  const data = document.data();
  return {
    id: document.id,
    dataHash: `sha256:${sha256(stableStringify(data))}`,
    updateTime: { seconds, nanoseconds },
  };
}

function normalizationStatusRecord(document, request) {
  const { projectId, requestedAt, requestedByUid } = request;
  if (!document) {
    return { id: `${projectId}-2026-09`, exists: false, alreadyNormalized: request.alreadyNormalized === true };
  }
  const data = document.data();
  const periods = data?.periods && typeof data.periods === 'object' ? { ...data.periods } : {};
  const month = periods.MONTH;
  delete periods.MONTH;
  const { updatedAt: _updatedAt, ...rest } = data;
  const canonicalMonth = month && typeof month === 'object'
    && stableStringify(Object.keys(month).sort()) === stableStringify([
      'approvedAt', 'approvedBy', 'revision', 'status', 'submittedAt', 'submittedBy',
    ])
    && month.status === 'SUBMITTED'
    && month.revision === 1
    && month.submittedAt === requestedAt
    && month.submittedBy === requestedByUid
    && month.approvedAt === ''
    && month.approvedBy === '';
  return {
    id: document.id,
    exists: true,
    alreadyNormalized: request.alreadyNormalized === true,
    hasMonth: Boolean(month),
    dataWithoutMonthHash: `sha256:${sha256(stableStringify({ ...rest, periods }))}`,
    canonicalMonth,
    canonicalNewDocument: stableStringify(Object.keys(data).sort()) === stableStringify([
      'periods', 'projectId', 'tenantId', 'updatedAt', 'yearMonth',
    ]) && data.projectId === projectId && data.yearMonth === '2026-09'
      && stableStringify(Object.keys(data.periods || {})) === '["MONTH"]',
  };
}

export function buildProtectedCashflowSnapshot({
  statuses = [], completions = [], versions = [], normalizationRequests = [],
  archiveSource = null, archiveDocument = null, archiveRequest = null,
}) {
  const completedProjects = [...new Set(statuses
    .filter((document) => document.data()?.periods?.MONTH?.status === 'COMPLETED')
    .map((document) => String(document.data()?.projectId || '').trim())
    .filter(Boolean))].sort();
  const normalize = (documents) => documents.map(documentRecord)
    .sort((left, right) => left.id.localeCompare(right.id));
  const projects = sortedUniqueIds(normalizationRequests.map(({ projectId }) => projectId));
  const normalizationIds = new Set(projects.map((projectId) => `${projectId}-2026-09`));
  const statusesById = new Map(statuses.map((document) => [document.id, document]));
  return {
    completedMonthProjects: completedProjects,
    settlementStatuses: normalize(statuses.filter(({ id }) => !normalizationIds.has(id))),
    normalizationStatuses: normalizationRequests.map((request) => normalizationStatusRecord(
      statusesById.get(`${request.projectId}-2026-09`), request,
    )),
    migrationArchive: archiveRequest ? {
      requestId: archiveRequest.requestId,
      revision: archiveRequest.revision,
      expectedDataHash: archiveRequest.dataHash,
      source: archiveSource?.exists ? documentRecord(archiveSource) : null,
      archive: archiveDocument?.exists ? documentRecord(archiveDocument) : null,
    } : null,
    weeklyCompletions: normalize(completions),
    weeklyCompletionVersions: normalize(versions),
  };
}

export function assertProtectedCashflowSnapshotUnchanged(before, after) {
  const archive = before?.migrationArchive;
  const archiveInvalid = archive && (
    archive.requestId !== AXR_ARCHIVE_REQUEST_ID
    || (archive.archive
      ? archive.archive.dataHash !== archive.expectedDataHash
      : archive.source?.dataHash !== archive.expectedDataHash)
  );
  if (archiveInvalid || stableStringify(before) !== stableStringify(after)) {
    throw new Error('Protected settlement or weekly completion documents changed during cutover.');
  }
  return { unchanged: true, fingerprint: `sha256:${sha256(stableStringify(before))}` };
}

export function assertProtectedCashflowSnapshotAfterNormalization(before, after) {
  const protectedBefore = {
    ...before,
    normalizationStatuses: undefined,
    migrationArchive: undefined,
  };
  const protectedAfter = {
    ...after,
    normalizationStatuses: undefined,
    migrationArchive: undefined,
  };
  const initial = before?.normalizationStatuses || [];
  const current = new Map((after?.normalizationStatuses || []).map((record) => [record.id, record]));
  const existingIds = initial.filter(({ exists }) => exists).map(({ id }) => id);
  const normalizationInvalid = initial.length !== 3
    || !existingIds.includes('p1773817948751-2026-09')
    || initial.some((record) => (record.alreadyNormalized
      ? !record.exists || !record.canonicalMonth
      : record.exists && record.hasMonth))
    || initial.some((record) => {
      const value = current.get(record.id);
      return !value?.exists || !value.canonicalMonth
        || (record.exists
          ? value.dataWithoutMonthHash !== record.dataWithoutMonthHash
          : !value.canonicalNewDocument);
    });
  const archiveBefore = before?.migrationArchive;
  const archiveAfter = after?.migrationArchive;
  const archiveInvalid = !archiveBefore
    || archiveBefore.requestId !== AXR_ARCHIVE_REQUEST_ID
    || (archiveBefore.archive
      ? archiveBefore.archive.dataHash !== archiveBefore.expectedDataHash
      : archiveBefore.source?.dataHash !== archiveBefore.expectedDataHash)
    || archiveAfter?.requestId !== archiveBefore.requestId
    || archiveAfter?.revision !== archiveBefore.revision
    || archiveAfter?.expectedDataHash !== archiveBefore.expectedDataHash
    || archiveAfter?.archive?.dataHash !== archiveBefore.expectedDataHash
    || (archiveBefore.archive
      && stableStringify(archiveBefore.archive) !== stableStringify(archiveAfter.archive));
  if (normalizationInvalid || archiveInvalid
    || stableStringify(protectedBefore) !== stableStringify(protectedAfter)) {
    throw new Error('Protected settlement or weekly completion documents changed during cutover.');
  }
  return { unchanged: true, fingerprint: `sha256:${sha256(stableStringify(before))}` };
}

function writeJson(path, state) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function readState(path) {
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (!validState(state)) throw new Error('Invalid cutover state file.');
  return state;
}

async function waitForVercelMutationDrain(configurationPath) {
  const seconds = vercelMutationDrainSeconds(JSON.parse(readFileSync(configurationPath, 'utf8')));
  for (let remaining = seconds; remaining > 0; remaining -= 30) {
    process.stderr.write(`Waiting for pre-maintenance Vercel invocations: ${remaining}s remaining.\n`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(30, remaining) * 1_000));
  }
  return { drained: true, seconds };
}

async function readProtectedCashflowSnapshot(firebaseProjectId, tenantId, plan) {
  if (!SAFE_ID.test(firebaseProjectId) || !SAFE_ID.test(tenantId)) {
    throw new Error('Exact Firebase project and tenant IDs are required.');
  }
  const { createFirestoreDb } = await import('../server/bff/firestore.mjs');
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const base = `orgs/${tenantId}`;
  const archiveRequest = plan?.archiveRequest;
  if (!archiveRequest || !SAFE_ID.test(archiveRequest.requestId)
    || !Number.isSafeInteger(archiveRequest.revision) || !SHA256.test(archiveRequest.dataHash)) {
    throw new Error('Frozen AXR archive request is invalid.');
  }
  const sourceRef = db.doc(`${base}/cashflow_month_close_requests/${archiveRequest.requestId}`);
  const archiveRef = db.doc(
    `${sourceRef.path}/migration_archives/stale-r${archiveRequest.revision}`,
  );
  const snapshots = await db.runTransaction((transaction) => Promise.all([
    'cashflow_settlement_statuses',
    'cashflow_weekly_update_completions',
    'cashflow_weekly_update_completion_versions',
  ].map((collection) => transaction.get(db.collection(`${base}/${collection}`))).concat([
    transaction.get(sourceRef),
    transaction.get(archiveRef),
  ])), { readOnly: true });
  return buildProtectedCashflowSnapshot({
    statuses: snapshots[0].docs,
    completions: snapshots[1].docs,
    versions: snapshots[2].docs,
    normalizationRequests: plan.normalizationRequests,
    archiveSource: snapshots[3],
    archiveDocument: snapshots[4],
    archiveRequest,
  });
}

async function main(args) {
  const [command, first, second, third, fourth] = args;
  if (!first) throw new Error('Cutover command path is required.');
  if (command === 'init' && second === undefined) {
    const state = { phase: 'START' };
    writeJson(first, state);
    return state;
  } if (command === 'resume-final-web' && second === undefined) {
    const state = resumeCashflowSettlementFinalWebCutover();
    writeJson(first, state);
    return state;
  } if (command === 'advance' && second && third === undefined) {
    const state = advanceCashflowSettlementCutover(readState(first), second);
    writeJson(first, state);
    return state;
  } if (command === 'failure-plan' && second === undefined) {
    return cashflowSettlementCutoverFailurePlan(readState(first));
  } if (command === 'freeze-preflight' && second && third === undefined) {
    const preflight = buildCashflowSettlementCutoverPreflight(JSON.parse(readFileSync(first, 'utf8')));
    writeJson(second, preflight);
    return preflight;
  } if (command === 'verify-preflight' && second && third === undefined) {
    const expected = JSON.parse(readFileSync(first, 'utf8'));
    const report = JSON.parse(readFileSync(second, 'utf8'));
    return assertCashflowSettlementCutoverPreflightUnchanged(expected, report);
  } if (command === 'wait-vercel-drain' && second === undefined) {
    return waitForVercelMutationDrain(first);
  } if (command === 'capture-protected' && second && third && fourth) {
    const plan = JSON.parse(readFileSync(fourth, 'utf8'));
    const snapshot = await readProtectedCashflowSnapshot(first, second, plan);
    writeJson(third, snapshot);
    return assertProtectedCashflowSnapshotUnchanged(snapshot, snapshot);
  } if (command === 'verify-protected' && second && third && fourth) {
    const plan = JSON.parse(readFileSync(fourth, 'utf8'));
    const before = JSON.parse(readFileSync(third, 'utf8'));
    const after = await readProtectedCashflowSnapshot(first, second, plan);
    return assertProtectedCashflowSnapshotAfterNormalization(before, after);
  }
  throw new Error('Invalid cashflow settlement cutover command.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(`${JSON.stringify(await main(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stderr.write(`${error?.message || String(error)}\n`);
    process.exitCode = 1;
  }
}
