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
