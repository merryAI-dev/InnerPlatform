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
});
