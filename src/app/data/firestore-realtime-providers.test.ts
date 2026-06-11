import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const providerFiles = [
  'board-store.tsx',
  'hr-announcements-store.tsx',
  'payroll-store.tsx',
  'portal-store.tsx',
  'training-store.tsx',
] as const;

describe('route-aware firestore realtime providers', () => {
  for (const file of providerFiles) {
    it(`${file} consumes injected firestore access policy`, () => {
      const source = readFileSync(resolve(import.meta.dirname, file), 'utf8');

      expect(source).toContain('useFirestoreAccessPolicy');
      expect(source).not.toContain('useRealtimeRoutePathname');
      expect(source).not.toContain('canUseRealtimeListeners(');
    });
  }

  it('keeps cashflow actuals on the Java read model path instead of Firestore realtime', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'cashflow-weeks-store.tsx'), 'utf8');

    expect(source).toContain('fetchCashflowSnapshotViaPlatformApi');
    expect(source).toContain('hydrateProjectCashflowSnapshot');
    expect(source).not.toContain('useFirestoreAccessPolicy');
    expect(source).toContain("Cashflow actual은 프론트에서 저장할 수 없습니다");
    expect(source).toContain("input.mode === 'actual'");
  });
});
