import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'store.tsx'), 'utf8');

function extractFunction(name: string, nextName: string): string {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(`const ${nextName} = useCallback`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('non-realtime store write mirroring', () => {
  it('uses one-shot reads for admin-wide high-volume collections', () => {
    expect(source).toContain("readOrgCollection(db, orgId, 'ledgers')");
    expect(source).toContain("readOrgCollection(db, orgId, 'transactions')");
    expect(source).toContain("readOrgCollection(db, orgId, 'comments')");
    expect(source).toContain("readOrgCollection(db, orgId, 'evidences')");
    expect(source).toContain("readOrgCollection(db, orgId, 'partEntries')");
  });

  it('mirrors remote writes for collections that no longer have live listeners', () => {
    const addLedger = extractFunction('addLedger', 'addTransaction');
    const addTransaction = extractFunction('addTransaction', 'updateTransaction');
    const updateTransaction = extractFunction('updateTransaction', 'changeTransactionState');
    const changeTransactionState = extractFunction('changeTransactionState', 'addComment');
    const addComment = extractFunction('addComment', 'addEvidence');
    const addEvidence = extractFunction('addEvidence', 'addParticipation');
    const addParticipation = extractFunction('addParticipation', 'updateParticipation');
    const updateParticipation = extractFunction('updateParticipation', 'removeParticipation');
    const removeParticipation = extractFunction('removeParticipation', 'getProjectLedgers');

    expect(addLedger).toContain('setLedgers((prev) => upsertLocalItem(prev, l))');
    expect(addTransaction).toContain('setTransactions((prev) => upsertLocalItem(prev, t))');
    expect(updateTransaction).toContain('setTransactions((prev) => updateLocalItem(prev, id, updates))');
    expect(changeTransactionState).toContain('buildTransactionStateLocalPatch(newState, currentUser.uid, reason)');
    expect(addComment).toContain('setComments((prev) => upsertLocalItem(prev, c))');
    expect(addEvidence).toContain('setEvidences((prev) => upsertLocalItem(prev, e))');
    expect(addParticipation).toContain('setParticipationEntries((prev) => upsertLocalItem(prev, pe))');
    expect(updateParticipation).toContain('setParticipationEntries((prev) => updateLocalItem(prev, id, updates))');
    expect(removeParticipation).toContain('setParticipationEntries((prev) => prev.filter((p) => p.id !== id))');
  });
});
