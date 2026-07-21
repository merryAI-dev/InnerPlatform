import { describe, expect, it } from 'vitest';
import { resolveMemberProjectAccessState } from './member-workspace';
import { buildLegacyMemberDocId, mergeMemberRecordSources } from './member-documents';
import { buildMemberDirectoryList } from '../lib/firestore-service';

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

  it('lets the member listener collapse canonical and legacy email documents', () => {
    const members = buildMemberDirectoryList([
      {
        id: 'uid-1',
        data: {
          uid: 'uid-1',
          name: '홍길동',
          email: 'hong@mysc.co.kr',
          role: 'pm',
        },
      },
      {
        id: 'hong_mysc_co_kr',
        data: {
          uid: 'uid-1',
          name: '홍길동 legacy',
          email: 'hong@mysc.co.kr',
          role: 'admin',
          projectIds: ['p1'],
        },
      },
    ]);

    expect(members).toEqual([{
      uid: 'uid-1',
      name: '홍길동',
      email: 'hong@mysc.co.kr',
      role: 'pm',
      avatarUrl: undefined,
    }]);
  });

  it('deduplicates multiple uid-keyed documents for the same email without relying on legacy ids', () => {
    const members = buildMemberDirectoryList([
      {
        id: 'uid-old',
        data: {
          uid: 'uid-old',
          name: '홍길동 이전',
          email: 'hong@mysc.co.kr',
          role: 'viewer',
          status: 'INACTIVE',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      {
        id: 'uid-current',
        data: {
          uid: 'uid-current',
          name: '홍길동',
          email: 'hong@mysc.co.kr',
          role: 'pm',
          status: 'ACTIVE',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      },
    ]);

    expect(members).toEqual([{
      uid: 'uid-current',
      name: '홍길동',
      email: 'hong@mysc.co.kr',
      role: 'pm',
      status: 'ACTIVE',
      avatarUrl: undefined,
    }]);
  });
});
