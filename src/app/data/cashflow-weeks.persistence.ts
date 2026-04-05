import type { CashflowSheetLineId, CashflowWeekSheet } from './types';

export function resolveWeekDocId(projectId: string, yearMonth: string, weekNo: number): string {
  const safeProjectId = projectId.trim();
  const safeYm = yearMonth.trim();
  const safeNo = Math.max(1, Math.min(6, Math.trunc(weekNo)));
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

export function buildCashflowWeekUpdatePatch(params: {
  orgId: string;
  actorUid: string;
  actorName: string;
  mode: 'projection' | 'actual';
  amounts: Partial<Record<CashflowSheetLineId, number>>;
  now: string;
}) {
  const patch: Record<string, unknown> = {
    tenantId: params.orgId,
    updatedAt: params.now,
    updatedByUid: params.actorUid,
    updatedByName: params.actorName,
  };
  for (const [lineId, amount] of Object.entries(normalizeWeekAmounts(params.amounts))) {
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
  return {
    id: resolveWeekDocId(params.projectId, params.yearMonth, params.weekNo),
    tenantId: params.orgId,
    projectId: params.projectId,
    yearMonth: params.yearMonth,
    weekNo: params.weekNo,
    weekStart: params.weekStart,
    weekEnd: params.weekEnd,
    projection: params.mode === 'projection' ? normalizedAmounts : {},
    actual: params.mode === 'actual' ? normalizedAmounts : {},
    pmSubmitted: false,
    adminClosed: false,
    createdAt: params.now,
    updatedAt: params.now,
    updatedByUid: params.actorUid,
    updatedByName: params.actorName,
  };
}
