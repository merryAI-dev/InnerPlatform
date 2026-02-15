import type { ExpenseSet, ExpenseSetStatus } from './budget-data';
import type { ChangeRequest, ChangeRequestState } from './personnel-change-data';

export function computeExpenseSetStatusCounts(sets: ExpenseSet[]) {
  const counts: Record<ExpenseSetStatus, number> = {
    DRAFT: 0,
    SUBMITTED: 0,
    APPROVED: 0,
    REJECTED: 0,
  };

  for (const s of sets) {
    if (s && counts[s.status as ExpenseSetStatus] !== undefined) {
      counts[s.status as ExpenseSetStatus] += 1;
    }
  }

  return counts;
}

export function computeChangeRequestStateCounts(reqs: ChangeRequest[]) {
  const counts: Record<ChangeRequestState, number> = {
    DRAFT: 0,
    SUBMITTED: 0,
    APPROVED: 0,
    REJECTED: 0,
    REVISION_REQUESTED: 0,
  };

  for (const r of reqs) {
    if (r && counts[r.state as ChangeRequestState] !== undefined) {
      counts[r.state as ChangeRequestState] += 1;
    }
  }

  return counts;
}

