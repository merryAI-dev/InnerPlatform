const REQUIRED_METHODS = Object.freeze([
  'assertRuntimeSuperadmin',
  'readPolicyEvidence',
  'readProject',
  'readProjectRecoveryEvidence',
  'readProjectResetEvidence',
  'transactExecutiveApproverChange',
  'applyCumulativeCloseHeadRecovery',
  'applyCumulativeCloseResetToReclose',
]);

export class CashflowPeriodPolicyPersistenceError extends Error {
  constructor(code, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = 'CashflowPeriodPolicyPersistenceError';
    this.code = code;
  }
}

export function persistenceError(code, cause) {
  return new CashflowPeriodPolicyPersistenceError(code, cause);
}

export function assertCashflowPeriodPolicyPersistencePort(port) {
  if (!port || typeof port !== 'object') {
    throw new TypeError('cashflow period policy persistence port is required');
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof port[method] !== 'function') {
      throw new TypeError(`cashflow period policy persistence port is missing ${method}`);
    }
  }
  return port;
}
