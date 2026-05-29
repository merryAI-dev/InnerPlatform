import { describe, expect, it } from 'vitest';
import { createProjectEditorDraft } from './project-editor';
import { buildProjectRequestDraft, buildProjectRequestDraftId } from './project-request-draft';

describe('project request draft', () => {
  it('uses stable owner-scoped draft ids for registration and change drafts', () => {
    expect(buildProjectRequestDraftId({
      kind: 'REGISTRATION',
      ownerId: 'user-1',
    })).toBe('registration-user-1');
    expect(buildProjectRequestDraftId({
      kind: 'CHANGE',
      ownerId: 'user-1',
      targetProjectId: 'project-1',
    })).toBe('change-project-1-user-1');
  });

  it('stores payload snapshots without undefined fields and increments draft version', () => {
    const first = buildProjectRequestDraft({
      tenantId: 'mysc',
      kind: 'REGISTRATION',
      ownerId: 'user-1',
      ownerName: '테스터',
      ownerEmail: 'tester@mysc.co.kr',
      draftKey: 'draft-key',
      draft: createProjectEditorDraft({
        name: '테스트 사업',
        department: 'CIC1',
        contractDocument: undefined,
      }),
      stepIndex: 2,
      now: '2026-05-29T09:00:00.000Z',
    });
    const second = buildProjectRequestDraft({
      tenantId: 'mysc',
      kind: 'REGISTRATION',
      ownerId: 'user-1',
      ownerName: '테스터',
      ownerEmail: 'tester@mysc.co.kr',
      draftKey: 'draft-key',
      draft: createProjectEditorDraft({ name: '테스트 사업 수정' }),
      stepIndex: 4,
      previousDraft: first,
      status: 'SUBMITTED',
      now: '2026-05-29T09:03:00.000Z',
    });

    expect(first.version).toBe(1);
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect(second.status).toBe('SUBMITTED');
    expect(second.submittedAt).toBe('2026-05-29T09:03:00.000Z');
    expect(JSON.stringify(second)).not.toContain('undefined');
  });
});
