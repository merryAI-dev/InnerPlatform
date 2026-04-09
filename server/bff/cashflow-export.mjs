import ExcelJS from 'exceljs';

const CASHFLOW_IN_LINES = [
  'MYSC_PREPAY_IN',
  'SALES_IN',
  'SALES_VAT_IN',
  'TEAM_SUPPORT_IN',
  'BANK_INTEREST_IN',
];

const CASHFLOW_OUT_LINES = [
  'DIRECT_COST_OUT',
  'INPUT_VAT_OUT',
  'MYSC_LABOR_OUT',
  'MYSC_PROFIT_OUT',
  'SALES_VAT_OUT',
  'TEAM_SUPPORT_OUT',
  'BANK_INTEREST_OUT',
];

const CASHFLOW_ALL_LINES = [...CASHFLOW_IN_LINES, ...CASHFLOW_OUT_LINES];

const CASHFLOW_SHEET_LINE_LABELS = {
  MYSC_PREPAY_IN: 'MYSC 선입금(잔금 등 입금 필요 시)',
  SALES_IN: '매출액(입금)',
  SALES_VAT_IN: '매출부가세(입금)',
  TEAM_SUPPORT_IN: '팀지원금(입금)',
  BANK_INTEREST_IN: '은행이자(입금)',
  DIRECT_COST_OUT: '직접사업비',
  INPUT_VAT_OUT: '매입부가세',
  MYSC_LABOR_OUT: 'MYSC 인건비',
  MYSC_PROFIT_OUT: 'MYSC 수익(간접비 등)',
  SALES_VAT_OUT: '매출부가세(출금)',
  TEAM_SUPPORT_OUT: '팀지원금(출금)',
  BANK_INTEREST_OUT: '은행이자(출금)',
};

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

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatIsoDate(year, month, day) {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

function addDaysUtc(isoDate, deltaDays) {
  const [yRaw, mRaw, dRaw] = isoDate.split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const base = Date.UTC(year, month - 1, day);
  const next = new Date(base + deltaDays * 24 * 60 * 60 * 1000);
  return formatIsoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function dayOfWeekUtc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysInMonthUtc(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function startOfWeekWednesday(isoDate) {
  const [yRaw, mRaw, dRaw] = isoDate.split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const dow = dayOfWeekUtc(year, month, day);
  const delta = -((dow - 3 + 7) % 7);
  return addDaysUtc(isoDate, delta);
}

function countDaysInMonthForWeek(weekStart, year, month) {
  let count = 0;
  for (let i = 0; i < 7; i += 1) {
    const date = addDaysUtc(weekStart, i);
    const [yy, mm] = date.split('-');
    if (Number.parseInt(yy, 10) === year && Number.parseInt(mm, 10) === month) count += 1;
  }
  return count;
}

function getMonthWeeks(yearMonth) {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return [];
  const { year, month } = parsed;
  const firstDay = formatIsoDate(year, month, 1);
  const lastDay = formatIsoDate(year, month, daysInMonthUtc(year, month));
  let weekStart = startOfWeekWednesday(firstDay);
  const weeks = [];
  const yy = year % 100;
  let weekNo = 0;
  while (weekStart <= lastDay) {
    const daysInMonth = countDaysInMonthForWeek(weekStart, year, month);
    if (daysInMonth >= 4) {
      weekNo += 1;
      const weekEnd = addDaysUtc(weekStart, 6);
      weeks.push({
        yearMonth,
        weekNo,
        weekStart,
        weekEnd,
        label: `${yy}-${month}-${weekNo}`,
      });
    }
    weekStart = addDaysUtc(weekStart, 7);
  }
  return weeks;
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
      label: actual?.label || `${yearMonth}-w${weekNo}`,
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

function createLineTotals() {
  return Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [lineId, 0]));
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
  const rowTotals = createLineTotals();
  for (const lineId of CASHFLOW_ALL_LINES) {
    rowTotals[lineId] = slotAmounts.reduce((acc, amounts) => acc + (Number(amounts[lineId]) || 0), 0);
  }
  const rows = [];
  rows.push([`${yearMonth} · ${modeLabel}`]);
  rows.push(['항목', ...slots.map((slot) => slot.label), '월 합계']);
  rows.push(['기간', ...slots.map((slot) => (slot.present ? `${slot.weekStart} ~ ${slot.weekEnd}` : '')), '']);
  rows.push([]);
  rows.push([`입금 (${modeLabel})`, ...Array(slots.length + 1).fill('')]);
  for (const lineId of CASHFLOW_IN_LINES) {
    const values = slotAmounts.map((amounts) => Number(amounts[lineId]) || 0);
    rows.push([CASHFLOW_SHEET_LINE_LABELS[lineId], ...values, rowTotals[lineId] || 0]);
  }
  rows.push(['입금 합계', ...weekTotals.map((week) => week.totalIn), weekTotals.reduce((acc, week) => acc + week.totalIn, 0)]);
  rows.push([]);
  rows.push([`출금 (${modeLabel})`, ...Array(slots.length + 1).fill('')]);
  for (const lineId of CASHFLOW_OUT_LINES) {
    const values = slotAmounts.map((amounts) => Number(amounts[lineId]) || 0);
    rows.push([CASHFLOW_SHEET_LINE_LABELS[lineId], ...values, rowTotals[lineId] || 0]);
  }
  rows.push(['출금 합계', ...weekTotals.map((week) => week.totalOut), weekTotals.reduce((acc, week) => acc + week.totalOut, 0)]);
  rows.push(['잔액', ...weekTotals.map((week) => week.net), weekTotals.reduce((acc, week) => acc + week.net, 0)]);
  return rows;
}

function buildWideModeSectionRows({ yearMonths, mode, weekIndex }) {
  const modeLabel = mode === 'projection' ? 'Projection' : 'Actual';
  const monthColumns = yearMonths.map((yearMonth) => {
    const slots = buildCashflowWeekSlots(yearMonth);
    const weeksByWeekNo = weekIndex.get(yearMonth) || new Map();
    const slotAmounts = slots.map((slot) => getWeekAmounts(weeksByWeekNo.get(slot.weekNo), mode));
    const weekTotals = slotAmounts.map((amounts) => computeCashflowTotals(amounts));
    const rowTotals = createLineTotals();
    for (const lineId of CASHFLOW_ALL_LINES) {
      rowTotals[lineId] = slotAmounts.reduce((acc, amounts) => acc + (Number(amounts[lineId]) || 0), 0);
    }
    return {
      yearMonth,
      slots,
      slotAmounts,
      weekTotals,
      rowTotals,
      totalIn: weekTotals.reduce((acc, week) => acc + week.totalIn, 0),
      totalOut: weekTotals.reduce((acc, week) => acc + week.totalOut, 0),
      totalNet: weekTotals.reduce((acc, week) => acc + week.net, 0),
    };
  });

  const headerRow = ['항목'];
  const periodRow = ['기간'];
  for (const month of monthColumns) {
    for (const slot of month.slots) {
      headerRow.push(slot.label);
      periodRow.push(slot.present ? `${slot.weekStart} ~ ${slot.weekEnd}` : '');
    }
    headerRow.push(`${month.yearMonth} 합계`);
    periodRow.push('');
  }

  const rows = [];
  rows.push([modeLabel]);
  rows.push(headerRow);
  rows.push(periodRow);
  rows.push([]);
  rows.push([`입금 (${modeLabel})`, ...Array(headerRow.length - 1).fill('')]);
  for (const lineId of CASHFLOW_IN_LINES) {
    const row = [CASHFLOW_SHEET_LINE_LABELS[lineId]];
    for (const month of monthColumns) {
      row.push(...month.slotAmounts.map((amounts) => Number(amounts[lineId]) || 0));
      row.push(month.rowTotals[lineId] || 0);
    }
    rows.push(row);
  }
  const inTotalRow = ['입금 합계'];
  for (const month of monthColumns) {
    inTotalRow.push(...month.weekTotals.map((week) => week.totalIn), month.totalIn);
  }
  rows.push(inTotalRow);
  rows.push([]);
  rows.push([`출금 (${modeLabel})`, ...Array(headerRow.length - 1).fill('')]);
  for (const lineId of CASHFLOW_OUT_LINES) {
    const row = [CASHFLOW_SHEET_LINE_LABELS[lineId]];
    for (const month of monthColumns) {
      row.push(...month.slotAmounts.map((amounts) => Number(amounts[lineId]) || 0));
      row.push(month.rowTotals[lineId] || 0);
    }
    rows.push(row);
  }
  const outTotalRow = ['출금 합계'];
  for (const month of monthColumns) {
    outTotalRow.push(...month.weekTotals.map((week) => week.totalOut), month.totalOut);
  }
  rows.push(outTotalRow);
  const netRow = ['잔액'];
  for (const month of monthColumns) {
    netRow.push(...month.weekTotals.map((week) => week.net), month.totalNet);
  }
  rows.push(netRow);
  return rows;
}

function buildProjectWorkbookRows({ project, yearMonths, includeBothModes, mode }) {
  const rows = [];
  const projectTitle = normalizeProjectTitle(project);
  const projectLabel = normalizeProjectLabel(project);
  const weekIndex = indexProjectWeeks(project);
  rows.push(['사업', projectTitle, '사업 ID', project.id]);
  if (projectLabel !== projectTitle) {
    rows.push(['표시명', projectLabel]);
  }
  rows.push(['기간', summarizeCashflowYearMonths(yearMonths)]);
  rows.push([]);
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
    rows.push([]);
    return rows;
  }
  for (const yearMonth of yearMonths) {
    const slots = buildCashflowWeekSlots(yearMonth);
    const monthWeeks = weekIndex.get(yearMonth) || new Map();
    rows.push([`${yearMonth}`]);
    rows.push([]);
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
    rows.push([]);
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

function buildWorkbookSpec({ projects, yearMonths, variant }) {
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
    const rows = [['대상 기간', summarizeCashflowYearMonths(yearMonths)], []];
    const sortedProjects = [...projects].sort((left, right) => normalizeProjectTitle(left).localeCompare(normalizeProjectTitle(right), 'ko'));
    for (const project of sortedProjects) {
      rows.push(...buildProjectWorkbookRows({ project, yearMonths, includeBothModes: true }));
      rows.push([]);
    }
    return { sheets: [{ name: '전체 사업', rows }] };
  }
  const usedNames = new Set();
  const sortedProjects = [...projects].sort((left, right) => normalizeProjectTitle(left).localeCompare(normalizeProjectTitle(right), 'ko'));
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
  const suffix = variant === 'combined' ? '전체사업_통합시트' : '전체사업_개별시트';
  return `캐시플로_추출_${suffix}_${period || '기간미지정'}.xlsx`;
}

export async function buildCashflowExportWorkbookBuffer({ projects, yearMonths, variant }) {
  const workbookSpec = buildWorkbookSpec({ projects, yearMonths, variant });
  const workbook = new ExcelJS.Workbook();
  for (const sheet of workbookSpec.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    sheet.rows.forEach((row) => worksheet.addRow(row));
    worksheet.views = [{ state: 'frozen', ySplit: 2 }];
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
