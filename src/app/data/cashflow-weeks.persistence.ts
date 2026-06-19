import type { CashflowSheetLineId, CashflowWeekSheet, ProjectionChangeAlert } from './types';
import { computeCashflowTotals } from '../platform/cashflow-sheet';

export const PROJECTION_CHANGE_ALERT_THRESHOLD_AMOUNT = 10_000_000;

export function resolveWeekDocId(projectId: string, yearMonth: string, weekNo: number): string {
  const safeProjectId = projectId.trim();
  const safeYm = yearMonth.trim();
  const safeNo = Math.max(1, Math.min(5, Math.trunc(weekNo)));
  return `${safeProjectId}-${safeYm}-w${safeNo}`;
}

export function clampCashflowAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

export function normalizeWeekAmounts(input: Partial<Record<CashflowSheetLineId, number>>) {
  const normalized: Partial<Record<CashflowSheetLineId, number>> = {};
  for (const [lineId, amountRaw] of Object.entries(input || {})) {
    const lineKey = typeof lineId === 'string' ? lineId.trim() : '';
    if (!lineKey) continue;
    normalized[lineKey as CashflowSheetLineId] = clampCashflowAmount(Number(amountRaw));
  }
  return normalized;
}

function parseDateOnlyUtc(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return Date.UTC(year, month - 1, day);
}

export function buildProjectionChangeAlert(params: {
  previousProjection?: Partial<Record<CashflowSheetLineId, number>>;
  nextProjection: Partial<Record<CashflowSheetLineId, number>>;
  weekStart: string;
  now: string;
  actorUid?: string;
  actorName?: string;
  thresholdAmount?: number;
}): ProjectionChangeAlert | null {
  const thresholdAmount = params.thresholdAmount ?? PROJECTION_CHANGE_ALERT_THRESHOLD_AMOUNT;
  const previous = normalizeWeekAmounts(params.previousProjection || {});
  const next = normalizeWeekAmounts(params.nextProjection || {});
  if (Object.keys(previous).length === 0) return null;

  const nowDate = parseDateOnlyUtc(params.now);
  const weekStartDate = parseDateOnlyUtc(params.weekStart);
  if (nowDate === null || weekStartDate === null) return null;
  const daysBeforeWeekStart = Math.floor((weekStartDate - nowDate) / (24 * 60 * 60 * 1000));
  if (daysBeforeWeekStart < 0 || daysBeforeWeekStart > 7) return null;

  const lineIds = new Set([...Object.keys(previous), ...Object.keys(next)] as CashflowSheetLineId[]);
  let totalAbsDelta = 0;
  let netDelta = 0;
  let largestLineId: CashflowSheetLineId | undefined;
  let largestLineDelta = 0;
  let previousAmount: number | undefined;
  let nextAmount: number | undefined;
  for (const lineId of lineIds) {
    const before = Number(previous[lineId] || 0);
    const after = Number(next[lineId] || 0);
    const delta = after - before;
    const absDelta = Math.abs(delta);
    totalAbsDelta += absDelta;
    netDelta += delta;
    if (absDelta > largestLineDelta) {
      largestLineDelta = absDelta;
      largestLineId = lineId;
      previousAmount = before;
      nextAmount = after;
    }
  }

  if (totalAbsDelta < thresholdAmount && largestLineDelta < thresholdAmount) return null;

  return {
    triggered: true,
    reason: 'near_week_large_projection_change',
    changedAt: params.now,
    changedByUid: params.actorUid,
    changedByName: params.actorName,
    daysBeforeWeekStart,
    thresholdAmount,
    totalAbsDelta,
    netDelta,
    largestLineId,
    largestLineDelta,
    previousAmount,
    nextAmount,
  };
}

export function buildCashflowWeekUpdatePatch(params: {
  orgId: string;
  actorUid: string;
  actorName: string;
  mode: 'projection' | 'actual';
  amounts: Partial<Record<CashflowSheetLineId, number>>;
  now: string;
  weekStart?: string;
  existingProjection?: Partial<Record<CashflowSheetLineId, number>>;
  existingActual?: Partial<Record<CashflowSheetLineId, number>>;
}) {
  const normalizedAmounts = normalizeWeekAmounts(params.amounts);
  const existingModeAmounts = params.mode === 'projection'
    ? normalizeWeekAmounts(params.existingProjection || {})
    : normalizeWeekAmounts(params.existingActual || {});
  const nextModeAmounts = {
    ...existingModeAmounts,
    ...normalizedAmounts,
  };
  const patch: Record<string, unknown> = {
    tenantId: params.orgId,
    updatedAt: params.now,
    updatedByUid: params.actorUid,
    updatedByName: params.actorName,
    [`${params.mode}Totals`]: computeCashflowTotals(nextModeAmounts),
  };
  if (params.mode === 'projection') {
    const alert = params.weekStart
      ? buildProjectionChangeAlert({
        previousProjection: params.existingProjection,
        nextProjection: nextModeAmounts,
        weekStart: params.weekStart,
        now: params.now,
        actorUid: params.actorUid,
        actorName: params.actorName,
      })
      : null;
    patch.projectionUpdated = true;
    patch.projectionUpdatedAt = params.now;
    patch.projectionUpdatedByUid = params.actorUid;
    patch.projectionUpdatedByName = params.actorName;
    patch.projectionChangeAlert = alert;
  }
  for (const [lineId, amount] of Object.entries(normalizedAmounts)) {
    patch[`${params.mode}.${lineId}`] = amount;
  }
  return patch;
}

export function buildInitialCashflowWeekDoc(params: {
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
}): CashflowWeekSheet {
  const normalizedAmounts = normalizeWeekAmounts(params.amounts);
  const projection = params.mode === 'projection' ? normalizedAmounts : {};
  const actual = params.mode === 'actual' ? normalizedAmounts : {};
  return {
    id: resolveWeekDocId(params.projectId, params.yearMonth, params.weekNo),
    tenantId: params.orgId,
    projectId: params.projectId,
    yearMonth: params.yearMonth,
    weekNo: params.weekNo,
    weekStart: params.weekStart,
    weekEnd: params.weekEnd,
    projection,
    actual,
    projectionTotals: computeCashflowTotals(projection),
    actualTotals: computeCashflowTotals(actual),
    ...(params.mode === 'projection'
      ? {
        projectionUpdated: true,
        projectionUpdatedAt: params.now,
        projectionUpdatedByUid: params.actorUid,
        projectionUpdatedByName: params.actorName,
      }
      : {}),
    pmSubmitted: false,
    adminClosed: false,
    createdAt: params.now,
    updatedAt: params.now,
    updatedByUid: params.actorUid,
    updatedByName: params.actorName,
  };
}
