import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const providerFiles = [
  'board-store.tsx',
  'cashflow-weeks-store.tsx',
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
});
