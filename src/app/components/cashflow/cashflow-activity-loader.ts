import type { CashflowActivitySource } from '../../lib/platform-bff-client';

export type CashflowActivityMutation =
  | 'sheet_mirror_refreshed'
  | 'sheet_values_applied'
  | 'month_reopen_completed'
  | 'month_close_requested'
  | 'month_close_withdrawn'
  | 'month_close_approver_changed';

const CASHFLOW_ACTIVITY_MUTATION_SOURCES = {
  sheet_mirror_refreshed: ['sheet_refresh'],
  sheet_values_applied: ['audit'],
  month_reopen_completed: ['audit'],
  month_close_requested: [],
  month_close_withdrawn: [],
  month_close_approver_changed: [],
} as const satisfies Record<CashflowActivityMutation, readonly CashflowActivitySource[]>;

export function cashflowActivitySourcesForMutations(
  mutations: readonly CashflowActivityMutation[],
): CashflowActivitySource[] {
  const selected = new Set(mutations.flatMap((mutation) => CASHFLOW_ACTIVITY_MUTATION_SOURCES[mutation]));
  return (['sheet_refresh', 'audit'] as const).filter((source) => selected.has(source));
}

export type CashflowActivityPendingWork =
  | { kind: 'aggregate' }
  | { kind: 'sources'; sources: CashflowActivitySource[] };

export function takeCashflowActivityPendingWork(
  state: {
    scope: string;
    depth: number;
    pendingAggregate: boolean;
    pendingSources: Set<CashflowActivitySource>;
  },
  input: {
    scope: string;
    visible: boolean;
    busy: boolean;
  },
): CashflowActivityPendingWork | null {
  if (state.scope !== input.scope || state.depth > 0 || !input.visible || input.busy) return null;
  if (state.pendingAggregate) {
    state.pendingAggregate = false;
    state.pendingSources.clear();
    return { kind: 'aggregate' };
  }
  const pendingSources = [...state.pendingSources];
  state.pendingSources.clear();
  return pendingSources.length > 0 ? { kind: 'sources', sources: pendingSources } : null;
}

export interface CashflowActivityCursor {
  source?: CashflowActivitySource;
  cursor: string;
}

export interface CashflowActivityRequestTicket {
  generation: number;
  lane: string;
  signal: AbortSignal;
}

export function createCashflowActivityRequestGuard() {
  let generation = 0;
  const controllers = new Map<string, AbortController>();

  const invalidate = () => {
    generation += 1;
    controllers.forEach((controller) => controller.abort());
    controllers.clear();
  };

  return {
    start(lane: string, options: { reset?: boolean } = {}): CashflowActivityRequestTicket {
      if (options.reset) invalidate();
      controllers.get(lane)?.abort();
      const controller = new AbortController();
      controllers.set(lane, controller);
      return { generation, lane, signal: controller.signal };
    },
    isCurrent(ticket: CashflowActivityRequestTicket): boolean {
      return generation === ticket.generation
        && controllers.get(ticket.lane)?.signal === ticket.signal
        && !ticket.signal.aborted;
    },
    isGenerationCurrent(candidate: number): boolean {
      return generation === candidate;
    },
    finish(ticket: CashflowActivityRequestTicket): void {
      if (controllers.get(ticket.lane)?.signal === ticket.signal) controllers.delete(ticket.lane);
    },
    invalidate,
  };
}

export function updateCashflowActivityCursorQueue(
  current: CashflowActivityCursor[],
  source: CashflowActivitySource | undefined,
  cursor: string | null,
  options: { preserveExisting?: boolean } = {},
): CashflowActivityCursor[] {
  if (options.preserveExisting) return current;
  const remaining = current.filter((candidate) => candidate.source !== source);
  return cursor ? [...remaining, { ...(source ? { source } : {}), cursor }] : remaining;
}

export function filterCashflowActivityErrorsAfterSuccess<T extends {
  source: CashflowActivitySource;
  preservePagination?: boolean;
}>(
  failures: T[],
  source: CashflowActivitySource,
  preservePagination: boolean,
): T[] {
  return failures.filter((failure) => (
    failure.source !== source || (preservePagination && !failure.preservePagination)
  ));
}

export function shouldStartCashflowActivityLoad(input: {
  visible: boolean;
  deferred: boolean;
  currentScope: boolean;
}): boolean {
  return input.visible && !input.deferred && input.currentScope;
}
