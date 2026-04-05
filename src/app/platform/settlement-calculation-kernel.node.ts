import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { MonthMondayWeek } from './cashflow-weeks';
import type { ImportRow } from './settlement-csv';
import {
  deserializeImportRowsFromKernel,
  serializeImportRowsForKernel,
  type KernelImportRowJson,
  type SettlementFlowSnapshot,
} from './settlement-kernel-contract';
import type {
  SettlementDerivationContext,
  SettlementDerivationOptions,
} from './settlement-row-derivation';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');
const cargoManifestPath = path.resolve(repoRoot, 'rust/spreadsheet-calculation-core/Cargo.toml');
const rustBinaryPath = path.resolve(repoRoot, 'rust/spreadsheet-calculation-core/target/debug/spreadsheet-calculation-core');

export const SETTLEMENT_RUST_KERNEL_PATHS = {
  repoRoot,
  cargoManifestPath,
  rustBinaryPath,
} as const;

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

function runRustKernel(input: object): string {
  if (!existsSync(rustBinaryPath)) {
    throw new Error('Rust settlement kernel binary is not built.');
  }
  const result = spawnSync(rustBinaryPath, {
    cwd: repoRoot,
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Rust settlement kernel failed.');
  }
  return result.stdout;
}

export function settlementRustKernelAvailable(): boolean {
  return existsSync(rustBinaryPath);
}

export function deriveSettlementRowsViaRustKernel(
  rows: ImportRow[],
  context: SettlementDerivationContext,
  options: SettlementDerivationOptions,
): ImportRow[] {
  const stdout = runRustKernel({
    rows: serializeImportRowsForKernel(rows),
    context,
    options,
  });
  return deserializeImportRowsFromKernel((JSON.parse(stdout) as { rows: KernelImportRowJson[] }).rows);
}

export function buildSettlementActualSyncPayloadViaRustKernel(
  rows: ImportRow[],
  yearWeeks: MonthMondayWeek[],
  persistedRows?: ImportRow[] | null,
): KernelActualSyncWeekJson[] {
  const stdout = runRustKernel({
    command: 'actualSync',
    rows: serializeImportRowsForKernel(rows),
    yearWeeks,
    ...(persistedRows ? { persistedRows: serializeImportRowsForKernel(persistedRows) } : {}),
  });
  return (JSON.parse(stdout) as { weeks: KernelActualSyncWeekJson[] }).weeks;
}

export function aggregateBudgetActualsViaRustKernel(
  rows: ImportRow[],
): { items: KernelBudgetActualItemJson[]; total: number } {
  const stdout = runRustKernel({
    command: 'budgetActuals',
    rows: serializeImportRowsForKernel(rows),
  });
  return JSON.parse(stdout) as { items: KernelBudgetActualItemJson[]; total: number };
}

export function buildSettlementFlowSnapshotsViaRustKernel(
  rows: ImportRow[],
): SettlementFlowSnapshot[] {
  const stdout = runRustKernel({
    command: 'flowSnapshot',
    rows: serializeImportRowsForKernel(rows),
  });
  return (JSON.parse(stdout) as { snapshots: SettlementFlowSnapshot[] }).snapshots;
}
