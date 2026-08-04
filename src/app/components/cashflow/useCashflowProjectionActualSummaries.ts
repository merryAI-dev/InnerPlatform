import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchCashflowProjectionActualSummariesViaBff,
  type ActorLike,
  type CashflowProjectionActualSummary,
  type CashflowProjectionActualSummaryBatch,
} from '../../lib/platform-bff-client';

const BATCH_SIZE = 10;

interface SummaryState {
  summaries: Record<string, CashflowProjectionActualSummary>;
  errors: Record<string, boolean>;
}

export function mergeCashflowProjectionActualSummaryBatch(
  current: SummaryState,
  requestedIds: string[],
  response: CashflowProjectionActualSummaryBatch,
): SummaryState {
  const returnedIds = new Set(response.items.map((item) => item.projectId));
  return {
    summaries: {
      ...current.summaries,
      ...Object.fromEntries(response.items.map((item) => [item.projectId, item])),
    },
    errors: {
      ...current.errors,
      ...Object.fromEntries(requestedIds.map((projectId) => [projectId, !returnedIds.has(projectId)])),
    },
  };
}

export function useCashflowProjectionActualSummaries(params: {
  tenantId: string;
  actor?: ActorLike | null;
  projectIds: string[];
  yearMonth?: string;
}) {
  const { actor, tenantId } = params;
  const projectIdsKey = JSON.stringify(params.projectIds);
  const projectIds = useMemo<string[]>(() => JSON.parse(projectIdsKey), [projectIdsKey]);
  const [state, setState] = useState<SummaryState>({ summaries: {}, errors: {} });
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const load = useCallback(async (ids: string[], active: () => boolean = () => true) => {
    if (!actor || ids.length === 0) return;
    setLoading((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, true])) }));
    setState((current) => ({
      ...current,
      errors: { ...current.errors, ...Object.fromEntries(ids.map((id) => [id, false])) },
    }));
    try {
      const response = await fetchCashflowProjectionActualSummariesViaBff({ tenantId, actor, projectIds: ids, yearMonth: params.yearMonth });
      if (!active()) return;
      setState((current) => mergeCashflowProjectionActualSummaryBatch(current, ids, response));
    } catch {
      if (active()) setState((current) => ({
        ...current,
        errors: { ...current.errors, ...Object.fromEntries(ids.map((id) => [id, true])) },
      }));
    } finally {
      if (active()) setLoading((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, false])) }));
    }
  }, [actor, params.yearMonth, tenantId]);

  useEffect(() => {
    let active = true;
    setState({ summaries: {}, errors: {} });
    setLoading(Object.fromEntries(projectIds.map((id) => [id, true])));
    if (!actor) return () => { active = false; };
    for (let index = 0; index < projectIds.length; index += BATCH_SIZE) {
      void load(projectIds.slice(index, index + BATCH_SIZE), () => active);
    }
    return () => { active = false; };
  }, [actor, load, projectIds]);

  return {
    summaries: state.summaries,
    loading,
    errors: state.errors,
    retry: (projectId: string) => load([projectId]),
  };
}
