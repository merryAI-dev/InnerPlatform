import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, '../../data/portal-store.tsx'), 'utf8');

describe('portal bank statement command boundary', () => {
  it('routes bank handoff through a BFF command from saveBankStatementRows', () => {
    expect(portalStoreSource).toContain('handoffPortalBankStatementViaBff');
  });
});
