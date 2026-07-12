import { describe, expect, it } from 'vitest';
import { buildSafeFirstLoginMember } from './auth-store';

describe('first-login member bootstrap', () => {
  it('creates only an unassigned PM profile that cannot self-elevate', () => {
    const member = buildSafeFirstLoginMember({
      uid: 'new-user',
      name: 'New User',
      email: 'new-user@mysc.co.kr',
      tenantId: 'mysc',
      avatarUrl: 'https://example.test/avatar.png',
      now: '2026-07-12T00:00:00.000Z',
    });

    expect(member).toEqual(expect.objectContaining({
      uid: 'new-user',
      role: 'pm',
      status: 'ACTIVE',
      tenantId: 'mysc',
      projectId: '',
      projectIds: [],
    }));
    expect(member).not.toHaveProperty('portalProfile');
    expect(member).not.toHaveProperty('projectNames');
    expect(member).not.toHaveProperty('department');
  });
});
