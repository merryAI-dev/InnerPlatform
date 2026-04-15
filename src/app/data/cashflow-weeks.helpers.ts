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
