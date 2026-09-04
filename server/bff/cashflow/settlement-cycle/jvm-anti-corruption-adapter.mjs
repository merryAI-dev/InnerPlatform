import { createHttpError } from '../../bff-utils.mjs';
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

export function buildHistoricalCashflowSettlementCycle(value, { projectId, cycleYearMonth }) {
  const source = objectValue(value);
  const items = Array.isArray(source?.items) ? source.items : [];
  const month = items.find((item) => item?.period === 'MONTH');
  const monthStatus = {
    WAITING_FOR_UPDATE: 'WAITING_FOR_UPDATE',
    PENDING_APPROVAL: 'SUBMITTED',
    SUBMITTED: 'SUBMITTED',
    COMPLETED: 'LOCKED',
    LOCKED: 'LOCKED',
  }[month?.status];
  if (!monthStatus) throw responseInvalid();
  const settlementStatuses = {
    ...source,
    items: items.map((item) => item === month ? { ...item, status: monthStatus } : item),
  };
  requireCashflowSettlementStatusesResult(settlementStatuses, {
    projectId,
    yearMonth: cycleYearMonth,
  });
  const canonicalMonth = settlementStatuses.items.find((item) => item.period === 'MONTH');
  const businessState = {
    WAITING_FOR_UPDATE: 'NOT_REQUESTED',
    SUBMITTED: 'SUBMITTED',
    LOCKED: 'LOCKED',
  }[monthStatus];
  const commandCapabilities = Object.fromEntries(SETTLEMENT_CYCLE_COMMANDS.map((command) => [
    command,
    { allowed: false, reasonCode: 'HISTORICAL_READ_ONLY' },
  ]));
  return {
    settlementStatuses,
    settlementCycle: {
      cycleYearMonth,
      weeklyYearMonth: cycleYearMonth,
      monthCloseTargetYearMonth: previousYearMonth(cycleYearMonth),
      closeDeadline: `${cycleYearMonth}-10`,
      businessState,
      health: 'OK',
      workflowRevision: canonicalMonth.revision,
      monthCloseSettlement: canonicalMonth,
      provenance: null,
      supersededAttempt: null,
      commandCapabilities,
    },
  };
}

const COMMAND_ELIGIBLE_STATES = Object.freeze({
  SUBMIT_MONTH_CLOSE: ['NOT_REQUESTED', 'REOPENED', 'REJECTED', 'WITHDRAWN'],
  WITHDRAW_MONTH_CLOSE: ['SUBMITTED'],
  APPROVE_MONTH_CLOSE: ['SUBMITTED'],
  REJECT_MONTH_CLOSE: ['SUBMITTED'],
  REQUEST_MONTH_REOPEN: ['LOCKED'],
  APPROVE_MONTH_REOPEN: ['REOPEN_REQUESTED'],
  REJECT_MONTH_REOPEN: ['REOPEN_REQUESTED'],
  CANCEL_ACTIVE_CYCLE: ['SUBMITTED', 'REOPENED'],
});

function readCommandCapabilities(raw, { businessState, health }) {
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
    const reasonCode = decision?.reasonCode;
    if (!decision
      || Object.keys(decision).some((key) => !['allowed', 'reasonCode'].includes(key))
      || typeof allowed !== 'boolean'
      || typeof reasonCode !== 'string'
      || (allowed ? reasonCode !== '' : !/^[A-Z][A-Z0-9_]*$/.test(reasonCode))) {
      throw responseInvalid();
    }
    capabilities[command] = { allowed, reasonCode };
  }
  if (health !== 'OK' || businessState === 'INCONSISTENT') {
    if (!SETTLEMENT_CYCLE_COMMANDS.every((command) => (
      capabilities[command].allowed === false
      && capabilities[command].reasonCode === 'PROJECTION_NOT_READY'
    ))) {
      throw responseInvalid();
    }
    return capabilities;
  }
  for (const command of SETTLEMENT_CYCLE_COMMANDS) {
    const eligible = COMMAND_ELIGIBLE_STATES[command].includes(businessState);
    const capability = capabilities[command];
    if ((!eligible && capability.allowed)
      || (!capability.allowed
        && ['LEGACY_READ_ONLY', 'PROJECTION_NOT_READY'].includes(capability.reasonCode))) {
      throw responseInvalid();
    }
  }
  return capabilities;
}

function validInstant(value) {
  return typeof value === 'string'
    && value.trim() === value
    && /^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function hasSettlementStatusShape(settlement) {
  return ['submittedAt', 'submittedBy', 'approvedAt', 'approvedBy']
    .every((field) => typeof settlement?.[field] === 'string')
    && [settlement.submittedAt, settlement.approvedAt]
      .every((value) => value === '' || validInstant(value))
    && validInstant(settlement.deadlineAt)
    && validInstant(settlement.approverDeadlineAt);
}

function requireMonthCloseSettlement(value, expectedStatus) {
  const settlement = objectValue(value);
  const revision = settlement?.revision;
  const submittedAt = settlement?.submittedAt;
  const submittedBy = settlement?.submittedBy;
  const approvedAt = settlement?.approvedAt;
  const approvedBy = settlement?.approvedBy;
  if (!settlement
    || settlement.period !== 'MONTH'
    || settlement.status !== expectedStatus
    || !Number.isSafeInteger(revision)
    || revision < (expectedStatus === 'WAITING_FOR_UPDATE' ? 0 : 1)
    || !hasSettlementStatusShape(settlement)) {
    throw responseInvalid();
  }
  if ((expectedStatus === 'WAITING_FOR_UPDATE'
      && (submittedAt || submittedBy || approvedAt || approvedBy))
    || (expectedStatus === 'SUBMITTED'
      && (!validInstant(submittedAt) || !submittedBy || approvedAt || approvedBy))
    || (expectedStatus === 'LOCKED'
      && (!validInstant(submittedAt) || !submittedBy || !validInstant(approvedAt) || !approvedBy))) {
    throw responseInvalid();
  }
  return settlement;
}

export function requireCashflowSettlementStatusesResult(value, { projectId, yearMonth }) {
  const statuses = objectValue(value);
  const items = Array.isArray(statuses?.items) ? statuses.items : null;
  if (!statuses
    || statuses.projectId !== projectId
    || statuses.yearMonth !== yearMonth
    || !items) {
    throw responseInvalid();
  }
  const periods = new Set();
  let month = null;
  for (const value of items) {
    const item = objectValue(value);
    const period = item?.period;
    const status = item?.status;
    const revision = item?.revision;
    const validStatus = period === 'MONTH'
      ? ['WAITING_FOR_UPDATE', 'SUBMITTED', 'LOCKED'].includes(status)
      : /^WEEK_[1-5]$/.test(period)
        && ['WAITING_FOR_UPDATE', 'PENDING_APPROVAL', 'COMPLETED'].includes(status);
    if (!item
      || periods.has(period)
      || !validStatus
      || !Number.isSafeInteger(revision)
      || revision < 0
      || !hasSettlementStatusShape(item)) {
      throw responseInvalid();
    }
    periods.add(period);
    if (period === 'MONTH') month = item;
  }
  if (!month
    || periods.size !== 6
    || ['MONTH', 'WEEK_1', 'WEEK_2', 'WEEK_3', 'WEEK_4', 'WEEK_5']
      .some((period) => !periods.has(period))) {
    throw responseInvalid();
  }
  return statuses;
}

export function requireCashflowSettlementStatusesBatchResult(value, { projectIds, yearMonth }) {
  const result = objectValue(value);
  const items = Array.isArray(result?.items) ? result.items : null;
  const errors = Array.isArray(result?.errors) ? result.errors : null;
  if (!result || !items || !errors) throw responseInvalid();
  const requested = new Set(projectIds);
  const returned = new Set();
  for (const item of items) {
    const projectId = item?.projectId;
    if (!requested.has(projectId) || returned.has(projectId)) throw responseInvalid();
    requireCashflowSettlementStatusesResult(item, { projectId, yearMonth });
    returned.add(projectId);
  }
  for (const value of errors) {
    const error = objectValue(value);
    const projectId = error?.projectId;
    if (!error
      || error.code !== 'STATUS_UNAVAILABLE'
      || !requested.has(projectId)
      || returned.has(projectId)) {
      throw responseInvalid();
    }
    returned.add(projectId);
  }
  if (returned.size !== requested.size) throw responseInvalid();
  return result;
}

function requireSettlementStatuses(source, { projectId, cycleYearMonth }) {
  const statuses = requireCashflowSettlementStatusesResult(source?.settlementStatuses, {
    projectId,
    yearMonth: cycleYearMonth,
  });
  return statuses.items.find((item) => item.period === 'MONTH');
}

export function requireCashflowSettlementCycleReadContext(source, { projectId, cycleYearMonth }) {
  const cycle = objectValue(source?.settlementCycle);
  const targetYearMonth = previousYearMonth(cycleYearMonth);
  const businessState = cycle?.businessState;
  const health = cycle?.health;
  const workflowRevision = cycle?.workflowRevision;
  const rawProvenance = cycle?.provenance;
  const provenance = rawProvenance === null ? null : objectValue(rawProvenance);
  const supersededAttempt = cycle?.supersededAttempt === null
    ? null
    : cycle?.supersededAttempt;
  if (!cycle
    || cycle.cycleYearMonth !== cycleYearMonth
    || cycle.weeklyYearMonth !== cycleYearMonth
    || cycle.monthCloseTargetYearMonth !== targetYearMonth
    || cycle.closeDeadline !== `${cycleYearMonth}-10`
    || !['NOT_REQUESTED', 'SUBMITTED', 'LOCKED', 'REOPEN_REQUESTED', 'REOPENED', 'REJECTED', 'WITHDRAWN', 'INCONSISTENT']
      .includes(businessState)
    || !['OK', 'RECONCILING', 'UNAVAILABLE'].includes(health)
    || !Number.isSafeInteger(workflowRevision)
    || (businessState === 'INCONSISTENT' ? workflowRevision < -1 : workflowRevision < 0)
    || (rawProvenance !== null && !provenance)
    || ![null, 'REJECTED', 'WITHDRAWN'].includes(supersededAttempt)) {
    throw responseInvalid();
  }
  const commandCapabilities = readCommandCapabilities(cycle.commandCapabilities, { businessState, health });
  const settlementMonth = requireSettlementStatuses(source, { projectId, cycleYearMonth });
  const provenanceClosedByCycleYearMonth = provenance?.closedByCycleYearMonth;
  const coveredByLaterCycle = isYearMonth(provenanceClosedByCycleYearMonth)
    && provenanceClosedByCycleYearMonth > cycleYearMonth;
  const expectedMonthStatus = {
    NOT_REQUESTED: 'WAITING_FOR_UPDATE',
    SUBMITTED: 'SUBMITTED',
    LOCKED: coveredByLaterCycle ? 'WAITING_FOR_UPDATE' : 'LOCKED',
    REOPEN_REQUESTED: coveredByLaterCycle ? 'WAITING_FOR_UPDATE' : 'LOCKED',
    REOPENED: 'WAITING_FOR_UPDATE',
    REJECTED: 'WAITING_FOR_UPDATE',
    WITHDRAWN: 'WAITING_FOR_UPDATE',
  }[businessState];
  const monthIdentityFields = [
    'period', 'status', 'submittedAt', 'submittedBy', 'approvedAt', 'approvedBy',
    'deadlineAt', 'approverDeadlineAt',
  ];
  if (expectedMonthStatus) {
    requireMonthCloseSettlement(settlementMonth, expectedMonthStatus);
  } else {
    const settlementStatus = settlementMonth.status;
    if (!['WAITING_FOR_UPDATE', 'SUBMITTED', 'LOCKED'].includes(settlementStatus)) throw responseInvalid();
    requireMonthCloseSettlement(settlementMonth, settlementStatus);
  }
  if ((expectedMonthStatus && settlementMonth.status !== expectedMonthStatus)
    || (cycle.monthCloseSettlement !== null
      && (monthIdentityFields.some((field) => (
        cycle.monthCloseSettlement?.[field] !== settlementMonth[field]
      ))
        || cycle.monthCloseSettlement?.revision !== settlementMonth.revision))) {
    throw responseInvalid();
  }
  if (businessState === 'REOPEN_REQUESTED' && coveredByLaterCycle) {
    if (cycle.monthCloseSettlement !== null) throw responseInvalid();
  } else if (['SUBMITTED', 'REOPEN_REQUESTED', 'REOPENED', 'REJECTED', 'WITHDRAWN'].includes(businessState)) {
    requireMonthCloseSettlement(cycle.monthCloseSettlement, expectedMonthStatus);
  } else if (businessState === 'LOCKED') {
    if (coveredByLaterCycle) {
      if (cycle.monthCloseSettlement !== null) throw responseInvalid();
    } else {
      if (supersededAttempt !== null) throw responseInvalid();
      requireMonthCloseSettlement(cycle.monthCloseSettlement, 'LOCKED');
    }
  } else if (businessState === 'INCONSISTENT' && cycle.monthCloseSettlement !== null) {
    const status = cycle.monthCloseSettlement?.status;
    if (!['WAITING_FOR_UPDATE', 'SUBMITTED', 'LOCKED'].includes(status)) throw responseInvalid();
    requireMonthCloseSettlement(cycle.monthCloseSettlement, status);
  } else if (businessState === 'NOT_REQUESTED' && health === 'RECONCILING') {
    requireMonthCloseSettlement(cycle.monthCloseSettlement, 'WAITING_FOR_UPDATE');
  } else if (!['LOCKED', 'INCONSISTENT'].includes(businessState) && cycle.monthCloseSettlement !== null) {
    throw responseInvalid();
  }

  if (['LOCKED', 'REOPEN_REQUESTED'].includes(businessState) !== Boolean(provenance)) {
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
      commandCapabilities,
    };
  }

  const affectedFromMonth = provenance.affectedFromMonth;
  const affectedThroughMonth = provenance.affectedThroughMonth;
  const closedByCycleYearMonth = provenance.closedByCycleYearMonth;
  const approvalVersionId = provenance.approvalVersionId;
  const requestId = provenance.requestId;
  const ledgerRevision = provenance.ledgerRevision;
  const rootHash = provenance.rootHash;
  const cycleRequestId = `${projectId}-${closedByCycleYearMonth}`;
  if (!isYearMonth(affectedFromMonth)
    || !isYearMonth(affectedThroughMonth)
    || affectedFromMonth > targetYearMonth
    || targetYearMonth > affectedThroughMonth
    || !isYearMonth(closedByCycleYearMonth)
    || affectedThroughMonth !== previousYearMonth(closedByCycleYearMonth)
    || closedByCycleYearMonth < cycleYearMonth
    || (!['LOCKED', 'REOPEN_REQUESTED'].includes(businessState)
      && closedByCycleYearMonth !== cycleYearMonth)
    || (!coveredByLaterCycle && supersededAttempt !== null)
    || typeof approvalVersionId !== 'string'
    || !approvalVersionId
    || approvalVersionId.includes('/')
    || requestId !== cycleRequestId
    || !Number.isSafeInteger(ledgerRevision)
    || ledgerRevision < 1
    || !/^sha256:[a-f0-9]{64}$/.test(rootHash)) {
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
    approvalVersionId,
    ledgerRevision,
    rootHash,
    commandCapabilities,
  };
}

function canonicalRequestMatches(record, context, { projectId, tenantId }) {
  const expectedStatus = context.businessState === 'SUBMITTED'
    ? context.health === 'OK'
      ? ['PENDING_APPROVAL']
      : context.health === 'RECONCILING'
        ? ['APPROVING', 'UNCERTAIN']
        : []
    : context.businessState === 'LOCKED'
      ? context.health === 'RECONCILING'
        ? ['APPROVING', 'UNCERTAIN']
        : ['APPROVED']
      : [context.businessState];
  const requestStatus = record?.status;
  const revision = record?.revision;
  const evidenceRevision = record?.evidenceRevision;
  const workflowRevision = record?.workflowRevision;
  const requestLedgerRevision = record?.ledgerRevision;
  const activeWorkflow = [
    'PENDING_APPROVAL', 'APPROVING', 'UNCERTAIN', 'REOPEN_REQUESTED', 'REOPENED',
  ].includes(requestStatus);
  return record.documentType === 'REQUEST'
    && record.contractVersion === CASHFLOW_CUMULATIVE_CLOSE_CONTRACT
    && record.requestId === context.requestId
    && record.tenantId === tenantId
    && record.projectId === projectId
    && record.yearMonth === context.requestCycleYearMonth
    && record.cycleYearMonth === context.requestCycleYearMonth
    && record.monthCloseTargetYearMonth === context.requestTargetYearMonth
    && record.throughMonth === context.requestTargetYearMonth
    && expectedStatus.includes(requestStatus)
    && Number.isSafeInteger(revision)
    && revision > 0
    && Number.isSafeInteger(evidenceRevision)
    && evidenceRevision === revision
    && Number.isSafeInteger(workflowRevision)
    && workflowRevision >= 0
    && (activeWorkflow
      ? workflowRevision === context.workflowRevision
      : workflowRevision <= context.workflowRevision)
    && /^sha256:[a-f0-9]{64}$/.test(record.manifestHash)
    && (!context.approvalVersionId
      || (record.approvalVersionId === context.approvalVersionId
        && Number.isSafeInteger(requestLedgerRevision)
        && requestLedgerRevision >= context.ledgerRevision
        && record.manifestHash === context.rootHash));
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
  if (!record || !canonicalRequestMatches(record, context, { projectId, tenantId })) throw responseInvalid();
  return { ...record };
}
