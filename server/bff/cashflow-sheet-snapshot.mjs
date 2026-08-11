import { createHash } from 'node:crypto';
import { toA1 } from './cashflow-sheet-template.mjs';
import { annualYearsFor, requireWeeklyYear, weekOrdinal } from './cashflow-coordinates.mjs';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => [key, canonicalize(value[key])]));
}

function revisionOf(value) {
  const serialized = JSON.stringify(canonicalize(value));
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

function normalizedText(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const DASH_ONLY_RE = /^[-–—―]+$/;

export function classifyCashflowSheetCell(value) {
  const rawValue = normalizedText(value);
  if (!rawValue || DASH_ONLY_RE.test(rawValue)) return { state: 'EMPTY' };

  const normalizedMinus = rawValue.replace(/[−﹣－]/g, '-');
  const parenthesizedNegative = /^\(.*\)$/.test(normalizedMinus);
  if ((normalizedMinus.includes('(') || normalizedMinus.includes(')')) && !parenthesizedNegative) {
    return { state: 'INVALID', rawValue };
  }

  let numericText = normalizedMinus
    .replace(/[()]/g, '')
    .replace(/[,\s\u00a0원₩￦]/g, '');
  if (numericText.endsWith('-') && numericText.length > 1) {
    numericText = `-${numericText.slice(0, -1)}`;
  }
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(numericText)) {
    return { state: 'INVALID', rawValue };
  }

  const parsed = Number(numericText);
  if (!Number.isFinite(parsed)) return { state: 'INVALID', rawValue };
  const amount = parenthesizedNegative && parsed > 0 ? -parsed : parsed;
  return { state: 'VALUE', amount: Object.is(amount, -0) ? 0 : amount };
}

function normalizedAmounts(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, amount]) => typeof amount === 'number' && Number.isFinite(amount))
    .sort(([left], [right]) => compareCodeUnits(left, right)));
}

function normalizedAmountSources(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value)
    .map(([sourceKey, amounts]) => [sourceKey, normalizedAmounts(amounts)])
    .filter(([, amounts]) => Object.keys(amounts).length > 0)
    .sort(([left], [right]) => compareCodeUnits(left, right)));
}

export function computeCashflowTargetRevision(snapshot = {}) {
  const weeks = (Array.isArray(snapshot?.weeks) ? snapshot.weeks : [])
    .map((week) => ({
      yearMonth: String(week?.yearMonth || ''),
      weekNo: Number(week?.weekNo),
      projection: normalizedAmounts(week?.projection),
      actual: normalizedAmounts(week?.actual),
      weeklyExpenseActualBySheet: normalizedAmountSources(week?.weeklyExpenseActualBySheet),
      adminClosed: Boolean(week?.adminClosed),
    }))
    .filter((week) => week.yearMonth && Number.isFinite(week.weekNo))
    .sort((left, right) => left.yearMonth.localeCompare(right.yearMonth) || left.weekNo - right.weekNo);
  return revisionOf({ weeks });
}

// Actual 은 회계 서식이 0 을 '-' 로 그린다. 시트의 '-' 는 확정된 0원이므로 ZERO 로 읽는다.
// Projection 의 '-' 는 기존 계약 그대로 미기입(EMPTY)이다.
function classifyModeCell(mode, value) {
  if (mode === 'actual' && DASH_ONLY_RE.test(normalizedText(value))) return { state: 'ZERO', amount: 0 };
  const classified = classifyCashflowSheetCell(value);
  return classified.state === 'VALUE' && classified.amount === 0
    ? { state: 'ZERO', amount: 0 }
    : classified;
}

function snapshotCell(mapping, matrix) {
  const cell = classifyModeCell(mapping.mode, matrix?.[mapping.rowIndex]?.[mapping.columnIndex]);
  return {
    mode: mapping.mode,
    yearMonth: mapping.yearMonth,
    weekNo: Number(mapping.weekNo),
    lineId: mapping.lineId,
    direction: mapping.direction,
    sourceCell: mapping.a1,
    sourceLabel: mapping.label || mapping.canonicalLabel || mapping.lineId,
    ...cell,
  };
}

function snapshotAnnualCell(mapping, matrix) {
  const annualClassified = classifyModeCell(mapping.mode, matrix?.[mapping.rowIndex]?.[mapping.columnIndex]);
  return {
    mode: mapping.mode,
    year: Number(mapping.year),
    periodKind: mapping.periodKind,
    lineId: mapping.lineId,
    direction: mapping.direction,
    sourceCell: mapping.a1,
    sourceLabel: mapping.label || mapping.canonicalLabel || mapping.lineId,
    ...annualClassified,
  };
}

function snapshotAnnualDerivedCell(mapping, matrix) {
  return {
    mode: mapping.mode,
    year: Number(mapping.year),
    periodKind: mapping.periodKind,
    derivedKind: mapping.derivedKind,
    sourceCell: mapping.a1,
    ...classifyModeCell(mapping.mode, matrix?.[mapping.rowIndex]?.[mapping.columnIndex]),
  };
}

function snapshotTotalCell(mapping, matrix) {
  const totalClassified = classifyModeCell(mapping.mode, matrix?.[mapping.rowIndex]?.[mapping.columnIndex]);
  return {
    mode: mapping.mode,
    kind: mapping.kind,
    lineId: mapping.lineId,
    direction: mapping.direction,
    derivedKind: mapping.derivedKind,
    sourceCell: mapping.a1,
    ...totalClassified,
  };
}

function compareCells(left, right) {
  return String(left.mode).localeCompare(String(right.mode))
    || String(left.yearMonth).localeCompare(String(right.yearMonth))
    || Number(left.weekNo) - Number(right.weekNo)
    || String(left.lineId).localeCompare(String(right.lineId));
}

function compareAnnualCells(left, right) {
  return Number(left.year) - Number(right.year)
    || String(left.mode).localeCompare(String(right.mode))
    || String(left.lineId).localeCompare(String(right.lineId));
}

function annualCoverage(cells, source) {
  const weeks = new Set();
  const months = new Set();
  for (const cell of cells) {
    const yearMonth = normalizedText(cell?.yearMonth);
    const weekNo = Number(cell?.weekNo);
    if (!yearMonth || !Number.isSafeInteger(weekNo)) continue;
    months.add(yearMonth);
    weeks.add(`${yearMonth}:${weekNo}`);
  }
  return {
    status: source === 'WEEKLY'
      ? (weeks.size === 60 && months.size === 12 ? 'COMPLETE' : 'PARTIAL')
      : source === 'ANNUAL' ? 'ANNUAL_ONLY' : 'NONE',
    weekCount: weeks.size,
    expectedWeekCount: 60,
    monthCount: months.size,
    expectedMonthCount: 12,
  };
}

function addWholeWon(left, right) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new RangeError('Cashflow annual total exceeds the safe whole-won range.');
  return sum;
}

function summarizeAnnualMode(cells, source) {
  const lineAmounts = {};
  let totalIn = 0;
  let totalOut = 0;
  let valueCellCount = 0;
  let emptyCellCount = 0;
  let invalidCellCount = 0;
  for (const cell of cells) {
    if (cell.state === 'EMPTY') {
      emptyCellCount += 1;
      continue;
    }
    if (cell.state === 'INVALID') {
      invalidCellCount += 1;
      continue;
    }
    const amount = Number(cell.amount);
    if (!Number.isSafeInteger(amount)) {
      invalidCellCount += 1;
      continue;
    }
    valueCellCount += 1;
    lineAmounts[cell.lineId] = addWholeWon(lineAmounts[cell.lineId] || 0, amount);
    if (cell.direction === 'IN') totalIn = addWholeWon(totalIn, amount);
    if (cell.direction === 'OUT') totalOut = addWholeWon(totalOut, amount);
  }
  return {
    source,
    coverage: annualCoverage(cells, source),
    valueCellCount,
    emptyCellCount,
    invalidCellCount,
    lineAmounts,
    totalIn,
    totalOut,
    net: addWholeWon(totalIn, -totalOut),
  };
}

const DERIVED_FIELD_BY_KIND = {
  deposit_total: 'depositTotal',
  withdrawal_total: 'withdrawalTotal',
  balance: 'balance',
};

// 연 단위 연도의 합계는 시트 합계 행 좌표(입금 합계 / 출금 합계 / 잔액)에서 읽는다.
// 좌표 칸이 금액을 담고 있지 않으면 값이 없는 것이며, 라인 합으로 대체하지 않는다.
function declaredAnnualTotals(annualDerivedCells, year, mode) {
  const result = { depositTotal: null, withdrawalTotal: null, balance: null };
  for (const [kind, field] of Object.entries(DERIVED_FIELD_BY_KIND)) {
    const cell = annualDerivedCells.find((candidate) => (
      Number(candidate?.year) === year
      && candidate?.mode === mode
      && candidate?.derivedKind === kind
    ));
    if (!['VALUE', 'ZERO'].includes(cell?.state) || !Number.isSafeInteger(Number(cell.amount))) continue;
    result[field] = Number(cell.amount);
  }
  return result;
}

// 좌표 계약상 한 연도가 주별과 연간을 겸할 수 없으므로 둘을 대조할 일이 없다.
const NO_RECONCILIATION = Object.freeze({ status: 'NOT_APPLICABLE', mismatchedLineIds: [] });

export function buildAnnualCashflowTotals({ cells = [], annualCells = [], annualDerivedCells = [], weeklyYear }) {
  const year0 = requireWeeklyYear(weeklyYear);
  const years = [...annualYearsFor(year0), year0].sort((left, right) => left - right);
  return years
    .map((year) => {
      const modeTotals = {};
      for (const mode of ['projection', 'actual']) {
        if (year === year0) {
          // 주별 연도: 주차 그리드가 그 해의 유일한 소스. 연간 열이 존재하지 않는다.
          modeTotals[mode] = {
            ...summarizeAnnualMode(
              cells.filter((cell) => cell.mode === mode && weekOrdinal(year0, cell?.yearMonth, cell?.weekNo) !== -1),
              'WEEKLY',
            ),
            reconciliation: NO_RECONCILIATION,
          };
          continue;
        }
        // 연 단위 연도: 연간 열 좌표가 유일한 소스. 주차 셀은 보지 않는다.
        const annual = summarizeAnnualMode(
          annualCells.filter((cell) => cell.mode === mode && Number(cell.year) === year && cell?.periodKind !== 'GRAND_TOTAL'),
          'ANNUAL',
        );
        const declared = declaredAnnualTotals(annualDerivedCells, year, mode);
        modeTotals[mode] = {
          ...annual,
          totalIn: declared.depositTotal,
          totalOut: declared.withdrawalTotal,
          net: declared.balance,
          reconciliation: NO_RECONCILIATION,
        };
      }
      return { year, ...modeTotals };
    });
}

function buildCashflowSheetTotal(totalCells, mode) {
  const lineAmounts = {};
  const lineStates = {};
  for (const cell of totalCells.filter((candidate) => candidate.mode === mode && candidate.kind === 'line' && candidate.lineId)) {
    lineStates[cell.lineId] = cell.state;
    if (cell.state === 'VALUE' || cell.state === 'ZERO') lineAmounts[cell.lineId] = Number(cell.amount || 0);
  }
  const derivedAmount = (kind, fallback) => {
    const cell = totalCells.find((candidate) => candidate.mode === mode && candidate.kind === 'derived' && candidate.derivedKind === kind);
    return cell?.state === 'VALUE' || cell?.state === 'ZERO' ? Number(cell.amount || 0) : fallback;
  };
  const computedIn = Object.entries(lineAmounts)
    .filter(([lineId]) => /^.+_IN$/.test(lineId))
    .reduce((sum, [, amount]) => sum + Number(amount || 0), 0);
  const computedOut = Object.entries(lineAmounts)
    .filter(([lineId]) => /^.+_OUT$/.test(lineId))
    .reduce((sum, [, amount]) => sum + Number(amount || 0), 0);
  const totalIn = derivedAmount('deposit_total', computedIn);
  const totalOut = derivedAmount('withdrawal_total', computedOut);
  return {
    lineAmounts,
    lineStates,
    totalIn,
    totalOut,
    net: derivedAmount('balance', totalIn - totalOut),
  };
}

function matrixValue(matrix, rowIndex, columnIndex) {
  return normalizedText(matrix?.[rowIndex]?.[columnIndex]);
}

function normalizeDateCell(value) {
  const raw = normalizedText(value);
  if (!raw) return '';
  const match = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function readWholeWon(
  matrix,
  rowIndex,
  columnIndex,
  issues,
  field,
  { allowEmpty = true, emptyValue = null, nonNegative = false } = {},
) {
  const sourceCell = toA1(rowIndex, columnIndex);
  const classified = classifyCashflowSheetCell(matrix?.[rowIndex]?.[columnIndex]);
  if (classified.state === 'EMPTY') {
    if (!allowEmpty) issues.push({ code: 'control_total_missing', field, sourceCell });
    return emptyValue;
  }
  if (
    classified.state !== 'VALUE'
    || !Number.isSafeInteger(classified.amount)
    || (nonNegative && classified.amount < 0)
  ) {
    issues.push({ code: 'sheet_value_invalid', field, sourceCell, rawValue: classified.rawValue || matrixValue(matrix, rowIndex, columnIndex) });
    return null;
  }
  return classified.amount;
}

function readComputedWholeWon(matrix, rowIndex, columnIndex, emptyValue = null) {
  const classified = classifyCashflowSheetCell(matrix?.[rowIndex]?.[columnIndex]);
  if (classified.state === 'EMPTY') return emptyValue;
  if (classified.state !== 'VALUE' || !Number.isSafeInteger(classified.amount)) return null;
  return classified.amount;
}

function buildWeeklyCalculationChecks({ template, matrix }) {
  return (template?.sections || []).flatMap((section) => {
    const lineRows = Array.isArray(section?.lineRows) ? section.lineRows : [];
    const derivedRows = Array.isArray(section?.derivedRows) ? section.derivedRows : [];
    const derivedByKind = new Map(derivedRows.map((row) => [row.kind, row]));
    if (
      !['deposit_total', 'withdrawal_total', 'balance'].every((kind) => derivedByKind.has(kind))
      || lineRows.some((row) => row.direction !== 'IN' && row.direction !== 'OUT')
    ) return [];
    const firstYear = Number(String(section?.weekColumns?.[0]?.yearMonth || '').slice(0, 4));
    const openingColumn = (section?.annualColumns || [])
      .filter((column) => Number(column?.year) < firstYear)
      .sort((left, right) => Number(right.year) - Number(left.year))[0];
    let priorBalance = openingColumn
      ? readComputedWholeWon(matrix, derivedByKind.get('balance').rowIndex, openingColumn.columnIndex, 0)
      : 0;
    return (section?.weekColumns || []).map((week) => {
      const amounts = lineRows.map((row) => ({
        direction: row.direction,
        amount: readComputedWholeWon(matrix, row.rowIndex, week.columnIndex, 0),
      }));
      const totalFor = (direction) => {
        const values = amounts.filter((row) => row.direction === direction).map((row) => row.amount);
        if (values.some((amount) => amount === null)) return null;
        try {
          return values.reduce((sum, amount) => addWholeWon(sum, amount), 0);
        } catch {
          return null;
        }
      };
      const depositTotal = readComputedWholeWon(matrix, derivedByKind.get('deposit_total')?.rowIndex, week.columnIndex);
      const withdrawalTotal = readComputedWholeWon(matrix, derivedByKind.get('withdrawal_total')?.rowIndex, week.columnIndex);
      const balance = readComputedWholeWon(matrix, derivedByKind.get('balance')?.rowIndex, week.columnIndex);
      const computedDepositTotal = totalFor('IN');
      const computedWithdrawalTotal = totalFor('OUT');
      let computedBalance = null;
      if (priorBalance !== null && computedDepositTotal !== null && computedWithdrawalTotal !== null) {
        try {
          computedBalance = addWholeWon(priorBalance, addWholeWon(computedDepositTotal, -computedWithdrawalTotal));
        } catch {
          computedBalance = null;
        }
      }
      const result = {
        mode: section.mode,
        yearMonth: week.yearMonth,
        weekNo: week.weekNo,
        reported: { openingBalance: priorBalance, depositTotal, withdrawalTotal, balance },
        sourceCells: {
          depositTotal: toA1(derivedByKind.get('deposit_total')?.rowIndex, week.columnIndex),
          withdrawalTotal: toA1(derivedByKind.get('withdrawal_total')?.rowIndex, week.columnIndex),
          balance: toA1(derivedByKind.get('balance')?.rowIndex, week.columnIndex),
          openingBalance: openingColumn ? toA1(derivedByKind.get('balance').rowIndex, openingColumn.columnIndex) : '',
        },
        matches: {
          depositTotal: depositTotal === null || computedDepositTotal === null ? null : depositTotal === computedDepositTotal,
          withdrawalTotal: withdrawalTotal === null || computedWithdrawalTotal === null ? null : withdrawalTotal === computedWithdrawalTotal,
          balance: balance === null || computedBalance === null ? null : balance === computedBalance,
        },
      };
      priorBalance = balance;
      return result;
    });
  });
}

function controlRow({ matrix, row, weekColumns, issues, controlColumnIndex }) {
  const field = `${row.kind}:${row.lineId || row.derivedKind}`;
  const amounts = weekColumns.map((week) => readWholeWon(
    matrix,
    row.rowIndex,
    week.columnIndex,
    issues,
    `${field}:${week.yearMonth}:${week.weekNo}`,
    { emptyValue: 0 },
  ));
  const computed = amounts.some((amount) => amount === null)
    ? null
    : amounts.reduce((sum, amount) => sum + amount, 0);
  const value = controlColumnIndex === null
    ? null
    : readWholeWon(matrix, row.rowIndex, controlColumnIndex, issues, field, { allowEmpty: false });
  const annualValues = new Map();
  for (let index = 0; index < weekColumns.length; index += 1) {
    const year = Number(String(weekColumns[index].yearMonth).slice(0, 4));
    if (!Number.isSafeInteger(year)) continue;
    annualValues.set(year, (annualValues.get(year) || 0) + (amounts[index] || 0));
  }
  return {
    kind: row.kind,
    ...(row.lineId ? { lineId: row.lineId } : { derivedKind: row.derivedKind }),
    sourceCell: controlColumnIndex === null ? '' : toA1(row.rowIndex, controlColumnIndex),
    value,
    computed,
    matches: value === null || computed === null ? null : value === computed,
    annualValues: [...annualValues.entries()]
      .sort(([left], [right]) => left - right)
      .map(([year, annualValue]) => ({ year, value: annualValue })),
  };
}

function annualSheetFinancialTotals({ depositScheduleRows, projectionControls }) {
  const years = new Set(depositScheduleRows.map((row) => Number(String(row.yearMonth).slice(0, 4))));
  for (const control of projectionControls) {
    for (const annualValue of control.annualValues || []) years.add(annualValue.year);
  }
  const annualValue = (lineId, year) => (
    projectionControls.find((control) => control.lineId === lineId)?.annualValues
      ?.find((value) => value.year === year)?.value || 0
  );
  return [...years]
    .filter(Number.isSafeInteger)
    .sort((left, right) => left - right)
    .map((year) => ({
      year,
      contractAmount: depositScheduleRows
        .filter((row) => Number(String(row.yearMonth).slice(0, 4)) === year)
        .reduce((sum, row) => sum + (row.expectedDepositAmount || 0), 0),
      salesVatAmount: annualValue('SALES_VAT_IN', year),
      totalRevenueAmount: annualValue('MYSC_PROFIT_OUT', year),
      supportAmount: annualValue('TEAM_SUPPORT_IN', year),
    }));
}

export function extractCashflowSheetFacts({
  template = {}, matrix = [], cells = [], annualCells = [], annualDerivedCells = [], totalCells = [], weeklyYear,
} = {}) {
  const issues = [];
  const projectionSection = template?.sections?.find((section) => section.mode === 'projection');
  const weekColumns = (projectionSection?.weekColumns || [])
    .sort((left, right) => left.yearMonth.localeCompare(right.yearMonth) || left.weekNo - right.weekNo);
  const depositControlColumnIndex = 70; // BS
  const unpaidControlColumnIndex = 71; // BT
  const depositScheduleRows = weekColumns.map((week) => {
    const taxInvoiceIssuedDate = normalizeDateCell(matrix?.[6]?.[week.columnIndex]);
    const expectedDepositDate = normalizeDateCell(matrix?.[7]?.[week.columnIndex]);
    if (taxInvoiceIssuedDate === null) {
      issues.push({ code: 'sheet_date_invalid', field: 'taxInvoiceIssuedDate', sourceCell: toA1(6, week.columnIndex) });
    }
    if (expectedDepositDate === null) {
      issues.push({ code: 'sheet_date_invalid', field: 'expectedDepositDate', sourceCell: toA1(7, week.columnIndex) });
    }
    return {
      yearMonth: week.yearMonth,
      weekNo: week.weekNo,
      taxInvoiceIssuedDate: taxInvoiceIssuedDate ?? '',
      expectedDepositDate: expectedDepositDate ?? '',
      expectedDepositAmount: readWholeWon(
        matrix,
        8,
        week.columnIndex,
        issues,
        `expectedDepositAmount:${week.yearMonth}:${week.weekNo}`,
        { nonNegative: true },
      ),
      sourceCells: {
        taxInvoiceIssuedDate: toA1(6, week.columnIndex),
        expectedDepositDate: toA1(7, week.columnIndex),
        expectedDepositAmount: toA1(8, week.columnIndex),
      },
    };
  });

  const controlRows = (section) => [
    ...(section?.lineRows || []).map((row) => ({ ...row, kind: 'line' })),
    ...(section?.derivedRows || []).map((row) => ({ ...row, kind: 'derived', derivedKind: row.kind })),
  ].sort((left, right) => left.rowIndex - right.rowIndex);
  const modeControls = (mode) => {
    const section = template?.sections?.find((candidate) => candidate.mode === mode);
    const columns = section?.weekColumns || [];
    return controlRows(section).map((row) => controlRow({
      matrix,
      row,
      weekColumns: columns,
      issues,
      controlColumnIndex: depositControlColumnIndex,
    }));
  };
  const depositValues = weekColumns.map((week) => readWholeWon(
    matrix,
    8,
    week.columnIndex,
    issues,
    `depositControl:${week.yearMonth}:${week.weekNo}`,
    { emptyValue: 0, nonNegative: true },
  ));
  const depositComputed = depositValues.some((amount) => amount === null)
    ? null
    : depositValues.reduce((sum, amount) => sum + amount, 0);
  const depositValue = depositControlColumnIndex === null
    ? null
    : readWholeWon(matrix, 8, depositControlColumnIndex, issues, 'depositControl', { allowEmpty: false, nonNegative: true });

  const projectionControls = modeControls('projection');
  const actualControls = modeControls('actual');
  const weeklyCalculationChecks = buildWeeklyCalculationChecks({ template, matrix });
  // 표준 관리시트의 Projection–Actual 차이 행(A11:BS11)은 별도 수식 결과다.
  // 화면에서 Projection과 Actual을 다시 빼지 않고 이 고정값을 그대로 사용한다.
  const projectionActualDifferences = weekColumns.map((week) => ({
    yearMonth: week.yearMonth,
    weekNo: week.weekNo,
    amount: readComputedWholeWon(matrix, 10, week.columnIndex),
    sourceCell: toA1(10, week.columnIndex),
  }));

  return {
    metadata: {
      lastUpdateText: { sourceCell: 'B1', value: matrixValue(matrix, 0, 1) },
      businessType: { sourceCell: 'B2', value: matrixValue(matrix, 1, 1) },
      accountType: { sourceCell: 'B3', value: matrixValue(matrix, 2, 1) },
      settlementStatus: { sourceCell: 'B4', value: matrixValue(matrix, 3, 1) },
    },
    depositScheduleRows,
    annualFinancialTotals: annualSheetFinancialTotals({ depositScheduleRows, projectionControls }),
    annualCashflowTotals: cells.length || annualCells.length || annualDerivedCells.length
      ? buildAnnualCashflowTotals({ cells, annualCells, annualDerivedCells, weeklyYear })
      : [],
    ...(weeklyCalculationChecks.length > 0 ? { weeklyCalculationChecks } : {}),
    ...(projectionActualDifferences.some((value) => value.amount !== null) ? { projectionActualDifferences } : {}),
    cashflowGrandTotals: {
      projection: buildCashflowSheetTotal(totalCells, 'projection'),
      actual: buildCashflowSheetTotal(totalCells, 'actual'),
    },
    controlTotals: {
      deposit: {
        sourceCell: depositControlColumnIndex === null ? '' : toA1(8, depositControlColumnIndex),
        value: depositValue,
        computed: depositComputed,
        matches: depositValue === null || depositComputed === null ? null : depositValue === depositComputed,
      },
      unpaid: {
        sourceCell: unpaidControlColumnIndex === null ? '' : toA1(8, unpaidControlColumnIndex),
        value: unpaidControlColumnIndex === null ? null : readWholeWon(matrix, 8, unpaidControlColumnIndex, issues, 'unpaidControl'),
      },
      projection: projectionControls,
      actual: actualControls,
    },
    issues,
  };
}

export function createCashflowPinnedSnapshot({
  projectId,
  spreadsheetId,
  spreadsheetTitle,
  selectedSheetName,
  mappings = [],
  matrix = [],
  template = {},
  targetSnapshot = {},
  capturedAt,
  capturedBy = {},
} = {}) {
  const cells = mappings.map((mapping) => snapshotCell(mapping, matrix)).sort(compareCells);
  const annualCells = (template?.sections || [])
    .flatMap((section) => section.annualMappings || [])
    .map((mapping) => snapshotAnnualCell(mapping, matrix))
    .sort(compareAnnualCells);
  const annualDerivedCells = (template?.sections || [])
    .flatMap((section) => section.annualDerivedMappings || [])
    .map((mapping) => snapshotAnnualDerivedCell(mapping, matrix))
    .sort((left, right) => Number(left.year) - Number(right.year)
      || String(left.mode).localeCompare(String(right.mode))
      || String(left.derivedKind).localeCompare(String(right.derivedKind)));
  const totalCells = (template?.sections || [])
    .flatMap((section) => section.totalMappings || [])
    .map((mapping) => snapshotTotalCell(mapping, matrix))
    .sort((left, right) => String(left.mode).localeCompare(String(right.mode))
      || String(left.kind).localeCompare(String(right.kind))
      || String(left.lineId || left.derivedKind || '').localeCompare(String(right.lineId || right.derivedKind || '')));
  const weeklyYear = template?.sections?.flatMap((section) => section.weekColumns || [])[0]?.year
    ?? Number(String(mappings[0]?.yearMonth || '').slice(0, 4));
  const sheetFacts = extractCashflowSheetFacts({
    template, matrix, cells, annualCells, annualDerivedCells, totalCells, weeklyYear,
  });
  const sourceRevision = revisionOf({ spreadsheetId, selectedSheetName, cells, annualCells, annualDerivedCells, totalCells, sheetFacts });
  const summary = cells.reduce((counts, cell) => {
    counts.cellCount += 1;
    if (cell.state === 'VALUE' || cell.state === 'ZERO') counts.valueCount += 1;
    if (cell.state === 'EMPTY') counts.emptyCount += 1;
    if (cell.state === 'INVALID') counts.invalidCount += 1;
    return counts;
  }, { cellCount: 0, valueCount: 0, emptyCount: 0, invalidCount: 0 });

  return {
    schemaVersion: 1,
    projectId,
    spreadsheetId,
    spreadsheetTitle,
    selectedSheetName,
    status: 'FRESH',
    sourceRevision,
    targetRevisionAtFetch: computeCashflowTargetRevision(targetSnapshot),
    capturedAt,
    capturedBy: {
      uid: String(capturedBy?.uid || ''),
      email: String(capturedBy?.email || ''),
      role: String(capturedBy?.role || ''),
    },
    yearMonths: [...new Set(cells.map((cell) => cell.yearMonth))].sort(),
    years: [...new Set([
      ...cells.map((cell) => Number(String(cell.yearMonth).slice(0, 4))),
      ...annualCells.map((cell) => cell.year),
    ].filter(Number.isSafeInteger))].sort((left, right) => left - right),
    summary,
    cells,
    annualCells,
    annualDerivedCells,
    totalCells,
    sheetFacts,
  };
}
