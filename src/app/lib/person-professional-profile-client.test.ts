import { describe, expect, it, vi } from 'vitest';
import {
  createPersonProfessionalProfileClient,
  type ProfessionalProfileCatalog,
  type ProfessionalProfileInput,
} from './person-professional-profile-client';
import type { PlatformApiClientLike } from './platform-bff-client';

const actor = { uid: 'admin-a', role: 'admin', idToken: 'token-a' };
const catalog: ProfessionalProfileCatalog = {
  catalogVersion: 1,
  educationAttainments: [{ code: 'MASTER_GRADUATED', label: '석사 졸업', rank: 60 }],
  englishTests: [{
    code: 'TOEIC', label: 'TOEIC', displayLabel: 'TOEIC',
    scales: [{ code: 'TOEIC_990', resultType: 'NUMBER', min: 0, max: 990, step: 1 }],
  }],
  educationRegions: [
    { code: 'DOMESTIC', label: '국내', rank: 10 },
    { code: 'OVERSEAS_ENGLISH', label: '해외(영미권)', rank: 20 },
    { code: 'OVERSEAS_OTHER', label: '해외(기타)', rank: 30 },
  ],
};
const profile: ProfessionalProfileInput = {
  educationRecords: [{
    attainmentCode: 'MASTER_GRADUATED', institutionName: 'University of Sussex',
    regionCode: 'OVERSEAS_ENGLISH', major: 'Development Studies',
  }],
  englishEvidence: [{
    testCode: 'TOEIC', scaleCode: 'TOEIC_990', resultValue: '920',
    otherTestName: null, testedAt: '2026-06',
  }],
  certifications: [{ label: 'PMP' }],
};

function mockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    request: vi.fn(),
  } as unknown as PlatformApiClientLike;
}

describe('person professional profile client', () => {
  it('loads catalog and one person profile with abortable GET requests', async () => {
    const client = mockClient();
    const controller = new AbortController();
    vi.mocked(client.get)
      .mockResolvedValueOnce({ data: catalog })
      .mockResolvedValueOnce({ data: {
        profile: {
          schemaVersion: 1,
          ...profile,
          certifications: [{ key: 'pmp', label: 'PMP' }],
          provenance: { source: 'PEOPLE_MANUAL', revision: 2, updatedAt: '2026-08-24T00:00:00.000Z', updatedBy: 'admin-a' },
        },
        revision: 2,
      } });
    const feature = createPersonProfessionalProfileClient({ tenantId: 'mysc', actor, client });

    await expect(feature.getCatalog(controller.signal)).resolves.toEqual(catalog);
    await expect(feature.get('person 한글', controller.signal)).resolves.toMatchObject({ revision: 2 });

    expect(client.get).toHaveBeenNthCalledWith(1, '/api/v1/person-professional-profile/catalog', expect.objectContaining({
      tenantId: 'mysc', actor: expect.objectContaining({ id: 'admin-a', role: 'admin', idToken: 'token-a' }),
      signal: controller.signal,
    }));
    expect(client.get).toHaveBeenNthCalledWith(2, '/api/v1/persons/person%20%ED%95%9C%EA%B8%80/professional-profile', expect.objectContaining({
      signal: controller.signal,
    }));
  });

  it('saves a full replacement with the caller-owned stable idempotency key', async () => {
    const client = mockClient();
    const canonical = {
      schemaVersion: 1,
      ...profile,
      certifications: [{ key: 'pmp', label: 'PMP' }],
      provenance: { source: 'PEOPLE_MANUAL' as const, revision: 3, updatedAt: '2026-08-25T00:00:00.000Z', updatedBy: 'admin-a' },
    };
    vi.mocked(client.request).mockResolvedValue({
      data: { profile: canonical, revision: 3, changed: true },
    });
    const feature = createPersonProfessionalProfileClient({ tenantId: 'mysc', actor, client });

    await expect(feature.save('person-a', {
      expectedRevision: 2,
      profile,
      idempotencyKey: 'profile-person-a-attempt-1',
    })).resolves.toEqual({ profile: canonical, revision: 3, changed: true });

    expect(client.request).toHaveBeenCalledWith('/api/v1/persons/person-a/professional-profile', expect.objectContaining({
      method: 'PUT',
      tenantId: 'mysc',
      body: { expectedRevision: 2, profile },
      idempotencyKey: 'profile-person-a-attempt-1',
      retries: 0,
    }));
  });

  it('rejects an empty or path-like person id before making a request', async () => {
    const client = mockClient();
    const feature = createPersonProfessionalProfileClient({ tenantId: 'mysc', actor, client });

    await expect(feature.get('  ')).rejects.toThrow('person ID');
    await expect(feature.get('person/a')).rejects.toThrow('person ID');
    expect(client.get).not.toHaveBeenCalled();
  });
});
