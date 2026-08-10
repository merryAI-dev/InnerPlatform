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
  const stableActor = useMemo<ActorLike | null>(() => actor ? ({
    uid: actor.uid,
    email: actor.email,
    role: actor.role,
    idToken: actor.idToken,
  }) : null, [actor?.email, actor?.idToken, actor?.role, actor?.uid]);
  const projectIdsKey = JSON.stringify(params.projectIds);
  const projectIds = useMemo<string[]>(() => JSON.parse(projectIdsKey), [projectIdsKey]);
  const [state, setState] = useState<SummaryState>({ summaries: {}, errors: {} });
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const load = useCallback(async (ids: string[], active: () => boolean = () => true) => {
    if (!stableActor || ids.length === 0) return;
    setLoading((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, true])) }));
    setState((current) => ({
      ...current,
      errors: { ...current.errors, ...Object.fromEntries(ids.map((id) => [id, false])) },
    }));
    try {
      const response = await fetchCashflowProjectionActualSummariesViaBff({ tenantId, actor: stableActor, projectIds: ids, yearMonth: params.yearMonth });
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
  }, [params.yearMonth, stableActor, tenantId]);

  useEffect(() => {
    let active = true;
    setState({ summaries: {}, errors: {} });
    setLoading({});
    if (!stableActor) return () => { active = false; };
    void (async () => {
      for (let index = 0; index < projectIds.length && active; index += BATCH_SIZE) {
        await load(projectIds.slice(index, index + BATCH_SIZE), () => active);
      }
    })();
    return () => { active = false; };
  }, [load, projectIds, stableActor]);

  return {
    summaries: state.summaries,
    loading,
    errors: state.errors,
    retry: (projectId: string) => load([projectId]),
  };
}
