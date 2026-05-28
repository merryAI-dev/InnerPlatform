import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'SettingsPage.tsx'), 'utf8');

describe('SettingsPage member directory contract', () => {
  it('manages the canonical member directory through store CRUD', () => {
    expect(source).toContain('구성원 원장 추가/수정');
    expect(source).toContain('orgs/{org.id}/members');
    expect(source).toContain('upsertMember({');
    expect(source).toContain('await removeMember(uid)');
    expect(source).toContain('Firebase UID');
    expect(source).toContain('이름, 이메일, UID 검색');
  });
});
