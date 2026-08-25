import ExcelJS from 'exceljs';
import { getMonthFinanceWeeks } from '../../src/app/platform/cashflow-week-core.mjs';
import {
  CASHFLOW_ALL_LINES,
  CASHFLOW_IN_LINES,
  CASHFLOW_OUT_LINES,
  getCashflowLineLabel,
} from './cashflow-policy.mjs';

function normalizeSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isYearMonth(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}$/.test(trimmed)) return false;
  const [, mmRaw] = trimmed.split('-');
  const month = Number.parseInt(mmRaw, 10);
  return Number.isFinite(month) && month >= 1 && month <= 12;
}

function parseYearMonth(value) {
  if (!isYearMonth(value)) return null;
  const [yearRaw, monthRaw] = value.trim().split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return { year, month };
}

function formatYearMonth(year, month) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function formatWeekLabel(yearMonth, weekNo) {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return `${yearMonth}-w${weekNo}`;
  return `${String(parsed.year % 100).padStart(2, '0')}-${parsed.month}-${weekNo}`;
}

function formatMonthTotalLabel(yearMonth) {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return `${yearMonth}-Total`;
  return `${String(parsed.year % 100).padStart(2, '0')}-${parsed.month}-Total`;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function getMonthWeeks(yearMonth) {
  return getMonthFinanceWeeks(yearMonth);
}

export function expandCashflowYearMonthRange(startYearMonth, endYearMonth) {
  const start = parseYearMonth(startYearMonth);
  const end = parseYearMonth(endYearMonth);
  if (!start || !end) return [];
  const startValue = start.year * 12 + (start.month - 1);
  const endValue = end.year * 12 + (end.month - 1);
  const low = Math.min(startValue, endValue);
  const high = Math.max(startValue, endValue);
  const yearMonths = [];
  for (let value = low; value <= high; value += 1) {
    const year = Math.floor(value / 12);
    const month = (value % 12) + 1;
    yearMonths.push(formatYearMonth(year, month));
  }
  return yearMonths;
}

function summarizeCashflowYearMonths(yearMonths) {
  if (!Array.isArray(yearMonths) || yearMonths.length === 0) return '';
  if (yearMonths.length === 1) return yearMonths[0];
  return `${yearMonths[0]} ~ ${yearMonths[yearMonths.length - 1]}`;
}

function buildCashflowWeekSlots(yearMonth) {
  const actualWeeks = new Map();
  for (const week of getMonthWeeks(yearMonth)) {
    actualWeeks.set(week.weekNo, week);
  }
  const slots = [];
  for (let weekNo = 1; weekNo <= 5; weekNo += 1) {
    const actual = actualWeeks.get(weekNo);
    slots.push({
      yearMonth,
      weekNo,
      weekStart: actual?.weekStart || '',
      weekEnd: actual?.weekEnd || '',
      label: actual?.label || formatWeekLabel(yearMonth, weekNo),
      present: Boolean(actual),
    });
  }
  return slots;
}

function computeCashflowTotals(sheet = {}) {
  const totalIn = CASHFLOW_IN_LINES.reduce((acc, id) => acc + (Number(sheet[id]) || 0), 0);
  const totalOut = CASHFLOW_OUT_LINES.reduce((acc, id) => acc + (Number(sheet[id]) || 0), 0);
  return { totalIn, totalOut, net: totalIn - totalOut };
}

function normalizeProjectLabel(project) {
  return normalizeSpace(project.shortName || project.name || project.id) || project.id;
}

function normalizeProjectTitle(project) {
  return normalizeSpace(project.name || project.shortName || project.id) || project.id;
}

function getPreferredWeekSheet(current, next) {
  if (!current) return next;
  const currentScore = `${current.updatedAt || ''}|${current.createdAt || ''}|${current.id || ''}`;
  const nextScore = `${next.updatedAt || ''}|${next.createdAt || ''}|${next.id || ''}`;
  return nextScore > currentScore ? next : current;
}

function indexProjectWeeks(project) {
  const byYearMonth = new Map();
  for (const week of project.weeks || []) {
    if (week.projectId !== project.id) continue;
    if (!isYearMonth(week.yearMonth)) continue;
    const weekNo = Math.max(1, Math.min(5, Math.trunc(week.weekNo)));
    const monthMap = byYearMonth.get(week.yearMonth) || new Map();
    monthMap.set(weekNo, getPreferredWeekSheet(monthMap.get(weekNo), week));
    byYearMonth.set(week.yearMonth, monthMap);
  }
  return byYearMonth;
}

function getWeekAmounts(week, mode) {
  const source = mode === 'projection' ? week?.projection : week?.actual;
  const amounts = {};
  for (const lineId of CASHFLOW_ALL_LINES) {
    amounts[lineId] = Number(source?.[lineId] || 0);
  }
  return amounts;
}

function buildModeSectionRows({ yearMonth, mode, slots, weeksByWeekNo }) {
  const modeLabel = mode === 'projection' ? 'Projection' : 'Actual';
  const slotAmounts = slots.map((slot) => getWeekAmounts(weeksByWeekNo.get(slot.weekNo), mode));
  const weekTotals = slotAmounts.map((amounts) => computeCashflowTotals(amounts));
  const rows = [];
  rows.push(['항목', ...slots.map((slot) => slot.label), formatMonthTotalLabel(yearMonth)]);
  rows.push([`입금 (${modeLabel})`, ...Array(slots.length + 1).fill('')]);
  for (const lineId of CASHFLOW_IN_LINES) {
    const values = slotAmounts.map((amounts) => Number(amounts[lineId]) || 0);
    rows.push([getCashflowLineLabel(lineId), ...values, sum(values)]);
  }
  const inTotals = weekTotals.map((week) => week.totalIn);
  rows.push(['입금 합계', ...inTotals, sum(inTotals)]);
  rows.push([`출금 (${modeLabel})`, ...Array(slots.length + 1).fill('')]);
  for (const lineId of CASHFLOW_OUT_LINES) {
    const values = slotAmounts.map((amounts) => Number(amounts[lineId]) || 0);
    rows.push([getCashflowLineLabel(lineId), ...values, sum(values)]);
  }
  const outTotals = weekTotals.map((week) => week.totalOut);
  const netTotals = weekTotals.map((week) => week.net);
  rows.push(['출금 합계', ...outTotals, sum(outTotals)]);
  rows.push(['잔액', ...netTotals, sum(netTotals)]);
  return rows;
}

function buildWideModeSectionRows({ yearMonths, mode, weekIndex }) {
  const modeLabel = mode === 'projection' ? 'Projection' : 'Actual';
  const monthColumns = yearMonths.map((yearMonth) => {
    const slots = buildCashflowWeekSlots(yearMonth);
    const weeksByWeekNo = weekIndex.get(yearMonth) || new Map();
    const slotAmounts = slots.map((slot) => getWeekAmounts(weeksByWeekNo.get(slot.weekNo), mode));
    const weekTotals = slotAmounts.map((amounts) => computeCashflowTotals(amounts));
    return {
      yearMonth,
      slots,
      slotAmounts,
      weekTotals,
    };
  });

  const headerRow = ['항목'];
  for (const month of monthColumns) {
    for (const slot of month.slots) {
      headerRow.push(slot.label);
    }
    headerRow.push(formatMonthTotalLabel(month.yearMonth));
  }

  const rows = [];
  rows.push(headerRow);
  rows.push([`입금 (${modeLabel})`, ...Array(headerRow.length - 1).fill('')]);
  for (const lineId of CASHFLOW_IN_LINES) {
    const row = [getCashflowLineLabel(lineId)];
    for (const month of monthColumns) {
      const values = month.slotAmounts.map((amounts) => Number(amounts[lineId]) || 0);
      row.push(...values, sum(values));
    }
    rows.push(row);
  }
  const inTotalRow = ['입금 합계'];
  for (const month of monthColumns) {
    const values = month.weekTotals.map((week) => week.totalIn);
    inTotalRow.push(...values, sum(values));
  }
  rows.push(inTotalRow);
  rows.push([`출금 (${modeLabel})`, ...Array(headerRow.length - 1).fill('')]);
  for (const lineId of CASHFLOW_OUT_LINES) {
    const row = [getCashflowLineLabel(lineId)];
    for (const month of monthColumns) {
      const values = month.slotAmounts.map((amounts) => Number(amounts[lineId]) || 0);
      row.push(...values, sum(values));
    }
    rows.push(row);
  }
  const outTotalRow = ['출금 합계'];
  for (const month of monthColumns) {
    const values = month.weekTotals.map((week) => week.totalOut);
    outTotalRow.push(...values, sum(values));
  }
  rows.push(outTotalRow);
  const netRow = ['잔액'];
  for (const month of monthColumns) {
    const values = month.weekTotals.map((week) => week.net);
    netRow.push(...values, sum(values));
  }
  rows.push(netRow);
  return rows;
}

function buildProjectWorkbookRows({ project, yearMonths, includeBothModes, mode }) {
  const rows = [];
  const projectTitle = normalizeProjectTitle(project);
  const projectLabel = normalizeProjectLabel(project);
  const weekIndex = indexProjectWeeks(project);
  const transactionCount = project.transactions?.length || 0;
  rows.push(['사업', projectTitle, '사업 ID', project.id, '거래 수', transactionCount]);
  if (projectLabel !== projectTitle) {
    rows.push(['표시명', projectLabel]);
  }
  if (yearMonths.length > 1) {
    rows.push(...buildWideModeSectionRows({
      yearMonths,
      mode: includeBothModes ? 'projection' : (mode || 'projection'),
      weekIndex,
    }));
    if (includeBothModes) {
      rows.push([]);
      rows.push(...buildWideModeSectionRows({ yearMonths, mode: 'actual', weekIndex }));
    }
    return rows;
  }
  for (const yearMonth of yearMonths) {
    const slots = buildCashflowWeekSlots(yearMonth);
    const monthWeeks = weekIndex.get(yearMonth) || new Map();
    rows.push(...buildModeSectionRows({
      yearMonth,
      mode: includeBothModes ? 'projection' : (mode || 'projection'),
      slots,
      weeksByWeekNo: monthWeeks,
    }));
    if (includeBothModes) {
      rows.push([]);
      rows.push(...buildModeSectionRows({ yearMonth, mode: 'actual', slots, weeksByWeekNo: monthWeeks }));
    }
  }
  return rows;
}

function makeUniqueSheetName(baseName, usedNames) {
  const cleaned = normalizeSpace(baseName).replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const base = (cleaned || 'Sheet').slice(0, 31);
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  for (let i = 2; i < 100; i += 1) {
    const suffix = ` (${i})`;
    const candidate = `${base.slice(0, Math.max(0, 31 - suffix.length))}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  const fallback = `${base.slice(0, 27)}-dup`;
  usedNames.add(fallback);
  return fallback.slice(0, 31);
}

function compareProjects(left, right, sortBy) {
  if (sortBy === 'DEPARTMENT') {
    const departmentOrder = normalizeSpace(left.department).localeCompare(normalizeSpace(right.department), 'ko');
    if (departmentOrder) return departmentOrder;
  }
  const leftTitle = normalizeProjectTitle(left);
  const rightTitle = normalizeProjectTitle(right);
  if (leftTitle !== rightTitle) return leftTitle.localeCompare(rightTitle, 'ko');
  return String(left.id || '').localeCompare(String(right.id || ''));
}

function buildWorkbookSpec({ projects, yearMonths, variant, sortBy = 'PROJECT_NAME', scope = 'all' }) {
  if (variant === 'single-project') {
    const project = projects[0];
    if (!project) return { sheets: [] };
    return {
      sheets: [
        { name: 'Projection', rows: buildProjectWorkbookRows({ project, yearMonths, includeBothModes: false, mode: 'projection' }) },
        { name: 'Actual', rows: buildProjectWorkbookRows({ project, yearMonths, includeBothModes: false, mode: 'actual' }) },
      ],
    };
  }
  if (variant === 'combined') {
    const rows = [];
    const sortedProjects = [...projects].sort((left, right) => compareProjects(left, right, sortBy));
    for (const project of sortedProjects) {
      rows.push(...buildProjectWorkbookRows({ project, yearMonths, includeBothModes: true }));
      rows.push([]);
    }
    return { sheets: [{ name: scope === 'selected' ? '선택 사업' : '전체 사업', rows }] };
  }
  const usedNames = new Set();
  const sortedProjects = [...projects].sort((left, right) => compareProjects(left, right, sortBy));
  return {
    sheets: sortedProjects.map((project) => ({
      name: makeUniqueSheetName(normalizeProjectLabel(project), usedNames),
      rows: buildProjectWorkbookRows({ project, yearMonths, includeBothModes: true }),
    })),
  };
}

export function buildCashflowExportFileName({ scope, projectName, yearMonths, variant }) {
  const period = summarizeCashflowYearMonths(yearMonths).replace(/\s+/g, '');
  if (scope === 'single') {
    return `캐시플로_추출_${normalizeSpace(projectName || '단일사업')}_${period || '기간미지정'}.xlsx`;
  }
  const scopeLabel = scope === 'selected' ? '선택사업' : '전체사업';
  const suffix = variant === 'combined' ? `${scopeLabel}_통합시트` : `${scopeLabel}_개별시트`;
  return `캐시플로_추출_${suffix}_${period || '기간미지정'}.xlsx`;
}

function applyCashflowWorksheetFormat(worksheet) {
  worksheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];
  worksheet.properties.defaultRowHeight = 20;
  worksheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  worksheet.getColumn(1).width = 24;
  for (let columnIndex = 2; columnIndex <= worksheet.columnCount; columnIndex += 1) {
    worksheet.getColumn(columnIndex).width = 14;
  }

  worksheet.eachRow((row, rowNumber) => {
    const label = normalizeSpace(row.getCell(1).value);
    const isMetadata = rowNumber === 1 || label === '표시명';
    const isHeader = label === '항목';
    const isSection = label.startsWith('입금 (') || label.startsWith('출금 (');
    const isSummary = ['입금 합계', '출금 합계', '잔액'].includes(label);

    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.alignment = { vertical: 'middle', horizontal: columnNumber === 1 ? 'left' : 'right' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFF1F5F9' } },
      };
      if (columnNumber > 1 && typeof cell.value === 'number') {
        cell.numFmt = '#,##0;[Red]-#,##0;–';
      }
      if (isMetadata) {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF001E46' } };
      } else if (isHeader) {
        cell.font = { bold: true, color: { argb: 'FF17324D' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF0F5' } };
      } else if (isSection) {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: label.startsWith('입금') ? 'FF0F766E' : 'FF475569' } };
      } else if (isSummary) {
        cell.font = { bold: true, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: label === '잔액' ? 'FFFDE68A' : 'FFF8FAFC' } };
      }
    });
  });
}

export async function buildCashflowExportWorkbookBuffer({
  projects,
  yearMonths,
  variant,
  sortBy = 'PROJECT_NAME',
  scope = 'all',
}) {
  const workbookSpec = buildWorkbookSpec({ projects, yearMonths, variant, sortBy, scope });
  const workbook = new ExcelJS.Workbook();
  for (const sheet of workbookSpec.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    sheet.rows.forEach((row) => worksheet.addRow(row));
    applyCashflowWorksheetFormat(worksheet);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
