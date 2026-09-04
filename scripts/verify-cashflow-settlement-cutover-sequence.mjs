#!/usr/bin/env node

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
const EXPECTED_MIGRATION_CANDIDATES = 12;
const EXPECTED_COMPLETED_MONTH_PROJECTS = 12;
const EXPECTED_PROTECTED_STATUS_DOCUMENTS = 78;

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
    'invalidHeads', 'unresolvedRequests', 'legacyActiveRequests',
    'activeCoordinators', 'invalidCoordinators',
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
  if (migrationCandidateProjects.length !== EXPECTED_MIGRATION_CANDIDATES) {
    throw new Error(`Expected ${EXPECTED_MIGRATION_CANDIDATES} migration candidates, found ${migrationCandidateProjects.length}.`);
  }
  const settlements = inventory?.canonicalState?.settlements;
  if (!Array.isArray(settlements)) throw new Error('Cutover inventory is missing settlement status data.');
  const protectedCompletedMonthProjects = sortedUniqueIds([...new Set(settlements
    .filter(({ month }) => month?.status === 'COMPLETED')
    .map(({ projectId }) => projectId))]);
  if (protectedCompletedMonthProjects.length !== EXPECTED_COMPLETED_MONTH_PROJECTS) {
    throw new Error(`Expected ${EXPECTED_COMPLETED_MONTH_PROJECTS} completed MONTH projects, found ${protectedCompletedMonthProjects.length}.`);
  }
  if (stableStringify(migrationCandidateProjects) !== stableStringify(protectedCompletedMonthProjects)) {
    throw new Error('Migration candidates must exactly match the protected completed MONTH projects.');
  }
  const protectedStatusDocumentCount = inventory?.protectedSettlementStatuses?.length;
  if (protectedStatusDocumentCount !== EXPECTED_PROTECTED_STATUS_DOCUMENTS) {
    throw new Error(`Expected ${EXPECTED_PROTECTED_STATUS_DOCUMENTS} protected settlement status documents, found ${protectedStatusDocumentCount}.`);
  }
  return {
    migrationCandidateProjects,
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

export function buildProtectedCashflowSnapshot({ statuses = [], completions = [], versions = [] }) {
  const completedProjects = [...new Set(statuses
    .filter((document) => document.data()?.periods?.MONTH?.status === 'COMPLETED')
    .map((document) => String(document.data()?.projectId || '').trim())
    .filter(Boolean))].sort();
  if (completedProjects.length !== 12) {
    throw new Error(`Expected 12 completed MONTH projects, found ${completedProjects.length}.`);
  }
  const normalize = (documents) => documents.map(documentRecord)
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    completedMonthProjects: completedProjects,
    settlementStatuses: normalize(statuses),
    weeklyCompletions: normalize(completions),
    weeklyCompletionVersions: normalize(versions),
  };
}

export function assertProtectedCashflowSnapshotUnchanged(before, after) {
  if (stableStringify(before) !== stableStringify(after)) {
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

async function readProtectedCashflowSnapshot(firebaseProjectId, tenantId) {
  if (!SAFE_ID.test(firebaseProjectId) || !SAFE_ID.test(tenantId)) {
    throw new Error('Exact Firebase project and tenant IDs are required.');
  }
  const { createFirestoreDb } = await import('../server/bff/firestore.mjs');
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const base = `orgs/${tenantId}`;
  const snapshots = await db.runTransaction((transaction) => Promise.all([
    'cashflow_settlement_statuses',
    'cashflow_weekly_update_completions',
    'cashflow_weekly_update_completion_versions',
  ].map((collection) => transaction.get(db.collection(`${base}/${collection}`)))), { readOnly: true });
  return buildProtectedCashflowSnapshot({
    statuses: snapshots[0].docs,
    completions: snapshots[1].docs,
    versions: snapshots[2].docs,
  });
}

async function main(args) {
  const [command, first, second, third] = args;
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
  } if (command === 'capture-protected' && second && third) {
    const snapshot = await readProtectedCashflowSnapshot(first, second);
    writeJson(third, snapshot);
    return assertProtectedCashflowSnapshotUnchanged(snapshot, snapshot);
  } if (command === 'verify-protected' && second && third) {
    const before = JSON.parse(readFileSync(third, 'utf8'));
    const after = await readProtectedCashflowSnapshot(first, second);
    return assertProtectedCashflowSnapshotUnchanged(before, after);
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
