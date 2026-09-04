#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const YEAR_MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const ROOT_HASH = /^sha256:[0-9a-f]{64}$/;
const CANONICAL_STATES = new Set([
  'NOT_REQUESTED',
  'SUBMITTED',
  'LOCKED',
  'REOPEN_REQUESTED',
  'REOPENED',
  'REJECTED',
  'WITHDRAWN',
]);
const PROVENANCE_STATES = new Set(['LOCKED', 'REOPEN_REQUESTED']);
const COMMAND_RULES = Object.freeze({
  SUBMIT_MONTH_CLOSE: {
    states: new Set(['NOT_REQUESTED', 'REOPENED', 'REJECTED', 'WITHDRAWN']),
    denialReasons: new Set(['PROJECT_WRITE_FORBIDDEN']),
  },
  WITHDRAW_MONTH_CLOSE: {
    states: new Set(['SUBMITTED']),
    denialReasons: new Set(['NOT_REQUESTER', 'PROJECT_WRITE_FORBIDDEN']),
  },
  APPROVE_MONTH_CLOSE: {
    states: new Set(['SUBMITTED']),
    denialReasons: new Set(['NOT_CURRENT_APPROVER']),
  },
  REJECT_MONTH_CLOSE: {
    states: new Set(['SUBMITTED']),
    denialReasons: new Set(['NOT_CURRENT_APPROVER']),
  },
  REQUEST_MONTH_REOPEN: {
    states: new Set(['LOCKED']),
    denialReasons: new Set(['PROJECT_WRITE_FORBIDDEN']),
  },
  APPROVE_MONTH_REOPEN: {
    states: new Set(['REOPEN_REQUESTED']),
    denialReasons: new Set(['REOPEN_DECISION_FORBIDDEN']),
  },
  REJECT_MONTH_REOPEN: {
    states: new Set(['REOPEN_REQUESTED']),
    denialReasons: new Set(['REOPEN_DECISION_FORBIDDEN']),
  },
  CANCEL_ACTIVE_CYCLE: {
    states: new Set(['SUBMITTED', 'REOPENED']),
    denialReasons: new Set(['RECOVERY_ADMIN_REQUIRED']),
  },
});
const COMMANDS = Object.keys(COMMAND_RULES);
const PROVENANCE_KEYS = [
  'affectedFromMonth',
  'affectedThroughMonth',
  'approvalVersionId',
  'closedByCycleYearMonth',
  'ledgerRevision',
  'requestId',
  'rootHash',
];

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameKeys(value, expected) {
  return isObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function previousYearMonth(value) {
  if (!YEAR_MONTH.test(value)) fail('cycleYearMonth must be YYYY-MM from 2000 through 2099');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return month === 1
    ? `${String(year - 1).padStart(4, '0')}-12`
    : `${String(year).padStart(4, '0')}-${String(month - 1).padStart(2, '0')}`;
}

function safeApprovalVersionId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value === value.trim()
    && value !== '.'
    && value !== '..'
    && Buffer.byteLength(value, 'utf8') <= 1500
    && !/[\/\\\u0000-\u001f\u007f]/u.test(value);
}

function validateProvenance(provenance, projectId, cycleYearMonth, targetYearMonth) {
  if (!sameKeys(provenance, PROVENANCE_KEYS)) fail('provenance has an invalid shape');
  if (provenance.requestId !== `${projectId}-${cycleYearMonth}`) {
    fail('provenance requestId does not identify this cycle');
  }
  if (provenance.affectedThroughMonth !== targetYearMonth) {
    fail('provenance affectedThroughMonth does not identify the target');
  }
  if (provenance.closedByCycleYearMonth !== cycleYearMonth) {
    fail('provenance closedByCycleYearMonth does not identify this cycle');
  }
  if (!YEAR_MONTH.test(provenance.affectedFromMonth)
    || !YEAR_MONTH.test(provenance.affectedThroughMonth)
    || provenance.affectedFromMonth > provenance.affectedThroughMonth) {
    fail('provenance affected range is invalid');
  }
  if (!Number.isSafeInteger(provenance.ledgerRevision) || provenance.ledgerRevision < 1) {
    fail('provenance ledgerRevision must be a positive integer');
  }
  if (!safeApprovalVersionId(provenance.approvalVersionId)) {
    fail('provenance approvalVersionId is unsafe');
  }
  if (typeof provenance.rootHash !== 'string' || !ROOT_HASH.test(provenance.rootHash)) {
    fail('provenance rootHash must be a sha256 digest');
  }
}

function validateCapabilities(capabilities, businessState) {
  if (!sameKeys(capabilities, COMMANDS)) fail('commandCapabilities must contain the exact command set');
  for (const command of COMMANDS) {
    const capability = capabilities[command];
    if (!sameKeys(capability, ['allowed', 'reasonCode'])
      || typeof capability.allowed !== 'boolean'
      || typeof capability.reasonCode !== 'string') {
      fail(`${command} capability has an invalid shape`);
    }
    const rule = COMMAND_RULES[command];
    const stateEligible = rule.states.has(businessState);
    if (!stateEligible) {
      if (capability.allowed || capability.reasonCode !== 'BUSINESS_STATE_NOT_ELIGIBLE') {
        fail(`${command} must be denied as BUSINESS_STATE_NOT_ELIGIBLE`);
      }
    } else if (capability.allowed) {
      if (capability.reasonCode !== '') fail(`${command} allowed capability has a denial reason`);
    } else if (!rule.denialReasons.has(capability.reasonCode)) {
      fail(`${command} has an invalid authorization denial reason`);
    }
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stable(value[key])]),
  );
}

function validateSource(source, projectId, cycleYearMonth, targetYearMonth) {
  if (!isObject(source)) fail('stdin must contain a JSON object');
  if (Object.hasOwn(source, 'projectId')) {
    if (source.projectId !== projectId) fail('item projectId does not match the canary project');
  } else if (isObject(source.monthClose)) {
    if (source.monthClose.projectId !== projectId) {
      fail('dashboard projectId does not match the canary project');
    }
    if (source.monthClose.yearMonth !== cycleYearMonth) {
      fail('dashboard yearMonth does not match the canary cycle');
    }
  } else {
    fail('stdin must be a weekly overview item or dashboard source');
  }

  const cycle = source.settlementCycle;
  if (!isObject(cycle)) fail('settlementCycle must be an object');
  if (cycle.cycleYearMonth !== cycleYearMonth
    || cycle.weeklyYearMonth !== cycleYearMonth
    || cycle.monthCloseTargetYearMonth !== targetYearMonth) {
    fail('settlementCycle identity does not match the canary cycle');
  }
  if (cycle.health !== 'OK') fail('settlementCycle health must be OK');
  if (!CANONICAL_STATES.has(cycle.businessState)) {
    fail('settlementCycle businessState is not canonical and usable');
  }
  if (!Number.isSafeInteger(cycle.workflowRevision) || cycle.workflowRevision < 0) {
    fail('settlementCycle workflowRevision must be a non-negative integer');
  }
  if (PROVENANCE_STATES.has(cycle.businessState)) {
    validateProvenance(cycle.provenance, projectId, cycleYearMonth, targetYearMonth);
  } else if (cycle.provenance !== null) {
    fail('settlementCycle provenance must be null in this state');
  }
  if (cycle.supersededAttempt !== null
    && (cycle.businessState !== 'LOCKED'
      || !['REJECTED', 'WITHDRAWN'].includes(cycle.supersededAttempt))) {
    fail('settlementCycle supersededAttempt is invalid for this state');
  }
  validateCapabilities(cycle.commandCapabilities, cycle.businessState);
  return cycle;
}

try {
  const [projectId, cycleYearMonth, extra] = process.argv.slice(2);
  if (extra !== undefined || typeof projectId !== 'string' || projectId.trim() === '') {
    fail('usage: verify-cashflow-settlement-cycle-projection.mjs <projectId> <cycleYearMonth>');
  }
  const targetYearMonth = previousYearMonth(cycleYearMonth);
  const source = JSON.parse(readFileSync(0, 'utf8'));
  const cycle = validateSource(source, projectId, cycleYearMonth, targetYearMonth);
  process.stdout.write(`${JSON.stringify(stable(cycle))}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`settlement-cycle projection invalid: ${message}\n`);
  process.exitCode = 1;
}
