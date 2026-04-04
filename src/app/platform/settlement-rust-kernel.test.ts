import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { ImportRow } from './settlement-csv';
import { deriveSettlementRows } from './settlement-row-derivation';
import type { SettlementDerivationContext, SettlementDerivationOptions } from './settlement-row-derivation';
import { buildSettlementDerivationContext } from './settlement-sheet-prepare';
import { parseNumber } from './csv-utils';
import {
  buildImportRowsFromUsageLedgerFixture,
  getUsageLedgerTrackedNormalReplayRows,
  type UsageLedgerPhase1Fixture,
} from './usage-ledger-phase1';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');
const cargoManifestPath = path.resolve(repoRoot, 'rust/spreadsheet-calculation-core/Cargo.toml');
const rustBinaryPath = path.resolve(repoRoot, 'rust/spreadsheet-calculation-core/target/debug/spreadsheet-calculation-core');
const cargoAvailable = spawnSync('cargo', ['--version'], { cwd: repoRoot, encoding: 'utf8' }).status === 0;

interface KernelImportRowJson {
  tempId: string;
  sourceTxId?: string;
  entryKind?: string;
  cells: string[];
  error?: string;
  reviewHints?: string[];
  reviewRequiredCellIndexes?: number[];
  reviewStatus?: 'pending' | 'confirmed';
  reviewFingerprint?: string;
  reviewConfirmedAt?: string;
  userEditedCells?: number[];
}

function loadFixture(): UsageLedgerPhase1Fixture {
  const fixturePath = path.resolve(
    currentDir,
    '../../../docs/architecture/usage-ledger-phase-1-fixture-2026-04-04.json',
  );
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as UsageLedgerPhase1Fixture;
}

function serializeRows(rows: ImportRow[]): KernelImportRowJson[] {
  return rows.map((row) => ({
    tempId: row.tempId,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    ...(row.entryKind ? { entryKind: row.entryKind } : {}),
    cells: [...row.cells],
    ...(row.error ? { error: row.error } : {}),
    ...(row.reviewHints ? { reviewHints: [...row.reviewHints] } : {}),
    ...(row.reviewRequiredCellIndexes ? { reviewRequiredCellIndexes: [...row.reviewRequiredCellIndexes] } : {}),
    ...(row.reviewStatus ? { reviewStatus: row.reviewStatus } : {}),
    ...(row.reviewFingerprint ? { reviewFingerprint: row.reviewFingerprint } : {}),
    ...(row.reviewConfirmedAt ? { reviewConfirmedAt: row.reviewConfirmedAt } : {}),
    ...(row.userEditedCells ? { userEditedCells: Array.from(row.userEditedCells).sort((a, b) => a - b) } : {}),
  }));
}

function deserializeRows(rows: KernelImportRowJson[]): ImportRow[] {
  return rows.map((row) => ({
    tempId: row.tempId,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    ...(row.entryKind ? { entryKind: row.entryKind as ImportRow['entryKind'] } : {}),
    cells: [...row.cells],
    ...(row.error ? { error: row.error } : {}),
    ...(row.reviewHints ? { reviewHints: [...row.reviewHints] } : {}),
    ...(row.reviewRequiredCellIndexes ? { reviewRequiredCellIndexes: [...row.reviewRequiredCellIndexes] } : {}),
    ...(row.reviewStatus ? { reviewStatus: row.reviewStatus } : {}),
    ...(row.reviewFingerprint ? { reviewFingerprint: row.reviewFingerprint } : {}),
    ...(row.reviewConfirmedAt ? { reviewConfirmedAt: row.reviewConfirmedAt } : {}),
    ...(row.userEditedCells ? { userEditedCells: new Set(row.userEditedCells) } : {}),
  }));
}

function deriveSettlementRowsViaRust(
  rows: ImportRow[],
  context: SettlementDerivationContext,
  options: SettlementDerivationOptions,
): ImportRow[] {
  const executable = existsSync(rustBinaryPath) ? rustBinaryPath : null;
  if (!executable) {
    throw new Error('Rust settlement kernel binary is not built.');
  }
  const payload = {
    rows: serializeRows(rows),
    context,
    options,
  };
  const result = spawnSync(executable, {
    cwd: repoRoot,
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Rust settlement kernel failed: ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout) as { rows: KernelImportRowJson[] };
  return deserializeRows(parsed.rows);
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
    const rustDerived = deriveSettlementRowsViaRust(rows, context, options);

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
    const rustDerived = deriveSettlementRowsViaRust(rows, context, options);

    expectRowsToMatch(tsDerived, rustDerived);
  });
});
