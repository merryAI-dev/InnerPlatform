import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');

describe('portal transaction finance-write boundary', () => {
  it('routes add/update transaction writes through the portal finance-write command and leaves lifecycle changes alone', () => {
    expect(portalStoreSource).toContain('savePortalTransactionFinanceWriteViaBff');
    expect(portalStoreSource).toContain('const addTransaction = useCallback(async (txData: Transaction) => {');
    expect(portalStoreSource).toContain('const updateTransaction = useCallback(async (id: string, updates: Partial<Transaction>) => {');
    expect(portalStoreSource).toContain('const changeTransactionState = useCallback(async (id: string, newState: TransactionState, reason?: string) => {');
    expect(portalStoreSource).toContain('if (isPlatformApiEnabled() && !isDevHarnessUser) {');
    expect(portalStoreSource).toContain("throw new Error('Platform API requires an authenticated actor for transaction finance writes.');");
    expect(portalStoreSource).toContain('await savePortalTransactionFinanceWriteViaBff({');
    expect(portalStoreSource).toContain('await persistTransaction(nextTx);');
  });
});
