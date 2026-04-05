import type { Basis, SettlementSheetPolicy } from './types';
import type { ImportRow } from '../platform/settlement-csv';
import {
  buildSettlementDerivationContext,
  prepareSettlementImportRowsBase,
  pruneEmptySettlementRows,
} from '../platform/settlement-sheet-prepare';
import { deriveSettlementRowsLocally } from '../platform/settlement-calculation-kernel';

export function prepareExpenseSheetRowsForSave(params: {
  rows: ImportRow[];
  projectId: string;
  defaultLedgerId: string;
  evidenceRequiredMap?: Record<string, string>;
  policy?: SettlementSheetPolicy;
  basis?: Basis;
}): ImportRow[] {
  const preparedBaseRows = prepareSettlementImportRowsBase(
    pruneEmptySettlementRows(params.rows),
    {
      projectId: params.projectId,
      defaultLedgerId: params.defaultLedgerId,
      evidenceRequiredMap: params.evidenceRequiredMap,
      policy: params.policy,
      basis: params.basis,
    },
  );
  if (preparedBaseRows.length === 0) return [];

  return deriveSettlementRowsLocally(
    preparedBaseRows,
    buildSettlementDerivationContext(
      params.projectId,
      params.defaultLedgerId,
      params.policy,
      params.basis,
    ),
    { mode: 'full' },
  );
}
