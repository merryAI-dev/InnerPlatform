import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  GOOGLE_SHEET_RULE_FAMILY_LABELS,
  planGoogleSheetWorkbook,
  type GoogleSheetRuleFamily,
} from '../src/app/platform/google-sheet-workbook-plan';

interface ScriptOptions {
  inputPath: string;
  outDir: string;
}

interface SheetFormulaRecord {
  sheetName: string;
  cell: string;
  formula: string;
  result: string;
  family: GoogleSheetRuleFamily;
  wave: string;
}

interface SheetSummary {
  sheetName: string;
  rowCount: number;
  columnCount: number;
  nonEmptyCellCount: number;
  formulaCount: number;
  uniqueFormulaCount: number;
  topFormulaColumns: Array<{ column: string; count: number }>;
  topFunctions: Array<{ fn: string; count: number }>;
  family: GoogleSheetRuleFamily;
  familyLabel: string;
  wave: string;
}

type SourceBugKind = 'literal_ref' | 'propagated_ref';

function parseArgs(argv: string[]): ScriptOptions {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  if (positional.length === 0) {
    throw new Error(
      'Usage: npx tsx scripts/extract_workbook_formula_inventory.ts <input.xlsx> [outDir]',
    );
  }

  const inputPath = path.resolve(positional[0]);
  const outDir = path.resolve(
    positional[1] || path.join(process.cwd(), 'output', 'spreadsheet'),
  );
  return { inputPath, outDir };
}

function columnLetter(index: number): string {
  let current = index;
  let output = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    current = Math.floor((current - 1) / 26);
  }
  return output || 'A';
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatResult(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function extractFunctions(formula: string): string[] {
  const matches = formula.toUpperCase().match(/[A-Z]+\(/g) || [];
  return matches.map((match) => match.slice(0, -1));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(options.outDir, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(options.inputPath);

  const workbookPlan = planGoogleSheetWorkbook(workbook.worksheets.map((ws) => ws.name));
  const planByName = new Map(workbookPlan.sheets.map((sheet) => [sheet.sheetName, sheet]));

  const allFormulas: SheetFormulaRecord[] = [];
  const sheetSummaries: SheetSummary[] = [];
  const sourceBugLedger: Array<{
    sheetName: string;
    cell: string;
    formula: string;
    result: string;
    kind: SourceBugKind;
  }> = [];

  for (const worksheet of workbook.worksheets) {
    const sheetPlan = planByName.get(worksheet.name);
    const formulaColumns = new Map<string, number>();
    const functions = new Map<string, number>();
    const uniqueFormulas = new Set<string>();
    let nonEmptyCellCount = 0;
    let formulaCount = 0;

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        nonEmptyCellCount += 1;
        const formula = cell.formula;
        if (!formula) return;
        formulaCount += 1;

        const normalizedFormula = `=${formula}`;
        const column = columnLetter(cell.col);
        formulaColumns.set(column, (formulaColumns.get(column) || 0) + 1);
        uniqueFormulas.add(normalizedFormula);

        for (const fn of extractFunctions(formula)) {
          functions.set(fn, (functions.get(fn) || 0) + 1);
        }

        const result = formatResult(cell.result);
        allFormulas.push({
          sheetName: worksheet.name,
          cell: cell.address,
          formula: normalizedFormula,
          result,
          family: sheetPlan?.family || 'UNKNOWN',
          wave: sheetPlan?.wave || 'REFERENCE',
        });

        const hasLiteralRef = normalizedFormula.includes('#REF!');
        const hasPropagatedRef = result.includes('#REF!');
        if (hasLiteralRef || hasPropagatedRef) {
          sourceBugLedger.push({
            sheetName: worksheet.name,
            cell: cell.address,
            formula: normalizedFormula,
            result,
            kind: hasLiteralRef ? 'literal_ref' : 'propagated_ref',
          });
        }
      });
    });

    const topFormulaColumns = Array.from(formulaColumns.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en'))
      .slice(0, 12)
      .map(([column, count]) => ({ column, count }));
    const topFunctions = Array.from(functions.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en'))
      .slice(0, 12)
      .map(([fn, count]) => ({ fn, count }));

    const family = sheetPlan?.family || 'UNKNOWN';
    sheetSummaries.push({
      sheetName: worksheet.name,
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
      nonEmptyCellCount,
      formulaCount,
      uniqueFormulaCount: uniqueFormulas.size,
      topFormulaColumns,
      topFunctions,
      family,
      familyLabel: GOOGLE_SHEET_RULE_FAMILY_LABELS[family],
      wave: sheetPlan?.wave || 'REFERENCE',
    });
  }

  const sourceBugCounts = sourceBugLedger.reduce(
    (acc, issue) => {
      acc[issue.kind] += 1;
      return acc;
    },
    { literal_ref: 0, propagated_ref: 0 } satisfies Record<SourceBugKind, number>,
  );

  const formulaInventory = {
    workbookPath: options.inputPath,
    generatedAt: new Date().toISOString(),
    workbookPlan,
    sheetSummaries,
  };

  const summaryLines = [
    '# Workbook Formula Extraction Summary',
    '',
    `Source workbook: ${options.inputPath}`,
    `Generated at: ${new Date().toISOString()}`,
    '',
    '## Workbook execution order',
    ...workbookPlan.executionOrder.map(
      (sheet, index) =>
        `${index + 1}. ${sheet.sheetName} — ${GOOGLE_SHEET_RULE_FAMILY_LABELS[sheet.family]} (${sheet.wave})`,
    ),
    '',
    '## Formula-bearing sheets',
    ...sheetSummaries
      .filter((sheet) => sheet.formulaCount > 0)
      .sort((left, right) => right.formulaCount - left.formulaCount)
      .map(
        (sheet) =>
          `- ${sheet.sheetName}: ${sheet.formulaCount} formulas, ${sheet.uniqueFormulaCount} unique, ${sheet.familyLabel}`,
      ),
    '',
    '## Missing dependencies',
    ...(workbookPlan.missingDependencies.length > 0
      ? workbookPlan.missingDependencies.map(
          (gap) => `- ${gap.sheetName}: missing ${gap.missingFamilies.join(', ')}`,
        )
      : ['- none']),
    '',
    '## Source bug ledger',
    `- literal_ref: ${sourceBugCounts.literal_ref}`,
    `- propagated_ref: ${sourceBugCounts.propagated_ref}`,
    ...(sourceBugLedger.length > 0
      ? sourceBugLedger.map(
          (issue) => `- [${issue.kind}] ${issue.sheetName}!${issue.cell}: \`${issue.formula}\` -> ${issue.result || '(empty result)'}`,
        )
      : ['- none']),
  ];

  await Promise.all([
    fs.writeFile(
      path.join(options.outDir, 'formula-inventory.json'),
      JSON.stringify(formulaInventory, null, 2),
      'utf-8',
    ),
    fs.writeFile(
      path.join(options.outDir, 'workbook-plan.json'),
      JSON.stringify(workbookPlan, null, 2),
      'utf-8',
    ),
    fs.writeFile(
      path.join(options.outDir, 'source-bug-ledger.json'),
      JSON.stringify(sourceBugLedger, null, 2),
      'utf-8',
    ),
    fs.writeFile(
      path.join(options.outDir, 'all-formulas.csv'),
      [
        'sheet,cell,family,wave,formula,result',
        ...allFormulas.map((record) =>
          [
            record.sheetName,
            record.cell,
            record.family,
            record.wave,
            record.formula,
            record.result,
          ].map(csvEscape).join(','),
        ),
      ].join('\n'),
      'utf-8',
    ),
    fs.writeFile(
      path.join(options.outDir, 'formula-summary.md'),
      summaryLines.join('\n'),
      'utf-8',
    ),
  ]);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        inputPath: options.inputPath,
        outDir: options.outDir,
        sheetCount: workbook.worksheets.length,
        formulaCount: allFormulas.length,
        sourceBugCount: sourceBugLedger.length,
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
