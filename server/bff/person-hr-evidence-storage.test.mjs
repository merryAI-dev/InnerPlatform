import { describe, expect, it, vi } from 'vitest';
import { createPersonHrEvidenceStorageService, personEvidencePrefix } from './person-hr-evidence-storage.mjs';

function createBucket(overrides = {}) {
  const files = new Map();
  const bucket = {
    file: vi.fn((path) => ({
      getSignedUrl: vi.fn(async () => [`https://storage.example/${encodeURIComponent(path)}`]),
      exists: vi.fn(async () => [files.has(path)]),
      getMetadata: vi.fn(async () => [files.get(path) || {}]),
      download: vi.fn(async () => [Buffer.from('evidence')]),
      delete: vi.fn(async () => undefined),
      ...overrides,
    })),
  };
  return { bucket, files };
}

function createService(bucket, createEvidenceId = () => 'ev-1') {
  return createPersonHrEvidenceStorageService({
    bucketName: 'test-bucket',
    adminApp: {},
    storage: { bucket: () => bucket },
    createEvidenceId,
  });
}

describe('인사정보 증빙 저장', () => {
  it('경로를 사람 밑으로 고정하고 서명 URL 을 준다 — 브라우저가 경로를 정하지 않는다', async () => {
    const { bucket } = createBucket();
    const service = createService(bucket);
    const session = await service.createUploadUrl({
      tenantId: 'mysc', personId: 'psn-a', fileName: '졸업 증명서.pdf', mimeType: 'application/pdf',
    });
    expect(session.evidenceId).toBe('ev-1');
    expect(session.path).toBe('orgs/mysc/person-hr-evidence/psn-a/ev-1-졸업_증명서.pdf');
    expect(session.path.startsWith(personEvidencePrefix('mysc', 'psn-a'))).toBe(true);
    expect(session.uploadUrl).toContain('https://storage.example/');
  });

  it('다른 사람 경로나 상위 경로 탈출은 읽지도 지우지도 않는다', async () => {
    const { bucket } = createBucket();
    const service = createService(bucket);
    await expect(service.downloadEvidence({
      tenantId: 'mysc', personId: 'psn-a', path: 'orgs/mysc/person-hr-evidence/psn-b/ev-9-x.pdf',
    })).rejects.toThrow(/outside the person prefix/);
    await expect(service.downloadEvidence({
      tenantId: 'mysc', personId: 'psn-a', path: 'orgs/mysc/person-hr-evidence/psn-a/../psn-b/x.pdf',
    })).rejects.toThrow(/outside the person prefix/);

    // 지우기는 조용히 넘어간다 - 정리 작업이 남의 파일을 건드리면 안 되고, 없는 파일에 실패할 이유도 없다.
    await service.deleteEvidence({ tenantId: 'mysc', personId: 'psn-a', path: 'orgs/mysc/other/x.pdf' });
    expect(bucket.file).not.toHaveBeenCalledWith('orgs/mysc/other/x.pdf');
  });

  it('업로드 여부와 크기는 스토리지에서 다시 읽는다 — 브라우저가 적어 온 값은 믿지 않는다', async () => {
    const { bucket, files } = createBucket();
    const path = 'orgs/mysc/person-hr-evidence/psn-a/ev-1-diploma.pdf';
    files.set(path, { size: '2048', contentType: 'application/pdf', timeCreated: '2026-08-27T00:00:00.000Z' });
    const service = createService(bucket);
    const described = await service.describeEvidence({
      tenantId: 'mysc', personId: 'psn-a', evidenceId: 'ev-1', fileName: 'diploma.pdf',
    });
    expect(described).toMatchObject({ path, size: 2048, contentType: 'application/pdf' });

    const missing = await service.describeEvidence({
      tenantId: 'mysc', personId: 'psn-a', evidenceId: 'ev-2', fileName: 'diploma.pdf',
    });
    expect(missing).toBeNull();
  });
});
