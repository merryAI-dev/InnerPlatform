import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./PortalProjectEdit.tsx', import.meta.url), 'utf8');

describe('PortalProjectEdit private draft boundary', () => {
  it('starts read-only and uses project-info lease plus BFF draft commands', () => {
    expect(source).toContain("resourceType: 'project-info'");
    expect(source).toContain('createProjectInfoDraftClient');
    expect(source).toContain('readOnly={!lease.canEdit}');
    expect(source).toContain('lease.checkBeforeSave()');
    expect(source).toContain('<EditLeaseDialogs');
  });

  it('reopens the owner draft when the same tab refreshes with an active lease', () => {
    expect(source).toContain('const status = await lease.checkStatus()');
    expect(source).toContain('draftClient.open(status.ownership)');
  });

  it('refreshes the BFF clients when Firebase rotates the ID token', () => {
    expect(source).toContain('current.actor.idToken === idToken');
    expect(source).toContain('createProjectInfoDraftClient({');
    expect(source).toContain('user?.idToken, user?.uid');
  });

  it('does not write project drafts, requests, or canonical projects through the browser Firestore SDK', () => {
    expect(source).not.toContain('projectRequestDrafts');
    expect(source).not.toContain('setDoc(');
    expect(source).not.toContain('resubmitProjectExecutiveReviewViaBff');
    expect(source).not.toContain('uploadProjectRequestContractFile');
  });
});
