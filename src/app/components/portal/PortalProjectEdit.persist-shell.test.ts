import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalProjectEdit.tsx'), 'utf8');

describe('PortalProjectEdit persistence shell', () => {
  it('stores portal edits as approval-gated change requests instead of mutating the project snapshot', () => {
    expect(source).toContain('buildProjectChangeRequest');
    expect(source).toContain("doc(db, getOrgDocumentPath(orgId, 'projectRequests', changeRequest.id))");
    expect(source).not.toContain('patchProjectSnapshot');
    expect(source).not.toContain('upsertProjectViaBff');
  });

  it('uses the executive review resubmit endpoint only for explicit resubmission', () => {
    expect(source).toContain('resubmitProjectExecutiveReviewViaBff');
    expect(source).toContain("const forcePendingReview = actionId === 'resubmit'");
    expect(source).toContain('if (forcePendingReview && changeRequest)');
  });

  it('keeps the project edit draft key stable across request listener updates', () => {
    expect(source).toContain("const autosaveKey = `portal-edit-${orgId}-${myProject?.id || 'no-project'}-${authUser?.uid || 'anonymous'}`");
    expect(source).toContain('draftKey={autosaveKey}');
    expect(source).not.toContain("draftKey={`portal-edit-${myProject.id}-${requestDoc?.updatedAt || myProject.updatedAt}`}");
  });
});
