const CUMULATIVE_CONTRACT = 'cashflow-cumulative-close-v2';
const MONTH_CLOSE_CONTRACT = 'cashflow-month-close-v1';
// Must match the canonical JVM cumulative-close contract. The migration never accepts an
// arbitrary request start month and therefore cannot create a head the JVM itself would not write.
const CUMULATIVE_BASELINE = '2023-01';
const YEAR_MONTH_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
import { sha256, stableStringify } from './utils.mjs';
import { readCashflowCumulativeCloseAuthority } from './cashflow-close-calendar.mjs';

const RECOVERY_EVIDENCE_CONTRACT = 'cashflow-cumulative-close-head-recovery-evidence-v1';
const RESET_TO_RECLOSE_EVIDENCE_CONTRACT = 'cashflow-cumulative-close-reset-to-reclose-evidence-v1';
const RECOVERY_EVIDENCE_QUERY_LIMIT = 250;
const WRITABLE_PLAN_STATUSES = new Set(['READY', 'REPAIR_READY', 'AUTHORITY_PRESENT']);
const HEAD_FIELDS = [
  'contractVersion',
  'tenantId',
  'projectId',
  'status',
  'fromMonth',
  'closedThrough',
  'settlementMonth',
  'rootHash',
  'revision',
  'requestId',
  'requestRevision',
  'approvalId',
  'operationId',
  'closedAt',
  'closedByUid',
];
const SOURCE_FIELDS = [
  'monthlyCloseId',
  'monthlyCloseVersionId',
  'requestId',
  'monthlyCloseRevision',
  'requestRevision',
  'sourceRevision',
  'snapshotHash',
];

export class CashflowCumulativeCloseRecoveryError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CashflowCumulativeCloseRecoveryError';
    this.code = code;
  }
}

function recoveryError(code, message, cause) {
  return new CashflowCumulativeCloseRecoveryError(code, message, cause);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function documentData(document) {
  return objectValue(document?.data) || {};
}

function documentId(document) {
  return text(document?.id);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nextYearMonth(value) {
  if (!YEAR_MONTH_PATTERN.test(value)) return '';
  const [year, month] = value.split('-').map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`;
}

function matchingHead(actual, expected) {
  const current = objectValue(actual);
  const target = objectValue(expected);
  return Boolean(
    current
    && target
    && Object.keys(current).length === HEAD_FIELDS.length
    && Object.keys(target).length === HEAD_FIELDS.length
    && HEAD_FIELDS.every((field) => (
      Object.hasOwn(current, field)
      && Object.hasOwn(target, field)
      && current[field] === target[field]
    )),
  );
}

function matchingSource(actual, expected) {
  const current = objectValue(actual);
  return Boolean(current && SOURCE_FIELDS.every((field) => current[field] === expected[field]));
}

function authorityFingerprint(head) {
  const value = objectValue(head);
  return `sha256:${sha256(stableStringify(value || { exists: false }))}`;
}

function recoveryEvidence(candidate, existingHead) {
  if (!candidate?.head || !candidate?.source) return null;
  return {
    contractVersion: RECOVERY_EVIDENCE_CONTRACT,
    authorityFingerprint: authorityFingerprint(existingHead),
    monthlyCloseId: candidate.source.monthlyCloseId,
    monthlyCloseVersionId: candidate.source.monthlyCloseVersionId,
    requestId: candidate.source.requestId,
    monthlyCloseRevision: candidate.source.monthlyCloseRevision,
    requestRevision: candidate.source.requestRevision,
    sourceRevision: candidate.source.sourceRevision,
    snapshotHash: candidate.source.snapshotHash,
    rootHash: candidate.head.rootHash,
    headRevision: candidate.head.revision,
  };
}

function documentFingerprint(value) {
  return `sha256:${sha256(stableStringify(value || { exists: false }))}`;
}

function exactCycleDocument(document) {
  const id = documentId(document);
  const data = documentData(document);
  const projectId = text(data.projectId);
  const yearMonth = text(data.yearMonth);
  if (
    !projectId || projectId.includes('/')
    || !YEAR_MONTH_PATTERN.test(yearMonth)
    || id !== `${projectId}-${yearMonth}`
  ) return null;
  return { projectId, yearMonth, id, data };
}

function cycleIdentityFromDocumentId(document, kind) {
  const match = documentId(document).match(kind === 'version'
    ? /^(.*)-(20\d{2}-(?:0[1-9]|1[0-2]))-r(\d+)$/
    : /^(.*)-(20\d{2}-(?:0[1-9]|1[0-2]))$/);
  if (!match?.[1]) return null;
  return {
    projectId: match[1],
    yearMonth: match[2],
    revision: kind === 'version' ? positiveInteger(match[3]) : null,
  };
}

function preservesMutableHeader(cycle) {
  return ['OPEN', 'REOPEN_REQUESTED'].includes(text(cycle?.data?.status).toUpperCase());
}

function exactImmutableCycle(document, kind, tenantId) {
  const id = documentId(document);
  const data = documentData(document);
  const projectId = text(data.projectId);
  const yearMonth = text(data.yearMonth);
  if (
    !projectId || projectId.includes('/')
    || text(data.tenantId) !== tenantId
    || !YEAR_MONTH_PATTERN.test(yearMonth)
  ) return null;
  const exactId = kind === 'request'
    ? id === `${projectId}-${yearMonth}` && text(data.requestId) === id
    : id === `${projectId}-${yearMonth}-r${positiveInteger(data.revision)}`;
  return exactId ? { projectId, yearMonth } : null;
}

function latestCycle(cycles) {
  return [...cycles].sort((left, right) => right.yearMonth.localeCompare(left.yearMonth))[0] || null;
}

function immutableEvidenceFingerprint({ projectId, monthlyCloseVersions, requests }) {
  const related = (documents) => (documents || [])
    .filter((document) => text(documentData(document).projectId) === projectId)
    .map((document) => ({ id: documentId(document), data: documentData(document) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return documentFingerprint({
    monthlyCloseVersions: related(monthlyCloseVersions),
    requests: related(requests),
  });
}

function matchingRecoveryEvidence(actual, expected) {
  const current = objectValue(actual);
  const target = objectValue(expected);
  return Boolean(current && target && stableStringify(current) === stableStringify(target));
}

function matchingResetOutcomeEvidence(actual, expected) {
  const current = objectValue(actual);
  const target = objectValue(expected);
  return Boolean(
    current
    && target
    && text(current.contractVersion) === RESET_TO_RECLOSE_EVIDENCE_CONTRACT
    && text(target.contractVersion) === RESET_TO_RECLOSE_EVIDENCE_CONTRACT
    && text(current.monthlyCloseId) === text(target.monthlyCloseId)
    && text(current.yearMonth) === text(target.yearMonth)
    && text(current.immutableEvidenceFingerprint) === text(target.immutableEvidenceFingerprint),
  );
}

function collectionMap(documents) {
  return new Map((documents || []).map((document) => [documentId(document), documentData(document)]));
}

function validateManifestMonths({ monthShards, fromMonth, throughMonth, monthCount }) {
  if (!Array.isArray(monthShards) || monthShards.length === 0 || monthShards.length !== monthCount) {
    return false;
  }
  let expected = fromMonth;
  for (const shard of monthShards) {
    if (
      !objectValue(shard)
      || text(shard.yearMonth) !== expected
      || !SHA256_PATTERN.test(text(shard.shardHash))
    ) return false;
    expected = nextYearMonth(expected);
  }
  return text(monthShards.at(-1)?.yearMonth) === throughMonth;
}

function completeHeadCandidate({ tenantId, closeDocument, versionsById, requestsById }) {
  const reasons = [];
  const closeId = documentId(closeDocument);
  const close = documentData(closeDocument);
  const projectId = text(close.projectId);
  const settlementMonth = text(close.yearMonth);
  const closeStatus = text(close.status).toUpperCase();

  if (closeStatus !== 'CLOSED') reasons.push('MONTHLY_CLOSE_NOT_CLOSED');
  if (!projectId || !settlementMonth || !YEAR_MONTH_PATTERN.test(settlementMonth)) {
    reasons.push('MONTHLY_CLOSE_SCOPE_INVALID');
  }
  if (closeId !== `${projectId}-${settlementMonth}`) {
    reasons.push('MONTHLY_CLOSE_IDENTITY_INVALID');
  }
  if (
    text(close.contractVersion) !== MONTH_CLOSE_CONTRACT
    || text(close.tenantId) !== tenantId
  ) reasons.push('MONTHLY_CLOSE_CONTRACT_INVALID');

  const versionId = text(close.latestVersionId);
  const version = versionsById.get(versionId);
  if (!versionId || !version) {
    reasons.push('MONTHLY_CLOSE_VERSION_MISSING');
    return { projectId, settlementMonth, closeId, head: null, source: null, reasons };
  }
  const snapshot = objectValue(version.snapshot);
  const closeSnapshot = objectValue(close.snapshot);
  if (
    versionId !== `${projectId}-${settlementMonth}-r${positiveInteger(version.revision)}`
    || versionId !== `${text(version.projectId)}-${text(version.yearMonth)}-r${positiveInteger(version.revision)}`
  ) {
    reasons.push('MONTHLY_CLOSE_VERSION_IDENTITY_INVALID');
  }
  if (
    text(version.contractVersion) !== MONTH_CLOSE_CONTRACT
    || text(version.tenantId) !== tenantId
    || text(version.projectId) !== projectId
    || text(version.yearMonth) !== settlementMonth
    || text(version.status).toUpperCase() !== 'CLOSED'
    || positiveInteger(version.revision) !== positiveInteger(close.revision)
    || !SHA256_PATTERN.test(text(version.snapshotHash))
    || text(version.snapshotHash) !== text(close.snapshotHash)
    || !snapshot
    || !closeSnapshot
  ) reasons.push('MONTHLY_CLOSE_VERSION_INVALID');
  if (!snapshot || !closeSnapshot) {
    return { projectId, settlementMonth, closeId, head: null, source: null, reasons };
  }

  const requestId = text(snapshot.requestId);
  const request = requestsById.get(requestId);
  if (!requestId || !request) {
    reasons.push('CUMULATIVE_REQUEST_MISSING');
    return { projectId, settlementMonth, closeId, head: null, source: null, reasons };
  }

  const scope = objectValue(request.scope);
  const fromMonth = text(request.fromMonth);
  const throughMonth = text(request.throughMonth);
  const rootHash = text(snapshot.rootHash);
  const requestRevision = positiveInteger(snapshot.requestRevision);
  const headRevision = positiveInteger(snapshot.headRevision);
  const sourceRevision = text(version.sourceRevision);
  const monthCount = positiveInteger(request.monthCount);
  const closedAt = text(snapshot.closedAt);
  const closedByUid = text(snapshot.closedByUid);
  const approvalId = text(snapshot.approvalId);
  const operationId = text(snapshot.operationId);

  if (
    requestId !== `${projectId}-${settlementMonth}`
    || requestId !== `${text(request.projectId)}-${text(request.yearMonth)}`
    || text(request.requestId) !== requestId
  ) {
    reasons.push('CUMULATIVE_REQUEST_IDENTITY_INVALID');
  }

  if (
    text(snapshot.contractVersion) !== CUMULATIVE_CONTRACT
    || text(closeSnapshot.contractVersion) !== CUMULATIVE_CONTRACT
    || text(snapshot.projectId) !== projectId
    || text(closeSnapshot.projectId) !== projectId
    || text(snapshot.yearMonth) !== settlementMonth
    || text(closeSnapshot.yearMonth) !== settlementMonth
    || text(closeSnapshot.requestId) !== requestId
    || positiveInteger(closeSnapshot.requestRevision) !== requestRevision
    || text(closeSnapshot.rootHash) !== rootHash
    || positiveInteger(closeSnapshot.headRevision) !== headRevision
  ) reasons.push('CUMULATIVE_RUN_SNAPSHOT_INVALID');
  if (
    text(request.contractVersion) !== CUMULATIVE_CONTRACT
    || text(request.tenantId) !== tenantId
    || text(request.projectId) !== projectId
    || text(request.requestId) !== requestId
    || text(request.yearMonth) !== settlementMonth
    || !['APPROVING', 'APPROVED'].includes(text(request.status).toUpperCase())
    || !positiveInteger(request.revision)
    || positiveInteger(request.revision) < requestRevision
  ) reasons.push('CUMULATIVE_REQUEST_SCOPE_INVALID');
  if (
    fromMonth !== CUMULATIVE_BASELINE
    || text(scope?.fromMonth) !== CUMULATIVE_BASELINE
  ) reasons.push('CUMULATIVE_FROM_MONTH_INVALID');
  if (
    !YEAR_MONTH_PATTERN.test(fromMonth)
    || !YEAR_MONTH_PATTERN.test(throughMonth)
    || nextYearMonth(throughMonth) !== settlementMonth
    || !scope
    || text(scope.contractVersion) !== CUMULATIVE_CONTRACT
    || text(scope.throughMonth) !== throughMonth
  ) reasons.push('CUMULATIVE_THROUGH_MONTH_INVALID');
  if (
    !SHA256_PATTERN.test(rootHash)
    || text(snapshot.manifestHash) !== rootHash
    || text(closeSnapshot.manifestHash) !== rootHash
    || text(request.manifestHash) !== rootHash
  ) reasons.push('CUMULATIVE_ROOT_HASH_INVALID');
  if (!requestRevision || !headRevision) reasons.push('CUMULATIVE_REVISION_INVALID');
  if (!SHA256_PATTERN.test(sourceRevision)) reasons.push('SOURCE_REVISION_INVALID');
  if (!closedAt || !closedByUid || !approvalId || !operationId) {
    reasons.push('CUMULATIVE_ACTOR_EVIDENCE_INVALID');
  }
  if (
    text(version.closedAt) !== closedAt
    || text(version.closedByUid) !== closedByUid
    || text(close.closedAt) !== closedAt
    || text(close.closedByUid) !== closedByUid
    || text(request.approvalId) !== approvalId
    || text(request.operationId) !== operationId
  ) reasons.push('CUMULATIVE_RUN_LINK_INVALID');
  if (
    !monthCount
    || !validateManifestMonths({
      monthShards: snapshot.monthShards,
      fromMonth: CUMULATIVE_BASELINE,
      throughMonth,
      monthCount,
    })
  ) reasons.push('CUMULATIVE_MANIFEST_EVIDENCE_INVALID');

  if (reasons.length > 0) {
    return { projectId, settlementMonth, closeId, head: null, source: null, reasons: [...new Set(reasons)] };
  }

  return {
    projectId,
    settlementMonth,
    closeId,
    reasons: [],
    head: {
      contractVersion: CUMULATIVE_CONTRACT,
      tenantId,
      projectId,
      status: 'CLOSED',
      fromMonth,
      closedThrough: throughMonth,
      settlementMonth,
      rootHash,
      revision: headRevision,
      requestId,
      requestRevision,
      approvalId,
      operationId,
      closedAt,
      closedByUid,
    },
    source: {
      monthlyCloseId: closeId,
      monthlyCloseVersionId: versionId,
      requestId,
      monthlyCloseRevision: positiveInteger(version.revision),
      requestRevision,
      sourceRevision,
      snapshotHash: text(version.snapshotHash),
    },
  };
}

export function buildCumulativeCloseHeadPlan({
  tenantId,
  monthlyCloses = [],
  monthlyCloseVersions = [],
  requests = [],
  heads = [],
} = {}) {
  const normalizedTenantId = text(tenantId);
  if (!normalizedTenantId || normalizedTenantId.includes('/')) throw new Error('tenantId is required');
  const versionsById = collectionMap(monthlyCloseVersions);
  const requestsById = collectionMap(requests);
  const headsByProject = collectionMap(heads);
  const closesByProject = new Map();

  for (const document of monthlyCloses) {
    const close = documentData(document);
    if (text(close.status).toUpperCase() === 'OPEN') continue;
    const projectId = text(close.projectId);
    const key = projectId || `__UNSCOPED__:${documentId(document)}`;
    if (!closesByProject.has(key)) closesByProject.set(key, []);
    closesByProject.get(key).push(document);
  }

  const plan = [];
  for (const [groupKey, closeDocuments] of closesByProject) {
    const sorted = [...closeDocuments].sort((left, right) => {
      const monthOrder = text(documentData(right).yearMonth).localeCompare(text(documentData(left).yearMonth));
      return monthOrder || documentId(right).localeCompare(documentId(left));
    });
    const latest = sorted[0];
    const latestMonth = text(documentData(latest).yearMonth);
    const sameMonth = sorted.filter((document) => text(documentData(document).yearMonth) === latestMonth);
    const candidate = completeHeadCandidate({
      tenantId: normalizedTenantId,
      closeDocument: latest,
      versionsById,
      requestsById,
    });
    if (sameMonth.length > 1) candidate.reasons.push('LATEST_MONTHLY_CLOSE_AMBIGUOUS');
    const existingHead = headsByProject.get(candidate.projectId);

    let status;
    let reasons = [...new Set(candidate.reasons)];
    if (!candidate.head || candidate.reasons.length > 0) {
      status = 'UNREPAIRABLE';
    } else if (!existingHead) {
      status = 'READY';
    } else if (matchingHead(existingHead, candidate.head)) {
      status = 'AUTHORITY_PRESENT';
    } else {
      status = 'REPAIR_READY';
      reasons = ['HEAD_CONFLICT'];
    }

    plan.push({
      projectId: candidate.projectId || groupKey,
      settlementMonth: candidate.settlementMonth || null,
      monthlyCloseId: candidate.closeId || documentId(latest),
      status,
      reasons,
      head: status === 'UNREPAIRABLE' ? null : candidate.head,
      source: status === 'UNREPAIRABLE' ? null : candidate.source,
      expectedEvidence: status === 'UNREPAIRABLE'
        ? null
        : recoveryEvidence(candidate, existingHead),
    });
  }

  return plan.sort((left, right) => left.projectId.localeCompare(right.projectId));
}

export function buildCumulativeCloseResetToReclosePlan({
  tenantId,
  projectIds = [],
  monthlyCloses = [],
  monthlyCloseVersions = [],
  requests = [],
  heads = [],
} = {}) {
  const normalizedTenantId = text(tenantId);
  if (!normalizedTenantId || normalizedTenantId.includes('/')) throw new Error('tenantId is required');
  const headByProject = collectionMap(heads);
  const invalidIdentityProjects = new Set();
  const invalidIdentityCycles = new Set();
  const markInvalidIdentity = (document, kind) => {
    const data = documentData(document);
    const embedded = { projectId: text(data.projectId), yearMonth: text(data.yearMonth) };
    const parsed = cycleIdentityFromDocumentId(document, kind);
    const invalid = (
      !parsed
      || !embedded.projectId || embedded.projectId.includes('/')
      || !YEAR_MONTH_PATTERN.test(embedded.yearMonth)
      || parsed.projectId !== embedded.projectId
      || parsed.yearMonth !== embedded.yearMonth
      || (kind === 'request' && text(data.requestId) !== documentId(document))
      || (kind === 'version' && parsed.revision !== positiveInteger(data.revision))
    );
    if (!invalid) return;
    for (const identity of [embedded, parsed]) {
      if (!identity?.projectId || identity.projectId.includes('/')) continue;
      invalidIdentityProjects.add(identity.projectId);
      if (YEAR_MONTH_PATTERN.test(identity.yearMonth)) {
        invalidIdentityCycles.add(`${identity.projectId}:${identity.yearMonth}`);
      }
    }
  };
  const exactCycles = [];
  for (const document of monthlyCloses || []) {
    const cycle = exactCycleDocument(document);
    if (cycle) exactCycles.push(cycle);
    else markInvalidIdentity(document, 'close');
  }
  const cyclesByProject = new Map();
  for (const cycle of exactCycles) {
    if (!cyclesByProject.has(cycle.projectId)) cyclesByProject.set(cycle.projectId, []);
    cyclesByProject.get(cycle.projectId).push(cycle);
  }
  const immutableCyclesByProject = new Map();
  const addImmutableCycle = (cycle, kind) => {
    if (!cycle) return;
    const current = immutableCyclesByProject.get(cycle.projectId) || { request: [], version: [] };
    current[kind].push(cycle);
    immutableCyclesByProject.set(cycle.projectId, current);
  };
  for (const document of requests || []) {
    const cycle = exactImmutableCycle(document, 'request', normalizedTenantId);
    addImmutableCycle(cycle, 'request');
    if (!cycle) markInvalidIdentity(document, 'request');
  }
  for (const document of monthlyCloseVersions || []) {
    const cycle = exactImmutableCycle(document, 'version', normalizedTenantId);
    addImmutableCycle(cycle, 'version');
    if (!cycle) markInvalidIdentity(document, 'version');
  }
  const repairPlans = new Map(buildCumulativeCloseHeadPlan({
    tenantId: normalizedTenantId,
    monthlyCloses,
    monthlyCloseVersions,
    requests,
    heads,
  }).map((row) => [row.projectId, row]));

  const scopedProjectIds = new Set([
    ...(projectIds || []).map(text).filter((projectId) => projectId && !projectId.includes('/')),
    ...cyclesByProject.keys(),
    ...immutableCyclesByProject.keys(),
    ...invalidIdentityProjects,
    ...(heads || []).map((document) => documentId(document)).filter(Boolean),
  ]);
  const rows = [];
  for (const projectId of scopedProjectIds) {
    const headerCycles = cyclesByProject.get(projectId) || [];
    const currentHead = headByProject.get(projectId) || null;
    const currentCycle = headerCycles.length > 0
      ? [...headerCycles].sort((left, right) => (
        right.yearMonth.localeCompare(left.yearMonth) || right.id.localeCompare(left.id)
      ))[0]
      : null;
    const preserveMutableHeader = preservesMutableHeader(currentCycle);
    const immutableCycles = immutableCyclesByProject.get(projectId) || { request: [], version: [] };
    const immutableLatest = [
      latestCycle(immutableCycles.request),
      latestCycle(immutableCycles.version),
    ].filter(Boolean);
    const fallbackHeadMonth = (
      text(currentHead?.tenantId) === normalizedTenantId
      && text(currentHead?.projectId) === projectId
      && YEAR_MONTH_PATTERN.test(text(currentHead?.settlementMonth))
    ) ? text(currentHead.settlementMonth) : '';
    const fallbackMonths = [...new Set([
      ...immutableLatest.map((cycle) => cycle.yearMonth),
      ...(immutableLatest.length === 0 && fallbackHeadMonth ? [fallbackHeadMonth] : []),
    ])].sort((left, right) => right.localeCompare(left));
    const candidateCycles = currentCycle
      ? [currentCycle]
      : fallbackMonths.map((yearMonth) => ({
        projectId,
        yearMonth,
        id: `${projectId}-${yearMonth}`,
        data: null,
      }));
    const identityInvalid = candidateCycles.some((cycle) => (
      invalidIdentityCycles.has(`${projectId}:${cycle.yearMonth}`)
    )) || (candidateCycles.length === 0 && invalidIdentityProjects.has(projectId));
    const validAuthority = currentHead
      ? readCashflowCumulativeCloseAuthority(currentHead, {
        tenantId: normalizedTenantId,
        projectId,
        allowOpen: false,
      })
      : null;
    const repairPlan = repairPlans.get(projectId);
    const alreadyWritable = !currentHead && (!currentCycle || preserveMutableHeader);
    let status = alreadyWritable
      ? 'RECLOSE_READY'
      : candidateCycles.length === 1
        ? 'RESET_TO_RECLOSE_READY'
        : candidateCycles.length > 1 ? 'RESET_CYCLE_SELECTION_REQUIRED' : 'RESET_CYCLE_EVIDENCE_REQUIRED';
    let reasons = repairPlan?.reasons?.length
      ? [...repairPlan.reasons]
      : ['IMMUTABLE_CLOSE_EVIDENCE_INCOMPLETE'];
    if (identityInvalid) {
      status = 'RESET_CYCLE_EVIDENCE_REQUIRED';
      reasons = ['CLOSE_EVIDENCE_IDENTITY_INVALID'];
    } else if (repairPlan && ['READY', 'REPAIR_READY'].includes(repairPlan.status)) {
      status = 'EXACT_REPAIR_REQUIRED';
      reasons = repairPlan.reasons || [];
    } else if (repairPlan?.status === 'AUTHORITY_PRESENT' || validAuthority) {
      status = 'NORMAL_REOPEN_REQUIRED';
      reasons = [];
    } else if (alreadyWritable) {
      reasons = [];
    }
    const expectedEvidenceFor = (cycle) => ({
      contractVersion: RESET_TO_RECLOSE_EVIDENCE_CONTRACT,
      authorityFingerprint: authorityFingerprint(currentHead),
      monthlyCloseFingerprint: documentFingerprint(cycle.data),
      immutableEvidenceFingerprint: immutableEvidenceFingerprint({
        projectId,
        monthlyCloseVersions,
        requests,
      }),
      monthlyCloseId: cycle.id,
      yearMonth: cycle.yearMonth,
    });
    rows.push({
      projectId,
      status,
      monthlyCloseId: candidateCycles.length === 1 ? candidateCycles[0].id : null,
      yearMonth: candidateCycles.length === 1 ? candidateCycles[0].yearMonth : null,
      reasons,
      after: null,
      preserveMutableHeader,
      expectedEvidence: status === 'RESET_TO_RECLOSE_READY'
        ? expectedEvidenceFor(candidateCycles[0])
        : null,
      cycleCandidates: status === 'RESET_CYCLE_SELECTION_REQUIRED'
        || (status === 'RECLOSE_READY' && !currentCycle)
        ? candidateCycles.map((cycle) => ({
          yearMonth: cycle.yearMonth,
          monthlyCloseId: cycle.id,
          expectedEvidence: expectedEvidenceFor(cycle),
        }))
        : [],
    });
  }
  return rows.sort((left, right) => left.projectId.localeCompare(right.projectId));
}

function flagValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

export function parseCumulativeCloseHeadMigrationArgs(args = process.argv.slice(2)) {
  const options = {
    apply: false,
    allowedProjectIds: [],
    peopleUid: '',
    reason: '',
    tenantId: 'mysc',
    firebaseProjectId: '',
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--allow-projects') {
      options.allowedProjectIds.push(...flagValue(args, index, arg).split(',').map((value) => value.trim()).filter(Boolean));
      index += 1;
    } else if (arg === '--people-uid') {
      options.peopleUid = flagValue(args, index, arg).trim();
      index += 1;
    } else if (arg === '--reason') {
      options.reason = flagValue(args, index, arg).trim();
      index += 1;
    } else if (arg === '--tenant') {
      options.tenantId = flagValue(args, index, arg).trim();
      index += 1;
    } else if (arg === '--firebase-project' || arg === '--project') {
      options.firebaseProjectId = flagValue(args, index, arg).trim();
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  options.allowedProjectIds = [...new Set(options.allowedProjectIds)];
  return options;
}

export function validateCumulativeCloseHeadMigrationOptions(input) {
  const options = {
    ...input,
    allowedProjectIds: [...new Set(input?.allowedProjectIds || [])],
    peopleUid: text(input?.peopleUid),
    reason: text(input?.reason),
    tenantId: text(input?.tenantId) || 'mysc',
  };
  if (options.tenantId.includes('/')) throw new Error('--tenant contains an invalid tenant ID');
  if (!options.apply) return options;
  if (options.allowedProjectIds.length === 0) {
    throw new Error('--apply requires --allow-projects with one or more project IDs');
  }
  if (options.allowedProjectIds.includes('*')) {
    throw new Error('--allow-projects wildcard is forbidden');
  }
  if (options.allowedProjectIds.length > 50 || options.allowedProjectIds.some((value) => !value || value.includes('/'))) {
    throw new Error('--allow-projects contains an invalid project ID');
  }
  if (!options.peopleUid || options.peopleUid.includes('/')) {
    throw new Error('--apply requires a valid --people-uid');
  }
  if (!options.reason || options.reason.length > 1_000) {
    throw new Error('--apply requires --reason (maximum 1000 characters)');
  }
  return options;
}

function allowedPlanRows(plan, allowedProjectIds) {
  const byProject = new Map((plan || []).map((row) => [row.projectId, row]));
  return allowedProjectIds.map((projectId) => {
    const row = byProject.get(projectId);
    if (!row) throw new Error(`${projectId}: no non-OPEN monthly close was found`);
    if (!WRITABLE_PLAN_STATUSES.has(row.status) || !row.head || !row.source) {
      throw new Error(`${projectId}: ${row.status}${row.reasons?.length ? ` (${row.reasons.join(', ')})` : ''}`);
    }
    if (!matchingHead(row.head, row.head)) throw new Error(`${projectId}: head contract invalid`);
    return row;
  });
}

export async function assertLinkedActivePeopleUid({ db, transaction, tenantId, peopleUid }) {
  if (!db?.collection || !db?.doc) {
    throw recoveryError(
      'RUNTIME_SUPERADMIN_STORE_UNAVAILABLE',
      'Firestore is required to validate People UID',
    );
  }
  const peopleQuery = db.collection(`orgs/${tenantId}/persons`).where('uid', '==', peopleUid).limit(2);
  const memberRef = db.doc(`orgs/${tenantId}/members/${peopleUid}`);
  const read = (target) => (transaction ? transaction.get(target) : target.get());
  const [snapshot, memberSnapshot] = await Promise.all([read(peopleQuery), read(memberRef)]);
  if (snapshot.size !== 1) {
    throw recoveryError(
      'RUNTIME_SUPERADMIN_REQUIRED',
      `--people-uid must match exactly one People record: ${peopleUid}`,
    );
  }
  const member = memberSnapshot.exists ? memberSnapshot.data() || {} : {};
  if (
    text(member.uid) !== peopleUid
    || text(member.status).toUpperCase() !== 'ACTIVE'
    || text(member.role).toLowerCase() !== 'admin'
  ) {
    throw recoveryError(
      'RUNTIME_SUPERADMIN_REQUIRED',
      `--people-uid must be an ACTIVE runtime admin member: ${peopleUid}`,
    );
  }
  return { personId: snapshot.docs[0].id, peopleUid };
}

export async function applyCumulativeCloseHeadPlan({ db, tenantId, plan, options, auditChainService }) {
  const validated = validateCumulativeCloseHeadMigrationOptions(options);
  if (!validated.apply) throw new Error('applyCumulativeCloseHeadPlan requires --apply');
  if (!db?.doc || !db?.runTransaction) throw new Error('Firestore transaction support is required');
  if (!auditChainService?.appendManyInTransaction) throw new Error('Atomic append-only audit chain is required');
  const normalizedTenantId = text(tenantId) || validated.tenantId;
  if (normalizedTenantId !== validated.tenantId) {
    throw new Error('Migration tenant does not match the validated --tenant scope');
  }
  const rows = allowedPlanRows(plan, validated.allowedProjectIds);

  return db.runTransaction(async (transaction) => {
    await assertLinkedActivePeopleUid({
      db,
      transaction,
      tenantId: normalizedTenantId,
      peopleUid: validated.peopleUid,
    });
    const refs = rows.map((row) => ({
      head: db.doc(`orgs/${normalizedTenantId}/cashflow_cumulative_close_heads/${row.projectId}`),
      monthlyCloses: db.collection(`orgs/${normalizedTenantId}/monthly_closes`)
        .where('projectId', '==', row.projectId)
        .limit(RECOVERY_EVIDENCE_QUERY_LIMIT + 1),
      monthlyCloseVersions: db.collection(`orgs/${normalizedTenantId}/monthly_close_versions`)
        .where('projectId', '==', row.projectId)
        .limit(RECOVERY_EVIDENCE_QUERY_LIMIT + 1),
      requests: db.collection(`orgs/${normalizedTenantId}/cashflow_month_close_requests`)
        .where('projectId', '==', row.projectId)
        .limit(RECOVERY_EVIDENCE_QUERY_LIMIT + 1),
    }));
    const snapshots = await Promise.all(refs.map(async (rowRefs) => {
      const [head, monthlyCloses, monthlyCloseVersions, requests] = await Promise.all([
        transaction.get(rowRefs.head),
        transaction.get(rowRefs.monthlyCloses),
        transaction.get(rowRefs.monthlyCloseVersions),
        transaction.get(rowRefs.requests),
      ]);
      if (
        monthlyCloses.docs.length > RECOVERY_EVIDENCE_QUERY_LIMIT
        || monthlyCloseVersions.docs.length > RECOVERY_EVIDENCE_QUERY_LIMIT
        || requests.docs.length > RECOVERY_EVIDENCE_QUERY_LIMIT
      ) {
        throw recoveryError(
          'RECOVERY_EVIDENCE_TRUNCATED',
          'cashflow recovery evidence query limit exceeded',
        );
      }
      return { head, monthlyCloses, monthlyCloseVersions, requests };
    }));
    const toWrite = [];
    const replayed = [];
    rows.forEach((row, index) => {
      const current = snapshots[index];
      const [liveRow] = buildCumulativeCloseHeadPlan({
        tenantId: normalizedTenantId,
        monthlyCloses: current.monthlyCloses.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
        monthlyCloseVersions: current.monthlyCloseVersions.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
        requests: current.requests.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
        // Canonical candidate is always recomputed from immutable close evidence. A corrupt
        // authority head must never influence the value used to repair itself.
        heads: [],
      });
      if (
        !liveRow
        || liveRow.status !== 'READY'
        || !matchingHead(liveRow.head, row.head)
        || !matchingSource(liveRow.source, row.source)
      ) {
        throw recoveryError(
          'RECOVERY_EVIDENCE_CHANGED',
          `${row.projectId}: canonical source evidence changed during apply transaction`,
        );
      }
      const currentHead = current.head.exists ? current.head.data() || {} : null;
      if (matchingHead(currentHead, row.head)) {
        replayed.push(row.projectId);
        return;
      }
      if (
        !matchingRecoveryEvidence(row.expectedEvidence, recoveryEvidence(liveRow, currentHead))
      ) {
        throw recoveryError(
          'RECOVERY_EVIDENCE_CHANGED',
          `${row.projectId}: authority evidence changed during apply transaction`,
        );
      }
      toWrite.push({
        row,
        ref: refs[index].head,
        before: current.head.exists
          ? { exists: true, value: currentHead }
          : { exists: false },
      });
    });

    if (toWrite.length > 0) {
      await auditChainService.appendManyInTransaction(transaction, toWrite.map(({ row, before }) => ({
        tenantId: normalizedTenantId,
        entityType: 'cashflow_cumulative_close_head',
        entityId: row.projectId,
        action: before.exists
          ? 'CASHFLOW_CUMULATIVE_CLOSE_HEAD_REPAIRED'
          : 'CASHFLOW_CUMULATIVE_CLOSE_HEAD_BACKFILLED',
        actorId: validated.peopleUid,
        actorRole: 'admin',
        requestId: `cashflow-close-head-recovery:${row.projectId}:r${row.head.revision}`,
        details: {
          reason: validated.reason,
          sourceRevision: row.source.sourceRevision,
        },
        metadata: {
          reason: validated.reason,
          before,
          after: row.head,
          sourceRevision: row.source.sourceRevision,
          source: {
            monthlyClosePath: `orgs/${normalizedTenantId}/monthly_closes/${row.source.monthlyCloseId}`,
            monthlyCloseVersionPath: `orgs/${normalizedTenantId}/monthly_close_versions/${row.source.monthlyCloseVersionId}`,
            requestPath: `orgs/${normalizedTenantId}/cashflow_month_close_requests/${row.source.requestId}`,
            monthlyCloseRevision: row.source.monthlyCloseRevision,
            requestRevision: row.source.requestRevision,
            snapshotHash: row.source.snapshotHash,
          },
        },
      })));
      for (const { row, ref, before } of toWrite) {
        if (before.exists) transaction.set(ref, row.head);
        else transaction.create(ref, row.head);
      }
    }

    return {
      mode: 'APPLY',
      applied: toWrite.map(({ row }) => row.projectId),
      replayed,
    };
  });
}

export async function applyCumulativeCloseResetToReclose({
  db,
  tenantId,
  projectId,
  peopleUid,
  reason,
  expectedEvidence,
  auditChainService,
}) {
  const normalizedTenantId = text(tenantId);
  const normalizedProjectId = text(projectId);
  const normalizedPeopleUid = text(peopleUid);
  const normalizedReason = text(reason);
  const expected = objectValue(expectedEvidence);
  const yearMonth = text(expected?.yearMonth);
  const monthlyCloseId = text(expected?.monthlyCloseId);
  if (
    !normalizedTenantId || normalizedTenantId.includes('/')
    || !normalizedProjectId || normalizedProjectId.includes('/')
    || !normalizedPeopleUid || normalizedPeopleUid.includes('/')
    || !normalizedReason || normalizedReason.length > 500
    || text(expected?.contractVersion) !== RESET_TO_RECLOSE_EVIDENCE_CONTRACT
    || !YEAR_MONTH_PATTERN.test(yearMonth)
    || monthlyCloseId !== `${normalizedProjectId}-${yearMonth}`
  ) throw new Error('reset-to-reclose input is invalid');
  if (!db?.doc || !db?.collection || !db?.runTransaction) {
    throw new Error('Firestore transaction support is required');
  }
  if (!auditChainService?.appendManyInTransaction) {
    throw new Error('Atomic append-only audit chain is required');
  }

  return db.runTransaction(async (transaction) => {
    await assertLinkedActivePeopleUid({
      db,
      transaction,
      tenantId: normalizedTenantId,
      peopleUid: normalizedPeopleUid,
    });
    const basePath = `orgs/${normalizedTenantId}`;
    const headRef = db.doc(`${basePath}/cashflow_cumulative_close_heads/${normalizedProjectId}`);
    const monthlyCloseRef = db.doc(`${basePath}/monthly_closes/${monthlyCloseId}`);
    const versionsQuery = db.collection(`${basePath}/monthly_close_versions`)
      .where('projectId', '==', normalizedProjectId)
      .limit(RECOVERY_EVIDENCE_QUERY_LIMIT + 1);
    const requestsQuery = db.collection(`${basePath}/cashflow_month_close_requests`)
      .where('projectId', '==', normalizedProjectId)
      .limit(RECOVERY_EVIDENCE_QUERY_LIMIT + 1);
    const [headSnapshot, monthlyCloseSnapshot, versionsSnapshot, requestsSnapshot] = await Promise.all([
      transaction.get(headRef),
      transaction.get(monthlyCloseRef),
      transaction.get(versionsQuery),
      transaction.get(requestsQuery),
    ]);
    if (
      versionsSnapshot.docs.length > RECOVERY_EVIDENCE_QUERY_LIMIT
      || requestsSnapshot.docs.length > RECOVERY_EVIDENCE_QUERY_LIMIT
    ) {
      throw recoveryError(
        'RESET_EVIDENCE_TRUNCATED',
        'cashflow reset evidence query limit exceeded',
      );
    }
    const rawHead = headSnapshot.exists ? headSnapshot.data() || {} : null;
    const rawMonthlyClose = monthlyCloseSnapshot.exists ? monthlyCloseSnapshot.data() || {} : null;
    const [plannedLiveRow] = buildCumulativeCloseResetToReclosePlan({
      tenantId: normalizedTenantId,
      monthlyCloses: rawMonthlyClose ? [{ id: monthlyCloseId, data: rawMonthlyClose }] : [],
      monthlyCloseVersions: versionsSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
      requests: requestsSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} })),
      heads: rawHead ? [{ id: normalizedProjectId, data: rawHead }] : [],
    });
    if (plannedLiveRow?.status === 'RECLOSE_READY') {
      const replayCandidate = plannedLiveRow.cycleCandidates?.find((candidate) => (
        matchingResetOutcomeEvidence(candidate.expectedEvidence, expected)
      ));
      if (!replayCandidate) {
        throw recoveryError(
          'RESET_EVIDENCE_CHANGED',
          `${normalizedProjectId}: reset-to-reclose evidence changed`,
        );
      }
      return {
        status: 'RESET_TO_RECLOSE_REPLAYED',
        projectId: normalizedProjectId,
        yearMonth: replayCandidate.yearMonth,
      };
    }
    const selectedCandidate = plannedLiveRow?.status === 'RESET_CYCLE_SELECTION_REQUIRED'
      ? plannedLiveRow.cycleCandidates?.find((candidate) => (
        matchingRecoveryEvidence(candidate.expectedEvidence, expected)
      ))
      : null;
    const livePlan = selectedCandidate
      ? {
        ...plannedLiveRow,
        status: 'RESET_TO_RECLOSE_READY',
        monthlyCloseId: selectedCandidate.monthlyCloseId,
        yearMonth: selectedCandidate.yearMonth,
        expectedEvidence: selectedCandidate.expectedEvidence,
      }
      : plannedLiveRow;
    if (!livePlan || livePlan.projectId !== normalizedProjectId) {
      throw recoveryError(
        'RESET_EVIDENCE_CHANGED',
        `${normalizedProjectId}: reset-to-reclose evidence changed`,
      );
    }
    if (livePlan.status === 'NORMAL_REOPEN_REQUIRED') {
      throw recoveryError(
        'RESET_NORMAL_REOPEN_REQUIRED',
        `${normalizedProjectId}: valid authority requires normal reopen`,
      );
    }
    if (livePlan.status !== 'RESET_TO_RECLOSE_READY') {
      throw recoveryError(
        'RESET_EXACT_RECOVERY_REQUIRED',
        `${normalizedProjectId}: exact recovery is available`,
      );
    }
    if (!matchingRecoveryEvidence(expected, livePlan.expectedEvidence)) {
      throw recoveryError(
        'RESET_EVIDENCE_CHANGED',
        `${normalizedProjectId}: reset-to-reclose evidence changed`,
      );
    }

    const before = {
      authority: rawHead
        ? { exists: true, value: rawHead }
        : { exists: false },
      monthlyClose: rawMonthlyClose
        ? { exists: true, id: monthlyCloseId, value: rawMonthlyClose }
        : { exists: false, id: monthlyCloseId },
    };
    const after = {
      authority: { exists: false },
      monthlyClose: livePlan.preserveMutableHeader && rawMonthlyClose
        ? { exists: true, id: monthlyCloseId, value: rawMonthlyClose }
        : { exists: false },
    };
    await auditChainService.appendManyInTransaction(transaction, [{
      tenantId: normalizedTenantId,
      entityType: 'cashflow_cumulative_close_head',
      entityId: normalizedProjectId,
      action: 'CASHFLOW_CUMULATIVE_CLOSE_RESET_TO_RECLOSE',
      actorId: normalizedPeopleUid,
      actorRole: 'admin',
      requestId: `cashflow-close-reset-to-reclose:${normalizedProjectId}:${yearMonth}`,
      details: {
        reason: normalizedReason,
        yearMonth,
      },
      metadata: {
        reason: normalizedReason,
        yearMonth,
        expectedEvidence: expected,
        before,
        after,
      },
    }]);
    if (headSnapshot.exists) transaction.delete(headRef);
    if (monthlyCloseSnapshot.exists && !livePlan.preserveMutableHeader) transaction.delete(monthlyCloseRef);
    return {
      status: 'RESET_TO_RECLOSE_COMPLETED',
      projectId: normalizedProjectId,
      yearMonth,
    };
  });
}

export async function executeCumulativeCloseHeadMigration({ db, tenantId, plan, options, auditChainService }) {
  const validated = validateCumulativeCloseHeadMigrationOptions(options);
  if (!validated.apply) return { mode: 'DRY_RUN', applied: [], replayed: [] };
  return applyCumulativeCloseHeadPlan({
    db,
    tenantId: text(tenantId) || validated.tenantId,
    plan,
    options: validated,
    auditChainService,
  });
}
