import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadProjectRequestContractFile } from './project-contract-upload';

const mocks = vi.hoisted(() => ({
  getAuthInstance: vi.fn(),
  isPlatformApiEnabled: vi.fn(),
  processProjectRequestContractViaBff: vi.fn(),
}));

vi.mock('../lib/firebase', () => ({
  getAuthInstance: mocks.getAuthInstance,
}));

vi.mock('../lib/platform-bff-client', () => ({
  isPlatformApiEnabled: mocks.isPlatformApiEnabled,
  processProjectRequestContractViaBff: mocks.processProjectRequestContractViaBff,
}));

const file = new File(['pdf'], 'contract.pdf', { type: 'application/pdf' });

describe('project-contract-upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPlatformApiEnabled.mockReturnValue(true);
    mocks.getAuthInstance.mockReturnValue({
      currentUser: {
        getIdToken: vi.fn(async () => 'fresh-token'),
      },
    });
    mocks.processProjectRequestContractViaBff.mockResolvedValue({
      contractDocument: {
        path: 'contracts/contract.pdf',
        name: 'contract.pdf',
        downloadURL: 'https://example.com/contract.pdf',
        size: 3,
        contentType: 'application/pdf',
        uploadedAt: '2026-05-27T00:00:00.000Z',
      },
      analysis: { provider: 'heuristic', summary: '요약' },
    });
  });

  it('fails before touching BFF when login context is missing', async () => {
    await expect(uploadProjectRequestContractFile({
      tenantId: 'mysc',
      actor: null,
      file,
    })).rejects.toThrow('로그인 정보를 확인할 수 없습니다.');

    expect(mocks.processProjectRequestContractViaBff).not.toHaveBeenCalled();
  });

  it('fails before touching BFF when platform API is disabled', async () => {
    mocks.isPlatformApiEnabled.mockReturnValue(false);

    await expect(uploadProjectRequestContractFile({
      tenantId: 'mysc',
      actor: { uid: 'u-1', email: 'pm@mysc.co.kr', role: 'pm' },
      file,
    })).rejects.toThrow('계약서 업로드는 플랫폼 API가 켜진 환경에서만 사용할 수 있습니다.');

    expect(mocks.processProjectRequestContractViaBff).not.toHaveBeenCalled();
  });

  it('normalizes the upload call and reuses an existing actor id token', async () => {
    const result = await uploadProjectRequestContractFile({
      tenantId: 'mysc',
      actor: { uid: 'u-1', email: 'pm@mysc.co.kr', role: 'pm', idToken: 'existing-token' },
      file,
    });

    expect(result.contractDocument.name).toBe('contract.pdf');
    expect(mocks.getAuthInstance).not.toHaveBeenCalled();
    expect(mocks.processProjectRequestContractViaBff).toHaveBeenCalledWith({
      tenantId: 'mysc',
      actor: { uid: 'u-1', email: 'pm@mysc.co.kr', role: 'pm', idToken: 'existing-token' },
      file,
    });
  });

  it('refreshes the Firebase id token when the actor does not carry one', async () => {
    await uploadProjectRequestContractFile({
      tenantId: 'mysc',
      actor: { uid: 'u-1', email: 'pm@mysc.co.kr', role: 'pm' },
      file,
    });

    expect(mocks.processProjectRequestContractViaBff).toHaveBeenCalledWith({
      tenantId: 'mysc',
      actor: { uid: 'u-1', email: 'pm@mysc.co.kr', role: 'pm', idToken: 'fresh-token' },
      file,
    });
  });
});
