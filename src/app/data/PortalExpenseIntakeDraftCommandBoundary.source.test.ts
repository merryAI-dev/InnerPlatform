import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');

describe('portal expense intake draft command boundary', () => {
  it('routes expense intake draft saves through the BFF command when platform api is enabled', () => {
    expect(portalStoreSource).toContain('savePortalExpenseIntakeDraftViaBff');
    expect(portalStoreSource).toContain('isPlatformApiEnabled()');
  });
});
