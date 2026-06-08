import type { Basis, SettlementSheetPolicy } from './types';
import type { ImportRow } from '../platform/settlement-csv';
import {
  prepareSettlementImportRowsBase,
} from '../platform/settlement-sheet-prepare';

export function prepareExpenseSheetRowsForSave(params: {
  rows: ImportRow[];
  projectId: string;
  defaultLedgerId: string;
  evidenceRequiredMap?: Record<string, string>;
  policy?: SettlementSheetPolicy;
  basis?: Basis;
}): ImportRow[] {
  return prepareSettlementImportRowsBase(params.rows, {
    projectId: params.projectId,
    defaultLedgerId: params.defaultLedgerId,
    evidenceRequiredMap: params.evidenceRequiredMap,
    policy: params.policy,
    basis: params.basis,
  });
}
