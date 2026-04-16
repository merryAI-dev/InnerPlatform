import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowWeeksStoreSource = readFileSync(resolve(import.meta.dirname, 'cashflow-weeks-store.tsx'), 'utf8');

describe('cashflow week lifecycle command boundary', () => {
  it('routes PM submit and admin close through BFF commands when platform api is enabled', () => {
    expect(cashflowWeeksStoreSource).toContain('submitPortalWeeklySubmissionViaBff');
    expect(cashflowWeeksStoreSource).toContain('closeCashflowWeekViaBff');
  });
});
