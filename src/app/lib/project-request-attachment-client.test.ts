import { describe, expect, it, vi } from 'vitest';
import { downloadProjectRequestAttachmentViaBff } from './project-request-attachment-client';

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
});
