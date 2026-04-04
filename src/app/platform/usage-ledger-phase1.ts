import { SETTLEMENT_COLUMNS, type ImportRow } from './settlement-csv';

export type UsageLedgerTrackedAnomalyKind =
  | 'absolute_reference_pattern'
  | 'running_balance_break';

export interface UsageLedgerPhase1FixtureCell {
  role?: string;
  appHeader?: string;
  value?: unknown;
  formula?: string | null;
  result?: unknown;
}

export interface UsageLedgerPhase1FixtureRow {
  rowNumber: number;
  cells: Record<string, UsageLedgerPhase1FixtureCell>;
}

export interface UsageLedgerTrackedAnomaly {
  kind: UsageLedgerTrackedAnomalyKind;
  cells: string[];
  description: string;
}

export interface UsageLedgerPhase1Fixture {
  workbookSha256: string;
  sheetName: string;
  range: string;
  rows: UsageLedgerPhase1FixtureRow[];
  anomalies: UsageLedgerTrackedAnomaly[];
}

interface BuildUsageLedgerImportRowsOptions {
  rowNumbers?: number[];
  clearTrackedAnomalyCells?: boolean;
}

const WORKBOOK_COLUMN_TO_SETTLEMENT_HEADER: Record<string, string> = {
  B: 'No.',
  D: '거래일시',
  E: '지출구분',
  G: '세목',
  H: '세세목',
  I: 'cashflow항목',
  J: '통장잔액',
  K: '통장에 찍힌 입/출금액',
  L: '입금액(사업비,공급가액,은행이자)',
  M: '매입부가세 반환',
  N: '사업비 사용액',
  O: '매입부가세',
  P: '지급처',
  Q: '상세 적요',
};

function formatFixtureScalar(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    return value.toLocaleString('ko-KR', { maximumFractionDigits: 10 });
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
    return trimmed;
  }
  return String(value);
}

function getCellAddressColumn(cellAddress: string): string {
  return cellAddress.replace(/\d+/g, '');
}

function getCellAddressRow(cellAddress: string): number {
  return Number.parseInt(cellAddress.replace(/[A-Z]+/gi, ''), 10);
}

function getColumnIndexByHeader(header: string): number {
  return SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
}

export function listUsageLedgerTrackedAnomalies(
  fixture: UsageLedgerPhase1Fixture,
): UsageLedgerTrackedAnomaly[] {
  return [...fixture.anomalies];
}

export function resolveUsageLedgerTrackedAnomalyCells(
  fixture: UsageLedgerPhase1Fixture,
): Set<string> {
  const cells = new Set<string>();
  for (const anomaly of fixture.anomalies) {
    for (const cellAddress of anomaly.cells) {
      cells.add(cellAddress);
      if (anomaly.kind === 'absolute_reference_pattern') {
        const rowNumber = getCellAddressRow(cellAddress);
        if (rowNumber > 0) cells.add(`O${rowNumber}`);
      }
    }
  }
  return cells;
}

export function findUsageLedgerRunningBalanceBreakRow(
  fixture: UsageLedgerPhase1Fixture,
): number | null {
  const runningBreak = fixture.anomalies.find((anomaly) => anomaly.kind === 'running_balance_break');
  if (!runningBreak) return null;
  const firstCell = runningBreak.cells[0];
  if (!firstCell) return null;
  const rowNumber = getCellAddressRow(firstCell);
  return Number.isFinite(rowNumber) ? rowNumber : null;
}

export function buildImportRowsFromUsageLedgerFixture(
  fixture: UsageLedgerPhase1Fixture,
  options: BuildUsageLedgerImportRowsOptions = {},
): ImportRow[] {
  const anomalyCells = options.clearTrackedAnomalyCells
    ? resolveUsageLedgerTrackedAnomalyCells(fixture)
    : new Set<string>();
  const allowedRows = options.rowNumbers ? new Set(options.rowNumbers) : null;

  return fixture.rows
    .filter((row) => (allowedRows ? allowedRows.has(row.rowNumber) : true))
    .map((row, index) => {
      const cells = SETTLEMENT_COLUMNS.map(() => '');

      for (const [workbookColumn, header] of Object.entries(WORKBOOK_COLUMN_TO_SETTLEMENT_HEADER)) {
        const targetIndex = getColumnIndexByHeader(header);
        if (targetIndex < 0) continue;
        const cellAddress = `${workbookColumn}${row.rowNumber}`;
        if (anomalyCells.has(cellAddress)) continue;
        const fixtureCell = row.cells[workbookColumn];
        if (!fixtureCell) continue;
        const sourceValue = fixtureCell.result ?? fixtureCell.value;
        cells[targetIndex] = formatFixtureScalar(sourceValue);
      }

      const workbookDisplayOrder = row.cells.B;
      if (workbookDisplayOrder) {
        const noIndex = getColumnIndexByHeader('No.');
        if (noIndex >= 0) {
          const sourceValue = workbookDisplayOrder.result ?? workbookDisplayOrder.value ?? index + 1;
          cells[noIndex] = formatFixtureScalar(sourceValue);
        }
      }

      return {
        tempId: `usage-ledger-fixture-${row.rowNumber}`,
        cells,
      } satisfies ImportRow;
    });
}

export function getUsageLedgerFixtureCell(
  fixture: UsageLedgerPhase1Fixture,
  rowNumber: number,
  workbookColumn: string,
): UsageLedgerPhase1FixtureCell | undefined {
  return fixture.rows.find((row) => row.rowNumber === rowNumber)?.cells[workbookColumn];
}

export function getUsageLedgerTrackedNormalReplayRows(
  fixture: UsageLedgerPhase1Fixture,
): number[] {
  const breakRow = findUsageLedgerRunningBalanceBreakRow(fixture);
  return fixture.rows
    .map((row) => row.rowNumber)
    .filter((rowNumber) => (breakRow == null ? true : rowNumber < breakRow));
}

export function getUsageLedgerTrackedAnomalyColumns(
  fixture: UsageLedgerPhase1Fixture,
): string[] {
  const columns = new Set<string>();
  for (const cell of resolveUsageLedgerTrackedAnomalyCells(fixture)) {
    columns.add(getCellAddressColumn(cell));
  }
  return [...columns].sort();
}
