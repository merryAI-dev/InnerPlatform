import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string) {
  return readFileSync(resolve(import.meta.dirname, relativePath), 'utf8');
}

describe('firestore access policy contract', () => {
  it('injects explicit route access mode from route-scoped providers', () => {
    const adminProvidersSource = readSource('./admin-route-providers.tsx');
    const portalProvidersSource = readSource('./portal-route-providers.tsx');

    expect(adminProvidersSource).toContain('FirestoreRouteModeProvider');
    expect(adminProvidersSource).toContain('mode="admin-live"');
    expect(portalProvidersSource).toContain('FirestoreRouteModeProvider');
    expect(portalProvidersSource).toContain('mode="portal-safe"');
  });

  it('keeps operational stores free of pathname-based realtime inference', () => {
    const storeFiles = [
      './board-store.tsx',
      './cashflow-weeks-store.tsx',
      './hr-announcements-store.tsx',
      './payroll-store.tsx',
      './portal-store.tsx',
      './training-store.tsx',
    ];

    for (const relativePath of storeFiles) {
      const source = readSource(relativePath);
      expect(source).not.toContain('useRealtimeRoutePathname');
      expect(source).not.toContain("'./realtime-route'");
      expect(source).not.toContain('canUseRealtimeListeners(');
    }
  });

  it('defines access policy without reading window.location directly', () => {
    const policySource = readSource('./firestore-realtime-mode.ts');

    expect(policySource).toContain('useFirestoreAccessPolicy');
    expect(policySource).not.toContain('window.location');
    expect(policySource).not.toContain('pathname');
  });
});
