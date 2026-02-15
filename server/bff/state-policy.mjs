const ALLOWED_TRANSITIONS = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'REJECTED'],
  REJECTED: ['SUBMITTED'],
  APPROVED: [],
};

export const SUPPORTED_TRANSACTION_STATES = new Set(Object.keys(ALLOWED_TRANSITIONS));

export function normalizeState(rawState) {
  return typeof rawState === 'string' ? rawState.trim().toUpperCase() : '';
}

export function isSupportedTransactionState(rawState) {
  return SUPPORTED_TRANSACTION_STATES.has(normalizeState(rawState));
}

export function assertTransitionAllowed({ currentState, nextState }) {
  const from = normalizeState(currentState);
  const to = normalizeState(nextState);

  if (!SUPPORTED_TRANSACTION_STATES.has(from)) {
    const error = new Error(`Unsupported current transaction state: ${String(currentState)}`);
    error.statusCode = 400;
    throw error;
  }

  if (!SUPPORTED_TRANSACTION_STATES.has(to)) {
    const error = new Error(`Unsupported transaction state: ${String(nextState)}`);
    error.statusCode = 400;
    throw error;
  }

  const allowed = ALLOWED_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    const error = new Error(`Invalid state transition: ${from} -> ${to}`);
    error.statusCode = 400;
    throw error;
  }

  return {
    from,
    to,
  };
}
