import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowWeeksStoreSource = readFileSync(resolve(import.meta.dirname, 'cashflow-weeks-store.tsx'), 'utf8');

describe('cashflow week upsert command boundary', () => {
  it('routes week amount upserts through a BFF command instead of direct firestore writes', () => {
    expect(cashflowWeeksStoreSource).toContain('upsertCashflowWeekViaBff');
  });
});
