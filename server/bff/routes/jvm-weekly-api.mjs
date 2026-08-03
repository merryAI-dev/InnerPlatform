import {
  asyncHandler,
  assertActorRoleAllowed,
  createHttpError,
  readOptionalText,
  ROUTE_ROLES,
} from '../bff-utils.mjs';
import {
  isWorkspaceAuthMode,
  isWorkspaceUser,
  resolveJavaWeeklyApiServiceAccountJson,
} from '../java-weekly-auth.mjs';
import { assertCashflowMutationRuntime, createJavaWeeklyClient } from '../java-weekly-client.mjs';
import { createCashflowPerformanceTrace } from '../cashflow-performance.mjs';
import {
  buildCashflowProjectionActualComparison,
  resolveCashflowComparisonAsOf,
} from '../cashflow-comparison.mjs';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from '../cashflow-policy.mjs';
import { stableStringify } from '../utils.mjs';
import { getMonthFinanceWeeks } from '../../../src/app/platform/cashflow-week-core.mjs';
import { createHash } from 'node:crypto';

const CASHFLOW_MANAGEMENT_CHECK_IDS = [
  'labor-transfer',
  'profit-vat-after-deposit',
  'negative-projection-balance',
  'future-prepay-over-million',
];
const CASHFLOW_MONTH_CLOSE_ROUTE_TIMEOUT_MS = 26_000;
const CASHFLOW_MONTH_CLOSE_MUTATION_BUDGET_MS = 12_000;
const CASHFLOW_MONTH_CLOSE_REQUEST_MAX_BYTES = 900_000;
const CASHFLOW_CUMULATIVE_CLOSE_CONTRACT = 'cashflow-cumulative-close-v2';
const CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH = '2023-01';

function cashflowMonthCloseTimeoutError() {
  return createHttpError(
    504,
    '월 결산 서버 조회 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
    'cashflow_month_close_route_timeout',
  );
}

function assertCashflowMonthCloseMutationResult(result, projectId, yearMonth, expectedRevision) {
  if (
    result?.ok !== true
    || readOptionalText(result.projectId) !== projectId
    || readOptionalText(result.yearMonth) !== yearMonth
    || readOptionalText(result.status) !== 'CLOSED'
    || !Number.isSafeInteger(result.revision)
    || result.revision !== expectedRevision + 1
    || !readOptionalText(result.auditId)
  ) {
    throw createHttpError(
      502,
      'JVM 캐시플로 저장 결과를 확인할 수 없습니다.',
      'cashflow_jvm_invalid_response',
    );
  }
  return result;
}

async function withCashflowMonthCloseDeadline(task, timeoutMs) {
  let timeoutId;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(cashflowMonthCloseTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveJavaWeeklyApiBaseUrl(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiBaseUrl)
    || readOptionalText(env.JVM_WEEKLY_API_BASE_URL)
    || readOptionalText(env.WEEKLY_API_BASE_URL);
}

function resolveJavaWeeklyApiServiceToken(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiServiceToken)
    || readOptionalText(env.JVM_WEEKLY_INTERNAL_API_TOKEN)
    || readOptionalText(env.WEEKLY_API_INTERNAL_TOKEN);
}

function resolveJavaWeeklyApiIdTokenAudience(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiIdTokenAudience)
    || readOptionalText(env.JVM_WEEKLY_API_ID_TOKEN_AUDIENCE)
    || readOptionalText(env.WEEKLY_API_ID_TOKEN_AUDIENCE);
}

function resolveJavaWeeklyAuthMode(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyAuthMode)
    || readOptionalText(env.JVM_WEEKLY_AUTH_MODE)
    || readOptionalText(env.WEEKLY_AUTH_MODE)
    || 'strict';
}

function resolveJavaWeeklyWorkspaceEmailDomain(options = {}, env = process.env) {
  const raw = readOptionalText(options.jvmWeeklyWorkspaceEmailDomain)
    || readOptionalText(env.JVM_WEEKLY_WORKSPACE_EMAIL_DOMAIN)
    || readOptionalText(env.WEEKLY_WORKSPACE_EMAIL_DOMAIN)
    || 'mysc.co.kr';
  return raw.replace(/^@+/, '').toLowerCase();
}

function resolveJavaWeeklyFirestoreProjectId(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyFirestoreProjectId)
    || readOptionalText(env.JVM_WEEKLY_FIRESTORE_PROJECT_ID)
    || readOptionalText(env.WEEKLY_FIRESTORE_PROJECT_ID);
}

function resolveBffDataProjectId(env = process.env) {
  return readOptionalText(env.FIREBASE_PROJECT_ID)
    || readOptionalText(env.VITE_FIREBASE_PROJECT_ID)
    || readOptionalText(env.GCLOUD_PROJECT)
    || readOptionalText(env.GOOGLE_CLOUD_PROJECT);
}

function cashflowMonthCloseRequestPath(tenantId, requestId) {
  return `orgs/${tenantId}/cashflow_month_close_requests/${requestId}`;
}

function cashflowMonthCloseRequestMonthPath(tenantId, requestId, revision, yearMonth) {
  return `orgs/${tenantId}/cashflow_month_close_request_months/${requestId}-r${revision}-${yearMonth}`;
}

function cashflowCloseHash(value) {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

export function buildCashflowMonthCloseRevisionChanges(previousCells, currentCells) {
  const key = (cell) => `${cell.mode}|${cell.weekNo}|${cell.cashflowLine}`;
  const previousByKey = new Map((previousCells || []).map((cell) => [key(cell), cell]));
  const currentByKey = new Map((currentCells || []).map((cell) => [key(cell), cell]));
  const orderedKeys = [
    ...currentByKey.keys(),
    ...[...previousByKey.keys()].filter((cellKey) => !currentByKey.has(cellKey)),
  ];

  return orderedKeys.flatMap((cellKey) => {
    const before = previousByKey.get(cellKey);
    const current = currentByKey.get(cellKey);
    if (before && current && before.cellState === current.cellState && before.amount === current.amount) return [];
    const identity = current || before;
    const previousAmount = before && typeof before.amount === 'number' ? before.amount : null;
    const currentAmount = current && typeof current.amount === 'number' ? current.amount : null;
    return [{
      mode: identity.mode,
      weekNo: identity.weekNo,
      cashflowLine: identity.cashflowLine,
      previousState: before?.cellState || 'MISSING',
      previousAmount,
      currentState: current?.cellState || 'MISSING',
      currentAmount,
      amountDelta: previousAmount === null || currentAmount === null ? null : currentAmount - previousAmount,
    }];
  });
}

function cashflowMonthCloseRequestAuditPath(tenantId, requestId, revision, action) {
  return `orgs/${tenantId}/cashflow_month_close_request_audits/${requestId}-r${revision}-${action}`;
}

function cashflowMonthCloseRequestView(record, partyNames = {}) {
  if (record.contractVersion === CASHFLOW_CUMULATIVE_CLOSE_CONTRACT) {
    const throughMonth = readOptionalText(record.throughMonth) || record.yearMonth;
    return {
      documentType: 'MONTHLY_CLOSE',
      contractVersion: record.contractVersion,
      requestId: record.requestId,
      projectId: record.projectId,
      yearMonth: record.yearMonth,
      throughMonth,
      fromMonth: record.fromMonth,
      status: record.status,
      revision: record.revision,
      manifestHash: record.manifestHash,
      monthCount: record.monthCount,
      weekCount: record.weekCount,
      cellCount: record.cellCount,
      source: objectValue(record.source),
      totals: objectValue(record.totals),
      annualSummaries: Array.isArray(record.annualSummaries) ? record.annualSummaries : [],
      approverUid: record.approverUid,
      approverName: partyNames.approverName || '구성원 이름 확인 불가',
      requestedByUid: record.requestedByUid,
      requestedByName: partyNames.requestedByName || '구성원 이름 확인 불가',
      requestedAt: record.requestedAt,
      reviewedByUid: record.reviewedByUid || null,
      reviewedByName: record.reviewedByUid ? partyNames.reviewedByName || '구성원 이름 확인 불가' : null,
      reviewedAt: record.reviewedAt || null,
      decisionReason: record.decisionReason || null,
      reviewWarnings: Array.isArray(record.reviewWarnings) ? record.reviewWarnings : [],
      monthSnapshot: null,
      lockRange: {
        fromMonth: record.fromMonth,
        fromWeekNo: 1,
        throughMonth,
        throughWeekNo: 5,
      },
      reconciliationEvidence: objectValue(record.reconciliationEvidence),
    };
  }
  return {
    documentType: 'MONTHLY_CLOSE',
    requestId: record.requestId,
    projectId: record.projectId,
    yearMonth: record.yearMonth,
    status: record.status,
    revision: record.revision,
    approverUid: record.approverUid,
    approverName: partyNames.approverName || '구성원 이름 확인 불가',
    requestedByUid: record.requestedByUid,
    requestedByName: partyNames.requestedByName || '구성원 이름 확인 불가',
    requestedAt: record.requestedAt,
    reviewedByUid: record.reviewedByUid || null,
    reviewedByName: record.reviewedByUid ? partyNames.reviewedByName || '구성원 이름 확인 불가' : null,
    reviewedAt: record.reviewedAt || null,
    decisionReason: record.decisionReason || null,
    reviewWarnings: Array.isArray(record.reviewWarnings) ? record.reviewWarnings : [],
    monthSnapshot: objectValue(record.monthSnapshot),
    reconciliationEvidence: objectValue(record.reconciliationEvidence),
  };
}

function cumulativeMonthCloseShard({ requestId, requestRevision, projectId, yearMonth, month, source }) {
  const cells = canonicalMonthCells(month, yearMonth).map(({ mode, weekNo, cashflowLine, cellState, amount }) => ({
    mode, weekNo, cashflowLine, cellState, amount: cellState === 'EMPTY' ? null : amount,
  }));
  const base = {
    contractVersion: CASHFLOW_CUMULATIVE_CLOSE_CONTRACT,
    requestId,
    requestRevision,
    projectId,
    yearMonth,
    cells,
    source,
  };
  return { ...base, shardHash: cashflowCloseHash(base) };
}

function cumulativeMonthCloseManifest({ requestId, requestRevision, projectId, yearMonth, shards }) {
  const manifest = {
    contractVersion: CASHFLOW_CUMULATIVE_CLOSE_CONTRACT,
    requestId,
    requestRevision,
    projectId,
    fromMonth: CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH,
    yearMonth,
    months: shards.map((shard) => ({ yearMonth: shard.yearMonth, shardHash: shard.shardHash })),
  };
  return { ...manifest, manifestHash: cashflowCloseHash(manifest) };
}

function assertCashflowMonthCloseRequestSize(record) {
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') <= CASHFLOW_MONTH_CLOSE_REQUEST_MAX_BYTES) return;
  throw createHttpError(
    413,
    '월 결산 요청 자료가 너무 큽니다. 시트 범위를 확인해 주세요.',
    'cashflow_month_close_request_too_large',
  );
}

async function readActiveCashflowMember({ db, tenantId, actorId }) {
  const normalizedActorId = readOptionalText(actorId);
  if (!normalizedActorId || normalizedActorId.includes('/')) {
    throw createHttpError(403, '활성 구성원만 월 결산 요청을 조회하거나 검토할 수 있습니다.', 'cashflow_month_close_member_inactive');
  }
  const snapshot = await db.doc(`orgs/${tenantId}/members/${normalizedActorId}`).get();
  const member = snapshot.exists ? snapshot.data() || {} : null;
  if (
    !member
    || readOptionalText(member.uid) !== normalizedActorId
    || readOptionalText(member.status).toUpperCase() !== 'ACTIVE'
  ) {
    throw createHttpError(403, '활성 구성원만 월 결산 요청을 조회하거나 검토할 수 있습니다.', 'cashflow_month_close_member_inactive');
  }
  return member;
}

async function readCashflowRequestPartyNames({ db, tenantId, record }) {
  const entries = await Promise.all([
    ['requestedByName', record.requestedByUid],
    ['approverName', record.approverUid],
    ['reviewedByName', record.reviewedByUid],
  ].map(async ([key, uid]) => {
    const normalizedUid = readOptionalText(uid);
    if (!normalizedUid || normalizedUid.includes('/')) return [key, ''];
    const snapshot = await db.doc(`orgs/${tenantId}/members/${normalizedUid}`).get();
    const member = snapshot.exists ? snapshot.data() || {} : {};
    return [key, readOptionalText(member.status).toUpperCase() === 'ACTIVE' ? readOptionalText(member.name) : ''];
  }));
  return Object.fromEntries(entries);
}

async function readCanonicalCashflowApprover({ db, tenantId, projectId, requesterUid }) {
  const projectSnapshot = await db.doc(`orgs/${tenantId}/projects/${projectId}`).get();
  const project = projectSnapshot.exists ? projectSnapshot.data() || {} : null;
  const approverUid = readOptionalText(project?.executiveApproverId);
  if (!project || !approverUid || approverUid.includes('/')) {
    throw createHttpError(409, '프로젝트 조직장을 먼저 지정해 주세요.', 'cashflow_month_close_approver_required');
  }
  if (approverUid === readOptionalText(requesterUid)) {
    throw createHttpError(409, '월 결산 요청자는 자신의 요청을 승인할 수 없습니다.', 'cashflow_month_close_self_approval_forbidden');
  }
  await readActiveCashflowMember({ db, tenantId, actorId: approverUid });
  return approverUid;
}

function commandBody(req) {
  const body = {
    ...(req.body && typeof req.body === 'object' ? req.body : {}),
    idempotencyKey: req.context.idempotencyKey,
  };
  delete body.actor;
  delete body.tenantId;
  delete body.actorRole;
  delete body.dataProjectId;
  delete body.sourceSheetKey;
  return body;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readWeeklyExpenseEditSession(req) {
  const sessionId = readOptionalText(req.header('x-edit-session-id'));
  const leaseId = readOptionalText(req.header('x-edit-lease-id'));
  const fenceText = readOptionalText(req.header('x-edit-fence'));
  const fence = /^[1-9]\d*$/.test(fenceText) ? Number(fenceText) : Number.NaN;
  if (!sessionId || !leaseId || !Number.isSafeInteger(fence)) {
    throw createHttpError(400, 'Weekly expense edit lease headers are required.', 'cashflow_edit_lease_request_invalid');
  }
  const finalizeText = readOptionalText(req.header('x-edit-finalize'));
  if (finalizeText && finalizeText !== 'true') {
    throw createHttpError(400, 'x-edit-finalize must be true when present.', 'cashflow_edit_lease_request_invalid');
  }
  return { sessionId, leaseId, fence, ...(finalizeText === 'true' ? { finalize: true } : {}) };
}

function parseAuditMetadata(value) {
  try {
    return objectValue(JSON.parse(readOptionalText(value) || '{}')) || {};
  } catch {
    return {};
  }
}

async function readCashflowActivityDocuments(db, tenantId, collectionId, projectId) {
  if (!db?.collection) return [];
  let query = db.collection(`orgs/${tenantId}/${collectionId}`)
    .where('projectId', '==', projectId);
  query = collectionId === 'weekly_api_audit_events'
    ? query.limit(200)
    : query.limit(200);
  const snap = await query.get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

async function readCashflowActivity(db, tenantId, projectId, source = '') {
  const [refreshRuns, monthlyAudits, legacyEvents] = await Promise.all([
    source && source !== 'sheet_refresh' ? [] : readCashflowActivityDocuments(db, tenantId, 'cashflow_sheet_refresh_runs', projectId),
    source && source !== 'audit' ? [] : readCashflowActivityDocuments(db, tenantId, 'weekly_api_audit_events', projectId),
    source && source !== 'legacy' ? [] : readCashflowActivityDocuments(db, tenantId, 'cashflow_events', projectId),
  ]);
  const refreshEvents = refreshRuns
    .filter((run) => readOptionalText(run.status) === 'COMPLETED' && readOptionalText(run.response?.status) === 'FRESH')
    .map((run) => ({
      id: `sheet-refresh:${run.id}`,
      projectId,
      runId: readOptionalText(run.idempotencyKey) || run.id,
      type: 'sheet_refresh',
      source: 'google_sheet_refresh',
      actorUid: readOptionalText(run.createdBy?.uid),
      actorName: readOptionalText(run.createdBy?.name),
      actorEmail: readOptionalText(run.createdBy?.email),
      createdAt: readOptionalText(run.completedAt) || readOptionalText(run.createdAt),
      sheetName: readOptionalText(run.response?.selectedSheetName),
    }));
  const closeEvents = monthlyAudits
    .filter((audit) => readOptionalText(audit.commandName).startsWith('cashflowMonth.'))
    .map((audit) => {
      const metadata = parseAuditMetadata(audit.metadataJson);
      return {
        id: `month-close:${audit.id}`,
        projectId,
        runId: readOptionalText(audit.idempotencyKey) || audit.id,
        type: 'month_close',
        source: 'month_close',
        yearMonth: readOptionalText(metadata.yearMonth),
        status: readOptionalText(metadata.status),
        actorUid: readOptionalText(audit.actorId),
        actorEmail: readOptionalText(metadata.actorEmail),
        actorName: readOptionalText(metadata.actorName),
        createdAt: readOptionalText(audit.createdAt),
      };
    });
  const sheetApplyEvents = monthlyAudits
    .filter((audit) => readOptionalText(audit.commandName) === 'weeklyExpense.cashflowSheetLab.apply')
    .map((audit) => {
      const metadata = parseAuditMetadata(audit.metadataJson);
      const projectionLineCount = safeAmount(metadata.projectionLineCount);
      const actualLineCount = safeAmount(metadata.actualLineCount);
      return {
        id: `sheet-apply:${audit.id}`,
        projectId,
        runId: readOptionalText(audit.idempotencyKey) || audit.id,
        type: 'sheet_apply',
        source: 'google_sheet_apply',
        yearMonth: readOptionalText(metadata.yearMonth),
        year: Number.isSafeInteger(Number(metadata.year)) ? Number(metadata.year) : undefined,
        scope: readOptionalText(metadata.scope) || 'monthly',
        projectionLineCount,
        actualLineCount,
        appliedLineCount: projectionLineCount + actualLineCount,
        actorUid: readOptionalText(audit.actorId),
        actorEmail: readOptionalText(metadata.actorEmail),
        actorName: readOptionalText(metadata.actorName),
        createdAt: readOptionalText(audit.createdAt),
      };
    });
  const appliedCellEvents = monthlyAudits
    .filter((audit) => readOptionalText(audit.commandName) === 'weeklyExpense.cashflowSheetLab.apply')
    .flatMap((audit) => {
      const metadata = parseAuditMetadata(audit.metadataJson);
      return (Array.isArray(metadata.appliedCellChanges) ? metadata.appliedCellChanges : []).map((rawChange, index) => {
        const change = objectValue(rawChange) || {};
        const before = objectValue(change.before) || {};
        const after = objectValue(change.after) || {};
        const mode = readOptionalText(change.mode).toLowerCase();
        const beforeState = readOptionalText(before.cellState).toUpperCase();
        const afterState = readOptionalText(after.cellState).toUpperCase();
        const operationId = readOptionalText(change.operationId) || readOptionalText(metadata.operationId) || readOptionalText(audit.idempotencyKey);
        return {
          id: `sheet-apply-cell:${audit.id}:${index}`,
          projectId,
          runId: readOptionalText(change.idempotencyKey) || readOptionalText(audit.idempotencyKey) || operationId || audit.id,
          type: mode === 'projection' ? 'projection_amount_change' : 'actual_amount_change',
          source: 'google_sheet_apply',
          sourceDetail: readOptionalText(change.source) || readOptionalText(metadata.source) || readOptionalText(audit.sheetKey),
          operation: readOptionalText(change.operationType) || readOptionalText(change.operation) || readOptionalText(metadata.operationType) || readOptionalText(metadata.operation) || readOptionalText(audit.commandName),
          operationId,
          auditId: readOptionalText(change.auditId) || audit.id,
          sourceRevision: readOptionalText(change.sourceRevision) || readOptionalText(metadata.sourceRevision),
          targetRevision: readOptionalText(change.targetRevision) || readOptionalText(metadata.targetRevision),
          yearMonth: readOptionalText(change.yearMonth),
          weekNo: safeAmount(change.weekNo),
          mode,
          lineId: readOptionalText(change.lineId) || readOptionalText(change.cashflowLine),
          beforeState,
          beforeHadValue: beforeState !== 'EMPTY',
          ...(beforeState !== 'EMPTY' ? { beforeAmount: safeAmount(before.amount) } : {}),
          afterState,
          afterHadValue: afterState !== 'EMPTY',
          ...(afterState !== 'EMPTY' ? { afterAmount: safeAmount(after.amount) } : {}),
          actorUid: readOptionalText(change.actorId) || readOptionalText(change.actorUid) || readOptionalText(audit.actorId),
          actorName: readOptionalText(change.actorName) || readOptionalText(metadata.actorName),
          actorEmail: readOptionalText(change.actorEmail) || readOptionalText(metadata.actorEmail),
          reason: readOptionalText(change.reason) || readOptionalText(metadata.reason) || readOptionalText(metadata.amendmentReason),
          createdAt: readOptionalText(change.changedAt) || readOptionalText(audit.createdAt),
        };
      });
    });
  return [...legacyEvents, ...refreshEvents, ...sheetApplyEvents, ...appliedCellEvents, ...closeEvents]
    .filter((event) => readOptionalText(event.createdAt))
    .sort((left, right) => readOptionalText(right.createdAt).localeCompare(readOptionalText(left.createdAt)));
}

function safeAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : 0;
}

function normalizeMonthCloseCell(cell, yearMonth) {
  const value = objectValue(cell);
  if (!value) return null;
  const mode = readOptionalText(value.mode).toLowerCase();
  const weekNo = Number(value.weekNo);
  const cashflowLine = readOptionalText(value.cashflowLine) || readOptionalText(value.lineId);
  const cellState = readOptionalText(value.cellState) || readOptionalText(value.state);
  if (
    !['projection', 'actual'].includes(mode)
    || !Number.isSafeInteger(weekNo)
    || weekNo < 1
    || weekNo > 5
    || !CASHFLOW_ALL_LINES.includes(cashflowLine)
    || !['VALUE', 'ZERO', 'EMPTY'].includes(cellState)
    || (readOptionalText(value.yearMonth) && readOptionalText(value.yearMonth) !== yearMonth)
  ) return null;
  const amount = ['VALUE', 'ZERO'].includes(cellState) ? Number(value.amount) : null;
  if (['VALUE', 'ZERO'].includes(cellState) && !Number.isSafeInteger(amount)) return null;
  if (cellState === 'ZERO' && amount !== 0) return null;
  return {
    mode,
    weekNo,
    cashflowLine,
    cellState,
    amount,
    sourceCell: readOptionalText(value.sourceCell) || null,
    sourceLabel: readOptionalText(value.sourceLabel) || null,
  };
}

function normalizeMonthCloseCells(cells, yearMonth) {
  return (Array.isArray(cells) ? cells : [])
    .map((cell) => normalizeMonthCloseCell(cell, yearMonth))
    .filter(Boolean);
}

function completeMonthCloseCells(cells) {
  if (cells.length !== CASHFLOW_ALL_LINES.length * 2 * 5) return false;
  const keys = new Set(cells.map((cell) => `${cell.mode}:${cell.weekNo}:${cell.cashflowLine}`));
  return keys.size === CASHFLOW_ALL_LINES.length * 2 * 5;
}

function sumSafe(values) {
  let total = 0;
  for (const value of values) {
    const next = total + safeAmount(value);
    if (!Number.isSafeInteger(next)) return null;
    total = next;
  }
  return total;
}

function buildMonthModeReadModel(cells, mode) {
  const rowTotals = Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [lineId, 0]));
  let runningIn = 0;
  let runningOut = 0;
  const weeks = Array.from({ length: 5 }, (_, index) => {
    const weekNo = index + 1;
    const amounts = Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => {
      const cell = cells.find((candidate) => (
        candidate.mode === mode && candidate.weekNo === weekNo && candidate.cashflowLine === lineId
      ));
      return [lineId, ['VALUE', 'ZERO'].includes(cell?.cellState) ? safeAmount(cell.amount) : 0];
    }));
    for (const lineId of CASHFLOW_ALL_LINES) rowTotals[lineId] += amounts[lineId];
    const weekIn = sumSafe(CASHFLOW_IN_LINES.map((lineId) => amounts[lineId]));
    const weekOut = sumSafe(CASHFLOW_OUT_LINES.map((lineId) => amounts[lineId]));
    if (weekIn === null || weekOut === null) return null;
    runningIn += weekIn;
    runningOut += weekOut;
    return { weekNo, amounts, totalIn: weekIn, totalOut: weekOut, net: runningIn - runningOut, weekIn, weekOut };
  });
  if (weeks.some((week) => week === null) || !Number.isSafeInteger(runningIn) || !Number.isSafeInteger(runningOut)) {
    return null;
  }
  return {
    rowTotals,
    weeks,
    monthTotals: { totalIn: runningIn, totalOut: runningOut, net: runningIn - runningOut },
  };
}

function canonicalMonthCells(month, yearMonth) {
  return ['projection', 'actual'].flatMap((mode) => {
    const weeks = new Map((Array.isArray(month?.[mode]?.weeks) ? month[mode].weeks : [])
      .map((week) => [Number(week?.weekNo), objectValue(week?.amounts) || {}]));
    return Array.from({ length: 5 }, (_, index) => index + 1).flatMap((weekNo) => {
      const amounts = weeks.get(weekNo) || {};
      return CASHFLOW_ALL_LINES.map((cashflowLine) => {
        const hasValue = Object.hasOwn(amounts, cashflowLine);
        const amount = hasValue ? safeAmount(amounts[cashflowLine]) : null;
        return {
          yearMonth,
          mode,
          weekNo,
          cashflowLine,
          cellState: hasValue ? (amount === 0 ? 'ZERO' : 'VALUE') : 'EMPTY',
          ...(hasValue ? { amount } : {}),
        };
      });
    });
  });
}

function monthWeeksFromCells(cells, yearMonth) {
  const modes = {
    projection: buildMonthModeReadModel(cells, 'projection'),
    actual: buildMonthModeReadModel(cells, 'actual'),
  };
  return Array.from({ length: 5 }, (_, index) => {
    const weekNo = index + 1;
    const financeWeek = getMonthFinanceWeeks(yearMonth).find((week) => week.weekNo === weekNo) || {};
    return {
      yearMonth,
      weekNo,
      weekStart: financeWeek.weekStart || '',
      weekEnd: financeWeek.weekEnd || '',
      projection: modes.projection?.weeks?.find((week) => week.weekNo === weekNo)?.amounts || {},
      actual: modes.actual?.weeks?.find((week) => week.weekNo === weekNo)?.amounts || {},
    };
  });
}

function canonicalPinnedSheetWeeks(pinnedSheetCells) {
  const cellsByMonth = new Map();
  for (const sourceCell of Array.isArray(pinnedSheetCells) ? pinnedSheetCells : []) {
    const source = objectValue(sourceCell);
    const yearMonth = readOptionalText(source?.yearMonth);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)) continue;
    const cell = normalizeMonthCloseCell(source, yearMonth);
    if (!cell) continue;
    const monthCells = cellsByMonth.get(yearMonth) || [];
    monthCells.push(cell);
    cellsByMonth.set(yearMonth, monthCells);
  }
  return [...cellsByMonth.entries()]
    .filter(([, monthCells]) => completeMonthCloseCells(monthCells))
    .flatMap(([yearMonth, monthCells]) => monthWeeksFromCells(monthCells, yearMonth))
    .sort((left, right) => cashflowRangeSortKey(left) - cashflowRangeSortKey(right));
}

function canonicalCashflowWeeks(cashflow, cells, yearMonth, pinnedSheetCells) {
  const pinnedWeeks = canonicalPinnedSheetWeeks(pinnedSheetCells);
  const byKey = new Map();
  for (const month of Array.isArray(cashflow?.readModel?.months) ? cashflow.readModel.months : []) {
    const monthKey = readOptionalText(month?.yearMonth);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(monthKey)) continue;
    const financeWeeks = getMonthFinanceWeeks(monthKey);
    for (let weekNo = 1; weekNo <= 5; weekNo += 1) {
      const financeWeek = financeWeeks.find((week) => week.weekNo === weekNo) || {};
      byKey.set(`${monthKey}:${weekNo}`, {
        yearMonth: monthKey,
        weekNo,
        weekStart: financeWeek.weekStart || '',
        weekEnd: financeWeek.weekEnd || '',
        projection: month?.projection?.weeks?.find((week) => Number(week?.weekNo) === weekNo)?.amounts || {},
        actual: month?.actual?.weeks?.find((week) => Number(week?.weekNo) === weekNo)?.amounts || {},
      });
    }
  }
  if (byKey.size > 0) {
    for (const pinnedWeek of pinnedWeeks) {
      const key = `${pinnedWeek.yearMonth}:${pinnedWeek.weekNo}`;
      if (!byKey.has(key)) byKey.set(key, { ...pinnedWeek, projection: {}, actual: {} });
    }
    return [...byKey.values()].sort((left, right) => cashflowRangeSortKey(left) - cashflowRangeSortKey(right));
  }
  if (pinnedWeeks.length > 0) {
    const pinnedByKey = new Map(pinnedWeeks.map((week) => [`${week.yearMonth}:${week.weekNo}`, week]));
    if (completeMonthCloseCells(cells)) {
      for (const week of monthWeeksFromCells(cells, yearMonth)) pinnedByKey.set(`${yearMonth}:${week.weekNo}`, week);
    }
    return [...pinnedByKey.values()].sort((left, right) => cashflowRangeSortKey(left) - cashflowRangeSortKey(right));
  }
  if (completeMonthCloseCells(cells)) {
    for (const week of monthWeeksFromCells(cells, yearMonth)) byKey.set(`${yearMonth}:${week.weekNo}`, week);
  }
  return [...byKey.values()].sort((left, right) => (
    cashflowRangeSortKey(left) - cashflowRangeSortKey(right)
  ));
}

function cashflowCellKey(yearMonth, cell) {
  return `${yearMonth}:${cell.mode}:${cell.weekNo}:${cell.cashflowLine}`;
}

function canonicalCashflowCellStates(cashflow, cells, yearMonth, pinnedSheetCells) {
  const canonicalMonths = Array.isArray(cashflow?.readModel?.months) ? cashflow.readModel.months : [];
  if (canonicalMonths.length > 0) {
    const canonical = new Map();
    for (const month of canonicalMonths) {
      const monthKey = readOptionalText(month?.yearMonth);
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(monthKey)) continue;
      for (const mode of ['projection', 'actual']) {
        for (const week of Array.isArray(month?.[mode]?.weeks) ? month[mode].weeks : []) {
          const weekNo = Number(week?.weekNo);
          const amounts = objectValue(week?.amounts);
          if (!Number.isInteger(weekNo) || weekNo < 1 || weekNo > 5) continue;
          for (const lineId of CASHFLOW_ALL_LINES) {
            if (!Object.prototype.hasOwnProperty.call(amounts, lineId)) continue;
            canonical.set(`${monthKey}:${mode}:${weekNo}:${lineId}`, {
              mode,
              weekNo,
              cashflowLine: lineId,
              cellState: 'VALUE',
              amount: safeAmount(amounts[lineId]),
            });
          }
        }
      }
    }
    return canonical;
  }
  const byKey = new Map();
  for (const sourceCell of Array.isArray(pinnedSheetCells) ? pinnedSheetCells : []) {
    const source = objectValue(sourceCell);
    const sourceYearMonth = readOptionalText(source?.yearMonth);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(sourceYearMonth)) continue;
    const cell = normalizeMonthCloseCell(source, sourceYearMonth);
    if (cell) byKey.set(cashflowCellKey(sourceYearMonth, cell), cell);
  }
  for (const cell of Array.isArray(cells) ? cells : []) {
    if (cell) byKey.set(cashflowCellKey(yearMonth, cell), cell);
  }
  return byKey;
}

function managementCheck(id, status, title, detail, findings = []) {
  return findings.length > 0 ? { id, status, title, detail, findings } : { id, status, title, detail };
}

function laborTransferCheck(weeks, cellStates, yearMonth, asOfKey) {
  const yearMonths = [...new Set([yearMonth, ...weeks.map((week) => readOptionalText(week.yearMonth))])].sort();
  const warnings = [];
  const reviews = [];
  for (const yearMonth of yearMonths) {
    if (cashflowRangeSortKey({ yearMonth, weekNo: 3 }) > asOfKey) continue;
    const projection = cellStates.get(`${yearMonth}:projection:3:MYSC_LABOR_OUT`);
    if (!projection || projection.cellState === 'EMPTY') {
      warnings.push(`${yearMonth} 3주차 인건비 미입력`);
      continue;
    }
    const plannedAmount = safeAmount(projection.amount);
    if (plannedAmount === 0) {
      reviews.push(`${yearMonth} 3주차 인건비 미입력`);
      continue;
    }
    const actual = cellStates.get(`${yearMonth}:actual:3:MYSC_LABOR_OUT`);
    if (!actual || actual.cellState === 'EMPTY') {
      warnings.push(`${yearMonth} 3주차 · 예정 ${plannedAmount.toLocaleString('ko-KR')}원 · Actual 인건비 미기입`);
      continue;
    }
    const actualAmount = safeAmount(actual.amount);
    if (actualAmount === 0) {
      warnings.push(`${yearMonth} 3주차 · 예정 ${plannedAmount.toLocaleString('ko-KR')}원 · 실제 0원 · 실제 미이관`);
    } else if (actualAmount < plannedAmount) {
      warnings.push(`${yearMonth} 3주차 · 예정 ${plannedAmount.toLocaleString('ko-KR')}원 · 실제 ${actualAmount.toLocaleString('ko-KR')}원 · 일부 이관`);
    }
  }
  const findings = warnings.length > 0 ? warnings : reviews;
  return managementCheck(
    'labor-transfer',
    warnings.length > 0 ? 'WARNING' : reviews.length > 0 ? 'REVIEW_REQUIRED' : 'OK',
    'MYSC 인건비 이관',
    findings.length > 0 ? findings.join(', ') : '기준일까지 모든 3주차 인건비 이관을 확인했습니다.',
    findings,
  );
}

function profitVatAfterDepositCheck(weeks) {
  const due = [];
  const deposits = weeks.filter((week) => safeAmount(week.projection?.SALES_IN) > 0);
  for (const deposit of deposits) {
    const index = weeks.indexOf(deposit);
    const next = weeks[index + 1];
    const gapMs = next?.weekStart && deposit.weekEnd
      ? Date.parse(`${next.weekStart}T00:00:00Z`) - Date.parse(`${deposit.weekEnd}T00:00:00Z`)
      : Number.POSITIVE_INFINITY;
    const targets = [deposit, gapMs <= 8 * 86_400_000 ? next : null].filter(Boolean);
    const hasProfit = targets.some((week) => safeAmount(week.projection?.MYSC_PROFIT_OUT) > 0);
    const hasVat = targets.some((week) => safeAmount(week.projection?.SALES_VAT_OUT) > 0);
    const missing = [hasProfit ? null : 'MYSC 수익', hasVat ? null : '매출부가세'].filter(Boolean);
    if (missing.length > 0) {
      due.push(`${deposit.yearMonth} ${deposit.weekNo}주차에 매출입금이 있으나 [${missing.join('·')}] 계획이 Projection에 없습니다.`);
    }
  }
  if (deposits.length === 0) {
    return managementCheck('profit-vat-after-deposit', 'REVIEW_REQUIRED', '입금 후 MYSC 수익·매출부가세 이관(해당 주, 차주)', 'Projection 매출입금이 없습니다. 해당 없음 여부를 사람이 확인해 주세요.');
  }
  return managementCheck(
    'profit-vat-after-deposit',
    due.length > 0 ? 'WARNING' : 'OK',
    '입금 후 MYSC 수익·매출부가세 이관(해당 주, 차주)',
    due.length > 0 ? `입금 주차 또는 다음 주차까지 미이관: ${due.join(', ')}` : 'Projection 매출입금의 같은 주차 또는 다음 주차 이관을 확인했습니다.',
    due,
  );
}

function negativeProjectionCheck(weeks, openingBalance = 0) {
  let balance = safeAmount(openingBalance);
  let prepay = 0;
  const findings = [];
  for (const week of weeks) {
    const totalIn = sumSafe(CASHFLOW_IN_LINES.map((lineId) => week.projection?.[lineId])) || 0;
    const totalOut = sumSafe(CASHFLOW_OUT_LINES.map((lineId) => week.projection?.[lineId])) || 0;
    balance += totalIn - totalOut;
    prepay += safeAmount(week.projection?.MYSC_PREPAY_IN);
    if (balance < 0) {
      findings.push(`${week.yearMonth} ${week.weekNo}주차 · 잔액 ${balance.toLocaleString('ko-KR')}원${prepay > 0 ? '' : ' · MYSC 선입금 Projection 없음'}`);
    }
  }
  if (findings.length > 0) {
    return managementCheck(
      'negative-projection-balance',
      'WARNING',
      'Projection 잔액 마이너스',
      `${findings.length}개 주차에서 마이너스 · 최초 ${findings[0]}`,
      findings,
    );
  }
  return managementCheck('negative-projection-balance', 'OK', 'Projection 잔액 마이너스', 'Projection 누적 잔액이 0원 이상입니다.');
}

function futurePrepayCheck(weeks, asOfKey) {
  const occurrences = weeks.filter((week) => (
    cashflowRangeSortKey(week) > asOfKey && safeAmount(week.projection?.MYSC_PREPAY_IN) > 1_000_000
  ));
  return managementCheck(
    'future-prepay-over-million',
    occurrences.length > 0 ? 'WARNING' : 'OK',
    '금주 이후 선입금 요청 100만원 초과',
    occurrences.length > 0
      ? occurrences.map((week) => `${week.yearMonth} ${week.weekNo}주차 ${safeAmount(week.projection?.MYSC_PREPAY_IN).toLocaleString('ko-KR')}원`).join(', ')
      : '금주 이후 100만원 초과 요청이 없습니다.',
    occurrences.map((week) => `${week.yearMonth} ${week.weekNo}주차 · ${safeAmount(week.projection?.MYSC_PREPAY_IN).toLocaleString('ko-KR')}원`),
  );
}

export function buildCashflowManagementChecks({ cashflow, cells, yearMonth, depositScheduleRows, comparisonBoundary, pinnedSheetCells, projectionOpeningBalance = 0 }) {
  const weeks = canonicalCashflowWeeks(cashflow, cells, yearMonth, pinnedSheetCells);
  const cellStates = canonicalCashflowCellStates(cashflow, cells, yearMonth, pinnedSheetCells);
  const asOfKey = cashflowRangeSortKey(comparisonBoundary?.asOfWeek || { yearMonth, weekNo: 5 });
  const deposits = (Array.isArray(depositScheduleRows) ? depositScheduleRows : []).map((row) => ({
    ...row,
    yearMonth: /^20\d{2}-(0[1-9]|1[0-2])$/.test(readOptionalText(row?.yearMonth)) ? row.yearMonth : yearMonth,
  }));
  return [
    laborTransferCheck(weeks, cellStates, yearMonth, asOfKey),
    profitVatAfterDepositCheck(weeks),
    negativeProjectionCheck(weeks, projectionOpeningBalance),
    futurePrepayCheck(weeks, asOfKey),
  ];
}

function validManagementConfirmations(confirmations) {
  const byId = new Map();
  for (const item of Array.isArray(confirmations) ? confirmations : []) {
    const checkId = readOptionalText(item?.checkId);
    const decision = readOptionalText(item?.decision).toUpperCase();
    if (!CASHFLOW_MANAGEMENT_CHECK_IDS.includes(checkId) || !['CONFIRMED', 'NOT_APPLICABLE'].includes(decision)) continue;
    byId.set(checkId, { checkId, decision });
  }
  return byId;
}

function matchingManagementChecks(expected, actual) {
  const select = (items) => (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: readOptionalText(item?.id),
      status: readOptionalText(item?.status),
      title: readOptionalText(item?.title),
      detail: readOptionalText(item?.detail),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return select(expected).length === CASHFLOW_MANAGEMENT_CHECK_IDS.length
    && stableStringify(select(expected)) === stableStringify(select(actual));
}

function actualWrittenProgressPercent(cells, yearMonth, comparisonBoundary) {
  const asOfYearMonth = readOptionalText(comparisonBoundary?.asOfWeek?.yearMonth);
  const asOfWeekNo = Number(comparisonBoundary?.asOfWeek?.weekNo);
  const targetWeekCount = yearMonth < asOfYearMonth ? 5 : yearMonth === asOfYearMonth ? Math.max(0, Math.min(5, asOfWeekNo)) : 0;
  if (targetWeekCount === 0) return 0;
  const target = cells.filter((cell) => cell.mode === 'actual' && cell.weekNo <= targetWeekCount);
  const expected = targetWeekCount * CASHFLOW_ALL_LINES.length;
  if (expected === 0) return 0;
  return Math.round((Math.min(expected, target.length) / expected) * 10_000) / 100;
}

function settlementProgress(comparison, confirmations, yearMonth, comparisonBoundary) {
  const asOfYearMonth = readOptionalText(comparisonBoundary?.asOfWeek?.yearMonth);
  const asOfWeekNo = Number(comparisonBoundary?.asOfWeek?.weekNo);
  const targetWeekCount = yearMonth < asOfYearMonth ? 5 : yearMonth === asOfYearMonth ? Math.max(0, Math.min(5, asOfWeekNo)) : 0;
  if (targetWeekCount === 0) return { percent: 0, completed: 0, total: 0, incompleteWeeks: [] };

  const confirmationKeys = validConfirmationKeys(confirmations);
  const weeks = new Map((Array.isArray(comparison?.weeks) ? comparison.weeks : []).map((week) => [Number(week?.weekNo), week]));
  const incompleteWeeks = [];
  let completed = 0;
  for (let weekNo = 1; weekNo <= targetWeekCount; weekNo += 1) {
    const week = weeks.get(weekNo);
    const lines = Array.isArray(week?.lines) ? week.lines : [];
    const matches = lines.length === CASHFLOW_ALL_LINES.length
      && lines.every((line) => safeAmount(line?.difference) === 0);
    const humanConfirmed = ['projection', 'actual'].every((mode) => (
      CASHFLOW_ALL_LINES.every((cashflowLine) => confirmationKeys.has(`${mode}:${weekNo}:${cashflowLine}`))
    ));
    if (matches || humanConfirmed) {
      completed += 1;
      continue;
    }
    incompleteWeeks.push({
      yearMonth,
      weekNo,
      totalIn: safeAmount(week?.totalIn),
      totalOut: safeAmount(week?.totalOut),
      balance: safeAmount(week?.net),
      reason: lines.length === CASHFLOW_ALL_LINES.length ? 'DIFFERENCE_REVIEW_REQUIRED' : 'SOURCE_INCOMPLETE',
    });
  }
  return {
    percent: Math.round((completed / targetWeekCount) * 10_000) / 100,
    completed,
    total: targetWeekCount,
    incompleteWeeks,
  };
}

function postCloseAdjustment(close, currentSnapshot) {
  const previous = objectValue(close?.previousSnapshot);
  if (!previous || Object.keys(previous).length === 0) return null;
  const amounts = (snapshot) => {
    const result = new Map();
    for (const week of Array.isArray(snapshot?.weeklyTotals) ? snapshot.weeklyTotals : []) {
      const weekNo = Number(week?.weekNo);
      for (const mode of ['projection', 'actual']) {
        const values = objectValue(week?.[mode]) || {};
        for (const lineId of CASHFLOW_ALL_LINES) result.set(`${mode}:${weekNo}:${lineId}`, safeAmount(values[lineId]));
      }
    }
    return result;
  };
  const before = amounts(previous);
  const after = amounts(currentSnapshot);
  const changes = [...after.entries()].flatMap(([key, afterAmount]) => {
    const beforeAmount = before.get(key) || 0;
    if (beforeAmount === afterAmount) return [];
    const [mode, weekNo, cashflowLine] = key.split(':');
    return [{ mode, weekNo: Number(weekNo), cashflowLine, beforeAmount, afterAmount }];
  });
  const reopenContext = objectValue(currentSnapshot?.reopenContext) || {};
  const request = objectValue(reopenContext.request) || {};
  const decision = objectValue(reopenContext.decision) || {};
  return {
    reason: readOptionalText(request.reason) || readOptionalText(decision.reason) || '재오픈 후 조정',
    changedCount: changes.length,
    changes: changes.slice(0, 200),
  };
}

function parseCashflowRangeBoundary(value, fieldName) {
  const normalized = readOptionalText(value);
  if (!normalized) return null;
  const match = /^(\d{4}-(?:0[1-9]|1[0-2])):([1-5])$/.exec(normalized);
  if (!match) {
    throw createHttpError(
      400,
      `${fieldName} must use YYYY-MM:week format.`,
      'cashflow_range_invalid',
    );
  }
  return {
    yearMonth: match[1],
    weekNo: Number(match[2]),
  };
}

function cashflowRangeSortKey(boundary) {
  return Number(boundary.yearMonth.replace('-', '')) * 10 + Number(boundary.weekNo);
}

function cashflowReadModelBoundaries(months) {
  const boundaries = [];
  for (const month of Array.isArray(months) ? months : []) {
    const yearMonth = readOptionalText(month?.yearMonth);
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(yearMonth)) continue;
    const weekNumbers = new Set();
    for (const mode of ['projection', 'actual']) {
      for (const week of Array.isArray(month?.[mode]?.weeks) ? month[mode].weeks : []) {
        const weekNo = Number(week?.weekNo);
        if (Number.isSafeInteger(weekNo) && weekNo >= 1 && weekNo <= 5) weekNumbers.add(weekNo);
      }
    }
    for (const weekNo of weekNumbers) boundaries.push({ yearMonth, weekNo });
  }
  return boundaries.sort((left, right) => cashflowRangeSortKey(left) - cashflowRangeSortKey(right));
}

function resolveCashflowReadModelRange({ months, rawStart, rawEnd, comparisonBoundary }) {
  const knownBoundaries = cashflowReadModelBoundaries(months);
  const fallbackYearMonth = readOptionalText(comparisonBoundary?.asOfWeek?.yearMonth);
  const start = parseCashflowRangeBoundary(rawStart, 'rangeStart')
    || knownBoundaries[0]
    || { yearMonth: fallbackYearMonth, weekNo: 1 };
  const end = parseCashflowRangeBoundary(rawEnd, 'rangeEnd')
    || knownBoundaries.at(-1)
    || { yearMonth: fallbackYearMonth, weekNo: 5 };
  if (!start.yearMonth || !end.yearMonth || cashflowRangeSortKey(start) > cashflowRangeSortKey(end)) {
    throw createHttpError(400, 'rangeStart must be before or equal to rangeEnd.', 'cashflow_range_invalid');
  }
  return { start, end };
}

function buildCashflowRangeTotals(months, mode, range) {
  const startKey = cashflowRangeSortKey(range.start);
  const endKey = cashflowRangeSortKey(range.end);
  const rowTotals = Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [lineId, 0]));
  let totalIn = 0;
  let totalOut = 0;
  for (const month of Array.isArray(months) ? months : []) {
    const yearMonth = readOptionalText(month?.yearMonth);
    for (const week of Array.isArray(month?.[mode]?.weeks) ? month[mode].weeks : []) {
      const weekNo = Number(week?.weekNo);
      if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(yearMonth) || !Number.isSafeInteger(weekNo)) continue;
      const sortKey = cashflowRangeSortKey({ yearMonth, weekNo });
      if (sortKey < startKey || sortKey > endKey) continue;
      const amounts = week?.amounts && typeof week.amounts === 'object' ? week.amounts : {};
      for (const lineId of CASHFLOW_ALL_LINES) {
        const next = rowTotals[lineId] + safeAmount(amounts[lineId]);
        if (!Number.isSafeInteger(next)) {
          throw createHttpError(502, '합계 금액에 올바르지 않은 값이 있어 화면에 표시할 수 없습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_cashflow_totals_invalid');
        }
        rowTotals[lineId] = next;
      }
      const weekIn = sumSafe(CASHFLOW_IN_LINES.map((lineId) => amounts[lineId]));
      const weekOut = sumSafe(CASHFLOW_OUT_LINES.map((lineId) => amounts[lineId]));
      if (weekIn === null || weekOut === null) {
        throw createHttpError(502, '합계 금액에 올바르지 않은 값이 있어 화면에 표시할 수 없습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_cashflow_totals_invalid');
      }
      totalIn += weekIn;
      totalOut += weekOut;
      if (!Number.isSafeInteger(totalIn) || !Number.isSafeInteger(totalOut)) {
        throw createHttpError(502, '합계 금액에 올바르지 않은 값이 있어 화면에 표시할 수 없습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_cashflow_totals_invalid');
      }
    }
  }
  const net = totalIn - totalOut;
  if (!Number.isSafeInteger(net)) {
    throw createHttpError(502, '합계 금액에 올바르지 않은 값이 있어 화면에 표시할 수 없습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_cashflow_totals_invalid');
  }
  return { rowTotals, totalIn, totalOut, net };
}

function cashflowReadModelForYear(readModel, selectedYear) {
  const canonical = objectValue(readModel);
  if (!canonical || !Array.isArray(canonical.months)) return null;
  const range = {
    start: { yearMonth: `${selectedYear}-01`, weekNo: 1 },
    end: { yearMonth: `${selectedYear}-12`, weekNo: 5 },
  };
  return {
    ...canonical,
    range: {
      ...range,
      projection: buildCashflowRangeTotals(canonical.months, 'projection', range),
      actual: buildCashflowRangeTotals(canonical.months, 'actual', range),
    },
  };
}

function frozenCashflowReadModel(ledgerWeeks) {
  const weeks = (Array.isArray(ledgerWeeks) ? ledgerWeeks : [])
    .map((raw) => {
      const source = objectValue(raw);
      const yearMonth = readOptionalText(source?.yearMonth);
      const weekNo = Number(source?.weekNo);
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth) || !Number.isSafeInteger(weekNo) || weekNo < 1 || weekNo > 5) {
        return null;
      }
      const modes = {};
      for (const mode of ['projection', 'actual']) {
        const rawAmounts = objectValue(source?.[mode]) || {};
        const amounts = {};
        for (const lineId of CASHFLOW_ALL_LINES) {
          if (!Object.prototype.hasOwnProperty.call(rawAmounts, lineId)) continue;
          const amount = Number(rawAmounts[lineId]);
          if (!Number.isSafeInteger(amount)) {
            throw createHttpError(502, '결산된 달의 금액 중 올바르지 않은 값이 있어 화면에 표시할 수 없습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_cashflow_totals_invalid');
          }
          amounts[lineId] = amount;
        }
        modes[mode] = amounts;
      }
      return { yearMonth, weekNo, ...modes };
    })
    .filter(Boolean)
    .sort((left, right) => cashflowRangeSortKey(left) - cashflowRangeSortKey(right));
  if (weeks.length === 0) return null;

  const running = {
    projection: { totalIn: 0, totalOut: 0 },
    actual: { totalIn: 0, totalOut: 0 },
  };
  const months = new Map();
  for (const sourceWeek of weeks) {
    const month = months.get(sourceWeek.yearMonth) || {
      yearMonth: sourceWeek.yearMonth,
      projection: { rowTotals: Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [lineId, 0])), weeks: [], totalIn: 0, totalOut: 0 },
      actual: { rowTotals: Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [lineId, 0])), weeks: [], totalIn: 0, totalOut: 0 },
    };
    for (const mode of ['projection', 'actual']) {
      const amounts = sourceWeek[mode];
      for (const lineId of CASHFLOW_ALL_LINES) {
        month[mode].rowTotals[lineId] += safeAmount(amounts[lineId]);
      }
      const weekIn = sumSafe(CASHFLOW_IN_LINES.map((lineId) => amounts[lineId]));
      const weekOut = sumSafe(CASHFLOW_OUT_LINES.map((lineId) => amounts[lineId]));
      if (weekIn === null || weekOut === null) {
        throw createHttpError(502, '결산된 달의 항목 합계에 올바르지 않은 값이 있어 화면에 표시할 수 없습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_cashflow_totals_invalid');
      }
      running[mode].totalIn += weekIn;
      running[mode].totalOut += weekOut;
      month[mode].totalIn += weekIn;
      month[mode].totalOut += weekOut;
      for (const value of [
        running[mode].totalIn,
        running[mode].totalOut,
        month[mode].totalIn,
        month[mode].totalOut,
      ]) {
        if (!Number.isSafeInteger(value)) {
          throw createHttpError(502, '결산된 달의 누적 합계에 올바르지 않은 값이 있어 화면에 표시할 수 없습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_cashflow_totals_invalid');
        }
      }
      month[mode].weeks.push({
        weekNo: sourceWeek.weekNo,
        amounts,
        totalIn: weekIn,
        totalOut: weekOut,
        weekIn,
        weekOut,
        net: running[mode].totalIn - running[mode].totalOut,
      });
    }
    months.set(sourceWeek.yearMonth, month);
  }
  return {
    months: [...months.values()].map((month) => ({
      yearMonth: month.yearMonth,
      projection: {
        rowTotals: month.projection.rowTotals,
        weeks: month.projection.weeks,
        monthTotals: {
          totalIn: month.projection.totalIn,
          totalOut: month.projection.totalOut,
          net: month.projection.weeks.at(-1)?.net || 0,
        },
      },
      actual: {
        rowTotals: month.actual.rowTotals,
        weeks: month.actual.weeks,
        monthTotals: {
          totalIn: month.actual.totalIn,
          totalOut: month.actual.totalOut,
          net: month.actual.weeks.at(-1)?.net || 0,
        },
      },
    })),
  };
}

function differenceTotals(projection, actual) {
  return {
    totalIn: projection.totalIn - actual.totalIn,
    totalOut: projection.totalOut - actual.totalOut,
    balance: projection.balance - actual.balance,
  };
}

function dashboardTotals(mode) {
  return {
    totalIn: mode?.monthTotals?.totalIn || 0,
    totalOut: mode?.monthTotals?.totalOut || 0,
    balance: mode?.monthTotals?.net || 0,
    rowTotals: mode?.rowTotals || {},
    weeks: mode?.weeks || [],
  };
}

function buildCashflowMonthCloseMonthSnapshot({
  projectId, yearMonth, cells, sourceRevision, targetRevision, capturedAt, spreadsheetId, spreadsheetTitle, selectedSheetName,
}) {
  const modeSnapshot = (mode) => {
    const totals = dashboardTotals(buildMonthModeReadModel(cells, mode));
    return {
      ...totals,
      weeks: totals.weeks.map((week) => ({
        ...week,
        cells: CASHFLOW_ALL_LINES.map((cashflowLine) => {
          const cell = cells.find((candidate) => (
            candidate.mode === mode
            && candidate.weekNo === week.weekNo
            && candidate.cashflowLine === cashflowLine
          ));
          return { cashflowLine, cellState: cell.cellState, amount: cell.amount };
        }),
      })),
    };
  };
  const projection = modeSnapshot('projection');
  const actual = modeSnapshot('actual');
  return {
    schemaVersion: 1,
    projectId,
    yearMonth,
    source: {
      sourceRevision,
      targetRevision,
      capturedAt,
      spreadsheetId,
      spreadsheetTitle,
      selectedSheetName,
      spreadsheetUrl: spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`
        : null,
    },
    projection,
    actual,
    difference: differenceTotals(projection, actual),
  };
}

function canonicalWeeklyProjection(cashflow, fallback) {
  const months = Array.isArray(cashflow?.readModel?.months) ? cashflow.readModel.months : [];
  const boundaries = cashflowReadModelBoundaries(months);
  if (boundaries.length === 0) return { ...fallback, weeklyYears: [] };
  const totals = buildCashflowRangeTotals(months, 'projection', {
    start: boundaries[0],
    end: boundaries.at(-1),
  });
  return {
    totalIn: totals.totalIn,
    salesAndVatTotal: safeAmount(totals.rowTotals?.SALES_IN) + safeAmount(totals.rowTotals?.SALES_VAT_IN),
    weeklyYears: [...new Set(months
      .map((month) => Number(readOptionalText(month?.yearMonth).slice(0, 4)))
      .filter(Number.isSafeInteger))],
  };
}

function projectFinancialYears(project = {}) {
  const startText = readOptionalText(project.contractStart);
  const endText = readOptionalText(project.contractEnd);
  const startYear = /^\d{4}-/.test(startText) ? Number(startText.slice(0, 4)) : Number.NaN;
  const endYear = /^\d{4}-/.test(endText) ? Number(endText.slice(0, 4)) : Number.NaN;
  if (Number.isSafeInteger(startYear) && Number.isSafeInteger(endYear) && startYear <= endYear && endYear - startYear <= 20) {
    return Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
  }
  return [...new Set((Array.isArray(project.financialYears) ? project.financialYears : [])
    .map((row) => Number(row?.year))
    .filter(Number.isSafeInteger))].sort((left, right) => left - right);
}

function composeProjectionTotal({ project, cashflow, mirror, fallback, weeklyYearsHint = [] }) {
  const weekly = canonicalWeeklyProjection(cashflow, fallback);
  weekly.weeklyYears = [...new Set([...weekly.weeklyYears, ...weeklyYearsHint])].sort((left, right) => left - right);
  const annualYears = projectFinancialYears(project).filter((year) => !weekly.weeklyYears.includes(year));
  const annualTotals = new Map((Array.isArray(mirror?.sheetFacts?.annualCashflowTotals)
    ? mirror.sheetFacts.annualCashflowTotals
    : []).map((row) => [Number(row?.year), row]));
  const appliedAnnualYears = new Set((Array.isArray(mirror?.appliedAnnualYears)
    ? mirror.appliedAnnualYears
    : []).map(Number));
  const sourceIsApplied = readOptionalText(mirror?.appliedSourceRevision) === readOptionalText(mirror?.sourceRevision);
  const annual = annualYears.map((year) => {
    const total = sourceIsApplied && appliedAnnualYears.has(year) ? annualTotals.get(year) : null;
    return {
      year,
      source: total ? 'ANNUAL' : 'MISSING',
      totalIn: safeAmount(total?.projection?.totalIn),
      salesAndVatTotal: safeAmount(total?.projection?.lineAmounts?.SALES_IN)
        + safeAmount(total?.projection?.lineAmounts?.SALES_VAT_IN),
      salesAndVatSource: total?.projection?.lineAmounts ? 'ANNUAL_LINES' : 'MISSING',
    };
  });
  return {
    totalIn: weekly.totalIn + annual.reduce((sum, row) => sum + row.totalIn, 0),
    salesAndVatTotal: weekly.salesAndVatTotal + annual.reduce((sum, row) => sum + row.salesAndVatTotal, 0),
    years: [
      ...weekly.weeklyYears.map((year) => ({ year, source: 'WEEKLY' })),
      ...annual,
    ].sort((left, right) => left.year - right.year),
  };
}

function validConfirmationKeys(confirmations) {
  const keys = new Set();
  for (const confirmation of Array.isArray(confirmations) ? confirmations : []) {
    const mode = readOptionalText(confirmation?.mode).toLowerCase();
    const weekNo = Number(confirmation?.weekNo);
    const cashflowLine = readOptionalText(confirmation?.cashflowLine);
    const decision = readOptionalText(confirmation?.decision).toUpperCase();
    if (
      !['projection', 'actual'].includes(mode)
      || !Number.isSafeInteger(weekNo)
      || weekNo < 1
      || weekNo > 5
      || !CASHFLOW_ALL_LINES.includes(cashflowLine)
      || !['CONFIRMED', 'NOT_APPLICABLE'].includes(decision)
    ) continue;
    keys.add(`${mode}:${weekNo}:${cashflowLine}`);
  }
  return keys;
}

function completeMonthCloseConfirmations(confirmations) {
  const expectedCount = CASHFLOW_ALL_LINES.length * 2 * 5;
  return Array.isArray(confirmations)
    && confirmations.length === expectedCount
    && validConfirmationKeys(confirmations).size === expectedCount;
}

function closeSnapshotCells(snapshot, yearMonth) {
  const pinnedCells = normalizeMonthCloseCells(snapshot?.cells, yearMonth);
  if (pinnedCells.length > 0) return pinnedCells;
  return (Array.isArray(snapshot?.weeklyTotals) ? snapshot.weeklyTotals : []).flatMap((week) => (
    ['projection', 'actual'].flatMap((mode) => CASHFLOW_ALL_LINES.map((cashflowLine) => {
      const amounts = objectValue(week?.[mode]) || {};
      const hasValue = Object.hasOwn(amounts, cashflowLine);
      const amount = hasValue ? safeAmount(amounts[cashflowLine]) : null;
      return normalizeMonthCloseCell({
        mode,
        weekNo: week?.weekNo,
        cashflowLine,
        cellState: hasValue ? (amount === 0 ? 'ZERO' : 'VALUE') : 'EMPTY',
        ...(hasValue ? { amount } : {}),
      }, yearMonth);
    }))
  )).filter(Boolean);
}

function normalizedMetadataText(value) {
  return readOptionalText(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function projectSheetWarnings(project, metadata) {
  const warnings = [];
  const businessType = normalizedMetadataText(metadata?.businessType?.value);
  const accountType = normalizedMetadataText(metadata?.accountType?.value);
  const settlementStatus = normalizedMetadataText(metadata?.settlementStatus?.value);
  const settlementType = readOptionalText(project?.settlementType).toUpperCase();
  const basis = normalizedMetadataText(project?.basis);
  if (!businessType) {
    warnings.push({ code: 'SHEET_BUSINESS_TYPE_MISSING', message: '시트의 사업 구분을 확인해 주세요.' });
  } else if (
    (settlementType !== 'NONE' && !businessType.includes(settlementType.toLowerCase()))
    || (basis && basis !== 'none' && !businessType.includes(basis))
  ) {
    warnings.push({ code: 'PROJECT_SHEET_BUSINESS_TYPE_MISMATCH', message: '프로젝트 등록 정보와 시트의 사업 구분이 다릅니다.' });
  }
  if (!accountType) {
    warnings.push({ code: 'SHEET_ACCOUNT_TYPE_MISSING', message: '시트의 전용계좌사업 여부를 확인해 주세요.' });
  } else if ((project?.accountType === 'DEDICATED') !== accountType.includes('전용계좌')) {
    warnings.push({ code: 'PROJECT_SHEET_ACCOUNT_TYPE_MISMATCH', message: '프로젝트 등록 정보와 시트의 계좌 구분이 다릅니다.' });
  }
  const expectsSettlement = settlementType !== 'NONE';
  if (!settlementStatus) {
    warnings.push({ code: 'SHEET_SETTLEMENT_STATUS_MISSING', message: '시트의 정산 여부를 확인해 주세요.' });
  } else if (expectsSettlement !== settlementStatus.includes('정산진행')) {
    warnings.push({ code: 'PROJECT_SHEET_SETTLEMENT_STATUS_MISMATCH', message: '프로젝트 등록 정보와 시트의 정산 여부가 다릅니다.' });
  }
  return warnings;
}

function projectMetadata(project) {
  const settlementType = readOptionalText(project?.settlementType).toUpperCase();
  const basis = readOptionalText(project?.basis);
  return {
    businessType: [settlementType && settlementType !== 'NONE' ? settlementType : '', basis && basis !== 'NONE' ? basis : '']
      .filter(Boolean).join(' · ') || '미정',
    accountType: project?.accountType === 'DEDICATED' ? '전용계좌사업' : project?.accountType ? '운영계좌사업' : '미정',
    settlementStatus: !settlementType ? '미정' : settlementType !== 'NONE' ? '정산진행' : '정산없음',
  };
}

function monthsBetween(startYearMonth, endYearMonth) {
  const result = [];
  let cursor = new Date(`${startYearMonth}-01T00:00:00Z`);
  const end = new Date(`${endYearMonth}-01T00:00:00Z`);
  while (cursor <= end && result.length < 240) {
    result.push(cursor.toISOString().slice(0, 7));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return result;
}

function previousYearMonth(yearMonth) {
  const month = new Date(`${yearMonth}-01T00:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() - 1);
  return month.toISOString().slice(0, 7);
}

function cumulativeCloseMonths(yearMonth) {
  const throughMonth = previousYearMonth(yearMonth);
  const months = monthsBetween(CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH, throughMonth);
  if (
    throughMonth < CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH
    || months.length === 0
    || months.at(-1) !== throughMonth
  ) {
    throw createHttpError(
      400,
      '누적 월 결산 범위는 2023-01부터 최대 240개월까지 선택할 수 있습니다.',
      'cashflow_month_close_request_invalid',
    );
  }
  return months;
}

function buildCumulativeCloseScope(yearMonth, evidence = null) {
  const months = cumulativeCloseMonths(yearMonth);
  const throughMonth = months.at(-1);
  const nestedSource = objectValue(evidence?.source) || {};
  const sourceField = (...keys) => {
    for (const key of keys) {
      const value = readOptionalText(nestedSource[key]) || readOptionalText(evidence?.[key]);
      if (value) return value;
    }
    return null;
  };
  const spreadsheetId = sourceField('spreadsheetId');
  const monthCount = months.length;
  const weekCount = monthCount * 5;
  return {
    contractVersion: CASHFLOW_CUMULATIVE_CLOSE_CONTRACT,
    fromMonth: CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH,
    throughMonth,
    lockRange: {
      fromMonth: CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH,
      fromWeekNo: 1,
      throughMonth,
      throughWeekNo: 5,
    },
    monthCount,
    weekCount,
    cellCount: weekCount * CASHFLOW_ALL_LINES.length * 2,
    source: {
      sourceRevision: sourceField('sourceRevision', 'sourceFingerprint'),
      targetRevision: sourceField('targetRevision', 'targetRevisionAtFetch'),
      capturedAt: sourceField('capturedAt', 'sourceReadAt'),
      spreadsheetId,
      spreadsheetTitle: sourceField('spreadsheetTitle'),
      selectedSheetName: sourceField('selectedSheetName'),
      spreadsheetUrl: sourceField('spreadsheetUrl') || (spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`
        : null),
    },
  };
}

async function readCashflowSheetPublicationState({ db, tenantId, projectId }) {
  if (!db?.doc) {
    return { blocked: false, fingerprint: '{}' };
  }
  const snapshot = await db.doc(`orgs/${tenantId}/cashflow_sheet_publications/${projectId}`).get();
  const data = snapshot.exists ? snapshot.data() || {} : {};
  const publication = {
    status: readOptionalText(data.status).toUpperCase(),
    stagedRunId: readOptionalText(data.stagedRunId),
    sourceRevision: readOptionalText(data.sourceRevision),
    targetRevisionAtFetch: readOptionalText(data.targetRevisionAtFetch),
    appliedTargetRevision: readOptionalText(data.appliedTargetRevision),
    applyStartedAt: readOptionalText(data.applyStartedAt),
    applyFailedAt: readOptionalText(data.applyFailedAt),
    appliedAt: readOptionalText(data.appliedAt),
  };
  return {
    blocked: publication.status === 'APPLYING',
    fingerprint: stableStringify(publication),
  };
}

function assertCashflowSheetPublicationReady(state) {
  if (!state.blocked) return;
  throw createHttpError(
    409,
    '시트 값을 MYSCube 시트에 반영 중입니다. 반영이 끝난 뒤 다시 확인해 주세요.',
    'cashflow_sheet_apply_in_progress',
  );
}

// 월 결산 기한은 대상월 다음 달 10일이다. 판정 주체는 JVM이며(WeeklyExpensePersistence.closeDeadline),
// 대시보드는 선택된 달 하나가 아니라 모든 달을 한 번에 그려야 해서 같은 규칙이 여기에도 필요하다.
export function cashflowMonthCloseDeadline(yearMonth) {
  const [year, month] = String(yearMonth).split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  const deadlineYear = month === 12 ? year + 1 : year;
  const deadlineMonth = month === 12 ? 1 : month + 1;
  return `${deadlineYear}-${String(deadlineMonth).padStart(2, '0')}-10`;
}

async function readCashflowMonthCloseStatuses({ db, tenantId, projectId, businessDate = '' }) {
  if (!db?.collection) return [];
  const snapshot = await db.collection(`orgs/${tenantId}/monthly_closes`)
    .where('projectId', '==', projectId)
    .limit(500)
    .get();
  return snapshot.docs
    .map((doc) => doc.data() || {})
    .map((value) => {
      const yearMonth = readOptionalText(value.yearMonth);
      const status = readOptionalText(value.status).toUpperCase() || 'OPEN';
      const snapshotFacts = objectValue(objectValue(value.snapshot)?.sheetFacts);
      const amendmentEvidence = objectValue(value.lastAmendmentEvidence);
      const amendedCurrent = (
        status === 'CLOSED'
        && Number(value.amendmentCount) > 0
        && readOptionalText(amendmentEvidence.closeSnapshotHash)
        && readOptionalText(amendmentEvidence.closeSnapshotHash) === readOptionalText(value.snapshotHash)
      );
      const calculationChecks = amendedCurrent
        ? amendmentEvidence.calculationChecks
        : snapshotFacts?.weeklyCalculationChecks;
      const closeDeadline = cashflowMonthCloseDeadline(yearMonth);
      return {
        yearMonth,
        status,
        closeDeadline,
        // 기준일을 모르면 기한 초과를 단정하지 않는다.
        closeOverdue: Boolean(businessDate && closeDeadline && status !== 'CLOSED' && businessDate > closeDeadline),
        sheetCalculationChecks: Array.isArray(calculationChecks)
          ? calculationChecks.filter((check) => readOptionalText(check?.yearMonth) === yearMonth)
          : [],
      };
    })
    .filter((value) => /^20\d{2}-(0[1-9]|1[0-2])$/.test(value.yearMonth));
}

function sheetControlBlockers(sheetFacts) {
  if (!objectValue(sheetFacts)) {
    return [{ code: 'SHEET_FACTS_MISSING', message: '시트 검증값이 없습니다. 시트값을 다시 불러와 주세요.' }];
  }
  const blockers = [];
  if (Array.isArray(sheetFacts.issues) && sheetFacts.issues.length > 0) {
    blockers.push({ code: 'SHEET_VALUE_INVALID', message: '시트의 날짜 또는 금액 형식을 확인해 주세요.', details: sheetFacts.issues });
  }
  const controls = objectValue(sheetFacts.controlTotals);
  const projectionRows = Array.isArray(controls?.projection) ? controls.projection : [];
  const actualRows = Array.isArray(controls?.actual) ? controls.actual : [];
  const rows = [...projectionRows, ...actualRows];
  if (projectionRows.length !== 19 || actualRows.length !== 19) {
    blockers.push({
      code: 'SHEET_CONTROL_TOTAL_INCOMPLETE',
      message: 'Projection/Actual BO control total이 불완전합니다. 시트값을 다시 불러와 주세요.',
    });
  } else if (
    typeof controls?.deposit?.matches !== 'boolean'
    || rows.some((row) => typeof row?.matches !== 'boolean')
  ) {
    blockers.push({
      code: 'SHEET_CONTROL_TOTAL_INVALID',
      message: 'Projection/Actual BO control total 검산값이 올바르지 않습니다. 시트값을 다시 불러와 주세요.',
    });
  }
  return blockers;
}

function sheetControlWarnings(sheetFacts) {
  const controls = objectValue(sheetFacts?.controlTotals);
  const rows = [
    ...(Array.isArray(controls?.projection) ? controls.projection : []),
    ...(Array.isArray(controls?.actual) ? controls.actual : []),
  ];
  const comparableRows = rows.filter((row) => typeof row?.matches === 'boolean');
  const depositComparable = typeof controls?.deposit?.matches === 'boolean';
  return (depositComparable && controls.deposit.matches !== true) || comparableRows.some((row) => row.matches !== true)
    ? [{
      code: 'SHEET_CONTROL_TOTAL_MISMATCH',
      message: '전체 주차 합계와 시트 BO control total이 다릅니다.',
      details: {
        deposit: controls?.deposit || null,
        rows: rows.filter((row) => row?.matches !== true),
      },
    }]
    : [];
}

function monthSheetCalculationBlockers(sheetFacts, yearMonth) {
  const checks = (Array.isArray(sheetFacts?.weeklyCalculationChecks) ? sheetFacts.weeklyCalculationChecks : [])
    .filter((check) => readOptionalText(check?.yearMonth) === yearMonth);
  if (checks.length !== 10) {
    return [{
      code: 'SHEET_CALCULATION_CHECK_MISSING',
      message: '시트 합계·잔액 검산값이 없습니다. 시트값을 다시 불러와 주세요.',
    }];
  }
  const invalid = checks.filter((check) => Object.values(check?.matches || {}).some((match) => match === null));
  if (invalid.length > 0) {
    return [{
      code: 'SHEET_CALCULATION_VALUE_INVALID',
      message: '월 결산 대상의 입금·출금 합계 또는 잔액 값을 확인해 주세요.',
      details: invalid.map((check) => ({ mode: check.mode, weekNo: check.weekNo, sourceCells: check.sourceCells })),
    }];
  }
  return [];
}

function monthSheetCalculationWarnings(sheetFacts, yearMonth) {
  const checks = Array.isArray(sheetFacts?.weeklyCalculationChecks)
    ? sheetFacts.weeklyCalculationChecks.filter((check) => readOptionalText(check?.yearMonth) === yearMonth)
    : [];
  const mismatches = checks.filter((check) => Object.values(check?.matches || {}).some((match) => match === false));
  return mismatches.length === 0 ? [] : [{
    code: 'SHEET_CALCULATION_MISMATCH',
    message: '월 결산 대상의 시트 합계 또는 잔액이 항목 합계와 다릅니다.',
    details: mismatches.map((check) => ({ mode: check.mode, weekNo: check.weekNo, matches: check.matches, sourceCells: check.sourceCells })),
  }];
}

function managementReviewWarnings(checks) {
  return (Array.isArray(checks) ? checks : [])
    .filter((check) => readOptionalText(check?.status).toUpperCase() !== 'OK')
    .map((check) => ({
      code: `MANAGEMENT_CHECK_${readOptionalText(check.id).replaceAll('-', '_').toUpperCase()}`,
      message: readOptionalText(check.title),
      details: {
        status: readOptionalText(check.status),
        detail: readOptionalText(check.detail),
        findings: Array.isArray(check.findings) ? check.findings : [],
      },
    }));
}

function sourceDepositRows(sheetFacts, yearMonth) {
  return (Array.isArray(sheetFacts?.depositScheduleRows) ? sheetFacts.depositScheduleRows : [])
    .filter((row) => readOptionalText(row?.yearMonth) === yearMonth)
    .sort((left, right) => Number(left?.weekNo) - Number(right?.weekNo));
}

function matchingDepositSchedule(sourceRows, draftRows) {
  if (sourceRows.length !== 5 || !Array.isArray(draftRows) || draftRows.length !== 5) return false;
  const sourceByWeek = new Map(sourceRows.map((row) => [Number(row?.weekNo), row]));
  return draftRows.every((row) => {
    const source = sourceByWeek.get(Number(row?.weekNo));
    if (!source) return false;
    const sourceAmount = source.expectedDepositAmount == null ? null : Number(source.expectedDepositAmount);
    const draftAmount = row?.expectedDepositAmount == null ? null : Number(row.expectedDepositAmount);
    return readOptionalText(row?.taxInvoiceIssuedDate) === readOptionalText(source?.taxInvoiceIssuedDate)
      && readOptionalText(row?.expectedDepositDate) === readOptionalText(source?.expectedDepositDate)
      && sourceAmount === draftAmount;
  });
}

async function readDocument(db, path) {
  if (!db?.doc) return null;
  const snapshot = await db.doc(path).get();
  return snapshot.exists ? snapshot.data() || {} : null;
}

function validOpeningBalanceMode(mode, selectedYear) {
  if (
    !objectValue(mode)
    || !Number.isSafeInteger(mode.amount)
    || !objectValue(mode.lineAmounts)
    || !Array.isArray(mode.sources)
    || !Array.isArray(mode.includedYears)
    || !Array.isArray(mode.excludedWeeklyYears)
  ) return false;
  const canonicalYears = (years) => years.every((year, index) => (
    Number.isSafeInteger(year)
    && year >= 2000
    && year < selectedYear
    && (index === 0 || years[index - 1] < year)
  ));
  if (
    !canonicalYears(mode.includedYears)
    || !canonicalYears(mode.excludedWeeklyYears)
    || mode.includedYears.some((year) => mode.excludedWeeklyYears.includes(year))
    || mode.sources.length !== mode.includedYears.length
  ) return false;
  const aggregate = {};
  for (let index = 0; index < mode.sources.length; index += 1) {
    const source = objectValue(mode.sources[index]);
    const lineAmounts = objectValue(source?.lineAmounts);
    const lineStates = objectValue(source?.lineStates);
    if (
      !Number.isSafeInteger(source?.year)
      || source.year !== mode.includedYears[index]
      || !lineAmounts
      || !lineStates
      || Object.keys(lineStates).length !== CASHFLOW_ALL_LINES.length
      || !CASHFLOW_ALL_LINES.every((lineId) => Object.hasOwn(lineStates, lineId))
    ) return false;
    const amountLines = [];
    for (const lineId of CASHFLOW_ALL_LINES) {
      const state = readOptionalText(lineStates[lineId]);
      if (!['EMPTY', 'ZERO', 'VALUE'].includes(state)) return false;
      if (state === 'VALUE' || state === 'ZERO') amountLines.push(lineId);
      if (state === 'ZERO' && lineAmounts[lineId] !== 0) return false;
    }
    if (
      Object.keys(lineAmounts).length !== amountLines.length
      || !amountLines.every((lineId) => Number.isSafeInteger(lineAmounts[lineId]))
      || !Object.keys(lineAmounts).every((lineId) => amountLines.includes(lineId))
    ) return false;
    for (const lineId of amountLines) {
      aggregate[lineId] = Number(aggregate[lineId] || 0) + lineAmounts[lineId];
      if (!Number.isSafeInteger(aggregate[lineId])) return false;
    }
  }
  if (
    Object.keys(mode.lineAmounts).length !== Object.keys(aggregate).length
    || !Object.keys(mode.lineAmounts).every((lineId) => (
      CASHFLOW_ALL_LINES.includes(lineId)
      && Number.isSafeInteger(mode.lineAmounts[lineId])
      && mode.lineAmounts[lineId] === aggregate[lineId]
    ))
  ) return false;
  const totalIn = CASHFLOW_IN_LINES.reduce((sum, lineId) => sum + (mode.lineAmounts[lineId] || 0), 0);
  const totalOut = CASHFLOW_OUT_LINES.reduce((sum, lineId) => sum + (mode.lineAmounts[lineId] || 0), 0);
  return Number.isSafeInteger(totalIn) && Number.isSafeInteger(totalOut) && mode.amount === totalIn - totalOut;
}

function requireJvmOpeningBalances(source, yearMonth, {
  statusCode = 502,
  code = 'jvm_weekly_opening_balance_invalid',
} = {}) {
  const openingBalances = objectValue(source?.openingBalances);
  const selectedYear = Number(yearMonth.slice(0, 4));
  if (
    Number(openingBalances?.selectedYear) !== selectedYear
    || !validOpeningBalanceMode(openingBalances?.projection, selectedYear)
    || !validOpeningBalanceMode(openingBalances?.actual, selectedYear)
  ) {
    throw createHttpError(statusCode, 'Cashflow opening balance must preserve every annual source row and state.', code);
  }
  return openingBalances;
}

function requireReviewedOpeningBalances(value, yearMonth) {
  return requireJvmOpeningBalances({ openingBalances: value }, yearMonth, {
    statusCode: 400,
    code: 'cashflow_opening_balance_invalid',
  });
}

function requireUnchangedReviewedOpeningBalances(reviewed, current) {
  if (stableStringify(reviewed) !== stableStringify(current)) {
    throw createHttpError(
      409,
      '검토 후 전년도 이월 항목이 변경되었습니다. 월 결산 화면을 다시 확인해 주세요.',
      'cashflow_opening_balance_stale',
    );
  }
}

function deadlineSummaryFromCompliance(compliance, comparisonBoundary) {
  const items = Array.isArray(compliance?.items) ? compliance.items : [];
  const completedLateCount = items.filter((item) => readOptionalText(item?.status) === 'COMPLETED_LATE').length;
  const current = items.find((item) => (
    item.yearMonth === comparisonBoundary?.asOfWeek?.yearMonth
    && Number(item.weekNo) === Number(comparisonBoundary?.asOfWeek?.weekNo)
  )) || null;
  return {
    trackingStartedAt: null,
    onTimeCount: Number(compliance?.onTimeCount) || 0,
    missedCount: Number(compliance?.missedCount) || 0,
    completedCount: (Number(compliance?.onTimeCount) || 0) + completedLateCount,
    nextCursor: readOptionalText(compliance?.nextCursor) || null,
    current,
    completedWeeks: items.filter((item) => readOptionalText(item.completedAt)),
    weeklyStatuses: items.map((item) => ({
      yearMonth: item.yearMonth,
      weekNo: item.weekNo,
      status: item.status,
      deadline: item.deadline,
      updateResult: item.updateResult,
      operationId: item.operationId,
      auditId: item.auditId,
    })),
  };
}

async function composeCashflowMonthDashboard({
  db, req, projectId, yearMonth, close, cashflow, openingBalances, comparisonBoundary, weeklyCompliance,
  projectionActualSummary, weeklyComplianceBoundary = comparisonBoundary,
}) {
  const closedSnapshot = ['CLOSED', 'REOPEN_REQUESTED'].includes(readOptionalText(close?.status))
    ? objectValue(close?.snapshot) || {}
    : null;
  const snapshotCompatibility = objectValue(close?.snapshotCompatibility) || {
    status: closedSnapshot ? 'LEGACY_EVIDENCE_ONLY' : 'LIVE_CURRENT',
    missingEvidence: closedSnapshot ? ['OPENING_BALANCES', 'LEDGER_WEEKS'] : [],
  };
  const legacyEvidenceOnly = snapshotCompatibility.status === 'LEGACY_EVIDENCE_ONLY';
  const amendedCurrent = snapshotCompatibility.status === 'LIVE_AMENDED';
  const amendmentEvidence = objectValue(close?.lastAmendmentEvidence) || {};
  const tenantId = readOptionalText(req.context?.tenantId);
  const businessDate = readOptionalText(close?.evaluatedBusinessDate);
  const [monthCloseStatuses, projectDocument, mirror] = closedSnapshot
    ? await Promise.all([readCashflowMonthCloseStatuses({ db, tenantId, projectId, businessDate }), Promise.resolve(null), Promise.resolve(null)])
    : await Promise.all([
      readCashflowMonthCloseStatuses({ db, tenantId, projectId, businessDate }),
      readDocument(db, `orgs/${tenantId}/projects/${projectId}`),
      readDocument(db, `orgs/${tenantId}/cashflow_sheet_mirrors/${projectId}`),
    ]);
  const project = closedSnapshot?.project || projectDocument || {};
  const sheetFacts = closedSnapshot?.sheetFacts || mirror?.sheetFacts || null;
  const mirrorCells = normalizeMonthCloseCells(mirror?.cells, yearMonth);
  const frozenCells = closedSnapshot
    ? closeSnapshotCells(closedSnapshot, yearMonth)
    : mirrorCells;
  const selectedYear = Number(yearMonth.slice(0, 4));
  const frozenCanonical = closedSnapshot
    ? objectValue(closedSnapshot?.canonical) || frozenCashflowReadModel(closedSnapshot?.ledgerWeeks)
    : null;
  const canonicalReadModel = cashflowReadModelForYear(
    amendedCurrent ? objectValue(cashflow?.readModel) : frozenCanonical || objectValue(cashflow?.readModel),
    selectedYear,
  );
  const currentCanonicalMonth = amendedCurrent
    ? canonicalReadModel?.months?.find((month) => month.yearMonth === yearMonth) || null
    : null;
  const cells = amendedCurrent
    ? canonicalMonthCells(currentCanonicalMonth, yearMonth)
    : frozenCells;
  const projectionMode = buildMonthModeReadModel(cells, 'projection');
  const actualMode = buildMonthModeReadModel(cells, 'actual');
  const projection = dashboardTotals(projectionMode);
  const actual = dashboardTotals(actualMode);
  const difference = differenceTotals(projection, actual);
  const comparison = projectionMode && actualMode
    ? buildCashflowProjectionActualComparison({
      projectId,
      readModel: { months: [{ yearMonth, projection: projectionMode, actual: actualMode }] },
    }, comparisonBoundary).months[0] || null
    : null;
  const confirmations = closedSnapshot?.confirmations || [];
  const managementConfirmations = closedSnapshot?.managementConfirmations || [];
  const sourceRows = sourceDepositRows(sheetFacts, yearMonth);
  const depositScheduleRows = closedSnapshot?.depositScheduleRows
    || sourceRows
    || [];
  const openingBalanceCandidate = amendedCurrent
    ? openingBalances
    : objectValue(closedSnapshot?.openingBalances) || openingBalances;
  const authoritativeOpeningBalances = openingBalanceCandidate
    ? requireJvmOpeningBalances({ openingBalances: openingBalanceCandidate }, yearMonth)
    : null;
  const canonicalComparison = canonicalReadModel
    ? buildCashflowProjectionActualComparison({ projectId, readModel: canonicalReadModel }, comparisonBoundary)
    : null;
  const canonicalWithComparison = canonicalReadModel ? {
    ...canonicalReadModel,
    months: canonicalReadModel.months.map((month) => ({
      ...month,
      comparison: canonicalComparison?.months?.find((candidate) => candidate.yearMonth === month.yearMonth) || null,
    })),
  } : null;
  const managementChecks = amendedCurrent
    ? buildCashflowManagementChecks({
      project,
      cashflow,
      cells,
      yearMonth,
      depositScheduleRows: sheetFacts?.depositScheduleRows || depositScheduleRows,
      comparisonBoundary,
      pinnedSheetCells: null,
      projectionOpeningBalance: safeAmount(authoritativeOpeningBalances?.projection?.amount),
    })
    : Array.isArray(closedSnapshot?.managementChecks)
      ? closedSnapshot.managementChecks
      : legacyEvidenceOnly
      ? []
      : buildCashflowManagementChecks({
        project,
        cashflow,
        cells,
        yearMonth,
        depositScheduleRows: sheetFacts?.depositScheduleRows || depositScheduleRows,
        comparisonBoundary,
        pinnedSheetCells: mirror?.cells,
        projectionOpeningBalance: safeAmount(authoritativeOpeningBalances?.projection?.amount),
      });
  const liveDeadlineSummary = deadlineSummaryFromCompliance(weeklyCompliance, weeklyComplianceBoundary);
  const deadlineSummary = closedSnapshot
    ? {
      ...(closedSnapshot?.deadlineSummary || liveDeadlineSummary),
      completedWeeks: liveDeadlineSummary.completedWeeks,
      weeklyStatuses: liveDeadlineSummary.weeklyStatuses,
    }
    : liveDeadlineSummary;
  const blockers = [];
  if (readOptionalText(close?.status) !== 'OPEN') {
    blockers.push({ code: 'MONTH_NOT_OPEN', message: '결산 또는 재오픈 검토 중인 월은 수정할 수 없습니다.' });
  } else {
    if (close?.closeEligible === false) {
      blockers.push({ code: 'MONTH_NOT_ENDED', message: '대상 월이 끝난 뒤 월 결산할 수 있습니다.' });
    }
    if (!projectDocument) blockers.push({ code: 'PROJECT_NOT_FOUND', message: '프로젝트 등록 정보를 찾을 수 없습니다.' });
    if (!mirror) blockers.push({ code: 'SHEET_SOURCE_REQUIRED', message: '먼저 시트값을 불러와 주세요.' });
    else if (mirror.status !== 'FRESH') blockers.push({ code: 'SHEET_SOURCE_STALE', message: '시트값을 다시 불러와 주세요.' });
    else if ((mirror.projectId && mirror.projectId !== projectId) || !mirror.yearMonths?.includes(yearMonth)) {
      blockers.push({ code: 'SHEET_SOURCE_SCOPE_MISMATCH', message: '고정한 시트값의 프로젝트 또는 월이 다릅니다.' });
    } else if (readOptionalText(mirror.appliedSourceRevision) !== readOptionalText(mirror.sourceRevision)) {
      blockers.push({ code: 'SHEET_SOURCE_NOT_APPLIED', message: '불러온 값을 MYSCube 시트에 반영해 주세요.' });
    }
    blockers.push(...sheetControlBlockers(sheetFacts));
    blockers.push(...monthSheetCalculationBlockers(sheetFacts, yearMonth));
    if (!completeMonthCloseCells(cells)) blockers.push({ code: 'SHEET_MONTH_INCOMPLETE', message: '선택한 월의 160개 캐시플로우 값을 다시 불러와 주세요.' });
    if (!projectionMode || !actualMode) blockers.push({ code: 'AMOUNT_OUT_OF_RANGE', message: '지원 범위를 넘는 금액이 있습니다.' });
  }
  const contractAmount = safeAmount(project?.contractAmount);
  const projectionComposition = closedSnapshot
    ? {
      totalIn: safeAmount(canonicalWithComparison?.range?.projection?.totalIn ?? projection.totalIn),
      salesAndVatTotal: safeAmount(canonicalWithComparison?.range?.projection?.rowTotals?.SALES_IN ?? projection.rowTotals?.SALES_IN)
        + safeAmount(canonicalWithComparison?.range?.projection?.rowTotals?.SALES_VAT_IN ?? projection.rowTotals?.SALES_VAT_IN),
      years: Array.isArray(closedSnapshot?.projectionYears) ? closedSnapshot.projectionYears : [],
    }
    : composeProjectionTotal({
      project,
      cashflow,
      mirror,
      fallback: {
        totalIn: projection.totalIn,
        salesAndVatTotal: safeAmount(projection.rowTotals?.SALES_IN) + safeAmount(projection.rowTotals?.SALES_VAT_IN),
      },
      weeklyYearsHint: (Array.isArray(mirror?.appliedWeeklyYears) ? mirror.appliedWeeklyYears : mirror?.cells?.map((cell) => (
        Number(readOptionalText(cell?.yearMonth).slice(0, 4))
      )) || []).map(Number).filter(Number.isSafeInteger),
    });
  const projectionTotalIn = projectionComposition.totalIn;
  const projectionSalesAndVatTotal = projectionComposition.salesAndVatTotal;
  const contractDifference = contractAmount - projectionSalesAndVatTotal;
  const rawProjectionProgressPercent = contractAmount === 0
    ? 100
    : Math.round((projectionSalesAndVatTotal / contractAmount) * 10_000) / 100;
  const projectionProgressPercent = Math.max(0, rawProjectionProgressPercent);
  const requiredCellConfirmationCount = CASHFLOW_ALL_LINES.length * 2 * 5;
  const requiredManagementConfirmationCount = CASHFLOW_MANAGEMENT_CHECK_IDS.length;
  const confirmationProgressPercent = Math.round(
    Math.min(
      1,
      (validConfirmationKeys(confirmations).size + validManagementConfirmations(managementConfirmations).size)
        / (requiredCellConfirmationCount + requiredManagementConfirmationCount),
    ) * 10_000,
  ) / 100;
  const settlement = settlementProgress(comparison, confirmations, yearMonth, comparisonBoundary);
  const source = closedSnapshot ? {
    kind: amendedCurrent ? 'MONTH_CLOSE_AMENDED_CURRENT' : 'MONTH_CLOSE_SNAPSHOT',
    status: readOptionalText(close?.status),
    sourceRevision: amendedCurrent
      ? readOptionalText(amendmentEvidence.sourceRevision)
      : readOptionalText(closedSnapshot?.sourceFingerprint),
    targetRevision: amendedCurrent
      ? readOptionalText(amendmentEvidence.resultingTargetRevision)
      : readOptionalText(closedSnapshot?.targetRevision),
    capturedAt: amendedCurrent
      ? readOptionalText(close?.lastAmendmentAt)
      : readOptionalText(closedSnapshot?.sourceReadAt),
  } : {
    kind: 'PINNED_MIRROR',
    status: readOptionalText(mirror?.status) || 'EMPTY',
    sourceRevision: readOptionalText(mirror?.sourceRevision),
    targetRevision: readOptionalText(mirror?.targetRevisionAtFetch),
    appliedSourceRevision: readOptionalText(mirror?.appliedSourceRevision),
    appliedTargetRevision: readOptionalText(mirror?.appliedTargetRevision),
    capturedAt: readOptionalText(mirror?.capturedAt),
  };
  const warnings = closedSnapshot ? [] : [
    ...projectSheetWarnings(project, sheetFacts?.metadata),
    ...sheetControlWarnings(sheetFacts),
    ...monthSheetCalculationWarnings(sheetFacts, yearMonth),
    ...managementReviewWarnings(managementChecks),
  ];
  if (legacyEvidenceOnly) {
    warnings.push({
      code: 'LEGACY_CLOSE_EVIDENCE_LIMITED',
      message: '이 결산은 이전 형식으로 저장되어 항목별 전년도 이월 근거와 전체 동결 시트를 확인할 수 없습니다. 재오픈 후 시트값을 다시 반영하고 재결산해 주세요.',
      details: { missingEvidence: snapshotCompatibility.missingEvidence || [] },
    });
  }
  if (contractAmount !== projectionSalesAndVatTotal) {
    warnings.push({
      code: 'CONTRACT_PROJECTION_MISMATCH',
      message: `계약금액 ${contractAmount.toLocaleString('ko-KR')}원과 전체 사업기간 Projection 매출·매출부가세 ${projectionSalesAndVatTotal.toLocaleString('ko-KR')}원이 다릅니다.`,
    });
  }
  return {
    source,
    cumulativeCloseScope: buildCumulativeCloseScope(yearMonth, closedSnapshot || mirror),
    project,
    projectMetadata: projectMetadata(project),
    sheetMetadata: sheetFacts?.metadata || {},
    sheetCalculationChecks: amendedCurrent
      ? (Array.isArray(amendmentEvidence.calculationChecks) ? amendmentEvidence.calculationChecks : [])
      : (Array.isArray(sheetFacts?.weeklyCalculationChecks)
        ? sheetFacts.weeklyCalculationChecks.filter((check) => readOptionalText(check?.yearMonth) === yearMonth)
        : []),
    sheetControlTotals: {
      deposit: objectValue(sheetFacts?.controlTotals?.deposit) || null,
      unpaid: objectValue(sheetFacts?.controlTotals?.unpaid) || null,
    },
    sheetDepositScheduleRows: sourceRows,
    depositScheduleRows,
    cells,
    confirmations,
    managementChecks,
    managementConfirmations,
    openingBalances: authoritativeOpeningBalances,
    snapshotCompatibility,
    deadlineSummary,
    projectionActualSummary,
    monthCloseStatuses,
    postCloseAdjustment: closedSnapshot ? postCloseAdjustment(close, closedSnapshot) : null,
    draftRevision: null,
    totals: { projection, actual, difference },
    comparison,
    summary: {
      projectionProgressPercent,
      projectionTotalIn,
      projectionSalesAndVatTotal,
      contractDifference,
      contractCoveragePercent: projectionProgressPercent,
      projectionContractAmount: contractAmount,
      projectionYears: projectionComposition.years,
      actualProgressPercent: actualWrittenProgressPercent(cells, yearMonth, comparisonBoundary),
      confirmationProgressPercent,
      settlementProgressPercent: settlement.percent,
      settlementDifferenceAmount: projectionActualSummary.settlementDifferenceAmount,
      settlementMatches: projectionActualSummary.settlementMatches,
      settlementCompletedWeekCount: settlement.completed,
      settlementTargetWeekCount: settlement.total,
      settlementIncompleteWeeks: settlement.incompleteWeeks,
      comparisonMatches: settlement.total > 0 && settlement.incompleteWeeks.length === 0,
      comparisonAsOfDate: comparisonBoundary.asOfDate,
      comparisonAsOfWeek: comparisonBoundary.asOfWeek,
      evaluatedBusinessDate: readOptionalText(close?.evaluatedBusinessDate) || null,
      closeDeadline: readOptionalText(close?.closeDeadline) || null,
      late: Boolean(close?.late),
    },
    validation: {
      canClose: readOptionalText(close?.status) === 'OPEN' && blockers.length === 0,
      blockers,
      warnings,
    },
    canonical: canonicalWithComparison,
  };
}

async function composeCashflowMonthCloseBody({ db, req, projectId, cashflow, openingBalances, comparisonBoundary, weeklyCompliance }) {
  const tenantId = readOptionalText(req.context?.tenantId);
  const requested = commandBody(req);
  const yearMonth = readOptionalText(requested.yearMonth);
  const expectedRevision = Number(requested.expectedRevision);
  const closeInput = objectValue(requested.closeInput);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw createHttpError(400, 'Cashflow month close scope is invalid.', 'cashflow_month_close_request_invalid');
  }
  if (!closeInput || readOptionalText(closeInput.yearMonth) !== yearMonth) {
    throw createHttpError(400, 'Cashflow month close review input is required.', 'cashflow_month_close_request_invalid');
  }
  if (closeInput.humanReviewed !== true) {
    throw createHttpError(409, '시트값과 결산 항목을 직접 확인한 뒤 결산해 주세요.', 'cashflow_month_close_human_review_required');
  }
  if (!db?.doc) {
    throw createHttpError(503, '월 결산 자료를 보관하는 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'cashflow_month_close_source_unavailable');
  }

  const [mirrorSnap, projectSnap] = await Promise.all([
    db.doc(`orgs/${tenantId}/cashflow_sheet_mirrors/${projectId}`).get(),
    db.doc(`orgs/${tenantId}/projects/${projectId}`).get(),
  ]);
  const mirror = mirrorSnap.exists ? mirrorSnap.data() || {} : null;
  const project = projectSnap.exists ? projectSnap.data() || {} : {};
  const normalizedCells = normalizeMonthCloseCells(closeInput.cells, yearMonth);
  if (!completeMonthCloseCells(normalizedCells)) {
    throw createHttpError(409, '월 결산 대상 160개 캐시플로우 값을 다시 확인해 주세요.', 'cashflow_month_close_cells_incomplete');
  }
  const sourceWarnings = [];
  if (!mirror) {
    sourceWarnings.push({ code: 'SHEET_SOURCE_REQUIRED', message: '먼저 시트값을 불러와 주세요.' });
  } else {
    if (mirror.status !== 'FRESH') {
      sourceWarnings.push({ code: 'SHEET_SOURCE_STALE', message: '시트값을 다시 불러와 주세요.' });
    }
    if ((mirror.projectId && mirror.projectId !== projectId) || !mirror.yearMonths?.includes(yearMonth)) {
      sourceWarnings.push({ code: 'SHEET_SOURCE_SCOPE_MISMATCH', message: '고정한 시트값의 프로젝트 또는 월이 다릅니다.' });
    }
    if (
      readOptionalText(mirror.sourceRevision) !== readOptionalText(closeInput.sourceRevision)
      || readOptionalText(mirror.targetRevisionAtFetch) !== readOptionalText(closeInput.targetRevision)
    ) {
      sourceWarnings.push({
        code: 'SHEET_SOURCE_REVISION_MISMATCH',
        message: '요청에서 확인한 시트 버전과 현재 고정된 시트 버전이 다릅니다.',
        details: {
          requestedSourceRevision: readOptionalText(closeInput.sourceRevision),
          requestedTargetRevision: readOptionalText(closeInput.targetRevision),
          currentSourceRevision: readOptionalText(mirror.sourceRevision),
          currentTargetRevision: readOptionalText(mirror.targetRevisionAtFetch),
        },
      });
    }
    if (readOptionalText(mirror.appliedSourceRevision) !== readOptionalText(mirror.sourceRevision)) {
      sourceWarnings.push({ code: 'SHEET_SOURCE_NOT_APPLIED', message: '불러온 값을 MYSCube 시트에 반영해 주세요.' });
    }
  }
  const sheetBlockers = mirror ? [
    ...sheetControlBlockers(mirror.sheetFacts),
    ...monthSheetCalculationBlockers(mirror.sheetFacts, yearMonth),
  ] : [];
  const depositWarnings = mirror?.sheetFacts
    && !matchingDepositSchedule(sourceDepositRows(mirror.sheetFacts, yearMonth), closeInput.depositScheduleRows)
    ? [{
      code: 'SHEET_DEPOSIT_SCHEDULE_MISMATCH',
      message: '시트 입금 일정과 요청에서 확인한 입금 일정이 다릅니다.',
      details: {
        sourceRows: sourceDepositRows(mirror.sheetFacts, yearMonth),
        requestedRows: Array.isArray(closeInput.depositScheduleRows) ? closeInput.depositScheduleRows : [],
      },
    }]
    : [];
  const managementChecks = buildCashflowManagementChecks({
    project,
    cashflow,
    cells: normalizedCells,
    yearMonth,
    depositScheduleRows: closeInput.depositScheduleRows,
    comparisonBoundary,
    pinnedSheetCells: mirror?.cells,
    projectionOpeningBalance: safeAmount(openingBalances?.projection?.amount),
  });
  const managementWarnings = matchingManagementChecks(managementChecks, closeInput.managementChecks) ? [] : [{
    code: 'MANAGEMENT_CHECKS_STALE',
    message: '요청에서 확인한 주요 관리 항목 판정과 현재 판정이 다릅니다.',
    details: { requested: closeInput.managementChecks || [], authoritative: managementChecks },
  }];
  if (!completeMonthCloseConfirmations(closeInput.confirmations)) {
    throw createHttpError(409, '월 결산 대상 160개 항목을 모두 확인해 주세요.', 'cashflow_month_close_confirmations_incomplete');
  }
  const deadlineSummary = deadlineSummaryFromCompliance(weeklyCompliance, comparisonBoundary);

  const reviewWarnings = [
    ...sourceWarnings,
    ...sheetBlockers,
    ...depositWarnings,
    ...managementWarnings,
    ...sheetControlWarnings(mirror?.sheetFacts),
    ...monthSheetCalculationWarnings(mirror?.sheetFacts, yearMonth),
    ...managementReviewWarnings(managementChecks),
  ];
  return {
    closeBody: {
      idempotencyKey: requested.idempotencyKey,
      yearMonth,
      expectedRevision,
      expectedDraftRevision: 0,
      humanReviewed: true,
      sourceRevision: closeInput.sourceRevision,
      targetRevision: closeInput.targetRevision,
      depositScheduleRows: closeInput.depositScheduleRows,
      cells: normalizedCells,
      confirmations: closeInput.confirmations,
      managementChecks,
      managementConfirmations: [...validManagementConfirmations(closeInput.managementConfirmations).values()],
      openingBalances,
      deadlineSummary: {
        trackingStartedAt: deadlineSummary.trackingStartedAt,
        missedCount: deadlineSummary.missedCount,
        completedCount: deadlineSummary.completedCount,
        current: deadlineSummary.current,
      },
    },
    reviewWarnings,
    monthSnapshot: buildCashflowMonthCloseMonthSnapshot({
      projectId,
      yearMonth,
      cells: normalizedCells,
      sourceRevision: closeInput.sourceRevision,
      targetRevision: closeInput.targetRevision,
      capturedAt: readOptionalText(mirror?.capturedAt) || null,
      spreadsheetId: readOptionalText(mirror?.spreadsheetId) || null,
      spreadsheetTitle: readOptionalText(mirror?.spreadsheetTitle) || null,
      selectedSheetName: readOptionalText(mirror?.selectedSheetName) || null,
    }),
  };
}

function createJavaMutatingProxyRoute(routeHandler) {
  return asyncHandler(async (req, res) => {
    const result = await routeHandler(req, res);
    const status = result?.status ?? 200;
    const body = result?.body ?? null;
    res.status(status).json(body);
  });
}

function assertWeeklyWorkspaceOrRoleAllowed(req, allowedRoles, action, authMode, workspaceEmailDomain) {
  if (isWorkspaceAuthMode(authMode) && isWorkspaceUser(req.context, workspaceEmailDomain)) return;
  assertActorRoleAllowed(req, allowedRoles, action);
}

export function mountJvmWeeklyApiRoutes(app, {
  db,
  env = process.env,
  fetchImpl = globalThis.fetch,
  jvmWeeklyApiBaseUrl,
  jvmWeeklyApiServiceToken,
  jvmWeeklyApiIdTokenAudience,
  jvmWeeklyApiServiceAccountJson,
  jvmWeeklyApiIdentityTokenResolver,
  jvmWeeklyAuthMode,
  jvmWeeklyWorkspaceEmailDomain,
  jvmWeeklyFirestoreProjectId,
  jvmWeeklyApiTimeoutMs,
  cashflowMonthCloseRouteTimeoutMs,
  performanceLogger,
  performanceNow,
  now = () => new Date(),
} = {}) {
  const baseUrl = resolveJavaWeeklyApiBaseUrl({ jvmWeeklyApiBaseUrl }, env);
  const serviceToken = resolveJavaWeeklyApiServiceToken({ jvmWeeklyApiServiceToken }, env);
  const idTokenAudience = resolveJavaWeeklyApiIdTokenAudience({ jvmWeeklyApiIdTokenAudience }, env);
  const serviceAccountJson = resolveJavaWeeklyApiServiceAccountJson({ jvmWeeklyApiServiceAccountJson }, env);
  const authMode = resolveJavaWeeklyAuthMode({ jvmWeeklyAuthMode }, env);
  const workspaceEmailDomain = resolveJavaWeeklyWorkspaceEmailDomain({ jvmWeeklyWorkspaceEmailDomain }, env);
  const firestoreProjectId = resolveJavaWeeklyFirestoreProjectId({ jvmWeeklyFirestoreProjectId }, env);
  const bffDataProjectId = resolveBffDataProjectId(env);
  const weeklyExpenseEditLeasesEnabled = readOptionalText(env.BFF_EDIT_LEASES_ENABLED).toLowerCase() === 'true';
  const monthCloseRouteTimeoutMs = Number.isFinite(Number(cashflowMonthCloseRouteTimeoutMs))
    && Number(cashflowMonthCloseRouteTimeoutMs) > 0
    ? Math.min(Number(cashflowMonthCloseRouteTimeoutMs), CASHFLOW_MONTH_CLOSE_ROUTE_TIMEOUT_MS)
    : CASHFLOW_MONTH_CLOSE_ROUTE_TIMEOUT_MS;

  async function readWeeklyCompliance(context, projectId, { limit = 100, cursor = '' } = {}) {
    const query = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = await proxyJavaWeeklyRequest({
      context,
      method: 'GET',
      path: `/api/v1/cashflow/${encodeURIComponent(projectId)}/weekly-update-compliance?${query}`,
    });
    const result = objectValue(response?.weeklyCompliance) || response;
    if (!Array.isArray(result?.items)
      || !Number.isSafeInteger(Number(result?.onTimeCount))
      || !Number.isSafeInteger(Number(result?.missedCount))) {
      throw createHttpError(502, 'JVM 주간 정산 이력을 확인할 수 없습니다.', 'jvm_weekly_response_invalid');
    }
    return result;
  }
  const javaWeeklyClient = createJavaWeeklyClient({
    env,
    fetchImpl,
    jvmWeeklyApiBaseUrl: baseUrl,
    jvmWeeklyApiServiceToken: serviceToken,
    jvmWeeklyApiIdTokenAudience: idTokenAudience,
    jvmWeeklyApiServiceAccountJson: serviceAccountJson,
    jvmWeeklyApiIdentityTokenResolver,
    jvmWeeklyAuthMode: authMode,
    jvmWeeklyWorkspaceEmailDomain: workspaceEmailDomain,
    jvmWeeklyFirestoreProjectId: firestoreProjectId,
    jvmWeeklyApiTimeoutMs,
    performanceLogger,
    performanceNow,
  });

  function proxyJavaWeeklyRequest(options) {
    return javaWeeklyClient.requestJson(options);
  }

  function assertAlignedCashflowMutation() {
    assertCashflowMutationRuntime({ bffDataProjectId, jvmWeeklyFirestoreProjectId: firestoreProjectId }, env);
  }

  async function proxyMutation(req, path, body, {
    cashflowWrite = false,
    requireWeeklyExpenseLease = false,
    deadlineAtMs,
  } = {}) {
    let editSession;
    let dataProjectId;
    if (cashflowWrite) {
      assertAlignedCashflowMutation();
      if (requireWeeklyExpenseLease) {
        if (!weeklyExpenseEditLeasesEnabled) {
          throw createHttpError(503, '현재 환경에서는 주간 비용을 저장할 수 없습니다. 담당자에게 문의해 주세요.', 'cashflow_edit_leases_disabled');
        }
        editSession = readWeeklyExpenseEditSession(req);
      }
      dataProjectId = bffDataProjectId;
    }
    return proxyJavaWeeklyRequest({
      context: req.context,
      method: 'POST',
      path,
      body,
      editSession,
      dataProjectId,
      deadlineAtMs,
    });
  }

  app.get('/api/v1/weekly-expenses/:projectId/sheets', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read weekly expense sheets', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/weekly-expenses/${projectId}/sheets`,
    });
    res.status(200).json(result);
  }));

  app.get('/api/v1/weekly-expenses/:projectId/sheets/:sheetKey', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read weekly expense sheet', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
    const result = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}`,
    });
    res.status(200).json(result);
  }));

  app.post('/api/v1/weekly-expenses/:projectId/sheets/:sheetKey/save-draft', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'save weekly expense draft', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
    const result = await proxyMutation(
      req,
      `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}/save-draft`,
      commandBody(req),
      { cashflowWrite: true, requireWeeklyExpenseLease: true },
    );
    return { status: 200, body: result };
  }));

  app.post('/api/v1/weekly-expenses/:projectId/bank-statements/import-batch', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'import weekly expense bank statement batch', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(
      req,
      `/api/v1/weekly-expenses/${projectId}/bank-statements/import-batch`,
      commandBody(req),
      { cashflowWrite: true, requireWeeklyExpenseLease: true },
    );
    return { status: 200, body: result };
  }));

  app.get('/api/v1/weekly-expenses/:projectId/bank-statements/import-lines', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read weekly expense bank statement import lines', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const status = readOptionalText(req.query.status);
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const result = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/weekly-expenses/${projectId}/bank-statements/import-lines${query}`,
    });
    res.status(200).json(result);
  }));

  app.post('/api/v1/weekly-expenses/:projectId/bank-statements/apply-items', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'apply weekly expense bank statement items', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(
      req,
      `/api/v1/weekly-expenses/${projectId}/bank-statements/apply-items`,
      commandBody(req),
      { cashflowWrite: true, requireWeeklyExpenseLease: true },
    );
    return { status: 200, body: result };
  }));

  for (const command of ['cell-patch', 'copy', 'paste', 'cut', 'row-insert', 'row-delete']) {
    app.post(`/api/v1/weekly-expenses/:projectId/sheets/:sheetKey/commands/${command}`, createJavaMutatingProxyRoute(async (req) => {
      assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, `run weekly expense ${command}`, authMode, workspaceEmailDomain);
      const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
      const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
      const result = await proxyMutation(
        req,
        `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}/commands/${command}`,
        commandBody(req),
        { cashflowWrite: true, requireWeeklyExpenseLease: true },
      );
      return { status: 200, body: result };
    }));
  }

  app.post('/api/v1/weekly-expenses/:projectId/submit', asyncHandler(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'submit weekly expense week', authMode, workspaceEmailDomain);
    throw createHttpError(
      410,
      '주차 제출은 더 이상 사용하지 않습니다. 프로젝트별 월 결산을 이용해 주세요.',
      'weekly_close_disabled_use_month_close',
    );
  }));

  app.post('/api/v1/weekly-expenses/:projectId/close', asyncHandler(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance'], 'close weekly expense week', authMode, workspaceEmailDomain);
    throw createHttpError(
      410,
      '주차 결산은 더 이상 사용하지 않습니다. 프로젝트별 월 결산을 이용해 주세요.',
      'weekly_close_disabled_use_month_close',
    );
  }));

  app.post('/api/v1/weekly-expenses/:projectId/audit-export', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance'], 'create weekly expense audit export', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/audit-export`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.post('/api/v1/cashflow/:projectId/projection', asyncHandler(async (_req, _res) => {
    throw createHttpError(
      410,
      'Projection 직접 입력은 사용하지 않습니다. 시트 값 불러오기로 반영해 주세요.',
      'cashflow_projection_sheet_import_only',
    );
  }));

  app.post('/api/v1/cashflow-metadata/:projectId/variance', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(
      req,
      ['admin', 'finance', 'pm'],
      'update cashflow variance metadata',
      authMode,
      workspaceEmailDomain,
    );
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(
      req,
      `/api/v1/cashflow/${projectId}/variance`,
      commandBody(req),
      { cashflowWrite: true },
    );
    return { status: 200, body: result };
  }));

  app.get('/api/v1/cashflow/:projectId/activity', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read cashflow activity', authMode, workspaceEmailDomain);
    const projectId = readOptionalText(req.params.projectId);
    const source = readOptionalText(req.query.source);
    if (source && !['legacy', 'sheet_refresh', 'audit'].includes(source)) {
      throw createHttpError(400, '활동 기록 조회 출처가 올바르지 않습니다.', 'cashflow_activity_source_invalid');
    }
    res.status(200).json({
      projectId,
      ...(source ? { source } : {}),
      events: await readCashflowActivity(db, readOptionalText(req.context?.tenantId), projectId, source),
    });
  }));

  app.get('/api/v1/cashflow/:projectId/applied-cell-changes', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read applied cashflow cell changes', authMode, workspaceEmailDomain);
    const projectId = readOptionalText(req.params.projectId);
    if (!projectId || !readOptionalText(req.context?.tenantId)) {
      throw createHttpError(400, '프로젝트와 워크스페이스를 확인해 주세요.', 'cashflow_applied_cell_changes_context_invalid');
    }
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    const cursor = readOptionalText(req.query.cursor);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor.length > 512) {
      throw createHttpError(400, '실제 반영 이력 조회 범위가 올바르지 않습니다.', 'cashflow_applied_cell_changes_query_invalid');
    }
    const query = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const result = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/cashflow/${encodeURIComponent(projectId)}/applied-cell-changes?${query}`,
    });
    res.status(200).json(result);
  }));

  app.get('/api/v1/cashflow/:projectId/month-close', asyncHandler(async (req, res) => {
    const trace = createCashflowPerformanceTrace({
      requestId: req.context?.requestId || req.requestId,
      operation: 'cashflow.month_close.read',
      ...(performanceLogger ? { logger: performanceLogger } : {}),
      ...(performanceNow ? { now: performanceNow } : {}),
    });
    const body = await withCashflowMonthCloseDeadline(async () => {
      assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read cashflow month close', authMode, workspaceEmailDomain);
      const rawProjectId = readOptionalText(req.params.projectId);
      const projectId = encodeURIComponent(rawProjectId);
      const yearMonth = readOptionalText(req.query.yearMonth);
      if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
        throw createHttpError(400, 'Cashflow month close yearMonth must use YYYY-MM.', 'cashflow_month_close_request_invalid');
      }
      cumulativeCloseMonths(yearMonth);
      const currentNow = now();
      const comparisonBoundary = {
        ...resolveCashflowComparisonAsOf('', currentNow),
        asOfMs: currentNow.getTime(),
      };
      const weeklyComplianceBoundary = {
        ...resolveCashflowComparisonAsOf('', currentNow),
        asOfMs: currentNow.getTime(),
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const traceAttempt = attempt + 1;
        const publicationBefore = await trace.measure(
          'publication_before',
          () => readCashflowSheetPublicationState({
            db,
            tenantId: req.context.tenantId,
            projectId: rawProjectId,
          }),
          { attempt: traceAttempt },
        );
        assertCashflowSheetPublicationReady(publicationBefore);
        const source = await trace.measure(
          'jvm_dashboard',
          () => proxyJavaWeeklyRequest({
            context: req.context,
            method: 'GET',
            path: `/api/v1/cashflow/${projectId}/month-close/dashboard-source?yearMonth=${encodeURIComponent(yearMonth)}`,
          }),
          { attempt: traceAttempt },
        );
        const result = objectValue(source?.monthClose);
        const cashflow = objectValue(source?.cashflow);
        const snapshotCompatibility = objectValue(source?.snapshotCompatibility) || {
          status: readOptionalText(result?.status) === 'OPEN' ? 'LIVE_CURRENT' : 'LEGACY_EVIDENCE_ONLY',
          missingEvidence: readOptionalText(result?.status) === 'OPEN' ? [] : ['OPENING_BALANCES', 'LEDGER_WEEKS'],
        };
        result.snapshotCompatibility = snapshotCompatibility;
        const openingBalances = snapshotCompatibility.status === 'LEGACY_EVIDENCE_ONLY'
          && snapshotCompatibility.missingEvidence?.includes('OPENING_BALANCES')
          ? null
          : requireJvmOpeningBalances(source, yearMonth);
        if (readOptionalText(result?.projectId) !== rawProjectId || readOptionalText(result?.yearMonth) !== yearMonth) {
          throw createHttpError(502, '요청한 달과 다른 달의 자료가 도착했습니다. 화면을 새로고침해 주세요.', 'jvm_weekly_project_mismatch');
        }
        if (db?.doc && readOptionalText(result?.status) === 'OPEN' && !cashflow) {
          throw createHttpError(502, '월 결산 자료 일부가 도착하지 않았습니다. 잠시 후 다시 시도해 주세요.', 'jvm_weekly_response_invalid');
        }
        if (cashflow && readOptionalText(cashflow?.projectId) !== rawProjectId) {
          throw createHttpError(502, '다른 프로젝트의 자료가 도착했습니다. 화면을 새로고침해 주세요.', 'jvm_weekly_project_mismatch');
        }
        const projectionActualSummary = objectValue(source?.projectionActualSummary);
        if (readOptionalText(projectionActualSummary?.projectId) !== rawProjectId
          || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(readOptionalText(projectionActualSummary?.fromMonth))
          || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(readOptionalText(projectionActualSummary?.comparisonAsOfWeek?.yearMonth))
          || !Number.isSafeInteger(Number(projectionActualSummary?.comparisonAsOfWeek?.weekNo))
          || Number(projectionActualSummary?.comparisonAsOfWeek?.weekNo) < 1
          || Number(projectionActualSummary?.comparisonAsOfWeek?.weekNo) > 5
          || !Number.isFinite(Number(projectionActualSummary?.settlementDifferenceAmount))
          || typeof projectionActualSummary?.settlementMatches !== 'boolean') {
          throw createHttpError(502, 'JVM 누적 Projection-Actual 요약을 확인할 수 없습니다.', 'jvm_weekly_response_invalid');
        }
        const weeklyCompliance = await trace.measure(
          'jvm_compliance',
          () => readWeeklyCompliance(req.context, rawProjectId),
          { attempt: traceAttempt },
        );
        const dashboard = await trace.measure(
          'dashboard_compose',
          () => composeCashflowMonthDashboard({
            db,
            req,
            projectId: rawProjectId,
            yearMonth,
            close: result,
            cashflow,
            openingBalances,
            comparisonBoundary,
            weeklyCompliance,
            projectionActualSummary,
            weeklyComplianceBoundary,
          }),
          { attempt: traceAttempt },
        );
        const publicationAfter = await trace.measure(
          'publication_after',
          () => readCashflowSheetPublicationState({
            db,
            tenantId: req.context.tenantId,
            projectId: rawProjectId,
          }),
          { attempt: traceAttempt },
        );
        assertCashflowSheetPublicationReady(publicationAfter);
        if (publicationBefore.fingerprint === publicationAfter.fingerprint) {
          return { ...result, dashboard };
        }
      }
      throw createHttpError(
        409,
        '시트 반영 상태가 조회 중 변경되었습니다. 잠시 후 다시 확인해 주세요.',
        'cashflow_sheet_publication_changed',
      );
    }, monthCloseRouteTimeoutMs);
    res.status(200).json(body);
  }));

  app.get('/api/v1/cashflow/:projectId/weekly-update-complete', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance', 'pm', 'auditor', 'viewer', 'tenant_admin', 'support', 'security'], 'read weekly cashflow update', authMode, workspaceEmailDomain);
    const projectId = readOptionalText(req.params.projectId);
    const yearMonth = readOptionalText(req.query.yearMonth);
    const weekNo = Number(req.query.weekNo);
    if (
      !/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)
      || !Number.isSafeInteger(weekNo)
      || weekNo < 1
      || weekNo > 5
    ) {
      throw createHttpError(
        400,
        '조회할 주간 정산 연월과 주차를 정확히 입력해 주세요.',
        'cashflow_weekly_update_scope_invalid',
      );
    }
    const result = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/cashflow/${encodeURIComponent(projectId)}/weekly-update-complete?yearMonth=${encodeURIComponent(yearMonth)}&weekNo=${weekNo}`,
    });
    res.status(200).json(result);
  }));

  app.get('/api/v1/cashflow/:projectId/weekly-update-compliance', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance', 'pm', 'auditor', 'viewer', 'tenant_admin', 'support', 'security'], 'read weekly cashflow compliance', authMode, workspaceEmailDomain);
    const projectId = readOptionalText(req.params.projectId);
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    const cursor = readOptionalText(req.query.cursor);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor.length > 512) {
      throw createHttpError(400, '주간 정산 이력 조회 범위가 올바르지 않습니다.', 'cashflow_weekly_compliance_query_invalid');
    }
    const result = await readWeeklyCompliance(req.context, projectId, { limit, cursor });
    res.status(200).json(result);
  }));

  app.post('/api/v1/cashflow/projection-actual-summary/batch', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read cashflow projection-actual summary', authMode, workspaceEmailDomain);
    const projectIds = req.body?.projectIds;
    if (!Array.isArray(projectIds)
      || projectIds.length < 1
      || projectIds.length > 10
      || projectIds.some((projectId) => typeof projectId !== 'string'
        || projectId.length < 1
        || projectId.length > 120
        || projectId.includes('/')
        || projectId.trim() !== projectId)
      || new Set(projectIds).size !== projectIds.length) {
      throw createHttpError(400, '현금흐름 요약 조회 범위가 올바르지 않습니다.', 'cashflow_projection_actual_summary_request_invalid');
    }
    const result = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'POST',
      path: '/api/v1/cashflow/projection-actual-summary/batch',
      command: 'read_cashflow_projection_actual_summaries',
      body: { projectIds },
      mutation: false,
    });
    res.status(200).json(result);
  }));

  app.post('/api/v1/cashflow/:projectId/weekly-update-complete', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance', 'pm', 'viewer', 'tenant_admin'], 'complete weekly cashflow update', authMode, workspaceEmailDomain);
    const projectId = readOptionalText(req.params.projectId);
    const currentNow = now();
    const boundary = resolveCashflowComparisonAsOf('', currentNow);
    const requested = commandBody(req);
    const requestedYearMonth = readOptionalText(requested.yearMonth);
    const requestedWeekNo = Number(requested.weekNo);
    const updateResult = readOptionalText(requested.updateResult).toUpperCase();
    const hasExplicitScope = Object.prototype.hasOwnProperty.call(requested, 'yearMonth')
      || Object.prototype.hasOwnProperty.call(requested, 'weekNo');
    if (!['CHANGED', 'NO_CHANGES'].includes(updateResult) || (hasExplicitScope && (
      !/^20\d{2}-(0[1-9]|1[0-2])$/.test(requestedYearMonth)
      || !Number.isSafeInteger(requestedWeekNo)
      || requestedWeekNo < 1
      || requestedWeekNo > 5
    ))) {
      throw createHttpError(
        400,
        '주간 정산 대상 연월과 주차를 함께 정확히 입력해 주세요.',
        'cashflow_weekly_update_scope_invalid',
      );
    }
    const requestKey = (
      readOptionalText(req.context.idempotencyKey)
      || readOptionalText(req.context.requestId)
      || String(currentNow.getTime())
    ).slice(0, 96);
    const result = await proxyMutation(
      req,
      `/api/v1/cashflow/${encodeURIComponent(projectId)}/weekly-update-complete`,
      {
        idempotencyKey: `cashflow-weekly:${requestKey}`,
        yearMonth: hasExplicitScope ? requestedYearMonth : boundary.asOfWeek.yearMonth,
        weekNo: hasExplicitScope ? requestedWeekNo : boundary.asOfWeek.weekNo,
        completedAt: currentNow.toISOString(),
        updateResult,
      },
      { cashflowWrite: true },
    );
    res.status(200).json(result);
  }));

  app.post('/api/v1/cashflow/:projectId/weekly-update-complete/reopen', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance', 'pm', 'viewer', 'tenant_admin'], 'reopen weekly cashflow update', authMode, workspaceEmailDomain);
    const projectId = readOptionalText(req.params.projectId);
    const requested = commandBody(req);
    const yearMonth = readOptionalText(requested.yearMonth);
    const weekNo = Number(requested.weekNo);
    const expectedRevision = Number(requested.expectedRevision);
    const reason = readOptionalText(requested.reason);
    if (
      !/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)
      || !Number.isSafeInteger(weekNo)
      || weekNo < 1
      || weekNo > 5
      || !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 1
      || !reason
      || reason.length > 1_000
    ) {
      throw createHttpError(
        400,
        '주간 정산 재오픈에는 대상 연월·주차·현재 revision·사유가 필요합니다.',
        'cashflow_weekly_reopen_request_invalid',
      );
    }
    const result = await proxyMutation(
      req,
      `/api/v1/cashflow/${encodeURIComponent(projectId)}/weekly-update-complete/reopen`,
      { ...requested, yearMonth, weekNo, expectedRevision, reason },
      { cashflowWrite: true },
    );
    res.status(200).json(result);
  }));

  async function prepareCashflowMonthClose(req, requestPayload = req.body, idempotencyKey = req.context.idempotencyKey) {
    const routeDeadlineAtMs = Date.now() + monthCloseRouteTimeoutMs;
    const mutationBudgetMs = Math.min(
      CASHFLOW_MONTH_CLOSE_MUTATION_BUDGET_MS,
      Math.max(1, Math.floor(monthCloseRouteTimeoutMs / 2)),
    );
    const preflightTimeoutMs = Math.max(1, monthCloseRouteTimeoutMs - mutationBudgetMs);
    const closeReq = {
      body: requestPayload,
      context: { ...req.context, idempotencyKey },
    };
    const prepared = await withCashflowMonthCloseDeadline(async () => {
      const rawProjectId = readOptionalText(req.params.projectId);
      const projectId = encodeURIComponent(rawProjectId);
      const requested = commandBody(closeReq);
      if (
        !/^20\d{2}-(0[1-9]|1[0-2])$/.test(readOptionalText(requested.yearMonth))
        || !Number.isSafeInteger(Number(requested.expectedRevision))
        || Number(requested.expectedRevision) < 0
        || !objectValue(requested.closeInput)
        || !objectValue(requested.expectedOpeningBalances)
        || readOptionalText(requested.closeInput.yearMonth) !== readOptionalText(requested.yearMonth)
      ) {
        throw createHttpError(400, 'Cashflow month close review input is required.', 'cashflow_month_close_request_invalid');
      }
      const currentNow = now();
      const publicationBefore = await readCashflowSheetPublicationState({
        db,
        tenantId: req.context.tenantId,
        projectId: rawProjectId,
      });
      assertCashflowSheetPublicationReady(publicationBefore);
      const comparisonBoundary = {
        ...resolveCashflowComparisonAsOf('', currentNow),
        asOfMs: currentNow.getTime(),
      };
      const yearMonth = readOptionalText(requested.yearMonth);
      const source = await proxyJavaWeeklyRequest({
        context: req.context,
        method: 'GET',
        path: `/api/v1/cashflow/${projectId}/month-close/dashboard-source?yearMonth=${encodeURIComponent(yearMonth)}`,
        deadlineAtMs: routeDeadlineAtMs - mutationBudgetMs,
      });
      const weeklyCompliance = await readWeeklyCompliance(req.context, rawProjectId);
      const sourceClose = objectValue(source?.monthClose);
      const cashflow = objectValue(source?.cashflow);
      const currentOpeningBalances = requireJvmOpeningBalances(source, yearMonth);
      const reviewedOpeningBalances = requireReviewedOpeningBalances(requested.expectedOpeningBalances, yearMonth);
      requireUnchangedReviewedOpeningBalances(reviewedOpeningBalances, currentOpeningBalances);
      if (Number(sourceClose?.revision) !== Number(requested.expectedRevision)) {
        throw createHttpError(
          409,
          '월 결산 상태가 변경되었습니다. 최신 자료를 다시 확인해 주세요.',
          'cashflow_month_close_revision_stale',
        );
      }
      if (
        readOptionalText(sourceClose?.projectId) !== rawProjectId
        || readOptionalText(sourceClose?.yearMonth) !== yearMonth
        || !cashflow
        || readOptionalText(cashflow?.projectId) !== rawProjectId
      ) {
        throw createHttpError(502, '월 결산 자료 일부가 도착하지 않았습니다. 잠시 후 다시 시도해 주세요.', 'jvm_weekly_response_invalid');
      }
      const { closeBody, reviewWarnings, monthSnapshot } = await composeCashflowMonthCloseBody({
        db,
        req: closeReq,
        projectId: rawProjectId,
        cashflow,
        openingBalances: reviewedOpeningBalances,
        comparisonBoundary,
        weeklyCompliance,
      });
      const publicationAfter = await readCashflowSheetPublicationState({
        db,
        tenantId: req.context.tenantId,
        projectId: rawProjectId,
      });
      assertCashflowSheetPublicationReady(publicationAfter);
      if (publicationBefore.fingerprint !== publicationAfter.fingerprint) {
        throw createHttpError(
          409,
          '월 결산 검토 중 시트 반영 상태가 변경되었습니다. 다시 확인해 주세요.',
          'cashflow_sheet_publication_changed',
        );
      }
      return {
        projectId,
        rawProjectId,
        cashflow,
        sourceCloseStatus: readOptionalText(sourceClose.status),
        closeBody,
        reviewWarnings,
        monthSnapshot,
        publicationFingerprint: publicationAfter.fingerprint,
        shardSource: {
          sourceRevision: readOptionalText(monthSnapshot?.source?.sourceRevision) || null,
          targetRevision: readOptionalText(monthSnapshot?.source?.targetRevision) || null,
          capturedAt: readOptionalText(monthSnapshot?.source?.capturedAt) || null,
          spreadsheetId: readOptionalText(monthSnapshot?.source?.spreadsheetId) || null,
          spreadsheetTitle: readOptionalText(monthSnapshot?.source?.spreadsheetTitle) || null,
          selectedSheetName: readOptionalText(monthSnapshot?.source?.selectedSheetName) || null,
          spreadsheetUrl: readOptionalText(monthSnapshot?.source?.spreadsheetUrl) || null,
        },
        routeDeadlineAtMs,
      };
    }, preflightTimeoutMs);
    return prepared;
  }

  async function executePreparedCashflowMonthClose(req, prepared) {
    if (Date.now() >= prepared.routeDeadlineAtMs) throw cashflowMonthCloseTimeoutError();
    try {
      const result = await proxyMutation(
        req,
        `/api/v1/cashflow/${prepared.projectId}/month-close`,
        prepared.closeBody,
        { cashflowWrite: true, deadlineAtMs: prepared.routeDeadlineAtMs },
      );
      return assertCashflowMonthCloseMutationResult(
        result,
        prepared.rawProjectId,
        prepared.closeBody.yearMonth,
        prepared.closeBody.expectedRevision,
      );
    } catch (mutationError) {
      const evidence = await reconcileCashflowMonthClose(req, prepared, mutationError);
      if (evidence.proven) return evidence.monthClose;
      const error = createHttpError(
        503,
        '월 결산 저장 결과를 확정할 수 없습니다. 같은 요청으로 다시 시도해 주세요.',
        'cashflow_month_close_reconciliation_pending',
      );
      error.reconciliationEvidence = evidence;
      throw error;
    }
  }

  async function reconcileCashflowMonthClose(req, prepared, mutationError = null) {
    const baseEvidence = {
      checkedAt: now().toISOString(),
      jvmMutationIdempotencyKey: prepared.closeBody.idempotencyKey,
      expected: {
        projectId: prepared.rawProjectId,
        yearMonth: prepared.closeBody.yearMonth,
        status: 'CLOSED',
        revision: prepared.closeBody.expectedRevision + 1,
      },
      mutationErrorCode: readOptionalText(mutationError?.code) || null,
    };
    try {
      const source = await proxyJavaWeeklyRequest({
        context: req.context,
        method: 'GET',
        path: `/api/v1/cashflow/${prepared.projectId}/month-close/dashboard-source?yearMonth=${encodeURIComponent(prepared.closeBody.yearMonth)}`,
        deadlineAtMs: Date.now() + Math.min(CASHFLOW_MONTH_CLOSE_MUTATION_BUDGET_MS, monthCloseRouteTimeoutMs),
      });
      const monthClose = objectValue(source?.monthClose);
      const observed = {
        projectId: readOptionalText(monthClose?.projectId) || null,
        yearMonth: readOptionalText(monthClose?.yearMonth) || null,
        status: readOptionalText(monthClose?.status) || null,
        revision: Number.isSafeInteger(Number(monthClose?.revision)) ? Number(monthClose.revision) : null,
      };
      const proven = observed.projectId === baseEvidence.expected.projectId
        && observed.yearMonth === baseEvidence.expected.yearMonth
        && observed.status === baseEvidence.expected.status
        && observed.revision === baseEvidence.expected.revision;
      return { ...baseEvidence, outcome: proven ? 'PROVEN' : 'DRIFTED', observed, proven, monthClose };
    } catch (readError) {
      return {
        ...baseEvidence,
        outcome: 'READ_FAILED',
        readErrorCode: readOptionalText(readError?.code) || null,
        proven: false,
      };
    }
  }

  function prepareStoredCashflowMonthCloseApproval(record, idempotencyKey) {
    const routeDeadlineAtMs = Date.now() + monthCloseRouteTimeoutMs;
    const rawProjectId = readOptionalText(record.projectId);
    const projectId = encodeURIComponent(rawProjectId);
    const requestPayload = objectValue(record.requestPayload);
    const closeInput = objectValue(requestPayload?.closeInput);
    const monthSnapshot = objectValue(record.monthSnapshot);
    const yearMonth = readOptionalText(record.yearMonth);
    const expectedRevision = Number(requestPayload?.expectedRevision);
    if (
      !closeInput
      || !monthSnapshot
      || readOptionalText(monthSnapshot.projectId) !== rawProjectId
      || readOptionalText(monthSnapshot.yearMonth) !== yearMonth
      || !Number.isSafeInteger(expectedRevision)
    ) {
      throw createHttpError(409, '저장된 월 결산 요청 근거를 확인할 수 없습니다.', 'cashflow_month_close_request_evidence_invalid');
    }
    const cells = ['projection', 'actual'].flatMap((mode) => (
      (Array.isArray(monthSnapshot?.[mode]?.weeks) ? monthSnapshot[mode].weeks : []).flatMap((week) => (
        (Array.isArray(week?.cells) ? week.cells : []).map((cell) => ({
          mode,
          yearMonth,
          weekNo: Number(week.weekNo),
          cashflowLine: cell?.cashflowLine,
          cellState: cell?.cellState,
          amount: cell?.amount,
        }))
      ))
    ));
    const normalizedCells = normalizeMonthCloseCells(cells, yearMonth);
    if (!completeMonthCloseCells(normalizedCells)) {
      throw createHttpError(409, '저장된 월 결산 160셀 근거를 확인할 수 없습니다.', 'cashflow_month_close_request_evidence_invalid');
    }
    return {
      projectId,
      rawProjectId,
      routeDeadlineAtMs,
      closeBody: {
        idempotencyKey,
        yearMonth,
        expectedRevision,
        expectedDraftRevision: 0,
        humanReviewed: true,
        sourceRevision: readOptionalText(monthSnapshot.source?.sourceRevision),
        targetRevision: readOptionalText(monthSnapshot.source?.targetRevision),
        depositScheduleRows: Array.isArray(closeInput.depositScheduleRows) ? closeInput.depositScheduleRows : [],
        cells: normalizedCells,
        confirmations: Array.isArray(closeInput.confirmations) ? closeInput.confirmations : [],
        managementChecks: Array.isArray(record.requestManagementChecks)
          ? record.requestManagementChecks
          : Array.isArray(closeInput.managementChecks) ? closeInput.managementChecks : [],
        managementConfirmations: [...validManagementConfirmations(closeInput.managementConfirmations).values()],
        openingBalances: requestPayload.expectedOpeningBalances,
        deadlineSummary: objectValue(record.requestDeadlineSummary) || {
          trackingStartedAt: null, missedCount: 0, completedCount: 0, current: null,
        },
      },
    };
  }

  async function persistCumulativeMonthCloseRequest({ req, prepared, approverUid, expectedApproverUid, expectedProjectVersion }) {
    const yearMonth = readOptionalText(prepared.closeBody.yearMonth);
    const cumulativeMonths = cumulativeCloseMonths(yearMonth);
    const requestId = `${prepared.rawProjectId}-${yearMonth}`;
    const sourceMonths = new Map((Array.isArray(prepared.cashflow?.readModel?.months) ? prepared.cashflow.readModel.months : [])
      .map((month) => [readOptionalText(month?.yearMonth), month]));
    const requestRef = db.doc(cashflowMonthCloseRequestPath(req.context.tenantId, requestId));
    const requestedAt = now().toISOString();
    const requestFingerprint = cashflowCloseHash(req.body ?? null);
    let revision;
    let shards;
    let manifest;
    let totals;
    let annualSummaries;
    let payloadFingerprint;
    let auditAction;
    const buildRevisionEvidence = (requestRevision, evidenceMonths = cumulativeMonths) => {
      const revisionShards = evidenceMonths.map((monthKey) => cumulativeMonthCloseShard({
        requestId,
        requestRevision,
        projectId: prepared.rawProjectId,
        yearMonth: monthKey,
        month: sourceMonths.get(monthKey),
        source: prepared.shardSource,
      }));
      const revisionManifest = cumulativeMonthCloseManifest({
        requestId, requestRevision, projectId: prepared.rawProjectId, yearMonth, shards: revisionShards,
      });
      const sumMode = (mode, selectedShards = revisionShards) => selectedShards.reduce((sum, shard) => sum + shard.cells
        .filter((cell) => cell.mode === mode && cell.cellState !== 'EMPTY')
        .reduce((monthSum, cell) => monthSum + Number(cell.amount), 0), 0);
      const revisionTotals = {
        projection: sumMode('projection'),
        actual: sumMode('actual'),
      };
      revisionTotals.difference = revisionTotals.actual - revisionTotals.projection;
      const revisionAnnualSummaries = [...new Set(revisionShards.map((shard) => Number(shard.yearMonth.slice(0, 4))))].map((year) => {
        const yearShards = revisionShards.filter((shard) => Number(shard.yearMonth.slice(0, 4)) === year);
        const projection = sumMode('projection', yearShards);
        const actual = sumMode('actual', yearShards);
        return { year, monthCount: yearShards.length, projection, actual, difference: actual - projection };
      });
      const fingerprint = cashflowCloseHash({
        contractVersion: CASHFLOW_CUMULATIVE_CLOSE_CONTRACT,
        approverUid,
        yearMonth,
        expectedRevision: prepared.closeBody.expectedRevision,
        manifestHash: revisionManifest.manifestHash,
      });
      return {
        shards: revisionShards,
        manifest: revisionManifest,
        totals: revisionTotals,
        annualSummaries: revisionAnnualSummaries,
        payloadFingerprint: fingerprint,
      };
    };
    return db.runTransaction(async (transaction) => {
      const [projectSnapshot, approverSnapshot, requesterSnapshot, requestSnapshot] = await Promise.all([
        transaction.get(db.doc(`orgs/${req.context.tenantId}/projects/${prepared.rawProjectId}`)),
        transaction.get(db.doc(`orgs/${req.context.tenantId}/members/${approverUid}`)),
        transaction.get(db.doc(`orgs/${req.context.tenantId}/members/${readOptionalText(req.context.actorId)}`)),
        transaction.get(requestRef),
      ]);
      const project = projectSnapshot.exists ? projectSnapshot.data() || {} : {};
      const approver = approverSnapshot.exists ? approverSnapshot.data() || {} : {};
      const requester = requesterSnapshot.exists ? requesterSnapshot.data() || {} : {};
      const existing = requestSnapshot.exists ? requestSnapshot.data() || {} : null;
      if (
        readOptionalText(project.executiveApproverId) !== approverUid
        || approverUid !== expectedApproverUid
        || (Number.isSafeInteger(project.version) ? project.version : 0) !== expectedProjectVersion
        || readOptionalText(approver.uid) !== approverUid
        || readOptionalText(approver.status).toUpperCase() !== 'ACTIVE'
      ) throw createHttpError(409, '프로젝트 조직장 정보가 변경되었습니다. 다시 요청해 주세요.', 'cashflow_month_close_approver_stale');
      if (
        readOptionalText(requester.uid) !== readOptionalText(req.context.actorId)
        || readOptionalText(requester.status).toUpperCase() !== 'ACTIVE'
      ) throw createHttpError(403, '이 프로젝트의 월 결산을 요청할 권한이 없습니다.', 'cashflow_month_close_project_forbidden');
      if (existing) {
        if (existing.contractVersion !== CASHFLOW_CUMULATIVE_CLOSE_CONTRACT
          || !Number.isSafeInteger(Number(existing.revision)) || Number(existing.revision) < 1) {
          throw createHttpError(409, '이미 이 월의 결산 요청이 존재합니다.', 'cashflow_month_close_request_conflict');
        }
        let replayEvidence = buildRevisionEvidence(Number(existing.revision));
        const legacyBuildingEvidence = existing.status === 'BUILDING'
          && !readOptionalText(existing.throughMonth)
          && !readOptionalText(existing.requestFingerprint)
          && existing.requestId === requestId
          && existing.projectId === prepared.rawProjectId
          && existing.yearMonth === yearMonth
          ? buildRevisionEvidence(
            Number(existing.revision),
            monthsBetween(CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH, existing.yearMonth),
          )
          : null;
        const legacyBuildingReplay = existing.status === 'BUILDING'
          && legacyBuildingEvidence !== null
          && !readOptionalText(existing.requestFingerprint)
          && existing.createIdempotencyKey === req.context.idempotencyKey
          && existing.payloadFingerprint === legacyBuildingEvidence?.payloadFingerprint
          && existing.requestId === requestId
          && existing.tenantId === req.context.tenantId
          && existing.projectId === prepared.rawProjectId
          && existing.yearMonth === yearMonth
          && existing.requestedByUid === readOptionalText(req.context.actorId)
          && existing.approverUid === approverUid
          && Number(existing.expectedRevision) === prepared.closeBody.expectedRevision;
        if (legacyBuildingReplay) replayEvidence = legacyBuildingEvidence;
        if (
          existing.createIdempotencyKey === req.context.idempotencyKey
          && (existing.requestFingerprint === requestFingerprint || legacyBuildingReplay)
          && existing.payloadFingerprint === replayEvidence.payloadFingerprint
        ) {
          if (!['BUILDING', 'PENDING'].includes(existing.status)) {
            return existing;
          }
          revision = Number(existing.revision);
          ({ shards, manifest, totals, annualSummaries, payloadFingerprint } = replayEvidence);
          auditAction = revision === 1 ? 'REQUESTED' : 'RESUBMITTED';
        } else if (!['REJECTED', 'REOPENED'].includes(existing.status)
          && !(existing.status === 'APPROVED' && prepared.sourceCloseStatus === 'OPEN')) {
          throw createHttpError(409, '이미 이 월의 결산 요청이 존재합니다.', 'cashflow_month_close_request_conflict');
        } else {
          revision = Number(existing.revision) + 1;
          auditAction = 'RESUBMITTED';
          const existingThroughMonth = readOptionalText(existing.throughMonth);
          if (existingThroughMonth && existingThroughMonth !== cumulativeMonths.at(-1)) {
            throw createHttpError(
              409,
              '저장된 누적 월 결산 범위가 현재 계약과 다릅니다.',
              'cashflow_month_close_request_horizon_invalid',
            );
          }
          const legacyMonthCount = monthsBetween(CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH, yearMonth).length;
          if (!existingThroughMonth && Number(existing.monthCount) !== legacyMonthCount) {
            throw createHttpError(
              409,
              '저장된 레거시 누적 월 결산 범위를 확인할 수 없습니다.',
              'cashflow_month_close_request_horizon_invalid',
            );
          }
          if (!existingThroughMonth) {
            ({ shards, manifest, totals, annualSummaries, payloadFingerprint } = buildRevisionEvidence(
              revision,
              monthsBetween(CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH, yearMonth),
            ));
          }
        }
      } else {
        revision = 1;
        auditAction = 'REQUESTED';
      }
      if (!shards) {
        ({ shards, manifest, totals, annualSummaries, payloadFingerprint } = buildRevisionEvidence(revision));
      }
      const shardRefs = shards.map((shard) => db.doc(cashflowMonthCloseRequestMonthPath(
        req.context.tenantId, requestId, revision, shard.yearMonth,
      )));
      const shardSnapshots = await Promise.all(shardRefs.map((ref) => transaction.get(ref)));
      shardSnapshots.forEach((snapshot, index) => {
        if (snapshot.exists && stableStringify(snapshot.data() || {}) !== stableStringify(shards[index])) {
          throw createHttpError(409, '저장된 누적 월 결산 월 근거가 변경되었습니다.', 'cashflow_month_close_request_evidence_tampered');
        }
      });
      const storedRecord = {
        contractVersion: CASHFLOW_CUMULATIVE_CLOSE_CONTRACT,
        requestId,
        tenantId: req.context.tenantId,
        projectId: prepared.rawProjectId,
        yearMonth,
        ...(shards.at(-1)?.yearMonth === yearMonth ? {} : { throughMonth: shards.at(-1)?.yearMonth }),
        fromMonth: CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH,
        status: 'PENDING',
        revision,
        manifestHash: manifest.manifestHash,
        monthCount: shards.length,
        weekCount: shards.length * 5,
        cellCount: shards.length * 160,
        source: prepared.shardSource,
        totals,
        annualSummaries,
        expectedRevision: prepared.closeBody.expectedRevision,
        approverUid,
        requestedByUid: readOptionalText(req.context.actorId),
        requestedAt,
        createIdempotencyKey: req.context.idempotencyKey,
        requestFingerprint,
        payloadFingerprint,
      };
      shardSnapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) transaction.set(shardRefs[index], shards[index]);
      });
      transaction.set(requestRef, storedRecord);
      transaction.set(
        db.doc(cashflowMonthCloseRequestAuditPath(
          req.context.tenantId, requestId, revision, auditAction.toLowerCase(),
        )),
        {
          requestId,
          projectId: prepared.rawProjectId,
          yearMonth,
          action: auditAction,
          revision,
          manifestHash: manifest.manifestHash,
          actorUid: storedRecord.requestedByUid,
          idempotencyKey: storedRecord.createIdempotencyKey,
          createdAt: storedRecord.requestedAt,
        },
      );
      return storedRecord;
    });
  }

  function assertCumulativeCloseResult(result, record) {
    if (
      result?.ok !== true
      || readOptionalText(result.projectId) !== record.projectId
      || readOptionalText(result.requestId) !== record.requestId
      || Number(result.requestRevision) !== Number(record.revision)
      || readOptionalText(result.manifestHash) !== record.manifestHash
      || readOptionalText(result.rootHash) !== record.manifestHash
      || readOptionalText(result.yearMonth) !== record.yearMonth
      || readOptionalText(result.status) !== 'CLOSED'
      || !Number.isSafeInteger(Number(result.revision))
      || !Number.isSafeInteger(Number(result.headRevision))
      || !readOptionalText(result.auditId)
    ) throw createHttpError(502, 'JVM 누적 월 결산 결과를 확인할 수 없습니다.', 'cashflow_jvm_invalid_response');
    return result;
  }

  async function verifyCumulativeRequestShards(tenantId, record) {
    const shards = [];
    for (const yearMonth of monthsBetween(record.fromMonth, readOptionalText(record.throughMonth) || record.yearMonth)) {
      const snapshot = await db.doc(cashflowMonthCloseRequestMonthPath(
        tenantId, record.requestId, record.revision, yearMonth,
      )).get();
      const stored = snapshot.exists ? snapshot.data() || {} : null;
      const { shardHash, ...base } = stored || {};
      if (!stored || stored.cells?.length !== 160 || shardHash !== cashflowCloseHash(base)) {
        throw createHttpError(409, '저장된 누적 월 결산 근거가 손상되었습니다.', 'cashflow_month_close_request_evidence_tampered');
      }
      shards.push(stored);
    }
    const verified = cumulativeMonthCloseManifest({
      requestId: record.requestId,
      requestRevision: record.revision,
      projectId: record.projectId,
      yearMonth: record.yearMonth,
      shards,
    });
    if (shards.length !== record.monthCount || verified.manifestHash !== record.manifestHash) {
      throw createHttpError(409, '누적 월 결산 manifest가 일치하지 않습니다.', 'cashflow_month_close_request_manifest_invalid');
    }
  }

  app.get('/api/v1/cashflow/month-close/requests/pending', asyncHandler(async (req, res) => {
    if (!db?.doc || !db?.collection) {
      throw createHttpError(503, '월 결산 요청 저장소에 연결하지 못했습니다.', 'cashflow_month_close_request_store_unavailable');
    }
    const actorId = readOptionalText(req.context.actorId);
    await readActiveCashflowMember({ db, tenantId: req.context.tenantId, actorId });
    const snapshot = await db.collection(`orgs/${req.context.tenantId}/cashflow_month_close_requests`)
      .where('approverUid', '==', actorId)
      .limit(100)
      .get();
    const candidates = snapshot.docs
      .map((doc) => doc.data() || {})
      .filter((record) => ['PENDING', 'APPROVING', 'UNCERTAIN'].includes(record.status) && record.approverUid === actorId);
    const canonicalMatches = await Promise.all(candidates.map(async (record) => {
      const projectSnapshot = await db.doc(`orgs/${req.context.tenantId}/projects/${record.projectId}`).get();
      return projectSnapshot.exists
        && readOptionalText(projectSnapshot.data()?.executiveApproverId) === actorId;
    }));
    const visibleRecords = candidates.filter((_record, index) => canonicalMatches[index]);
    const items = (await Promise.all(visibleRecords.map(async (record) => cashflowMonthCloseRequestView(
      record,
      await readCashflowRequestPartyNames({ db, tenantId: req.context.tenantId, record }),
    ))))
      .sort((left, right) => String(right.requestedAt).localeCompare(String(left.requestedAt)));
    res.status(200).json({ items, count: items.length });
  }));

  app.post('/api/v1/cashflow/:projectId/month-close/approver', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance', 'pm', 'viewer'], 'set cashflow month-close approver', authMode, workspaceEmailDomain);
    assertAlignedCashflowMutation();
    if (!db?.doc || !db?.runTransaction) {
      throw createHttpError(503, '프로젝트 조직장 저장소에 연결하지 못했습니다.', 'cashflow_month_close_request_store_unavailable');
    }
    const projectId = readOptionalText(req.params.projectId);
    const approverUid = readOptionalText(req.body?.approverUid);
    const yearMonth = readOptionalText(req.body?.yearMonth);
    const expectedVersion = req.body?.expectedVersion;
    if (
      !projectId || projectId.includes('/')
      || !approverUid || approverUid.includes('/')
      || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)
      || (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0))
    ) {
      throw createHttpError(400, '프로젝트 조직장 지정값이 올바르지 않습니다.', 'cashflow_month_close_approver_invalid');
    }
    const actorId = readOptionalText(req.context.actorId);
    const projectRef = db.doc(`orgs/${req.context.tenantId}/projects/${projectId}`);
    const actorRef = db.doc(`orgs/${req.context.tenantId}/members/${actorId}`);
    const approverRef = db.doc(`orgs/${req.context.tenantId}/members/${approverUid}`);
    const requestId = `${projectId}-${yearMonth}`;
    const pendingRequestsQuery = db.collection(`orgs/${req.context.tenantId}/cashflow_month_close_requests`)
      .where('projectId', '==', projectId)
      .limit(100);
    const updatedAt = now().toISOString();
    let result;

    await db.runTransaction(async (transaction) => {
      const [projectSnapshot, actorSnapshot, approverSnapshot, requestSnapshot] = await Promise.all([
        transaction.get(projectRef),
        transaction.get(actorRef),
        transaction.get(approverRef),
        transaction.get(pendingRequestsQuery),
      ]);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, '프로젝트를 찾을 수 없습니다.', 'not_found');
      }
      const project = projectSnapshot.data() || {};
      const actor = actorSnapshot.exists ? actorSnapshot.data() || {} : null;
      const approver = approverSnapshot.exists ? approverSnapshot.data() || {} : null;
      if (
        !actor
        || readOptionalText(actor.uid) !== actorId
        || readOptionalText(actor.status).toUpperCase() !== 'ACTIVE'
      ) {
        throw createHttpError(403, '활성 구성원만 프로젝트 조직장을 지정할 수 있습니다.', 'cashflow_month_close_member_inactive');
      }
      if (
        !approver
        || readOptionalText(approver.uid) !== approverUid
        || readOptionalText(approver.status).toUpperCase() !== 'ACTIVE'
      ) {
        throw createHttpError(403, '같은 조직의 활성 구성원만 조직장으로 지정할 수 있습니다.', 'cashflow_month_close_member_inactive');
      }
      if ([actorId, project.registeredById, project.managerId].map(readOptionalText).includes(approverUid)) {
        throw createHttpError(409, '월 결산 요청자는 자신의 요청을 승인할 수 없습니다.', 'cashflow_month_close_self_approval_forbidden');
      }
      const hasPendingRequest = requestSnapshot.docs.some((doc) => (
        ['PENDING', 'APPROVING', 'UNCERTAIN'].includes(readOptionalText(doc.data()?.status))
      ));
      if (hasPendingRequest) {
        throw createHttpError(409, '승인 대기 중인 월 결산의 조직장은 변경할 수 없습니다.', 'cashflow_month_close_approver_locked');
      }
      const currentVersion = Number.isSafeInteger(project.version) ? project.version : 0;
      if (readOptionalText(project.executiveApproverId) === approverUid) {
        result = {
          projectId,
          executiveApproverId: approverUid,
          executiveApproverName: readOptionalText(project.executiveApproverName) || readOptionalText(approver.name),
          executiveApproverEmail: readOptionalText(project.executiveApproverEmail) || readOptionalText(approver.email),
          version: currentVersion,
          updatedAt: readOptionalText(project.updatedAt) || updatedAt,
        };
        return;
      }
      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        throw createHttpError(409, '프로젝트 정보가 변경되었습니다. 새로고침 후 다시 지정해 주세요.', 'version_conflict');
      }
      const version = currentVersion + 1;
      result = {
        projectId,
        executiveApproverId: approverUid,
        executiveApproverName: readOptionalText(approver.name),
        executiveApproverEmail: readOptionalText(approver.email),
        version,
        updatedAt,
      };
      transaction.set(projectRef, {
        executiveApproverId: result.executiveApproverId,
        executiveApproverName: result.executiveApproverName,
        executiveApproverEmail: result.executiveApproverEmail,
        version,
        updatedAt,
        updatedBy: actorId,
      }, { merge: true });
      transaction.set(
        db.doc(cashflowMonthCloseRequestAuditPath(req.context.tenantId, requestId, version, 'approver-updated')),
        {
          requestId,
          projectId,
          yearMonth,
          action: 'APPROVER_UPDATED',
          revision: version,
          actorUid: actorId,
          approverUid,
          idempotencyKey: readOptionalText(req.context.idempotencyKey),
          createdAt: updatedAt,
        },
      );
    });

    res.status(200).json(result);
  }));

  app.get('/api/v1/cashflow/:projectId/month-close/requests/current', asyncHandler(async (req, res) => {
    if (!db?.doc) {
      throw createHttpError(503, '월 결산 요청 저장소에 연결하지 못했습니다.', 'cashflow_month_close_request_store_unavailable');
    }
    const projectId = readOptionalText(req.params.projectId);
    const yearMonth = readOptionalText(req.query.yearMonth);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      throw createHttpError(400, '조회할 월 결산 연월이 올바르지 않습니다.', 'cashflow_month_close_request_invalid');
    }
    const actorId = readOptionalText(req.context.actorId);
    await readActiveCashflowMember({ db, tenantId: req.context.tenantId, actorId });
    const requestId = `${projectId}-${yearMonth}`;
    const snapshot = await db.doc(cashflowMonthCloseRequestPath(req.context.tenantId, requestId)).get();
    if (!snapshot.exists) {
      res.status(200).json({ request: null });
      return;
    }
    const record = snapshot.data() || {};
    if (record.projectId !== projectId || record.yearMonth !== yearMonth) {
      throw createHttpError(403, '이 월 결산 요청을 조회할 권한이 없습니다.', 'cashflow_month_close_request_forbidden');
    }
    if (record.contractVersion === CASHFLOW_CUMULATIVE_CLOSE_CONTRACT && record.status === 'BUILDING') {
      res.status(200).json({ request: null });
      return;
    }
    if (![record.requestedByUid, record.approverUid].includes(actorId)) {
      throw createHttpError(403, '이 월 결산 요청을 조회할 권한이 없습니다.', 'cashflow_month_close_request_forbidden');
    }
    if (record.approverUid === actorId) {
      const canonicalApproverUid = await readCanonicalCashflowApprover({
        db, tenantId: req.context.tenantId, projectId, requesterUid: record.requestedByUid,
      });
      if (canonicalApproverUid !== actorId) {
        throw createHttpError(403, '이 월 결산 요청을 조회할 권한이 없습니다.', 'cashflow_month_close_request_forbidden');
      }
    }
    res.status(200).json({
      request: cashflowMonthCloseRequestView(
        record,
        await readCashflowRequestPartyNames({ db, tenantId: req.context.tenantId, record }),
      ),
    });
  }));

  app.get('/api/v1/cashflow/:projectId/month-close/requests/:requestId/months', asyncHandler(async (req, res) => {
    if (!db?.doc) throw createHttpError(503, '월 결산 요청 저장소에 연결하지 못했습니다.', 'cashflow_month_close_request_store_unavailable');
    const projectId = readOptionalText(req.params.projectId);
    const requestId = readOptionalText(req.params.requestId);
    const actorId = readOptionalText(req.context.actorId);
    const cursor = readOptionalText(req.query.cursor);
    const limit = req.query.limit === undefined ? 12 : Number(req.query.limit);
    if ((cursor && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(cursor)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 12) {
      throw createHttpError(400, '월 결산 월 목록 조회 범위가 올바르지 않습니다.', 'cashflow_month_close_request_invalid');
    }
    await readActiveCashflowMember({ db, tenantId: req.context.tenantId, actorId });
    const requestSnapshot = await db.doc(cashflowMonthCloseRequestPath(req.context.tenantId, requestId)).get();
    const record = requestSnapshot.exists ? requestSnapshot.data() || {} : null;
    if (!record || record.projectId !== projectId || record.contractVersion !== CASHFLOW_CUMULATIVE_CLOSE_CONTRACT) {
      throw createHttpError(404, '월 결산 요청을 찾을 수 없습니다.', 'cashflow_month_close_request_not_found');
    }
    if (record.status === 'BUILDING') {
      throw createHttpError(409, '누적 월 결산 근거 저장이 아직 완료되지 않았습니다.', 'cashflow_month_close_request_building');
    }
    if (![record.requestedByUid, record.approverUid].includes(actorId)) {
      throw createHttpError(403, '이 월 결산 요청을 조회할 권한이 없습니다.', 'cashflow_month_close_request_forbidden');
    }
    if (record.approverUid === actorId) {
      const canonicalApproverUid = await readCanonicalCashflowApprover({
        db, tenantId: req.context.tenantId, projectId, requesterUid: record.requestedByUid,
      });
      if (canonicalApproverUid !== actorId) {
        throw createHttpError(403, '이 월 결산 요청을 조회할 권한이 없습니다.', 'cashflow_month_close_request_forbidden');
      }
    }
    const allMonths = monthsBetween(record.fromMonth, readOptionalText(record.throughMonth) || record.yearMonth);
    const start = cursor ? allMonths.findIndex((month) => month >= cursor) : 0;
    const pageMonths = allMonths.slice(start < 0 ? allMonths.length : start, (start < 0 ? allMonths.length : start) + limit);
    const months = [];
    for (const month of pageMonths) {
      const snapshot = await db.doc(cashflowMonthCloseRequestMonthPath(
        req.context.tenantId, requestId, record.revision, month,
      )).get();
      const stored = snapshot.exists ? snapshot.data() || {} : null;
      const { shardHash, ...base } = stored || {};
      if (!stored || stored.cells?.length !== 160 || shardHash !== cashflowCloseHash(base)) {
        throw createHttpError(409, '저장된 누적 월 결산 근거가 손상되었습니다.', 'cashflow_month_close_request_evidence_tampered');
      }
      months.push(stored);
    }
    const nextIndex = (start < 0 ? allMonths.length : start) + pageMonths.length;
    res.status(200).json({
      requestId,
      requestRevision: record.revision,
      manifestHash: record.manifestHash,
      monthCount: record.monthCount,
      months,
      nextCursor: nextIndex < allMonths.length ? allMonths[nextIndex] : null,
    });
  }));

  app.get('/api/v1/cashflow/:projectId/month-close/requests/:requestId/revision-diff', asyncHandler(async (req, res) => {
    if (!db?.doc) throw createHttpError(503, '월 결산 요청 저장소에 연결하지 못했습니다.', 'cashflow_month_close_request_store_unavailable');
    const projectId = readOptionalText(req.params.projectId);
    const requestId = readOptionalText(req.params.requestId);
    const actorId = readOptionalText(req.context.actorId);
    await readActiveCashflowMember({ db, tenantId: req.context.tenantId, actorId });
    const requestSnapshot = await db.doc(cashflowMonthCloseRequestPath(req.context.tenantId, requestId)).get();
    const record = requestSnapshot.exists ? requestSnapshot.data() || {} : null;
    if (!record || record.projectId !== projectId || record.contractVersion !== CASHFLOW_CUMULATIVE_CLOSE_CONTRACT) {
      throw createHttpError(404, '월 결산 요청을 찾을 수 없습니다.', 'cashflow_month_close_request_not_found');
    }
    if (![record.requestedByUid, record.approverUid].includes(actorId)) {
      throw createHttpError(403, '이 월 결산 요청을 조회할 권한이 없습니다.', 'cashflow_month_close_request_forbidden');
    }
    if (record.approverUid === actorId) {
      const canonicalApproverUid = await readCanonicalCashflowApprover({
        db, tenantId: req.context.tenantId, projectId, requesterUid: record.requestedByUid,
      });
      if (canonicalApproverUid !== actorId) {
        throw createHttpError(403, '이 월 결산 요청을 조회할 권한이 없습니다.', 'cashflow_month_close_request_forbidden');
      }
    }
    const currentRevision = Number(record.revision);
    const throughMonth = readOptionalText(record.throughMonth) || record.yearMonth;
    if (!Number.isSafeInteger(currentRevision) || currentRevision < 1) {
      throw createHttpError(409, '월 결산 요청 revision이 올바르지 않습니다.', 'cashflow_month_close_request_evidence_invalid');
    }
    const readShard = async (revision) => {
      const snapshot = await db.doc(cashflowMonthCloseRequestMonthPath(
        req.context.tenantId, requestId, revision, throughMonth,
      )).get();
      const stored = snapshot.exists ? snapshot.data() || {} : null;
      const { shardHash, ...base } = stored || {};
      if (!stored
        || stored.requestId !== requestId
        || stored.projectId !== projectId
        || Number(stored.requestRevision) !== revision
        || stored.yearMonth !== throughMonth
        || stored.cells?.length !== 160
        || shardHash !== cashflowCloseHash(base)) {
        throw createHttpError(409, '저장된 revision 비교 근거가 손상되었습니다.', 'cashflow_month_close_request_evidence_tampered');
      }
      return stored;
    };
    const current = await readShard(currentRevision);
    if (currentRevision === 1) {
      res.status(200).json({ requestId, yearMonth: throughMonth, currentRevision, previousRevision: null, changes: [] });
      return;
    }
    const previousRevision = currentRevision - 1;
    const previous = await readShard(previousRevision);
    const changes = buildCashflowMonthCloseRevisionChanges(previous.cells, current.cells);
    res.status(200).json({ requestId, yearMonth: throughMonth, currentRevision, previousRevision, changes });
  }));

  app.post('/api/v1/cashflow/:projectId/month-close/requests', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance', 'pm', 'viewer'], 'request cashflow month close', authMode, workspaceEmailDomain);
    assertAlignedCashflowMutation();
    if (!db?.doc || !db?.runTransaction) {
      throw createHttpError(503, '월 결산 요청 저장소에 연결하지 못했습니다.', 'cashflow_month_close_request_store_unavailable');
    }
    const rawProjectId = readOptionalText(req.params.projectId);
    const expectedApproverUid = readOptionalText(req.body?.expectedApproverUid);
    const expectedProjectVersion = Number(req.body?.expectedProjectVersion);
    if (!expectedApproverUid || !Number.isSafeInteger(expectedProjectVersion) || expectedProjectVersion < 0) {
      throw createHttpError(400, '확정한 프로젝트 조직장 정보가 필요합니다.', 'cashflow_month_close_approver_expectation_required');
    }
    await readActiveCashflowMember({
      db,
      tenantId: req.context.tenantId,
      actorId: req.context.actorId,
    });
    const approverUid = await readCanonicalCashflowApprover({
      db,
      tenantId: req.context.tenantId,
      projectId: rawProjectId,
      requesterUid: req.context.actorId,
    });
    if (readOptionalText(req.body?.contractVersion) === CASHFLOW_CUMULATIVE_CLOSE_CONTRACT) {
      const yearMonth = readOptionalText(req.body?.yearMonth);
      const requestId = `${rawProjectId}-${yearMonth}`;
      const requestFingerprint = cashflowCloseHash(req.body ?? null);
      const [requestSnapshot, projectSnapshot] = await Promise.all([
        db.doc(cashflowMonthCloseRequestPath(req.context.tenantId, requestId)).get(),
        db.doc(`orgs/${req.context.tenantId}/projects/${rawProjectId}`).get(),
      ]);
      const existing = requestSnapshot.exists ? requestSnapshot.data() || {} : null;
      const project = projectSnapshot.exists ? projectSnapshot.data() || {} : {};
      const projectVersion = Number.isSafeInteger(project.version) ? project.version : 0;
      if (
        existing
        && existing.createIdempotencyKey === req.context.idempotencyKey
        && existing.requestFingerprint !== requestFingerprint
        && !(existing.status === 'BUILDING' && !readOptionalText(existing.requestFingerprint))
      ) {
        throw createHttpError(409, '동일한 요청 키의 월 결산 입력이 변경되었습니다.', 'cashflow_month_close_request_conflict');
      }
      if (
        existing
        && existing.status !== 'BUILDING'
        && existing.contractVersion === CASHFLOW_CUMULATIVE_CLOSE_CONTRACT
        && existing.requestId === requestId
        && existing.projectId === rawProjectId
        && existing.yearMonth === yearMonth
        && existing.requestedByUid === readOptionalText(req.context.actorId)
        && existing.approverUid === approverUid
        && Boolean(readOptionalText(req.context.idempotencyKey))
        && existing.createIdempotencyKey === req.context.idempotencyKey
        && existing.requestFingerprint === requestFingerprint
        && Number(existing.expectedRevision) === Number(req.body?.expectedRevision)
        && expectedApproverUid === approverUid
        && projectVersion === expectedProjectVersion
        && readOptionalText(project.executiveApproverId) === approverUid
      ) {
        res.status(202).json(cashflowMonthCloseRequestView(existing));
        return;
      }
    }
    const prepared = await prepareCashflowMonthClose(req);
    const yearMonth = readOptionalText(prepared.closeBody.yearMonth);
    if (readOptionalText(req.body?.contractVersion) === CASHFLOW_CUMULATIVE_CLOSE_CONTRACT) {
      const stored = await persistCumulativeMonthCloseRequest({
        req, prepared, approverUid, expectedApproverUid, expectedProjectVersion,
      });
      res.status(202).json(cashflowMonthCloseRequestView(stored));
      return;
    }
    const requestId = `${prepared.rawProjectId}-${yearMonth}`;
    const requestPayload = {
      yearMonth,
      expectedRevision: prepared.closeBody.expectedRevision,
      expectedApproverUid,
      expectedProjectVersion,
      expectedOpeningBalances: req.body.expectedOpeningBalances,
      closeInput: req.body.closeInput,
    };
    const payloadFingerprint = stableStringify({ approverUid, requestPayload });
    const requestRef = db.doc(cashflowMonthCloseRequestPath(req.context.tenantId, requestId));
    const projectRef = db.doc(`orgs/${req.context.tenantId}/projects/${prepared.rawProjectId}`);
    const approverRef = db.doc(`orgs/${req.context.tenantId}/members/${approverUid}`);
    const requesterRef = db.doc(`orgs/${req.context.tenantId}/members/${readOptionalText(req.context.actorId)}`);
    const requestedAt = now().toISOString();
    let storedRecord;
    await db.runTransaction(async (transaction) => {
      const [projectSnapshot, approverSnapshot, requesterSnapshot, snapshot] = await Promise.all([
        transaction.get(projectRef),
        transaction.get(approverRef),
        transaction.get(requesterRef),
        transaction.get(requestRef),
      ]);
      const currentProject = projectSnapshot.exists ? projectSnapshot.data() || {} : {};
      const currentApprover = approverSnapshot.exists ? approverSnapshot.data() || {} : {};
      const currentRequester = requesterSnapshot.exists ? requesterSnapshot.data() || {} : {};
      const currentVersion = Number.isSafeInteger(currentProject.version) ? currentProject.version : 0;
      if (
        readOptionalText(currentProject.executiveApproverId) !== approverUid
        || approverUid !== expectedApproverUid
        || currentVersion !== expectedProjectVersion
        || readOptionalText(currentApprover.uid) !== approverUid
        || readOptionalText(currentApprover.status).toUpperCase() !== 'ACTIVE'
      ) {
        throw createHttpError(409, '프로젝트 조직장 정보가 변경되었습니다. 다시 요청해 주세요.', 'cashflow_month_close_approver_stale');
      }
      if (
        readOptionalText(currentRequester.uid) !== readOptionalText(req.context.actorId)
        || readOptionalText(currentRequester.status).toUpperCase() !== 'ACTIVE'
      ) {
        throw createHttpError(403, '이 프로젝트의 월 결산을 요청할 권한이 없습니다.', 'cashflow_month_close_project_forbidden');
      }
      if (snapshot.exists) {
        const existing = snapshot.data() || {};
        if (
          existing.createIdempotencyKey === req.context.idempotencyKey
          && existing.payloadFingerprint === payloadFingerprint
        ) {
          storedRecord = existing;
          return;
        }
        if (existing.status === 'REJECTED') {
          const revision = Number(existing.revision) + 1;
          storedRecord = {
            ...existing,
            status: 'PENDING',
            revision,
            approverUid,
            requestedByUid: readOptionalText(req.context.actorId),
            requestedAt,
            createIdempotencyKey: req.context.idempotencyKey,
            payloadFingerprint,
            requestPayload,
            reviewWarnings: prepared.reviewWarnings,
            monthSnapshot: prepared.monthSnapshot,
            requestManagementChecks: prepared.closeBody.managementChecks,
            requestDeadlineSummary: prepared.closeBody.deadlineSummary,
            reviewedByUid: null,
            reviewedAt: null,
            decisionReason: null,
            reviewIdempotencyKey: null,
          };
          assertCashflowMonthCloseRequestSize(storedRecord);
          transaction.set(requestRef, storedRecord);
          transaction.set(
            db.doc(cashflowMonthCloseRequestAuditPath(req.context.tenantId, requestId, revision, 'resubmitted')),
            {
              requestId,
              projectId: prepared.rawProjectId,
              yearMonth,
              action: 'RESUBMITTED',
              revision,
              actorUid: storedRecord.requestedByUid,
              idempotencyKey: req.context.idempotencyKey,
              createdAt: requestedAt,
            },
          );
          return;
        }
        throw createHttpError(409, '이미 이 월의 결산 요청이 존재합니다.', 'cashflow_month_close_request_conflict');
      }
      storedRecord = {
        requestId,
        tenantId: req.context.tenantId,
        projectId: prepared.rawProjectId,
        yearMonth,
        status: 'PENDING',
        revision: 0,
        approverUid,
        requestedByUid: readOptionalText(req.context.actorId),
        requestedAt,
        createIdempotencyKey: req.context.idempotencyKey,
        payloadFingerprint,
        requestPayload,
        reviewWarnings: prepared.reviewWarnings,
        monthSnapshot: prepared.monthSnapshot,
        requestManagementChecks: prepared.closeBody.managementChecks,
        requestDeadlineSummary: prepared.closeBody.deadlineSummary,
      };
      assertCashflowMonthCloseRequestSize(storedRecord);
      transaction.set(requestRef, storedRecord);
      transaction.set(
        db.doc(cashflowMonthCloseRequestAuditPath(req.context.tenantId, requestId, 0, 'requested')),
        {
          requestId,
          projectId: prepared.rawProjectId,
          yearMonth,
          action: 'REQUESTED',
          revision: 0,
          actorUid: storedRecord.requestedByUid,
          idempotencyKey: req.context.idempotencyKey,
          createdAt: requestedAt,
        },
      );
    });
    res.status(202).json(cashflowMonthCloseRequestView(storedRecord));
  }));

  app.post('/api/v1/cashflow/:projectId/month-close/requests/:requestId/review', asyncHandler(async (req, res) => {
    assertAlignedCashflowMutation();
    if (!db?.doc || !db?.runTransaction) {
      throw createHttpError(503, '월 결산 요청 저장소에 연결하지 못했습니다.', 'cashflow_month_close_request_store_unavailable');
    }
    const projectId = readOptionalText(req.params.projectId);
    const requestId = readOptionalText(req.params.requestId);
    const decision = readOptionalText(req.body?.decision).toUpperCase();
    const expectedRevision = Number(req.body?.expectedRevision);
    const reason = readOptionalText(req.body?.reason);
    if (
      !requestId
      || !['APPROVE', 'REJECT'].includes(decision)
      || !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 0
      || (decision === 'REJECT' && !reason)
      || reason.length > 1_000
    ) {
      throw createHttpError(400, '월 결산 검토 입력값이 올바르지 않습니다.', 'cashflow_month_close_review_invalid');
    }
    await readActiveCashflowMember({
      db, tenantId: req.context.tenantId, actorId: req.context.actorId,
    });
    const requestRef = db.doc(cashflowMonthCloseRequestPath(req.context.tenantId, requestId));
    const initialSnapshot = await requestRef.get();
    if (!initialSnapshot.exists) {
      throw createHttpError(404, '월 결산 요청을 찾을 수 없습니다.', 'cashflow_month_close_request_not_found');
    }
    const initialRecord = initialSnapshot.data() || {};
    if (initialRecord.projectId !== projectId || initialRecord.requestId !== requestId) {
      throw createHttpError(404, '월 결산 요청을 찾을 수 없습니다.', 'cashflow_month_close_request_not_found');
    }
    const currentApproverUid = await readCanonicalCashflowApprover({
      db,
      tenantId: req.context.tenantId,
      projectId,
      requesterUid: initialRecord.requestedByUid,
    });
    if (
      readOptionalText(initialRecord.approverUid) !== readOptionalText(req.context.actorId)
      || currentApproverUid !== readOptionalText(req.context.actorId)
    ) {
      throw createHttpError(403, '지정된 승인자만 월 결산 요청을 검토할 수 있습니다.', 'cashflow_month_close_approver_mismatch');
    }
    const projectRef = db.doc(`orgs/${req.context.tenantId}/projects/${projectId}`);
    const reviewerRef = db.doc(`orgs/${req.context.tenantId}/members/${req.context.actorId}`);
    const reviewedAt = now().toISOString();
    if (initialRecord.contractVersion === CASHFLOW_CUMULATIVE_CLOSE_CONTRACT) {
      const expectedManifestHash = readOptionalText(req.body?.expectedManifestHash);
      if (expectedManifestHash !== initialRecord.manifestHash) {
        throw createHttpError(409, '누적 월 결산 manifest가 변경되었습니다.', 'cashflow_month_close_request_manifest_invalid');
      }
      const terminalReplay = (
        Boolean(readOptionalText(req.context.idempotencyKey))
        && initialRecord.reviewIdempotencyKey === req.context.idempotencyKey
        && Number(initialRecord.revision) === expectedRevision
        && readOptionalText(initialRecord.decisionReason) === reason
        && ((decision === 'REJECT' && initialRecord.status === 'REJECTED')
          || (decision === 'APPROVE' && initialRecord.status === 'APPROVED'))
      );
      if (terminalReplay) {
        res.status(200).json({
          request: cashflowMonthCloseRequestView(initialRecord),
          ...(decision === 'APPROVE' && objectValue(initialRecord.monthCloseResult)
            ? { monthClose: initialRecord.monthCloseResult }
            : {}),
        });
        return;
      }
      const resumesApproval = decision === 'APPROVE' && ['APPROVING', 'UNCERTAIN'].includes(initialRecord.status);
      if (Number(initialRecord.revision) !== expectedRevision || (!resumesApproval && initialRecord.status !== 'PENDING')) {
        throw createHttpError(409, '이미 검토가 시작되었거나 변경된 월 결산 요청입니다.', 'cashflow_month_close_request_already_reviewed');
      }
      if (decision === 'REJECT') {
        if (initialRecord.status !== 'PENDING') {
          throw createHttpError(409, '승인 처리가 시작된 월 결산 요청은 반려할 수 없습니다.', 'cashflow_month_close_request_already_reviewed');
        }
        let rejected;
        await db.runTransaction(async (transaction) => {
          const [projectSnapshot, reviewerSnapshot, snapshot] = await Promise.all([
            transaction.get(projectRef), transaction.get(reviewerRef), transaction.get(requestRef),
          ]);
          const currentProject = projectSnapshot.exists ? projectSnapshot.data() || {} : {};
          const current = snapshot.exists ? snapshot.data() || {} : null;
          const reviewer = reviewerSnapshot.exists ? reviewerSnapshot.data() || {} : {};
          if (!current || current.status !== 'PENDING' || current.manifestHash !== expectedManifestHash
            || Number(current.revision) !== expectedRevision
            || readOptionalText(currentProject.executiveApproverId) !== req.context.actorId
            || readOptionalText(reviewer.uid) !== req.context.actorId
            || readOptionalText(reviewer.status).toUpperCase() !== 'ACTIVE') {
            throw createHttpError(409, '이미 검토가 끝났거나 변경된 월 결산 요청입니다.', 'cashflow_month_close_request_already_reviewed');
          }
          rejected = {
            ...current, status: 'REJECTED', reviewedByUid: req.context.actorId,
            reviewedAt, decisionReason: reason, reviewIdempotencyKey: req.context.idempotencyKey,
          };
          transaction.set(requestRef, rejected);
          transaction.set(
            db.doc(cashflowMonthCloseRequestAuditPath(
              req.context.tenantId, requestId, expectedRevision, 'rejected',
            )),
            {
              requestId,
              projectId,
              yearMonth: rejected.yearMonth,
              action: 'REJECTED',
              revision: expectedRevision,
              manifestHash: rejected.manifestHash,
              actorUid: req.context.actorId,
              reason,
              idempotencyKey: req.context.idempotencyKey,
              createdAt: reviewedAt,
            },
          );
        });
        res.status(200).json({ request: cashflowMonthCloseRequestView(rejected) });
        return;
      }
      await verifyCumulativeRequestShards(req.context.tenantId, initialRecord);
      const approvalId = `cashflow-month-close:${requestId}:r${expectedRevision}`;
      const operationId = approvalId;
      const jvmIdempotencyKey = resumesApproval
        ? initialRecord.reviewIdempotencyKey
        : req.context.idempotencyKey;
      const closeBody = {
        idempotencyKey: jvmIdempotencyKey,
        requestId,
        requestRevision: expectedRevision,
        manifestHash: initialRecord.manifestHash,
        yearMonth: initialRecord.yearMonth,
        expectedRevision: initialRecord.expectedRevision,
      };
      if (resumesApproval) {
        if (initialRecord.operationId !== operationId || initialRecord.reviewedByUid !== req.context.actorId) {
          throw createHttpError(409, '저장된 승인 작업 근거가 일치하지 않습니다.', 'cashflow_month_close_request_revision_stale');
        }
      } else {
        await db.runTransaction(async (transaction) => {
          const [projectSnapshot, reviewerSnapshot, snapshot] = await Promise.all([
            transaction.get(projectRef), transaction.get(reviewerRef), transaction.get(requestRef),
          ]);
          const currentProject = projectSnapshot.exists ? projectSnapshot.data() || {} : {};
          const reviewer = reviewerSnapshot.exists ? reviewerSnapshot.data() || {} : {};
          const current = snapshot.exists ? snapshot.data() || {} : null;
          if (!current || current.status !== 'PENDING' || current.manifestHash !== expectedManifestHash
            || Number(current.revision) !== expectedRevision
            || readOptionalText(currentProject.executiveApproverId) !== req.context.actorId
            || readOptionalText(reviewer.uid) !== req.context.actorId
            || readOptionalText(reviewer.status).toUpperCase() !== 'ACTIVE') {
            throw createHttpError(409, '이미 검토가 시작되었거나 변경된 월 결산 요청입니다.', 'cashflow_month_close_request_already_reviewed');
          }
          transaction.set(requestRef, {
            ...current,
            status: 'APPROVING',
            reviewedByUid: req.context.actorId,
            reviewedAt,
            decisionReason: reason || null,
            reviewIdempotencyKey: req.context.idempotencyKey,
            approvalId,
            operationId,
          });
        });
      }
      const reconcileStoredClose = async () => {
        try {
          const source = await proxyJavaWeeklyRequest({
            context: req.context,
            method: 'GET',
            path: `/api/v1/cashflow/${encodeURIComponent(projectId)}/month-close/dashboard-source?yearMonth=${encodeURIComponent(initialRecord.yearMonth)}`,
            deadlineAtMs: Date.now() + monthCloseRouteTimeoutMs,
          });
          return assertCumulativeCloseResult(objectValue(source?.monthClose), initialRecord);
        } catch {
          return null;
        }
      };
      let monthClose;
      if (resumesApproval) monthClose = await reconcileStoredClose();
      if (!monthClose) {
        if (initialRecord.status === 'UNCERTAIN') {
          await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(requestRef);
            const current = snapshot.exists ? snapshot.data() || {} : null;
            if (!current || !['UNCERTAIN', 'APPROVING'].includes(current.status)
              || current.operationId !== operationId || current.reviewedByUid !== req.context.actorId
              || current.reviewIdempotencyKey !== jvmIdempotencyKey
              || current.manifestHash !== expectedManifestHash || Number(current.revision) !== expectedRevision) {
              throw createHttpError(409, '월 결산 승인 상태가 변경되었습니다.', 'cashflow_month_close_request_revision_stale');
            }
            if (current.status === 'UNCERTAIN') transaction.set(requestRef, { ...current, status: 'APPROVING' });
          });
        }
        try {
          monthClose = assertCumulativeCloseResult(await proxyMutation(
            req,
            `/api/v1/cashflow/${encodeURIComponent(projectId)}/month-close`,
            closeBody,
            { cashflowWrite: true, deadlineAtMs: Date.now() + monthCloseRouteTimeoutMs },
          ), initialRecord);
        } catch (mutationError) {
          monthClose = await reconcileStoredClose();
          if (!monthClose) {
            await requestRef.set({ ...(await requestRef.get()).data(), status: 'UNCERTAIN' });
            throw mutationError;
          }
        }
      }
      let approved;
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(requestRef);
        const current = snapshot.exists ? snapshot.data() || {} : null;
        if (!current || !['APPROVING', 'UNCERTAIN'].includes(current.status)
          || current.operationId !== operationId || current.reviewedByUid !== req.context.actorId
          || current.manifestHash !== expectedManifestHash || Number(current.revision) !== expectedRevision) {
          throw createHttpError(409, '월 결산 승인 상태가 변경되었습니다.', 'cashflow_month_close_request_revision_stale');
        }
        approved = {
          ...current,
          status: 'APPROVED',
          rootHash: monthClose.rootHash,
          headRevision: monthClose.headRevision,
          monthCloseResult: monthClose,
        };
        transaction.set(requestRef, approved);
        transaction.set(
          db.doc(cashflowMonthCloseRequestAuditPath(
            req.context.tenantId, requestId, expectedRevision, 'approved',
          )),
          {
            requestId,
            projectId,
            yearMonth: approved.yearMonth,
            action: 'APPROVED',
            revision: expectedRevision,
            manifestHash: approved.manifestHash,
            actorUid: req.context.actorId,
            reason: reason || null,
            idempotencyKey: req.context.idempotencyKey,
            jvmMutationIdempotencyKey: jvmIdempotencyKey,
            createdAt: reviewedAt,
          },
        );
      });
      res.status(200).json({ request: cashflowMonthCloseRequestView(approved), monthClose });
      return;
    }
    if (['APPROVED', 'REJECTED'].includes(initialRecord.status)) {
      throw createHttpError(409, '이미 검토가 끝난 월 결산 요청입니다.', 'cashflow_month_close_request_already_reviewed');
    }
    const resumesSameApproval = (
      decision === 'APPROVE'
      && ['APPROVING', 'UNCERTAIN'].includes(initialRecord.status)
      && initialRecord.reviewIdempotencyKey === req.context.idempotencyKey
      && Number(initialRecord.revision) === expectedRevision + 1
      && objectValue(initialRecord.preparedCloseBody)
    );
    if (!resumesSameApproval && Number(initialRecord.revision) !== expectedRevision) {
      throw createHttpError(409, '월 결산 요청 revision이 변경되었습니다.', 'cashflow_month_close_request_revision_stale');
    }

    if (decision === 'REJECT') {
      let rejected;
      await db.runTransaction(async (transaction) => {
        const [projectSnapshot, reviewerSnapshot, snapshot] = await Promise.all([
          transaction.get(projectRef),
          transaction.get(reviewerRef),
          transaction.get(requestRef),
        ]);
        const current = snapshot.exists ? snapshot.data() || {} : null;
        const currentProject = projectSnapshot.exists ? projectSnapshot.data() || {} : {};
        const currentReviewer = reviewerSnapshot.exists ? reviewerSnapshot.data() || {} : {};
        if (
          !current
          || current.status !== 'PENDING'
          || Number(current.revision) !== expectedRevision
          || readOptionalText(currentProject.executiveApproverId) !== req.context.actorId
          || readOptionalText(currentReviewer.uid) !== req.context.actorId
          || readOptionalText(currentReviewer.status).toUpperCase() !== 'ACTIVE'
        ) {
          throw createHttpError(409, '이미 검토가 끝났거나 변경된 월 결산 요청입니다.', 'cashflow_month_close_request_already_reviewed');
        }
        rejected = {
          ...current,
          status: 'REJECTED',
          revision: expectedRevision + 1,
          reviewedByUid: req.context.actorId,
          reviewedAt,
          decisionReason: reason || null,
          reviewIdempotencyKey: req.context.idempotencyKey,
        };
        transaction.set(requestRef, rejected);
        transaction.set(
          db.doc(cashflowMonthCloseRequestAuditPath(req.context.tenantId, requestId, rejected.revision, 'rejected')),
          {
            requestId,
            projectId,
            yearMonth: rejected.yearMonth,
            action: 'REJECTED',
            revision: rejected.revision,
            actorUid: req.context.actorId,
            reason: reason || null,
            idempotencyKey: req.context.idempotencyKey,
            createdAt: reviewedAt,
          },
        );
      });
      res.status(200).json({ request: cashflowMonthCloseRequestView(rejected) });
      return;
    }

    let prepared;
    let reviewRevision = expectedRevision + 1;
    if (resumesSameApproval) {
      prepared = {
        projectId: encodeURIComponent(projectId),
        rawProjectId: projectId,
        closeBody: initialRecord.preparedCloseBody,
        routeDeadlineAtMs: Date.now() + monthCloseRouteTimeoutMs,
      };
      reviewRevision = Number(initialRecord.revision);
    } else {
      if (initialRecord.status !== 'PENDING') {
        throw createHttpError(409, '이미 검토 중이거나 끝난 월 결산 요청입니다.', 'cashflow_month_close_request_already_reviewed');
      }
      const stableApprovalKey = `cashflow-month-close-approval:${requestId}:r${reviewRevision}`;
      prepared = prepareStoredCashflowMonthCloseApproval(initialRecord, stableApprovalKey);
      await db.runTransaction(async (transaction) => {
        const [projectSnapshot, reviewerSnapshot, snapshot] = await Promise.all([
          transaction.get(projectRef),
          transaction.get(reviewerRef),
          transaction.get(requestRef),
        ]);
        const current = snapshot.exists ? snapshot.data() || {} : null;
        const currentProject = projectSnapshot.exists ? projectSnapshot.data() || {} : {};
        const currentReviewer = reviewerSnapshot.exists ? reviewerSnapshot.data() || {} : {};
        if (
          !current
          || current.status !== 'PENDING'
          || Number(current.revision) !== expectedRevision
          || readOptionalText(currentProject.executiveApproverId) !== req.context.actorId
          || readOptionalText(currentReviewer.uid) !== req.context.actorId
          || readOptionalText(currentReviewer.status).toUpperCase() !== 'ACTIVE'
        ) {
          throw createHttpError(409, '이미 검토가 시작되었거나 변경된 월 결산 요청입니다.', 'cashflow_month_close_request_already_reviewed');
        }
        transaction.set(requestRef, {
          ...current,
          status: 'APPROVING',
          revision: reviewRevision,
          reviewedByUid: req.context.actorId,
          reviewedAt,
          decisionReason: reason || null,
          reviewIdempotencyKey: req.context.idempotencyKey,
          preparedCloseBody: prepared.closeBody,
        });
      });
    }

    let monthClose;
    if (initialRecord.status === 'UNCERTAIN') {
      const evidence = await reconcileCashflowMonthClose(req, prepared);
      if (evidence.proven) monthClose = evidence.monthClose;
    }
    if (!monthClose) {
      try {
        monthClose = await executePreparedCashflowMonthClose(req, prepared);
      } catch (error) {
        if (readOptionalText(error?.code) === 'cashflow_month_close_reconciliation_pending') {
          await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(requestRef);
            const current = snapshot.exists ? snapshot.data() || {} : null;
            if (
              !current
              || !['APPROVING', 'UNCERTAIN'].includes(current.status)
              || Number(current.revision) !== reviewRevision
              || current.reviewIdempotencyKey !== req.context.idempotencyKey
            ) return;
            transaction.set(requestRef, {
              ...current,
              status: 'UNCERTAIN',
              reconciliationEvidence: error.reconciliationEvidence,
            });
          });
        }
        throw error;
      }
    }
    let approved;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(requestRef);
      const current = snapshot.exists ? snapshot.data() || {} : null;
      if (
        !current
        || !['APPROVING', 'UNCERTAIN'].includes(current.status)
        || Number(current.revision) !== reviewRevision
        || current.reviewIdempotencyKey !== req.context.idempotencyKey
      ) {
        throw createHttpError(409, '월 결산 승인 상태가 변경되었습니다.', 'cashflow_month_close_request_revision_stale');
      }
      approved = { ...current, status: 'APPROVED' };
      delete approved.preparedCloseBody;
      delete approved.publicationFingerprint;
      delete approved.reconciliationEvidence;
      transaction.set(requestRef, approved);
      transaction.set(
        db.doc(cashflowMonthCloseRequestAuditPath(req.context.tenantId, requestId, reviewRevision, 'approved')),
        {
          requestId,
          projectId,
          yearMonth: approved.yearMonth,
          action: 'APPROVED',
          revision: reviewRevision,
          actorUid: req.context.actorId,
          reason: reason || null,
          idempotencyKey: req.context.idempotencyKey,
          jvmMutationIdempotencyKey: prepared.closeBody.idempotencyKey,
          createdAt: reviewedAt,
        },
      );
    });
    res.status(200).json({ request: cashflowMonthCloseRequestView(approved), monthClose });
  }));

  app.post('/api/v1/cashflow/:projectId/month-close', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance', 'pm', 'viewer'], 'close cashflow month', authMode, workspaceEmailDomain);
    assertAlignedCashflowMutation();
    await prepareCashflowMonthClose(req);
    throw createHttpError(
      409,
      '월 결산 요청을 만들고 지정 승인자의 승인을 받아 주세요.',
      'cashflow_month_close_approval_required',
    );
  }));

  app.post('/api/v1/cashflow/:projectId/month-close/reopen-request', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance', 'pm', 'viewer'], 'request cashflow month reopen', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(
      req,
      `/api/v1/cashflow/${projectId}/month-close/reopen-request`,
      commandBody(req),
      { cashflowWrite: true },
    );
    return { status: 200, body: result };
  }));

  app.post('/api/v1/cashflow/:projectId/month-close/reopen-decision', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance'], 'decide cashflow month reopen', authMode, workspaceEmailDomain);
    const rawProjectId = readOptionalText(req.params.projectId);
    const projectId = encodeURIComponent(rawProjectId);
    const result = await proxyMutation(
      req,
      `/api/v1/cashflow/${projectId}/month-close/reopen-decision`,
      commandBody(req),
      { cashflowWrite: true },
    );
    const decision = readOptionalText(req.body?.decision).toUpperCase();
    const yearMonth = readOptionalText(req.body?.yearMonth);
    if (decision === 'APPROVE') {
      if (readOptionalText(result?.projectId) !== rawProjectId
        || readOptionalText(result?.yearMonth) !== yearMonth
        || readOptionalText(result?.status) !== 'OPEN') {
        throw createHttpError(502, 'JVM 월 결산 재개 결과를 확인할 수 없습니다.', 'cashflow_jvm_invalid_response');
      }
      try {
        if (db?.doc && db?.runTransaction) {
          const requestId = `${rawProjectId}-${yearMonth}`;
          const requestRef = db.doc(cashflowMonthCloseRequestPath(req.context.tenantId, requestId));
          await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(requestRef);
            if (!snapshot.exists) return;
            const current = snapshot.data() || {};
            if (current.contractVersion !== CASHFLOW_CUMULATIVE_CLOSE_CONTRACT
              || current.requestId !== requestId
              || current.projectId !== rawProjectId
              || current.yearMonth !== yearMonth
              || current.status === 'REOPENED'
              || !['APPROVED', 'APPROVING', 'UNCERTAIN'].includes(current.status)) return;
            transaction.set(requestRef, {
              ...current,
              status: 'REOPENED',
              reopenedAt: now().toISOString(),
              reopenDecisionIdempotencyKey: req.context.idempotencyKey,
            });
          });
        }
      } catch {
        // The JVM reopen is authoritative; a workflow read-model failure cannot undo it.
      }
    }
    return { status: 200, body: result };
  }));

  app.get('/api/v1/cashflow/:projectId', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read Java weekly cashflow snapshot', authMode, workspaceEmailDomain);
    let comparisonBoundary;
    try {
      comparisonBoundary = resolveCashflowComparisonAsOf(readOptionalText(req.query.asOf), now());
    } catch {
      throw createHttpError(400, 'Cashflow comparison asOf must be a valid YYYY-MM-DD date.', 'cashflow_comparison_as_of_invalid');
    }
    const requestedRangeStart = parseCashflowRangeBoundary(req.query.rangeStart, 'rangeStart');
    const requestedRangeEnd = parseCashflowRangeBoundary(req.query.rangeEnd, 'rangeEnd');
    if (
      requestedRangeStart
      && requestedRangeEnd
      && cashflowRangeSortKey(requestedRangeStart) > cashflowRangeSortKey(requestedRangeEnd)
    ) {
      throw createHttpError(400, 'rangeStart must be before or equal to rangeEnd.', 'cashflow_range_invalid');
    }
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/cashflow/${projectId}`,
    });
    if (readOptionalText(result?.projectId) !== readOptionalText(req.params.projectId)) {
      throw createHttpError(502, '다른 프로젝트의 자료가 도착했습니다. 화면을 새로고침해 주세요.', 'jvm_weekly_project_mismatch');
    }
    const comparison = buildCashflowProjectionActualComparison(result, comparisonBoundary);
    const comparisonByMonth = new Map(comparison.months.map((month) => [month.yearMonth, month]));
    const sourceMonths = Array.isArray(result?.readModel?.months) ? result.readModel.months : [];
    const range = resolveCashflowReadModelRange({
      months: sourceMonths,
      rawStart: req.query.rangeStart,
      rawEnd: req.query.rangeEnd,
      comparisonBoundary,
    });
    res.status(200).json({
      ...result,
      readModel: {
        ...(result?.readModel || {}),
        range: {
          ...range,
          projection: buildCashflowRangeTotals(sourceMonths, 'projection', range),
          actual: buildCashflowRangeTotals(sourceMonths, 'actual', range),
        },
        months: sourceMonths.map((month) => {
          const monthComparison = comparisonByMonth.get(String(month?.yearMonth || ''));
          return {
            ...month,
            comparison: monthComparison || {
              yearMonth: String(month?.yearMonth || ''),
              weeks: [],
              rowTotals: {},
              totalIn: 0,
              totalOut: 0,
              net: 0,
              totals: {
                projection: { totalIn: 0, totalOut: 0, balance: 0 },
                actual: { totalIn: 0, totalOut: 0, balance: 0 },
                difference: { totalIn: 0, totalOut: 0, balance: 0 },
              },
            },
          };
        }),
      },
      comparison,
    });
  }));
}
