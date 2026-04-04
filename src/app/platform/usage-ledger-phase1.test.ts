import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseNumber } from './csv-utils';
import {
  deriveSettlementRows,
} from './settlement-row-derivation';
import { buildSettlementDerivationContext } from './settlement-sheet-prepare';
import {
  buildImportRowsFromUsageLedgerFixture,
  findUsageLedgerRunningBalanceBreakRow,
  getUsageLedgerFixtureCell,
  getUsageLedgerTrackedNormalReplayRows,
  getUsageLedgerTrackedAnomalyColumns,
  listUsageLedgerTrackedAnomalies,
  resolveUsageLedgerTrackedAnomalyCells,
  type UsageLedgerPhase1Fixture,
} from './usage-ledger-phase1';

function loadFixture(): UsageLedgerPhase1Fixture {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const fixturePath = path.resolve(
    currentDir,
    '../../../docs/architecture/usage-ledger-phase-1-fixture-2026-04-04.json',
  );
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as UsageLedgerPhase1Fixture;
}

describe('usage-ledger-phase1', () => {
  it('tracks the known source anomalies from the phase-1 fixture', () => {
    const fixture = loadFixture();

    expect(findUsageLedgerRunningBalanceBreakRow(fixture)).toBe(13);
    expect(getUsageLedgerTrackedAnomalyColumns(fixture)).toEqual(['J', 'N', 'O']);

    const trackedCells = resolveUsageLedgerTrackedAnomalyCells(fixture);
    expect(trackedCells.has('N4')).toBe(true);
    expect(trackedCells.has('N9')).toBe(true);
    expect(trackedCells.has('O4')).toBe(true);
    expect(trackedCells.has('O9')).toBe(true);
    expect(trackedCells.has('J13')).toBe(true);

    const anomalies = listUsageLedgerTrackedAnomalies(fixture);
    expect(anomalies.map((anomaly) => anomaly.kind)).toEqual([
      'absolute_reference_pattern',
      'running_balance_break',
    ]);
  });

  it('replays the tracked normal balance window without trusting imported balance anchors', () => {
    const fixture = loadFixture();
    const rows = buildImportRowsFromUsageLedgerFixture(fixture, {
      rowNumbers: getUsageLedgerTrackedNormalReplayRows(fixture),
    });
    const context = buildSettlementDerivationContext('proj-phase1', 'ledger-phase1');

    const derived = deriveSettlementRows(rows, context, {
      mode: 'full',
      respectExplicitBalanceAnchors: false,
    });

    for (const row of fixture.rows) {
      const expectedBalance = row.cells.J?.result;
      if (row.rowNumber >= 13 || typeof expectedBalance !== 'number') continue;
      const derivedRow = derived.find((candidate) => candidate.tempId === `usage-ledger-fixture-${row.rowNumber}`);
      const derivedBalance = parseNumber(derivedRow?.cells[context.balanceIdx] || '');
      expect(derivedBalance).not.toBeNull();
      expect(Math.abs((derivedBalance ?? 0) - expectedBalance)).toBeLessThanOrEqual(0.01);
    }
  });

  it('clears tracked absolute-reference anomalies before row-local derivation', () => {
    const fixture = loadFixture();
    const rows = buildImportRowsFromUsageLedgerFixture(fixture, {
      rowNumbers: [4, 5, 6, 7, 8, 9],
      clearTrackedAnomalyCells: true,
    });
    const context = buildSettlementDerivationContext('proj-phase1', 'ledger-phase1', undefined, '공급가액');

    for (const row of rows) {
      expect(row.cells[context.expenseIdx]).toBe('');
      expect(row.cells[context.vatInIdx]).toBe('');
    }

    const derived = deriveSettlementRows(rows, context, {
      mode: 'full',
      respectExplicitBalanceAnchors: false,
    });
    const sharedExpenseFromWorkbook = Number(getUsageLedgerFixtureCell(fixture, 4, 'N')?.result || 0);

    for (const row of derived) {
      const depositAmount = parseNumber(row.cells[context.depositIdx] || '') ?? 0;
      const bankAmount = parseNumber(row.cells[context.bankAmountIdx] || '') ?? 0;
      const expenseAmount = parseNumber(row.cells[context.expenseIdx] || '') ?? 0;
      const vatAmount = parseNumber(row.cells[context.vatInIdx] || '') ?? 0;
      if (depositAmount > 0) {
        expect(expenseAmount).toBe(0);
        expect(vatAmount).toBe(0);
        continue;
      }
      expect(expenseAmount + vatAmount).toBeCloseTo(bankAmount, 6);
    }

    const derivedRow5 = derived.find((row) => row.tempId === 'usage-ledger-fixture-5');
    const derivedRow6 = derived.find((row) => row.tempId === 'usage-ledger-fixture-6');
    expect(parseNumber(derivedRow5?.cells[context.expenseIdx] || '')).not.toBeCloseTo(sharedExpenseFromWorkbook, 6);
    expect(parseNumber(derivedRow6?.cells[context.expenseIdx] || '')).not.toBeCloseTo(sharedExpenseFromWorkbook, 6);
  });
});
