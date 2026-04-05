import type { MonthMondayWeek } from './cashflow-weeks';
import type { ActorLike } from '../lib/platform-bff-client';
import {
  aggregateBudgetActualsFromSettlementFlowSnapshots,
} from './budget-actuals';
import {
  buildSettlementFlowSnapshots,
  type SettlementFlowSnapshot,
} from './settlement-flow-amounts';
import {
  deriveSettlementRows,
  type SettlementDerivationContext,
  type SettlementDerivationOptions,
} from './settlement-row-derivation';
import {
  buildSettlementActualSyncPayload,
  type SettlementActualSyncWeekPayload,
} from './settlement-sheet-sync';
import type { ImportRow } from './settlement-csv';

export interface SettlementCalculationKernel {
  deriveRows: (
    rows: ImportRow[],
    context: SettlementDerivationContext,
    options: SettlementDerivationOptions,
  ) => ImportRow[];
  buildActualSyncPayload: (
    rows: ImportRow[],
    yearWeeks: MonthMondayWeek[],
    persistedRows?: ImportRow[] | null,
  ) => SettlementActualSyncWeekPayload[];
  buildFlowSnapshots: (
    rows: ImportRow[] | null | undefined,
  ) => SettlementFlowSnapshot[];
  aggregateBudgetActuals: (
    rows: ImportRow[] | null | undefined,
  ) => Map<string, number>;
}

export interface SettlementKernelRuntimeConfig {
  tenantId: string;
  projectId: string;
  actor: ActorLike;
}

const typeScriptSettlementCalculationKernel: SettlementCalculationKernel = {
  deriveRows: deriveSettlementRows,
  buildActualSyncPayload: buildSettlementActualSyncPayload,
  buildFlowSnapshots: buildSettlementFlowSnapshots,
  aggregateBudgetActuals: (rows) => aggregateBudgetActualsFromSettlementFlowSnapshots(
    buildSettlementFlowSnapshots(rows),
  ),
};

export function getSettlementCalculationKernel(): SettlementCalculationKernel {
  return typeScriptSettlementCalculationKernel;
}

export function deriveSettlementRowsLocally(
  rows: ImportRow[],
  context: SettlementDerivationContext,
  options: SettlementDerivationOptions,
): ImportRow[] {
  return getSettlementCalculationKernel().deriveRows(rows, context, options);
}

export function buildSettlementActualSyncPayloadLocally(
  rows: ImportRow[],
  yearWeeks: MonthMondayWeek[],
  persistedRows?: ImportRow[] | null,
): SettlementActualSyncWeekPayload[] {
  return getSettlementCalculationKernel().buildActualSyncPayload(rows, yearWeeks, persistedRows);
}

export function buildSettlementFlowSnapshotsLocally(
  rows: ImportRow[] | null | undefined,
): SettlementFlowSnapshot[] {
  return getSettlementCalculationKernel().buildFlowSnapshots(rows);
}

export function aggregateBudgetActualsFromSettlementRowsLocally(
  rows: ImportRow[] | null | undefined,
): Map<string, number> {
  return getSettlementCalculationKernel().aggregateBudgetActuals(rows);
}

export async function deriveSettlementRowsAuthoritatively(params: {
  rows: ImportRow[];
  context: SettlementDerivationContext;
  options: SettlementDerivationOptions;
  runtime?: SettlementKernelRuntimeConfig | null;
}): Promise<ImportRow[]> {
  return deriveSettlementRowsLocally(params.rows, params.context, params.options);
}

export async function previewSettlementActualSyncAuthoritatively(params: {
  rows: ImportRow[];
  yearWeeks: MonthMondayWeek[];
  persistedRows?: ImportRow[] | null;
  runtime?: SettlementKernelRuntimeConfig | null;
}): Promise<SettlementActualSyncWeekPayload[]> {
  return buildSettlementActualSyncPayloadLocally(params.rows, params.yearWeeks, params.persistedRows);
}

export async function previewSettlementFlowSnapshotsAuthoritatively(params: {
  rows: ImportRow[] | null | undefined;
  runtime?: SettlementKernelRuntimeConfig | null;
}): Promise<SettlementFlowSnapshot[]> {
  return buildSettlementFlowSnapshotsLocally(params.rows || []);
}

export async function aggregateBudgetActualsAuthoritatively(params: {
  rows: ImportRow[] | null | undefined;
  runtime?: SettlementKernelRuntimeConfig | null;
}): Promise<Map<string, number>> {
  return aggregateBudgetActualsFromSettlementRowsLocally(params.rows);
}
