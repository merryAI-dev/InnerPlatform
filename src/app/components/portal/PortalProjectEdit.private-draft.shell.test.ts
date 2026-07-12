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

  it('does not write project drafts, requests, or canonical projects through the browser Firestore SDK', () => {
    expect(source).not.toContain('projectRequestDrafts');
    expect(source).not.toContain('setDoc(');
    expect(source).not.toContain('resubmitProjectExecutiveReviewViaBff');
    expect(source).not.toContain('uploadProjectRequestContractFile');
  });
});
