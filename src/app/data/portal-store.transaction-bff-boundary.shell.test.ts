import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');

function extractFunction(name: string, nextName: string): string {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(`const ${nextName} = useCallback`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('portal transaction BFF boundary', () => {
  it('upserts transactions through the BFF and keeps server results local', () => {
    const persistTransaction = extractFunction('persistTransaction', 'register');
    const addTransaction = extractFunction('addTransaction', 'updateTransaction');
    const updateTransaction = extractFunction('updateTransaction', 'changeTransactionState');

    expect(persistTransaction).toContain('upsertTransactionViaBff');
    expect(persistTransaction).not.toContain('setDoc(');
    expect(addTransaction).toContain('await persistTransaction(txData, options?.cashflowLease)');
    expect(updateTransaction).toContain('await persistTransaction(nextTx, options?.cashflowLease)');
  });

  it('changes transaction state and creates comments through dedicated BFF commands', () => {
    const changeTransactionState = extractFunction('changeTransactionState', 'addComment');
    const addComment = source.slice(
      source.indexOf('const addComment = useCallback'),
      source.indexOf('const value:', source.indexOf('const addComment = useCallback')),
    );

    expect(changeTransactionState).toContain('changeTransactionStateViaBff');
    expect(changeTransactionState).not.toContain('persistTransaction(');
    expect(addComment).toContain('addCommentViaBff');
    expect(addComment).not.toContain('setDoc(');
  });
});
