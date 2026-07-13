import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalWeeklyExpensePage.tsx'), 'utf8');

function sliceBetween(startText: string, endText: string): string {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('portal weekly transaction BFF boundary', () => {
  it('does not persist the same transaction once directly and again through the store', () => {
    const ensurePersisted = sliceBetween(
      'const ensureTransactionPersisted = useCallback',
      'const provisionEvidenceDrive = useCallback',
    );

    expect(ensurePersisted).not.toContain('upsertTransactionViaBff');
    expect(ensurePersisted).toContain('cashflowLease.checkBeforeMutation()');
    expect(ensurePersisted).toContain('{ cashflowLease: mutationLease }');
    expect(ensurePersisted).toContain('await addTransaction(');
    expect(ensurePersisted).toContain('await updateTransaction(');
  });

  it('uploads evidence only through the BFF and applies returned state locally', () => {
    const uploadEvidence = sliceBetween(
      'const uploadEvidenceDrive = useCallback',
      'const handleAddTransaction = useCallback',
    );
    const applyProvisioned = sliceBetween(
      'const applyProvisionedDriveState = useCallback',
      'const applySyncedEvidenceState = useCallback',
    );
    const applySynced = sliceBetween(
      'const applySyncedEvidenceState = useCallback',
      'const ensureTransactionPersisted = useCallback',
    );

    expect(uploadEvidence).toContain('uploadTransactionEvidenceDriveViaBff');
    expect(uploadEvidence).toContain('cashflowLease.checkBeforeMutation()');
    expect(uploadEvidence).toContain('lease: mutationLease');
    expect(uploadEvidence).not.toContain('uploadFileToGoogleDriveFolder');
    expect(applyProvisioned).toContain('patchTransactionSnapshot');
    expect(applyProvisioned).not.toContain('updateTransaction(');
    expect(applySynced).toContain('patchTransactionSnapshot');
    expect(applySynced).not.toContain('updateTransaction(');
  });

  it('checks the project lease before transaction and comment callbacks', () => {
    const callbacks = sliceBetween(
      'const handleAddTransaction = useCallback',
      'const handleFetchBudgetSuggestion = useCallback',
    );

    expect(callbacks.match(/cashflowLease\.checkBeforeMutation\(\)/g)).toHaveLength(5);
    expect(source).toContain('onAddComment={handleAddComment}');
  });
});
