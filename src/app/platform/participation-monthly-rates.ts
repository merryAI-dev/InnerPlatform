import type { ParticipationEntry } from '../data/types';

function isValidRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** Returns null for a source blank, while preserving an explicit 0%. */
export function getMonthlyParticipationRate(
  entry: ParticipationEntry,
  yearMonth: string,
): number | null {
  const value = entry.monthlyRates?.[yearMonth];
  return isValidRate(value) ? value : null;
}

/** Uses the project-registered rate while the selected month is inside its participation period. */
export function getRegisteredParticipationRateForMonth(
  entry: ParticipationEntry,
  yearMonth: string,
): number | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth) || !isValidRate(entry.rate)) return null;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(entry.periodStart) && yearMonth < entry.periodStart) return null;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(entry.periodEnd) && yearMonth > entry.periodEnd) return null;
  return entry.rate;
}

export function resolveParticipationRateForMonth(
  entry: ParticipationEntry,
  yearMonth: string,
): { rate: number; source: 'DOCUMENT' | 'REGISTERED' } | null {
  const documentRate = getMonthlyParticipationRate(entry, yearMonth);
  if (documentRate !== null) return { rate: documentRate, source: 'DOCUMENT' };

  const registeredRate = getRegisteredParticipationRateForMonth(entry, yearMonth);
  return registeredRate === null ? null : { rate: registeredRate, source: 'REGISTERED' };
}

export function summarizeMemberMonthlyAllocations(
  rows: Array<{ memberId: string; projectId: string; rate: number }>,
): Map<string, { total: number; projectIds: Set<string> }> {
  const summaries = new Map<string, { total: number; projectIds: Set<string> }>();
  rows.forEach(({ memberId, projectId, rate }) => {
    const summary = summaries.get(memberId) || { total: 0, projectIds: new Set<string>() };
    summary.total += rate;
    summary.projectIds.add(projectId);
    summaries.set(memberId, summary);
  });
  return summaries;
}

/** Adapts one selected month to the existing deterministic risk rules. */
export function toMonthlyRateEntries(
  entries: ParticipationEntry[],
  yearMonth: string,
): ParticipationEntry[] {
  return entries.flatMap((entry) => {
    const rate = getMonthlyParticipationRate(entry, yearMonth);
    return rate === null ? [] : [{ ...entry, rate }];
  });
}
