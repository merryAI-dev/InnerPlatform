import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowWeeksStoreSource = readFileSync(
  resolve(import.meta.dirname, 'cashflow-weeks-store.tsx'),
  'utf8',
);

describe('CashflowWeekProvider Java read hydration contract', () => {
  it('merges weekly status read model into aggregate cashflow weeks', () => {
    expect(cashflowWeeksStoreSource).toContain('fetchWeeklyExpenseStatusesViaBff');
    expect(cashflowWeeksStoreSource).toContain('mergeWeeklyStatusesIntoCashflowWeeks');
    expect(cashflowWeeksStoreSource).toContain('pmSubmitted: Boolean(status.pmSubmitted)');
    expect(cashflowWeeksStoreSource).toContain('adminClosed: Boolean(status.adminClosed)');
  });

  it('creates status-only weeks so submitted or closed empty weeks are visible', () => {
    expect(cashflowWeeksStoreSource).toContain('byWeekId.set(weekId, {');
    expect(cashflowWeeksStoreSource).toContain('projection: {}');
    expect(cashflowWeeksStoreSource).toContain('actual: {}');
  });

  it('does not clear platform cashflow weeks on month navigation before Java hydration', () => {
    expect(cashflowWeeksStoreSource).not.toContain("if (isPlatformApiEnabled() && user.source !== 'dev_harness') {\n      setWeeks([]);");
    expect(cashflowWeeksStoreSource).not.toContain("if (isPlatformApiEnabled() && user.source !== 'dev_harness') {\n      setReadModels({});");
  });
});
