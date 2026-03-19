import { describe, expect, it } from 'vitest';
import { resolveMemberProjectAccessState } from './member-workspace';
import { buildLegacyMemberDocId, mergeMemberRecordSources } from './member-documents';

describe('member document helpers', () => {
  it('builds the legacy email-key member id from normalized email', () => {
    expect(buildLegacyMemberDocId(' MWByun1220@MYSC.co.kr ')).toBe('mwbyun1220_mysc_co_kr');
  });

  it('merges legacy project access into canonical members without losing canonical role', () => {
    const merged = mergeMemberRecordSources(
      {
        uid: 'uid-1',
        email: 'pm@mysc.co.kr',
        role: 'pm',
        projectIds: [],
        portalProfile: {
          projectId: 'p2',
          projectIds: ['p2'],
        },
      },
      {
        uid: 'uid-1',
        email: 'pm@mysc.co.kr',
        role: 'admin',
        projectId: 'p1',
        projectIds: [{ id: 'p1', name: '사업 A' }],
        projectNames: {
          p1: '사업 A',
        },
        defaultWorkspace: 'portal',
        portalProfile: {
          projectId: 'p1',
          projectIds: ['p1'],
          projectNames: {
            p1: '사업 A',
          },
        },
      },
    );

    expect(merged?.role).toBe('pm');
    expect(merged?.defaultWorkspace).toBe('portal');
    const access = resolveMemberProjectAccessState(merged);
    expect(access.normalizedProjectId).toBe('p2');
    expect(access.normalizedProjectIds).toEqual(['p1', 'p2']);
    expect(access.projectNames).toEqual({ p1: '사업 A' });
  });

  it('falls back to legacy values when canonical fields are blank', () => {
    const merged = mergeMemberRecordSources(
      {
        uid: 'uid-2',
        name: '',
        email: '',
      },
      {
        uid: 'uid-2',
        name: '홍길동',
        email: 'hong@mysc.co.kr',
        role: 'viewer',
      },
    );

    expect(merged).toMatchObject({
      uid: 'uid-2',
      name: '홍길동',
      email: 'hong@mysc.co.kr',
      role: 'viewer',
    });
  });
});
