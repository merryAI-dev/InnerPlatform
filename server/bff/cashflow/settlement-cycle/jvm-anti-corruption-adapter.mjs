import { createHttpError, readOptionalText } from '../../bff-utils.mjs';
import {
  CASHFLOW_CUMULATIVE_CLOSE_CONTRACT,
  previousYearMonth,
} from '../../cashflow-close-calendar.mjs';
import { cashflowMonthCloseRequestPath } from './contract.mjs';

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function responseInvalid() {
  return createHttpError(
    502,
    '월 결산 사이클 응답의 범위가 올바르지 않습니다.',
    'cashflow_settlement_cycle_response_invalid',
  );
}

function isYearMonth(value) {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
}

const SETTLEMENT_CYCLE_COMMANDS = Object.freeze([
  'SUBMIT_MONTH_CLOSE',
  'WITHDRAW_MONTH_CLOSE',
  'APPROVE_MONTH_CLOSE',
  'REJECT_MONTH_CLOSE',
  'REQUEST_MONTH_REOPEN',
  'APPROVE_MONTH_REOPEN',
  'REJECT_MONTH_REOPEN',
  'CANCEL_ACTIVE_CYCLE',
]);

function readCommandCapabilities(raw, { requireAllDenied = false } = {}) {
  const source = objectValue(raw);
  if (!source
    || Object.keys(source).length !== SETTLEMENT_CYCLE_COMMANDS.length
    || SETTLEMENT_CYCLE_COMMANDS.some((command) => !Object.hasOwn(source, command))) {
    throw responseInvalid();
  }
  const capabilities = {};
  for (const command of SETTLEMENT_CYCLE_COMMANDS) {
    const decision = objectValue(source[command]);
    const allowed = decision?.allowed;
    const reasonCode = readOptionalText(decision?.reasonCode);
    if (!decision
      || Object.keys(decision).some((key) => !['allowed', 'reasonCode'].includes(key))
      || typeof allowed !== 'boolean'
      || (allowed ? reasonCode !== '' : !/^[A-Z][A-Z0-9_]*$/.test(reasonCode))
      || (requireAllDenied && allowed)) {
      throw responseInvalid();
    }
    capabilities[command] = { allowed, reasonCode };
  }
  return capabilities;
}

function allCapabilitiesDenied(capabilities) {
  return SETTLEMENT_CYCLE_COMMANDS.every((command) => capabilities[command]?.allowed === false);
}

export function requireCashflowSettlementCycleReadContext(source, { projectId, cycleYearMonth }) {
  const cycle = objectValue(source?.settlementCycle);
  const targetYearMonth = previousYearMonth(cycleYearMonth);
  const businessState = readOptionalText(cycle?.businessState);
  const health = readOptionalText(cycle?.health);
  const workflowRevision = Number(cycle?.workflowRevision);
  const provenance = objectValue(cycle?.provenance);
  const supersededAttempt = cycle?.supersededAttempt === null
    ? null
    : readOptionalText(cycle?.supersededAttempt);
  if (!cycle
    || readOptionalText(cycle.cycleYearMonth) !== cycleYearMonth
    || readOptionalText(cycle.weeklyYearMonth) !== cycleYearMonth
    || readOptionalText(cycle.monthCloseTargetYearMonth) !== targetYearMonth
    || !['NOT_REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'REOPEN_REQUESTED', 'REOPENED', 'REJECTED', 'WITHDRAWN', 'INCONSISTENT']
      .includes(businessState)
    || !['OK', 'RECONCILING', 'UNAVAILABLE'].includes(health)
    || !Number.isSafeInteger(workflowRevision)
    || workflowRevision < 0
    || ![null, 'REJECTED', 'WITHDRAWN'].includes(supersededAttempt)) {
    throw responseInvalid();
  }
  const commandCapabilities = readCommandCapabilities(cycle.commandCapabilities, {
    requireAllDenied: health !== 'OK' || businessState === 'INCONSISTENT',
  });

  if (['APPROVED', 'REOPEN_REQUESTED'].includes(businessState) !== Boolean(provenance)) {
    throw responseInvalid();
  }
  if (!provenance) {
    return {
      cycle,
      businessState,
      health,
      workflowRevision,
      requestId: ['NOT_REQUESTED', 'INCONSISTENT'].includes(businessState)
        ? ''
        : `${projectId}-${cycleYearMonth}`,
      requestCycleYearMonth: cycleYearMonth,
      requestTargetYearMonth: targetYearMonth,
      requestStorageShape: 'CYCLE',
      commandCapabilities,
    };
  }

  const affectedFromMonth = readOptionalText(provenance.affectedFromMonth);
  const affectedThroughMonth = readOptionalText(provenance.affectedThroughMonth);
  const closedByCycleYearMonth = readOptionalText(provenance.closedByCycleYearMonth);
  const approvalVersionId = readOptionalText(provenance.approvalVersionId);
  const requestId = readOptionalText(provenance.requestId);
  const ledgerRevision = Number(provenance.ledgerRevision);
  const rootHash = readOptionalText(provenance.rootHash);
  const cycleRequestId = `${projectId}-${closedByCycleYearMonth}`;
  const targetRequestId = `${projectId}-${affectedThroughMonth}`;
  const requestStorageShape = requestId === cycleRequestId
    ? 'CYCLE'
    : requestId === targetRequestId && businessState === 'APPROVED'
      ? 'TARGET_V1'
      : '';
  if (!isYearMonth(affectedFromMonth)
    || !isYearMonth(affectedThroughMonth)
    || affectedFromMonth > targetYearMonth
    || affectedThroughMonth < targetYearMonth
    || !isYearMonth(closedByCycleYearMonth)
    || affectedThroughMonth !== previousYearMonth(closedByCycleYearMonth)
    || !approvalVersionId
    || approvalVersionId.includes('/')
    || !requestStorageShape
    || !Number.isSafeInteger(ledgerRevision)
    || ledgerRevision < 1
    || !/^sha256:[a-f0-9]{64}$/.test(rootHash)) {
    throw responseInvalid();
  }
  if (requestStorageShape === 'TARGET_V1' && !allCapabilitiesDenied(commandCapabilities)) {
    throw responseInvalid();
  }
  return {
    cycle,
    businessState,
    health,
    workflowRevision,
    requestId,
    requestCycleYearMonth: closedByCycleYearMonth,
    requestTargetYearMonth: affectedThroughMonth,
    requestStorageShape,
    approvalVersionId,
    ledgerRevision,
    rootHash,
    commandCapabilities,
  };
}

function canonicalRequestMatches(record, context, projectId) {
  const expectedStatus = context.businessState === 'PENDING_APPROVAL'
    ? ['PENDING', 'PENDING_APPROVAL']
    : [context.businessState];
  return readOptionalText(record.documentType) === 'REQUEST'
    && readOptionalText(record.contractVersion) === CASHFLOW_CUMULATIVE_CLOSE_CONTRACT
    && readOptionalText(record.requestId) === context.requestId
    && readOptionalText(record.projectId) === projectId
    && readOptionalText(record.cycleYearMonth || record.yearMonth) === context.requestCycleYearMonth
    && readOptionalText(record.monthCloseTargetYearMonth || record.throughMonth) === context.requestTargetYearMonth
    && expectedStatus.includes(readOptionalText(record.status))
    && (!context.approvalVersionId
      || (readOptionalText(record.approvalVersionId) === context.approvalVersionId
        && Number(record.ledgerRevision) === context.ledgerRevision
        && readOptionalText(record.manifestHash) === context.rootHash));
}

function legacyRequestMatches(record, context, { projectId, tenantId }) {
  if (context.businessState !== 'APPROVED'
    || !context.approvalVersionId
    || readOptionalText(record.documentType)
    || readOptionalText(record.contractVersion) !== CASHFLOW_CUMULATIVE_CLOSE_CONTRACT
    || readOptionalText(record.requestId) !== context.requestId
    || readOptionalText(record.projectId) !== projectId
    || (readOptionalText(record.tenantId) && readOptionalText(record.tenantId) !== tenantId)
    || readOptionalText(record.status) !== 'APPROVED'
    || readOptionalText(record.manifestHash) !== context.rootHash
    || !Number.isSafeInteger(Number(record.evidenceRevision ?? record.revision))
    || Number(record.evidenceRevision ?? record.revision) < 1) {
    return false;
  }
  const yearMonth = readOptionalText(record.yearMonth);
  const cycleYearMonth = readOptionalText(record.cycleYearMonth);
  const targetYearMonth = readOptionalText(record.monthCloseTargetYearMonth);
  const throughMonth = readOptionalText(record.throughMonth);
  if (context.requestStorageShape === 'TARGET_V1') {
    return yearMonth === context.requestTargetYearMonth
      && !cycleYearMonth
      && (!targetYearMonth || targetYearMonth === context.requestTargetYearMonth)
      && (!throughMonth || throughMonth === context.requestTargetYearMonth);
  }
  return context.requestStorageShape === 'CYCLE'
    && yearMonth === context.requestCycleYearMonth
    && (!cycleYearMonth || cycleYearMonth === context.requestCycleYearMonth)
    && (!targetYearMonth || targetYearMonth === context.requestTargetYearMonth)
    && throughMonth === context.requestTargetYearMonth;
}

export function alignCashflowSettlementCycleRequest(record, context, { projectId, tenantId }) {
  if (!context.requestId) return null;
  if (!record) throw responseInvalid();
  if (canonicalRequestMatches(record, context, projectId)) {
    return { ...record, workflowRevision: context.workflowRevision };
  }
  if (!legacyRequestMatches(record, context, { projectId, tenantId })) {
    throw responseInvalid();
  }
  if (!allCapabilitiesDenied(context.commandCapabilities)) {
    throw responseInvalid();
  }
  return {
    ...record,
    documentType: 'REQUEST',
    yearMonth: context.requestCycleYearMonth,
    cycleYearMonth: context.requestCycleYearMonth,
    monthCloseTargetYearMonth: context.requestTargetYearMonth,
    throughMonth: context.requestTargetYearMonth,
    workflowRevision: context.workflowRevision,
    evidenceRevision: Number(record.evidenceRevision ?? record.revision),
    approvalVersionId: context.approvalVersionId,
    ledgerRevision: context.ledgerRevision,
    legacyProvenanceReadOnly: true,
  };
}

export async function readAlignedCashflowSettlementCycleRequest({
  db,
  tenantId,
  projectId,
  context,
}) {
  if (!context.requestId) return null;
  const snapshot = await db.doc(cashflowMonthCloseRequestPath(tenantId, context.requestId)).get();
  const record = snapshot.exists ? snapshot.data() || null : null;
  return alignCashflowSettlementCycleRequest(record, context, { projectId, tenantId });
}

export function isLegacySettlementCycleReadOnly(record) {
  return record?.legacyProvenanceReadOnly === true;
}
