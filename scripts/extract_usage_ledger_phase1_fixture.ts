import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

interface ScriptOptions {
  workbookPath: string;
  outPath: string;
}

const SHEET_NAME = '사용내역(통장내역기준취소내역,불인정포함)';
const START_ROW = 4;
const END_ROW = 12;

const COLUMN_MAP = [
  { column: 'B', workbookLabel: 'No.', appHeader: 'No.', role: 'display_order' },
  { column: 'D', workbookLabel: '해당 주차', appHeader: '거래일시/해당 주차 seed', role: 'date_seed' },
  { column: 'E', workbookLabel: '지출구분', appHeader: '지출구분', role: 'payment_method' },
  { column: 'G', workbookLabel: '세목', appHeader: '세목', role: 'budget_sub_category' },
  { column: 'H', workbookLabel: '세세목', appHeader: '세세목', role: 'budget_sub_sub_category' },
  { column: 'I', workbookLabel: 'cashflow항목', appHeader: 'cashflow항목', role: 'cashflow_line' },
  { column: 'J', workbookLabel: '통장잔액', appHeader: '통장잔액', role: 'running_balance' },
  { column: 'K', workbookLabel: '통장에 찍힌 입/출금액', appHeader: '통장에 찍힌 입/출금액', role: 'bank_amount' },
  { column: 'L', workbookLabel: '입금액', appHeader: '입금액(사업비,공급가액,은행이자)', role: 'deposit_amount' },
  { column: 'M', workbookLabel: '매입부가세 반환', appHeader: '매입부가세 반환', role: 'vat_refund' },
  { column: 'N', workbookLabel: '사업비 사용액', appHeader: '사업비 사용액', role: 'expense_amount' },
  { column: 'O', workbookLabel: '매입부가세', appHeader: '매입부가세', role: 'input_vat' },
  { column: 'P', workbookLabel: '지급처', appHeader: '지급처', role: 'counterparty' },
  { column: 'Q', workbookLabel: '상세 적요', appHeader: '상세 적요', role: 'memo' },
] as const;

function parseArgs(argv: string[]): ScriptOptions {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  if (positional.length === 0) {
    throw new Error(
      'Usage: npx tsx scripts/extract_usage_ledger_phase1_fixture.ts <workbook.xlsx> [out.json]',
    );
  }

  return {
    workbookPath: path.resolve(positional[0]),
    outPath: path.resolve(
      positional[1] || path.join(process.cwd(), 'docs', 'architecture', 'usage-ledger-phase-1-fixture-2026-04-04.json'),
    ),
  };
}

function normalizeCellValue(value: unknown): string | number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const workbookBytes = await fs.readFile(options.workbookPath);
  const workbookSha256 = createHash('sha256').update(workbookBytes).digest('hex');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBytes);
  const worksheet = workbook.getWorksheet(SHEET_NAME);
  if (!worksheet) {
    throw new Error(`Worksheet not found: ${SHEET_NAME}`);
  }

  const fixture = {
    workbookPath: options.workbookPath,
    workbookSha256,
    sheetName: SHEET_NAME,
    range: `${START_ROW}:${END_ROW}`,
    relevantColumns: COLUMN_MAP,
    headerRows: {
      row2: COLUMN_MAP.map(({ column, workbookLabel }) => ({
        column,
        workbookLabel,
        raw: worksheet.getCell(`${column}2`).value ?? null,
      })),
      row3: COLUMN_MAP.map(({ column, appHeader }) => ({
        column,
        appHeader,
        raw: worksheet.getCell(`${column}3`).value ?? null,
      })),
    },
    rows: Array.from({ length: END_ROW - START_ROW + 1 }, (_, offset) => {
      const rowNumber = START_ROW + offset;
      return {
        rowNumber,
        cells: Object.fromEntries(
          COLUMN_MAP.map(({ column, role, appHeader }) => {
            const cell = worksheet.getCell(`${column}${rowNumber}`);
            return [
              column,
              {
                role,
                appHeader,
                value: normalizeCellValue(cell.value),
                formula: cell.formula ? `=${cell.formula}` : null,
                result: normalizeCellValue(cell.result),
              },
            ];
          }),
        ),
      };
    }),
    anomalies: [
      {
        kind: 'absolute_reference_pattern',
        cells: ['N4', 'N5', 'N6', 'N7', 'N8', 'N9'],
        description: '사업비 사용액 열이 각 행의 K행이 아니라 절대참조 `$K$4/11*10`으로 고정되어 있습니다.',
      },
      {
        kind: 'running_balance_break',
        cells: ['J13'],
        description: '통장잔액 연쇄 계산이 `#REF!`로 끊기며 이후 balance chain이 모두 전파 오류가 됩니다.',
      },
    ],
  };

  await fs.mkdir(path.dirname(options.outPath), { recursive: true });
  await fs.writeFile(options.outPath, JSON.stringify(fixture, null, 2), 'utf-8');

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        workbookPath: options.workbookPath,
        workbookSha256,
        outPath: options.outPath,
        sheetName: SHEET_NAME,
        rowCount: fixture.rows.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
