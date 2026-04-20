import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');

describe('portal transaction state command boundary', () => {
  it('routes platform-mode transaction state changes through the transaction state command', () => {
    expect(portalStoreSource).toContain('changeTransactionStateViaBff');
    expect(portalStoreSource).toContain('const changeTransactionState = useCallback(async (id: string, newState: TransactionState, reason?: string) => {');
    expect(portalStoreSource).toContain('if (isPlatformApiEnabled() && !isDevHarnessUser) {');
    expect(portalStoreSource).toContain("throw new Error('Platform API requires an authenticated actor for transaction state changes.');");
    expect(portalStoreSource).toContain('await changeTransactionStateViaBff({');
    expect(portalStoreSource).toContain('await persistTransaction(nextTx);');
  });
});
