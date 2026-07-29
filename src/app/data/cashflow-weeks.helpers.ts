export function resolveFirestoreErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const maybe = error as { code?: unknown };
  return typeof maybe.code === 'string' ? maybe.code : '';
}

export function shouldCreateDocOnUpdateError(error: unknown): boolean {
  return resolveFirestoreErrorCode(error) === 'not-found';
}

export function filterCashflowWeeksForYear<
  T extends { yearMonth?: string | null },
>(rows: T[], selectedYearMonth: string): T[] {
  const year = typeof selectedYearMonth === 'string' ? selectedYearMonth.slice(0, 4) : '';
  if (!/^\d{4}$/.test(year)) return [];
  const yearStart = `${year}-01`;
  const yearEnd = `${year}-12`;
  return rows.filter((row) => {
    const value = typeof row?.yearMonth === 'string' ? row.yearMonth : '';
    return value >= yearStart && value <= yearEnd;
  });
}

export function filterCashflowWeeksThroughSelectedYear<
  T extends { yearMonth?: string | null },
>(rows: T[], selectedYearMonth: string): T[] {
  const year = typeof selectedYearMonth === 'string' ? selectedYearMonth.slice(0, 4) : '';
  if (!/^\d{4}$/.test(year)) return [];
  const yearEnd = `${year}-12`;
  return rows.filter((row) => {
    const value = typeof row?.yearMonth === 'string' ? row.yearMonth : '';
    return /^\d{4}-\d{2}$/.test(value) && value <= yearEnd;
  });
}

export function cashflowWeeklyCompletionKey(value: {
  projectId?: unknown;
  yearMonth?: unknown;
  weekNo?: unknown;
}): string {
  const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : '';
  const yearMonth = typeof value.yearMonth === 'string' ? value.yearMonth.trim() : '';
  const weekNo = Number(value.weekNo);
  return projectId && /^\d{4}-\d{2}$/.test(yearMonth) && Number.isInteger(weekNo) && weekNo >= 1 && weekNo <= 5
    ? `${projectId}:${yearMonth}:${weekNo}`
    : '';
}

export function isCashflowWeeklySettlementCompleted(value: {
  status?: unknown;
  completedAt?: unknown;
}): boolean {
  const status = typeof value.status === 'string' ? value.status.trim().toUpperCase() : '';
  return status ? status === 'LOCKED' : typeof value.completedAt === 'string' && value.completedAt.trim().length > 0;
}
