import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./PortalProjectEdit.tsx', import.meta.url), 'utf8');

describe('PortalProjectEdit private draft boundary', () => {
  it('starts read-only and uses project-info lease plus BFF draft commands', () => {
    expect(source).toContain("resourceType: 'project-info'");
    expect(source).toContain('createProjectInfoDraftClient');
    expect(source).toContain('readOnly={!editorCanEdit}');
    expect(source).toContain('lease.checkBeforeSave()');
    expect(source).toContain('<EditLeaseDialogs');
  });

  it('fails closed and releases ownership when the private draft cannot open', () => {
    expect(source).toContain('const editorCanEdit = lease.canEdit && record !== null');
    expect(source).toContain('await lease.release()');
    expect(source).toContain('recordLoadedRef.current = false');
    expect(source).toContain("toast.error('수정 임시저장이 준비되지 않았습니다.')");
  });

  it('reopens the owner draft when the same tab refreshes with an active lease', () => {
    expect(source).toContain('const status = await lease.checkStatus()');
    expect(source).toContain('!status.ownership || recordLoadedRef.current');
    expect(source).toContain('draftClient.open(status.ownership)');
  });

  it('refreshes the BFF clients when Firebase rotates the ID token', () => {
    expect(source).toContain('current.actor.idToken === idToken');
    expect(source).toContain('createProjectInfoDraftClient({');
    expect(source).toContain('user?.idToken, user?.uid');
  });

  it('keeps local editor state isolated when the route switches projects', () => {
    expect(source).toContain('<ProjectInfoEditor');
    expect(source).toContain('key={project.id}');
  });

  it('does not write project drafts, requests, or canonical projects through the browser Firestore SDK', () => {
    expect(source).not.toContain('projectRequestDrafts');
    expect(source).not.toContain('setDoc(');
    expect(source).not.toContain('resubmitProjectExecutiveReviewViaBff');
    expect(source).not.toContain('uploadProjectRequestContractFile');
  });
});
