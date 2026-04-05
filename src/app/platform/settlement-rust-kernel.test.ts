import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { ImportRow } from './settlement-csv';
import { deriveSettlementRows } from './settlement-row-derivation';
import type { SettlementDerivationContext, SettlementDerivationOptions } from './settlement-row-derivation';
import { buildSettlementDerivationContext } from './settlement-sheet-prepare';
import {
  aggregateBudgetActualsViaRustKernel,
  buildSettlementActualSyncPayloadViaRustKernel,
  buildSettlementFlowSnapshotsViaRustKernel,
  deriveSettlementRowsViaRustKernel,
  SETTLEMENT_RUST_PARITY_PATHS,
} from './settlement-calculation-kernel.node';
import { parseNumber } from './csv-utils';
import { getYearMondayWeeks, type MonthMondayWeek } from './cashflow-weeks';
import { buildSettlementActualSyncPayload } from './settlement-sheet-sync';
import { aggregateBudgetActualsFromSettlementRows } from './budget-actuals';
import { resolveSettlementFlowSnapshot, type SettlementFlowAmountIndexes } from './settlement-flow-amounts';
import {
  buildImportRowsFromUsageLedgerFixture,
  getUsageLedgerTrackedNormalReplayRows,
  type UsageLedgerPhase1Fixture,
} from './usage-ledger-phase1';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');
const cargoManifestPath = SETTLEMENT_RUST_PARITY_PATHS.cargoManifestPath;
const cargoAvailable = spawnSync('cargo', ['--version'], { cwd: repoRoot, encoding: 'utf8' }).status === 0;

interface KernelActualSyncWeekJson {
  yearMonth: string;
  weekNo: number;
  amounts: Record<string, number>;
}

interface KernelBudgetActualItemJson {
  budgetKey: string;
  budgetCode: string;
  subCode: string;
  amount: number;
}

const flowIndexes: SettlementFlowAmountIndexes = {
  cashflowIdx: 8,
  bankAmountIdx: 10,
  depositIdx: 11,
  refundIdx: 12,
  expenseAmountIdx: 13,
  vatInIdx: 14,
};

function loadFixture(): UsageLedgerPhase1Fixture {
  const fixturePath = path.resolve(
    currentDir,
    '../../../docs/architecture/usage-ledger-phase-1-fixture-2026-04-04.json',
  );
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as UsageLedgerPhase1Fixture;
}

function expectRowsToMatch(tsRows: ImportRow[], rustRows: ImportRow[]) {
  expect(rustRows).toHaveLength(tsRows.length);
  tsRows.forEach((tsRow, rowIdx) => {
    const rustRow = rustRows[rowIdx];
    expect(rustRow?.tempId).toBe(tsRow.tempId);
    expect(rustRow?.reviewHints).toEqual(tsRow.reviewHints);
    expect(rustRow?.reviewRequiredCellIndexes).toEqual(tsRow.reviewRequiredCellIndexes);
    expect(rustRow?.reviewStatus).toEqual(tsRow.reviewStatus);
    expect(rustRow?.reviewFingerprint).toEqual(tsRow.reviewFingerprint);
    expect(rustRow?.reviewConfirmedAt).toEqual(tsRow.reviewConfirmedAt);
    expect(rustRow?.cells).toHaveLength(tsRow.cells.length);

    tsRow.cells.forEach((tsCell, cellIdx) => {
      const rustCell = rustRow?.cells[cellIdx] || '';
      const tsNumber = parseNumber(tsCell);
      const rustNumber = parseNumber(rustCell);
      if (tsNumber != null && rustNumber != null) {
        expect(Math.abs(rustNumber - tsNumber)).toBeLessThanOrEqual(0.01);
        return;
      }
      expect(rustCell).toBe(tsCell);
    });
  });
}

const describeRust = cargoAvailable ? describe : describe.skip;

describeRust('settlement-rust-kernel', () => {
  it('keeps the Rust bridge behind a node-only parity boundary', () => {
    const browserKernelSource = readFileSync(path.resolve(currentDir, './settlement-calculation-kernel.ts'), 'utf8');
    expect(browserKernelSource).not.toContain('settlement-calculation-kernel.node');
    expect(browserKernelSource).not.toContain('ViaRustKernel');
  });

  beforeAll(() => {
    const build = spawnSync('cargo', ['build', '--quiet', '--manifest-path', cargoManifestPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (build.status !== 0) {
      throw new Error(build.stderr || build.stdout || 'Rust settlement kernel build failed.');
    }
  });

  it('matches TypeScript usage-ledger replay on the tracked normal balance window', () => {
    const fixture = loadFixture();
    const rows = buildImportRowsFromUsageLedgerFixture(fixture, {
      rowNumbers: getUsageLedgerTrackedNormalReplayRows(fixture),
    });
    const context = buildSettlementDerivationContext('proj-phase1', 'ledger-phase1');
    const options: SettlementDerivationOptions = {
      mode: 'full',
      respectExplicitBalanceAnchors: false,
    };

    const tsDerived = deriveSettlementRows(rows, context, options);
    const rustDerived = deriveSettlementRowsViaRustKernel(rows, context, options);

    expectRowsToMatch(tsDerived, rustDerived);
  });

  it('matches TypeScript review-candidate derivation and manual clear preservation', () => {
    const context = buildSettlementDerivationContext('proj-rust', 'ledger-rust', undefined, '공급가액');
    const candidateRow: ImportRow = {
      tempId: 'candidate-row',
      sourceTxId: 'bank:row-1',
      cells: Array.from({ length: 26 }, () => ''),
    };
    candidateRow.cells[10] = '110,000';

    const manualClearRow: ImportRow = {
      tempId: 'manual-clear-row',
      cells: Array.from({ length: 26 }, () => ''),
      userEditedCells: new Set([13]),
    };
    manualClearRow.cells[10] = '110,000';

    const options: SettlementDerivationOptions = { mode: 'cascade', rowIdx: 0 };
    const rows = [candidateRow, manualClearRow];

    const tsDerived = deriveSettlementRows(rows, context, options);
    const rustDerived = deriveSettlementRowsViaRustKernel(rows, context, options);

    expectRowsToMatch(tsDerived, rustDerived);
  });

  it('matches TypeScript bank-import policy that keeps expense and vat blank for manual entry', () => {
    const context = buildSettlementDerivationContext('proj-rust', 'ledger-rust', undefined, '공급가액');
    const importedExpenseRow: ImportRow = {
      tempId: 'bank-imported-expense-row',
      sourceTxId: 'bank:expense-import-1',
      entryKind: 'EXPENSE',
      cells: Array.from({ length: 26 }, () => ''),
    };
    importedExpenseRow.cells[10] = '110,000';

    const options: SettlementDerivationOptions = { mode: 'cascade', rowIdx: 0 };
    const tsDerived = deriveSettlementRows([importedExpenseRow], context, options);
    const rustDerived = deriveSettlementRowsViaRustKernel([importedExpenseRow], context, options);

    expectRowsToMatch(tsDerived, rustDerived);
    expect(rustDerived[0]?.cells[13]).toBe('');
    expect(rustDerived[0]?.cells[14]).toBe('');
  });

  it('matches TypeScript weekly actual sync payload generation', () => {
    const yearWeeks: MonthMondayWeek[] = [
      { yearMonth: '2026-03', weekNo: 1, weekStart: '2026-03-02', weekEnd: '2026-03-08', label: '26-03-01' },
      { yearMonth: '2026-03', weekNo: 2, weekStart: '2026-03-09', weekEnd: '2026-03-15', label: '26-03-02' },
    ];
    const base = Array.from({ length: 27 }, () => '');
    const directRow: ImportRow = {
      tempId: 'direct-row',
      cells: [...base],
    };
    directRow.cells[2] = '2026-03-03';
    directRow.cells[3] = '26-03-01';
    directRow.cells[8] = '직접사업비';
    directRow.cells[13] = '30,000';
    directRow.cells[14] = '3,000';

    const salesRow: ImportRow = {
      tempId: 'sales-row',
      cells: [...base],
    };
    salesRow.cells[2] = '2026-03-04';
    salesRow.cells[3] = '26-03-01';
    salesRow.cells[8] = '매출액(입금)';
    salesRow.cells[11] = '250,000';

    const persistedRow: ImportRow = {
      tempId: 'persisted-row',
      cells: [...base],
    };
    persistedRow.cells[2] = '2026-03-12';
    persistedRow.cells[3] = '26-03-02';
    persistedRow.cells[8] = '직접사업비';
    persistedRow.cells[10] = '20,000';

    const tsPayload = buildSettlementActualSyncPayload([directRow, salesRow], yearWeeks, [persistedRow]);
    const rustPayload = buildSettlementActualSyncPayloadViaRustKernel([directRow, salesRow], yearWeeks, [persistedRow]);

    expect(rustPayload).toEqual(tsPayload);
    const marchWeek = tsPayload.find((item) => item.yearMonth === '2026-03' && item.weekNo === 1);
    expect(marchWeek?.amounts.DIRECT_COST_OUT).toBe(30000);
    expect(marchWeek?.amounts.INPUT_VAT_OUT).toBe(3000);
    expect(marchWeek?.amounts.SALES_IN).toBe(250000);
  });

  it('matches TypeScript budget actual aggregation from settlement rows', () => {
    const base = Array.from({ length: 27 }, () => '');
    const directRow: ImportRow = {
      tempId: 'budget-direct',
      cells: [...base],
    };
    directRow.cells[5] = '회의비';
    directRow.cells[6] = '다과비';
    directRow.cells[8] = '직접사업비';
    directRow.cells[13] = '30,000';

    const vatRow: ImportRow = {
      tempId: 'budget-vat',
      cells: [...base],
    };
    vatRow.cells[5] = '부가세';
    vatRow.cells[6] = '매입부가세';
    vatRow.cells[8] = '매입부가세';
    vatRow.cells[14] = '3,000';

    const inflowRow: ImportRow = {
      tempId: 'budget-inflow',
      cells: [...base],
    };
    inflowRow.cells[5] = '사업수익';
    inflowRow.cells[6] = '매출';
    inflowRow.cells[8] = '매출액(입금)';
    inflowRow.cells[10] = '999,000';

    const tsActuals = aggregateBudgetActualsFromSettlementRows([directRow, vatRow, inflowRow]);
    const rustActuals = aggregateBudgetActualsViaRustKernel([directRow, vatRow, inflowRow]);

    expect(rustActuals.total).toBe(33000);
    expect(rustActuals.items).toEqual([
      { budgetKey: '부가세|매입부가세', budgetCode: '부가세', subCode: '매입부가세', amount: 3000 },
      { budgetKey: '회의비|다과비', budgetCode: '회의비', subCode: '다과비', amount: 30000 },
    ]);
    expect(Object.fromEntries(tsActuals.entries())).toEqual({
      '회의비|다과비': 30000,
      '부가세|매입부가세': 3000,
    });
  });

  it('matches TypeScript flow snapshots for pending bank-imported outflow rows', () => {
    const base = Array.from({ length: 27 }, () => '');
    const pendingRow: ImportRow = {
      tempId: 'pending-bank-row',
      sourceTxId: 'bank:expense-1',
      entryKind: 'EXPENSE',
      cells: [...base],
    };
    pendingRow.cells[5] = '회의비';
    pendingRow.cells[6] = '다과비';
    pendingRow.cells[8] = '직접사업비';
    pendingRow.cells[10] = '110,000';

    const tsSnapshot = resolveSettlementFlowSnapshot(pendingRow, flowIndexes);
    const rustSnapshot = buildSettlementFlowSnapshotsViaRustKernel([pendingRow])[0];

    expect(rustSnapshot?.tempId).toBe(pendingRow.tempId);
    expect(rustSnapshot?.lineId).toBe(tsSnapshot.lineId);
    expect(rustSnapshot?.bankAmount).toBe(tsSnapshot.bankAmount);
    expect(rustSnapshot?.budgetActualAmount).toBe(tsSnapshot.budgetActualAmount);
    expect(rustSnapshot?.manualOutflowPending).toBe(tsSnapshot.manualOutflowPending);
    expect(rustSnapshot?.cashflowActualLineAmounts).toEqual(tsSnapshot.cashflowActualLineAmounts);
    expect(rustSnapshot?.budgetKey).toBe('회의비|다과비');
  });
});
