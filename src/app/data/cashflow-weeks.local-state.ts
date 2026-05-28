import type { CashflowSheetLineId, CashflowWeekSheet } from './types';
import { buildProjectionChangeAlert, normalizeWeekAmounts, resolveWeekDocId } from './cashflow-weeks.persistence';
import { computeCashflowTotals } from '../platform/cashflow-sheet';

export function applyWeekAmountsToLocalWeeks(input: {
  weeks: CashflowWeekSheet[];
  orgId: string;
  actorUid: string;
  actorName: string;
  projectId: string;
  yearMonth: string;
  weekNo: number;
  weekStart: string;
  weekEnd: string;
  mode: 'projection' | 'actual';
  amounts: Partial<Record<CashflowSheetLineId, number>>;
  now: string;
}): CashflowWeekSheet[] {
  const id = resolveWeekDocId(input.projectId, input.yearMonth, input.weekNo);
  const normalizedAmounts = normalizeWeekAmounts(input.amounts || {});
  const existingIndex = input.weeks.findIndex((sheet) => sheet.id === id);

  if (existingIndex >= 0) {
    const next = [...input.weeks];
    const current = next[existingIndex];
    const nextProjection = input.mode === 'projection'
      ? {
        ...current.projection,
        ...normalizedAmounts,
      }
      : current.projection;
    const nextModeAmounts = {
      ...current[input.mode],
      ...normalizedAmounts,
    };
    next[existingIndex] = {
      ...current,
      [input.mode]: {
        ...current[input.mode],
        ...normalizedAmounts,
      },
      [`${input.mode}Totals`]: computeCashflowTotals(nextModeAmounts),
      ...(input.mode === 'projection'
        ? {
          projectionUpdated: true,
          projectionUpdatedAt: input.now,
          projectionUpdatedByUid: input.actorUid,
          projectionUpdatedByName: input.actorName,
          projectionChangeAlert: buildProjectionChangeAlert({
            previousProjection: current.projection,
            nextProjection,
            weekStart: input.weekStart,
            now: input.now,
            actorUid: input.actorUid,
            actorName: input.actorName,
          }),
        }
        : {}),
      updatedAt: input.now,
      updatedByUid: input.actorUid,
      updatedByName: input.actorName,
    };
    return next;
  }

  return [
    ...input.weeks,
    {
      id,
      tenantId: input.orgId,
      projectId: input.projectId,
      yearMonth: input.yearMonth,
      weekNo: input.weekNo,
      weekStart: input.weekStart,
      weekEnd: input.weekEnd,
      projection: input.mode === 'projection' ? normalizedAmounts : {},
      actual: input.mode === 'actual' ? normalizedAmounts : {},
      projectionTotals: computeCashflowTotals(input.mode === 'projection' ? normalizedAmounts : {}),
      actualTotals: computeCashflowTotals(input.mode === 'actual' ? normalizedAmounts : {}),
      ...(input.mode === 'projection'
        ? {
          projectionUpdated: true,
          projectionUpdatedAt: input.now,
          projectionUpdatedByUid: input.actorUid,
          projectionUpdatedByName: input.actorName,
        }
        : {}),
      pmSubmitted: false,
      adminClosed: false,
      createdAt: input.now,
      updatedAt: input.now,
      updatedByUid: input.actorUid,
      updatedByName: input.actorName,
    },
  ];
}
