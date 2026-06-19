import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const payrollStoreSource = readFileSync(
  resolve(import.meta.dirname, 'payroll-store.tsx'),
  'utf8',
);

describe('PayrollProvider scoped realtime listeners', () => {
  it('keeps realtime listeners behind route policy and uses fetch mode for portal-safe routes', () => {
    expect(payrollStoreSource).toContain('allowRealtimeListeners: liveMode');
    expect(payrollStoreSource).toContain('if (liveMode) {');
    expect(payrollStoreSource).toContain("onSnapshot(scheduleRef");
    expect(payrollStoreSource).toContain("onSnapshot(runQuery");
    expect(payrollStoreSource).toContain("onSnapshot(closeQuery");
    expect(payrollStoreSource).toContain('getDoc(scheduleRef)');
    expect(payrollStoreSource).toContain('getDocs(runQuery)');
    expect(payrollStoreSource).toContain('getDocs(closeQuery)');
  });
});
