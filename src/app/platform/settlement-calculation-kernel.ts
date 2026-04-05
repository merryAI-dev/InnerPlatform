import type { MonthMondayWeek } from './cashflow-weeks';
import {
  aggregateBudgetActualsFromSettlementRows,
} from './budget-actuals';
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
  aggregateBudgetActuals: (
    rows: ImportRow[] | null | undefined,
  ) => Map<string, number>;
}

const typeScriptSettlementCalculationKernel: SettlementCalculationKernel = {
  deriveRows: deriveSettlementRows,
  buildActualSyncPayload: buildSettlementActualSyncPayload,
  aggregateBudgetActuals: aggregateBudgetActualsFromSettlementRows,
};

export function getSettlementCalculationKernel(): SettlementCalculationKernel {
  return typeScriptSettlementCalculationKernel;
}

export function deriveSettlementRowsWithKernel(
  rows: ImportRow[],
  context: SettlementDerivationContext,
  options: SettlementDerivationOptions,
): ImportRow[] {
  return getSettlementCalculationKernel().deriveRows(rows, context, options);
}

export function buildSettlementActualSyncPayloadWithKernel(
  rows: ImportRow[],
  yearWeeks: MonthMondayWeek[],
  persistedRows?: ImportRow[] | null,
): SettlementActualSyncWeekPayload[] {
  return getSettlementCalculationKernel().buildActualSyncPayload(rows, yearWeeks, persistedRows);
}

export function aggregateBudgetActualsFromSettlementRowsWithKernel(
  rows: ImportRow[] | null | undefined,
): Map<string, number> {
  return getSettlementCalculationKernel().aggregateBudgetActuals(rows);
}
