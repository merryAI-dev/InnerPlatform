import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalBankStatementPage.tsx'), 'utf8');

describe('PortalBankStatementPage cashflow lease', () => {
  it('starts read-only and checks the shared project lease before import or apply', () => {
    expect(source).toContain('useCashflowEditLease');
    expect(source).toContain('checkBeforeMutation');
    expect(source).toContain('EditLeaseDialogs');
    expect(source).toContain('cashflowLease: mutationLease');
    expect(source).toContain('disabled={!cashflowLease.canEdit');
  });

  it('keeps upload saves private and completes the draft only after final bank apply', () => {
    expect(source).toContain('createCashflowPrivateDraftClient');
    expect(source).toContain('bankWizardDraftVersions');
    expect(source).toContain('cashflowPrivateDraftClient.complete');
    expect(source).toContain('cashflowLease.checkStatus()');
    expect(source).not.toContain("from 'firebase/firestore'");
    expect(source).not.toContain('setDoc(');
  });

  it('restores bank inputs once per active lease after same-tab refresh', () => {
    expect(source).toContain('loadedPrivateDraftKeyRef');
    expect(source).toContain('privateDraftLoadRef');
    expect(source).toContain('hydrateBankPrivateDraft');
  });
});
