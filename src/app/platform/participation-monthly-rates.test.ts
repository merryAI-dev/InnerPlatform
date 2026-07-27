import { describe, expect, it } from 'vitest';
import type { ParticipationEntry } from '../data/types';
import {
  getMonthlyParticipationRate,
  getRegisteredParticipationRateForMonth,
  resolveParticipationRateForMonth,
  summarizeMemberMonthlyAllocations,
  toMonthlyRateEntries,
} from './participation-monthly-rates';

const entry: ParticipationEntry = {
  id: 'p1-m1', memberId: 'm1', memberName: '홍길동', projectId: 'p1', projectName: '사업 A',
  rate: 50, settlementSystem: 'E_NARA_DOUM', clientOrg: '기관 A', periodStart: '2026-01', periodEnd: '2026-12',
  isDocumentOnly: false, note: '', updatedAt: '2026-07-27T00:00:00.000Z',
  monthlyRates: {
    '2026-03': 10,
    '2026-04': 0,
    '2026-05': null,
  },
};

describe('monthly document participation rates', () => {
  it('returns the source document rate for its month', () => {
    expect(getMonthlyParticipationRate(entry, '2026-03')).toBe(10);
  });

  it('distinguishes an explicit 0% from a source blank', () => {
    expect(getMonthlyParticipationRate(entry, '2026-04')).toBe(0);
    expect(getMonthlyParticipationRate(entry, '2026-05')).toBeNull();
  });

  it('excludes blanks but keeps an explicit 0% in the risk input', () => {
    expect(toMonthlyRateEntries([entry], '2026-04')).toHaveLength(1);
    expect(toMonthlyRateEntries([entry], '2026-05')).toHaveLength(0);
  });

  it('uses the registered project rate only inside its participation period', () => {
    expect(getRegisteredParticipationRateForMonth(entry, '2026-01')).toBe(50);
    expect(getRegisteredParticipationRateForMonth(entry, '2026-12')).toBe(50);
    expect(getRegisteredParticipationRateForMonth(entry, '2025-12')).toBeNull();
    expect(getRegisteredParticipationRateForMonth(entry, '2027-01')).toBeNull();
  });

  it('prefers the monthly document value and otherwise falls back to the registered value', () => {
    expect(resolveParticipationRateForMonth(entry, '2026-03')).toEqual({ rate: 10, source: 'DOCUMENT' });
    expect(resolveParticipationRateForMonth(entry, '2026-05')).toEqual({ rate: 50, source: 'REGISTERED' });
    expect(resolveParticipationRateForMonth(entry, '2027-01')).toBeNull();
  });

  it('adds one member participation across multiple projects in the selected month', () => {
    const summaries = summarizeMemberMonthlyAllocations([
      { memberId: 'm1', projectId: 'p1', rate: 60 },
      { memberId: 'm1', projectId: 'p2', rate: 50 },
      { memberId: 'm2', projectId: 'p1', rate: 30 },
    ]);

    expect(summaries.get('m1')?.total).toBe(110);
    expect(Array.from(summaries.get('m1')?.projectIds || [])).toEqual(['p1', 'p2']);
    expect(summaries.get('m2')?.total).toBe(30);
  });
});
