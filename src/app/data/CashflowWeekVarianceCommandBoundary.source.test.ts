import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowWeeksStoreSource = readFileSync(resolve(import.meta.dirname, 'cashflow-weeks-store.tsx'), 'utf8');

describe('cashflow week variance command boundary', () => {
  it('routes variance flag updates through the BFF command when platform api is enabled', () => {
    expect(cashflowWeeksStoreSource).toContain('updateCashflowWeekVarianceViaBff');
    expect(cashflowWeeksStoreSource).toContain('isPlatformApiEnabled()');
  });
});
