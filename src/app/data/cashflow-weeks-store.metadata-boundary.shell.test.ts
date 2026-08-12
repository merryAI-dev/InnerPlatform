import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'cashflow-weeks-store.tsx'), 'utf8');
const varianceMutation = source.slice(
  source.indexOf('const updateVarianceFlag ='),
  source.indexOf('const getWeeksForProject ='),
);

describe('cashflow week metadata mutation boundary', () => {
  it('refreshes from the persisted snapshot instead of deriving local financial totals', () => {
    expect(source).toContain('const reloadWeeks = useCallback');
    expect(source).toContain('reloadWeeks();');
    expect(source).not.toContain('applyWeekAmountsToLocalWeeks');
    expect(source).not.toContain('computeCashflowTotals');
  });

  it('sends variance intent through the BFF and never writes Firestore directly', () => {
    expect(varianceMutation).toContain('applyCashflowVarianceIntentViaBff');
    expect(varianceMutation).toContain('cashflowLease');
    expect(varianceMutation).not.toContain('updateDoc(');
    expect(varianceMutation).not.toContain('setDoc(');
  });
});
