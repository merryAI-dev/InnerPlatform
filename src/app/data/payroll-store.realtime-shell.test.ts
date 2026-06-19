import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const payrollStoreSource = readFileSync(
  resolve(import.meta.dirname, 'payroll-store.tsx'),
  'utf8',
);

describe('PayrollProvider scoped realtime listeners', () => {
  it('keeps PM-scoped payroll data on realtime snapshots instead of one-shot fetches', () => {
    expect(payrollStoreSource).toContain("onSnapshot(scheduleRef");
    expect(payrollStoreSource).toContain("onSnapshot(runQuery");
    expect(payrollStoreSource).toContain("onSnapshot(closeQuery");
    expect(payrollStoreSource).not.toContain("getDoc(scheduleRef)");
    expect(payrollStoreSource).not.toContain("getDocs(runQuery)");
    expect(payrollStoreSource).not.toContain("getDocs(closeQuery)");
  });
});
