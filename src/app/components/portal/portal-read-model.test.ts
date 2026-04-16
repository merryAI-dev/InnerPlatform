import { describe, expect, it } from 'vitest';
import { resolvePortalProjectReadModel } from './portal-read-model';

describe('resolvePortalProjectReadModel', () => {
  it('prefers the BFF summary project for read surfaces', () => {
    const model = resolvePortalProjectReadModel({
      activeProjectId: 'project-bff',
      summaryProject: {
        id: 'project-bff',
        name: 'BFF 사업',
        status: 'IN_PROGRESS',
        clientOrg: 'MYSC',
        managerName: '보람',
        department: 'AXR',
      },
      fallbackProject: {
        id: 'project-store',
        name: '스토어 사업',
        status: 'CONTRACT_PENDING',
        clientOrg: 'Fallback Org',
        managerName: '다른 담당자',
        department: 'Ops',
        type: 'CONSULTING',
      },
    });

    expect(model).toMatchObject({
      projectId: 'project-bff',
      projectName: 'BFF 사업',
      statusLabel: '사업진행중',
      projectMetaLabel: 'MYSC · 보람 · AXR',
      ready: true,
      source: 'bff',
    });
  });

  it('falls back to the store-backed project shape when the summary project is unavailable', () => {
    const model = resolvePortalProjectReadModel({
      activeProjectId: 'project-store',
      summaryProject: null,
      fallbackProject: {
        id: 'project-store',
        name: '스토어 사업',
        status: 'CONTRACT_PENDING',
        clientOrg: 'Fallback Org',
        managerName: '담당자',
        department: 'Ops',
        type: 'CONSULTING',
      },
    });

    expect(model).toMatchObject({
      projectId: 'project-store',
      projectName: '스토어 사업',
      statusLabel: '계약전',
      projectMetaLabel: 'Fallback Org · 담당자 · Ops',
      ready: true,
      source: 'store',
    });
  });
});
