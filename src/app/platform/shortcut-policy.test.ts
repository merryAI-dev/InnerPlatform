import { describe, expect, it } from 'vitest';
import { getShortcutGroupsForRole } from './shortcut-policy';

function flattenDescriptions(groups: { shortcuts: { desc: string }[] }[]) {
  return groups.flatMap((g) => g.shortcuts.map((s) => s.desc));
}

describe('shortcut policy', () => {
  it('shows admin-only shortcuts for admin roles', () => {
    const descs = flattenDescriptions(getShortcutGroupsForRole('admin'));
    expect(descs).toContain('설정으로 이동');
    expect(descs).toContain('새 사업 등록');
  });

  it('filters out settings/new-project for finance', () => {
    const descs = flattenDescriptions(getShortcutGroupsForRole('finance'));
    expect(descs).toContain('프로젝트 목록으로 이동');
    expect(descs).toContain('감사로그로 이동');
    expect(descs).not.toContain('설정으로 이동');
    expect(descs).not.toContain('새 사업 등록');
  });

  it('filters shortcuts for security role', () => {
    const descs = flattenDescriptions(getShortcutGroupsForRole('security'));
    expect(descs).toContain('감사로그로 이동');
    expect(descs).not.toContain('캐시플로로 이동');
    expect(descs).not.toContain('증빙/정산으로 이동');
    expect(descs).not.toContain('새 사업 등록');
    expect(descs).not.toContain('설정으로 이동');
  });
});
