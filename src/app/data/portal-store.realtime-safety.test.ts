import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(
  resolve(import.meta.dirname, 'portal-store.tsx'),
  'utf8',
);

describe('portal-store realtime safety', () => {
  it('uses stable dependency keys for portal hydration listeners', () => {
    expect(portalStoreSource).toContain("const scopedProjectIdsKey = scopedProjectIds.join('|');");
    expect(portalStoreSource).toContain("const portalUserProjectIdsKey = (portalUser?.projectIds || []).join('|');");
    expect(portalStoreSource).toContain('scopedProjectIdsKey, isDevHarnessUser, portalUserProjectIdsKey, livePortalMode');
    expect(portalStoreSource).not.toContain('scopedProjectIds, isDevHarnessUser, portalUser?.projectIds, livePortalMode');
  });
});
