import type { CashflowWeekSheet, Transaction } from '../data/types';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES, computeCashflowTotals } from './cashflow-sheet';
import { normalizeSpace } from './csv-utils';
import { getMonthMondayWeeks, isYearMonth, type MonthMondayWeek } from './cashflow-weeks';
import { CASHFLOW_SHEET_LINE_LABELS, type CashflowSheetLineId } from '../data/types';

export type CashflowExportCell = string | number;
export type CashflowExportRows = CashflowExportCell[][];

export type CashflowExportMode = 'projection' | 'actual';
export type CashflowExportWorkbookVariant = 'single-project' | 'combined' | 'multi-sheet';

export interface CashflowExportProjectInput {
  projectId: string;
  projectName: string;
  projectShortName?: string;
  weeks?: CashflowWeekSheet[];
  transactions?: Transaction[];
}

export interface CashflowExportSheetSpec {
  name: string;
  rows: CashflowExportRows;
}

export interface CashflowExportWorkbookSpec {
  sheets: CashflowExportSheetSpec[];
}

export interface CashflowExportWeekSlot {
  yearMonth: string;
  weekNo: 1 | 2 | 3 | 4 | 5;
  weekStart: string;
  weekEnd: string;
  label: string;
  present: boolean;
}

function parseYearMonth(value: string): { year: number; month: number } | null {
  if (!isYearMonth(value)) return null;
  const [yearRaw, monthRaw] = value.trim().split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  return { year, month };
}

function formatYearMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function formatWeekLabel(yearMonth: string, weekNo: number): string {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return `${yearMonth}-w${weekNo}`;
  return `${String(parsed.year % 100).padStart(2, '0')}-${parsed.month}-${weekNo}`;
}

export function normalizeCashflowYearMonths(yearMonths: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of yearMonths || []) {
    const value = normalizeSpace(String(raw || ''));
    if (!isYearMonth(value) || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  normalized.sort((left, right) => left.localeCompare(right));
  return normalized;
}

export function expandCashflowYearMonthRange(startYearMonth: string, endYearMonth: string): string[] {
  const start = parseYearMonth(startYearMonth);
  const end = parseYearMonth(endYearMonth);
  if (!start || !end) return [];

  const startValue = start.year * 12 + (start.month - 1);
  const endValue = end.year * 12 + (end.month - 1);
  const low = Math.min(startValue, endValue);
  const high = Math.max(startValue, endValue);

  const yearMonths: string[] = [];
  for (let value = low; value <= high; value += 1) {
    const year = Math.floor(value / 12);
    const month = (value % 12) + 1;
    yearMonths.push(formatYearMonth(year, month));
  }
  return yearMonths;
}

export function summarizeCashflowYearMonths(yearMonths: string[]): string {
  const normalized = normalizeCashflowYearMonths(yearMonths);
  if (normalized.length === 0) return '';
  if (normalized.length === 1) return normalized[0];

  const first = parseYearMonth(normalized[0]);
  if (!first) return normalized.join(', ');

  let expected = first.year * 12 + (first.month - 1);
  for (const ym of normalized) {
    const parsed = parseYearMonth(ym);
    if (!parsed) return normalized.join(', ');
    const value = parsed.year * 12 + (parsed.month - 1);
    if (value !== expected) {
      return normalized.join(', ');
    }
    expected += 1;
  }

  return `${normalized[0]} ~ ${normalized[normalized.length - 1]}`;
}

export function buildCashflowWeekSlots(yearMonth: string): CashflowExportWeekSlot[] {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return [];

  const actualWeeks = new Map<number, MonthMondayWeek>();
  for (const week of getMonthMondayWeeks(yearMonth)) {
    actualWeeks.set(week.weekNo as 1 | 2 | 3 | 4 | 5, week);
  }

  const slots: CashflowExportWeekSlot[] = [];
  for (let weekNo = 1 as 1 | 2 | 3 | 4 | 5; weekNo <= 5; weekNo = (weekNo + 1) as 1 | 2 | 3 | 4 | 5) {
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

function normalizeProjectLabel(project: CashflowExportProjectInput): string {
  return normalizeSpace(project.projectShortName || project.projectName || project.projectId) || project.projectId;
}

function normalizeProjectTitle(project: CashflowExportProjectInput): string {
  return normalizeSpace(project.projectName || project.projectShortName || project.projectId) || project.projectId;
}

function createLineTotals(): Record<CashflowSheetLineId, number> {
  return Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [lineId, 0])) as Record<CashflowSheetLineId, number>;
}

function getPreferredWeekSheet(
  current: CashflowWeekSheet | undefined,
  next: CashflowWeekSheet,
): CashflowWeekSheet {
  if (!current) return next;
  const currentScore = `${current.updatedAt || ''}|${current.createdAt || ''}|${current.id}`;
  const nextScore = `${next.updatedAt || ''}|${next.createdAt || ''}|${next.id}`;
  return nextScore > currentScore ? next : current;
}

function indexProjectWeeks(project: CashflowExportProjectInput): Map<string, Map<number, CashflowWeekSheet>> {
  const byYearMonth = new Map<string, Map<number, CashflowWeekSheet>>();
  for (const week of project.weeks || []) {
    if (week.projectId !== project.projectId) continue;
    if (!isYearMonth(week.yearMonth)) continue;
    const weekNo = Math.max(1, Math.min(5, Math.trunc(week.weekNo))) as 1 | 2 | 3 | 4 | 5;
    const monthMap = byYearMonth.get(week.yearMonth) || new Map<number, CashflowWeekSheet>();
    monthMap.set(weekNo, getPreferredWeekSheet(monthMap.get(weekNo), week));
    byYearMonth.set(week.yearMonth, monthMap);
  }
  return byYearMonth;
}

function getWeekAmounts(
  week: CashflowWeekSheet | undefined,
  mode: CashflowExportMode,
): Partial<Record<CashflowSheetLineId, number>> {
  const source = mode === 'projection' ? week?.projection : week?.actual;
  const amounts: Partial<Record<CashflowSheetLineId, number>> = {};
  for (const lineId of CASHFLOW_ALL_LINES) {
    amounts[lineId] = Number(source?.[lineId] || 0);
  }
  return amounts;
}

function buildModeSectionRows(params: {
  yearMonth: string;
  mode: CashflowExportMode;
  slots: CashflowExportWeekSlot[];
  weeksByWeekNo: Map<number, CashflowWeekSheet>;
}): CashflowExportRows {
  const modeLabel = params.mode === 'projection' ? 'Projection' : 'Actual';
  const slotCount = params.slots.length;
  const slotAmounts = params.slots.map((slot) => getWeekAmounts(params.weeksByWeekNo.get(slot.weekNo), params.mode));
  const weekTotals = slotAmounts.map((amounts) => computeCashflowTotals(amounts));
  const rowTotals = createLineTotals();
  for (const lineId of CASHFLOW_ALL_LINES) {
    rowTotals[lineId] = slotAmounts.reduce((acc, amounts) => acc + (Number(amounts[lineId]) || 0), 0);
  }

  const rows: CashflowExportRows = [];
  rows.push([`${params.yearMonth} · ${modeLabel}`]);
  rows.push(['항목', ...params.slots.map((slot) => slot.label), '월 합계']);
  rows.push(['기간', ...params.slots.map((slot) => (slot.present ? `${slot.weekStart} ~ ${slot.weekEnd}` : '')), '']);
  rows.push([]);
  rows.push([`입금 (${modeLabel})`, ...Array(slotCount + 1).fill('')]);
  for (const lineId of CASHFLOW_IN_LINES) {
    const values = slotAmounts.map((amounts) => Number(amounts[lineId]) || 0);
    rows.push([CASHFLOW_SHEET_LINE_LABELS[lineId], ...values, rowTotals[lineId] || 0]);
  }
  rows.push(['입금 합계', ...weekTotals.map((week) => week.totalIn), weekTotals.reduce((acc, week) => acc + week.totalIn, 0)]);
  rows.push([]);
  rows.push([`출금 (${modeLabel})`, ...Array(slotCount + 1).fill('')]);
  for (const lineId of CASHFLOW_OUT_LINES) {
    const values = slotAmounts.map((amounts) => Number(amounts[lineId]) || 0);
    rows.push([CASHFLOW_SHEET_LINE_LABELS[lineId], ...values, rowTotals[lineId] || 0]);
  }
  rows.push(['출금 합계', ...weekTotals.map((week) => week.totalOut), weekTotals.reduce((acc, week) => acc + week.totalOut, 0)]);
  rows.push(['잔액', ...weekTotals.map((week) => week.net), weekTotals.reduce((acc, week) => acc + week.net, 0)]);
  return rows;
}

function buildProjectWorkbookRows(params: {
  project: CashflowExportProjectInput;
  yearMonths: string[];
  includeBothModes: boolean;
  mode?: CashflowExportMode;
}): CashflowExportRows {
  const rows: CashflowExportRows = [];
  const projectTitle = normalizeProjectTitle(params.project);
  const projectLabel = normalizeProjectLabel(params.project);
  const weekIndex = indexProjectWeeks(params.project);
  const transactionCount = params.project.transactions?.length || 0;
  const yearMonthSummary = summarizeCashflowYearMonths(params.yearMonths);

  rows.push(['사업', projectTitle, '사업 ID', params.project.projectId, '거래 수', transactionCount]);
  if (projectLabel !== projectTitle) {
    rows.push(['표시명', projectLabel]);
  }
  rows.push(['기간', yearMonthSummary || '']);
  rows.push([]);

  for (const yearMonth of params.yearMonths) {
    const slots = buildCashflowWeekSlots(yearMonth);
    const monthWeeks = weekIndex.get(yearMonth) || new Map<number, CashflowWeekSheet>();
    rows.push([`${yearMonth}`]);
    rows.push([]);
    rows.push(...buildModeSectionRows({
      yearMonth,
      mode: params.includeBothModes ? 'projection' : (params.mode || 'projection'),
      slots,
      weeksByWeekNo: monthWeeks,
    }));
    if (params.includeBothModes) {
      rows.push([]);
      rows.push(...buildModeSectionRows({ yearMonth, mode: 'actual', slots, weeksByWeekNo: monthWeeks }));
    }
    rows.push([]);
  }

  return rows;
}

function makeUniqueSheetName(baseName: string, usedNames: Set<string>): string {
  const cleaned = normalizeSpace(baseName)
    .replace(/[\[\]:*?/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function buildCombinedWorkbookRows(params: {
  projects: CashflowExportProjectInput[];
  yearMonths: string[];
}): CashflowExportRows {
  const rows: CashflowExportRows = [];
  const sortedProjects = [...params.projects].sort((left, right) => {
    const leftLabel = normalizeProjectTitle(left);
    const rightLabel = normalizeProjectTitle(right);
    if (leftLabel !== rightLabel) return leftLabel.localeCompare(rightLabel, 'ko');
    return left.projectId.localeCompare(right.projectId);
  });

  rows.push(['대상 기간', summarizeCashflowYearMonths(params.yearMonths) || '']);
  rows.push([]);

  for (const project of sortedProjects) {
    rows.push(...buildProjectWorkbookRows({ project, yearMonths: params.yearMonths, includeBothModes: true }));
    rows.push([]);
  }

  return rows;
}

export function buildSingleProjectCashflowWorkbookSpec(
  project: CashflowExportProjectInput,
  yearMonths: string[],
): CashflowExportWorkbookSpec {
  const normalizedYearMonths = normalizeCashflowYearMonths(yearMonths);
  return {
    sheets: [
      {
        name: 'Projection',
        rows: buildProjectWorkbookRows({
          project,
          yearMonths: normalizedYearMonths,
          includeBothModes: false,
          mode: 'projection',
        }),
      },
      {
        name: 'Actual',
        rows: buildProjectWorkbookRows({
          project,
          yearMonths: normalizedYearMonths,
          includeBothModes: false,
          mode: 'actual',
        }),
      },
    ],
  };
}

export function buildAllProjectsCombinedCashflowWorkbookSpec(
  projects: CashflowExportProjectInput[],
  yearMonths: string[],
): CashflowExportWorkbookSpec {
  const normalizedYearMonths = normalizeCashflowYearMonths(yearMonths);
  return {
    sheets: [
      {
        name: '전체 사업',
        rows: buildCombinedWorkbookRows({ projects, yearMonths: normalizedYearMonths }),
      },
    ],
  };
}

export function buildAllProjectsMultiSheetCashflowWorkbookSpec(
  projects: CashflowExportProjectInput[],
  yearMonths: string[],
): CashflowExportWorkbookSpec {
  const normalizedYearMonths = normalizeCashflowYearMonths(yearMonths);
  const usedNames = new Set<string>();
  const sortedProjects = [...projects].sort((left, right) => {
    const leftLabel = normalizeProjectLabel(left);
    const rightLabel = normalizeProjectLabel(right);
    if (leftLabel !== rightLabel) return leftLabel.localeCompare(rightLabel, 'ko');
    return left.projectId.localeCompare(right.projectId);
  });

  return {
    sheets: sortedProjects.map((project) => ({
      name: makeUniqueSheetName(normalizeProjectLabel(project), usedNames),
      rows: buildProjectWorkbookRows({ project, yearMonths: normalizedYearMonths, includeBothModes: true }),
    })),
  };
}

export function buildCashflowExportWorkbookSpec(params: {
  variant: CashflowExportWorkbookVariant;
  projects: CashflowExportProjectInput[];
  yearMonths: string[];
}): CashflowExportWorkbookSpec {
  if (params.variant === 'single-project') {
    const project = params.projects[0];
    if (!project) {
      return { sheets: [] };
    }
    return buildSingleProjectCashflowWorkbookSpec(project, params.yearMonths);
  }
  if (params.variant === 'combined') {
    return buildAllProjectsCombinedCashflowWorkbookSpec(params.projects, params.yearMonths);
  }
  return buildAllProjectsMultiSheetCashflowWorkbookSpec(params.projects, params.yearMonths);
}
