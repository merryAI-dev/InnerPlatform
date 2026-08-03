import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalProjectRegister.tsx'), 'utf8');

describe('PortalProjectRegister private draft session', () => {
  it('uses an opaque canonical draft URL and BFF-only draft lifecycle', () => {
    expect(source).toContain('useParams<{ draftId?: string }>');
    expect(source).toContain('createProjectRegistrationDraftClient');
    expect(source).toContain('client.create');
    expect(source).toContain('createDraftPromiseRef.current.ownerKey !== ownerKey');
    expect(source).toContain('createDraftPromiseRef.current === pendingCreate');
    expect(source).toContain('client.get(draftId)');
    expect(source).toContain('draftClient.save');
    expect(source).toContain('draftClient.submit');
    expect(source).toContain('navigate(`/portal/register-project/${created.draft.draftId}`');
    expect(source).not.toContain('setDoc(');
    expect(source).not.toContain('createProjectRequest(');
    expect(source).not.toContain('notifyProjectRequestRegistrationViaBff');
  });

  it('keeps the editor read-only without the current lease and checks status before writes', () => {
    expect(source).toContain('createEditLeaseClient');
    expect(source).toContain('useEditLease');
    expect(source).toContain('lease.checkBeforeSave()');
    expect(source).toContain('readOnly={!lease.canEdit}');
    expect(source).toContain('disabled: !lease.canEdit');
    expect(source).toContain('<EditLeaseDialogs');
  });

  it('serializes revisioned saves and persists attachment metadata before returning success', () => {
    expect(source).toContain('mutationQueueRef');
    expect(source).toContain('expectedDraftRevision: revisionRef.current');
    expect(source).toContain('revisionRef.current = uploaded.draft.draftRevision');
    expect(source).toContain('attachmentDocument(uploaded.attachment)');
  });

  it('analyzes the validated private contract and returns its extracted fields to the editor', () => {
    expect(source).toContain('extractTextFromPdf(file)');
    expect(source).toContain('analyzeProjectRequestContractViaBff({');
    expect(source).toContain("kind === 'contract'");
    expect(source).toMatch(/return\s*\{\s*document:\s*attachmentDocument\(uploaded\.attachment\),\s*contractAnalysis\s*\}/);
    expect(source).not.toContain('contractAnalysis: null }');
  });

  it('loads private attachment blobs through the owner-authorized BFF for review previews', () => {
    expect(source).toContain('downloadProjectRegistrationDraftAttachmentViaBff');
    expect(source).toContain('usePrivateDraftDocumentPreviews');
    expect(source).toContain('enabled: !submitted');
    expect(source).toContain('signal,');
    expect(source).toContain('documentPreviewUrls={documentPreviewUrls}');
    expect(source).toContain('documentPreviewStates={documentPreviewStates}');
    expect(source).toContain('onLoadDocumentPreview={loadDocumentPreview}');
    expect(source).not.toContain('Promise.all(attachments');
  });

  it('does not remount the editor for token-only auth refreshes', () => {
    const effect = source.slice(source.indexOf('useEffect(() => {', source.indexOf('export function PortalProjectRegister')));
    expect(effect).toContain('identityKey');
    expect(effect).not.toContain('user?.idToken]');
    expect(source).toContain('current.actor.idToken === idToken');
    expect(source).toContain('sessionId: current.session.sessionId');
  });

  it('keeps the editor inputs and autosave callback stable across lease countdown renders', () => {
    expect(source).toContain('const editorDraft = useMemo(() => draftForEditor(record), [record])');
    expect(source).toContain('const autosave = useMemo(() => ({');
    expect(source).toContain('initialDraft={editorDraft}');
    expect(source).toContain('autosave={autosave}');
  });

  it('opens legacy private drafts under the current registration-v2 contract', () => {
    expect(source).toContain('registrationRequirementsVersion: 2');
    expect(source.indexOf('registrationRequirementsVersion: 2')).toBeGreaterThan(source.indexOf('...(record.payload as Partial<ProjectEditorDraft>)'));
  });

  it('names the organization-head review destination explicitly', () => {
    expect(source).toContain('최종 결재자 (사업총괄)의 조직장 검토 화면');
    expect(source).not.toContain('관리자 검토 화면');
  });
});
