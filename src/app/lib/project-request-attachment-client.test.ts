import { describe, expect, it, vi } from 'vitest';
import {
  downloadProjectAttachmentViaBff,
  downloadProjectInfoDraftAttachmentViaBff,
  downloadProjectRegistrationDraftAttachmentViaBff,
  downloadProjectRequestAttachmentViaBff,
} from './project-request-attachment-client';

describe('project request attachment client', () => {
  it('downloads a pending attachment with authorization headers and no token in the URL', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new Blob(['private-pdf'], { type: 'application/pdf' }), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': "attachment; filename*=UTF-8''pending-contract.pdf",
      },
    }));

    const result = await downloadProjectRequestAttachmentViaBff({
      tenantId: 'mysc',
      actor: { uid: 'admin-a', role: 'admin', idToken: 'token-secret' },
      requestId: 'change-project-a',
      documentKind: 'contract',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/project-requests\/change-project-a\/attachments\/contract$/),
      expect.objectContaining({ method: 'GET' }),
    );
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(String(url)).not.toContain('token-secret');
    const headers = new Headers(options?.headers);
    expect(headers.get('authorization')).toBe('Bearer token-secret');
    expect(headers.get('x-tenant-id')).toBe('mysc');
    expect(result.blob.type).toBe('application/pdf');
    expect(result.fileName).toBe('pending-contract.pdf');
  });

  it('downloads a project attachment after final approval', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Blob(['private-pdf']), {
      status: 200,
      headers: { 'content-disposition': "attachment; filename*=UTF-8''contract.pdf" },
    }));

    await downloadProjectAttachmentViaBff({
      tenantId: 'mysc', actor: { uid: 'approver-a', role: 'admin' }, projectId: 'project-a', documentKind: 'contract', fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/projects\/project-a\/attachments\/contract$/),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each([
    ['registration', downloadProjectRegistrationDraftAttachmentViaBff, { draftId: 'draft-a' }, '/api/v1/project-registration-drafts/draft-a/attachments/contract'],
    ['information edit', downloadProjectInfoDraftAttachmentViaBff, { projectId: 'project-a' }, '/api/v1/project-info-drafts/project-a/attachments/contract'],
  ])('downloads an owner-authorized %s draft attachment without exposing credentials', async (_label, download, id, suffix) => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new Blob(['private-draft'], { type: 'application/pdf' }), {
      status: 200,
      headers: { 'content-disposition': "attachment; filename*=UTF-8''draft-contract.pdf" },
    }));

    const result = await download({
      tenantId: 'mysc',
      actor: { uid: 'pm-a', role: 'pm', idToken: 'draft-token' },
      ...id,
      documentKind: 'contract',
      fetchImpl,
    } as never);

    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toMatch(new RegExp(`${suffix}$`));
    expect(String(url)).not.toContain('draft-token');
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer draft-token');
    expect(result.fileName).toBe('draft-contract.pdf');
  });

  it('rejects an unsafe draft document kind before issuing a request', async () => {
    const fetchImpl = vi.fn();
    await expect(downloadProjectRegistrationDraftAttachmentViaBff({
      tenantId: 'mysc', actor: { uid: 'pm-a', role: 'pm' }, draftId: 'draft-a',
      documentKind: '../contract' as never, fetchImpl,
    })).rejects.toThrow('document kind is invalid');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards cancellation to private draft downloads', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => new Response(new Blob(['private-draft']), { status: 200 }));

    await downloadProjectRegistrationDraftAttachmentViaBff({
      tenantId: 'mysc',
      actor: { uid: 'pm-a', role: 'pm' },
      draftId: 'draft-a',
      documentKind: 'contract',
      fetchImpl,
      signal: controller.signal,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
