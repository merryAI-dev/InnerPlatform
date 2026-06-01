import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'SettingsPage.tsx'), 'utf8');

describe('SettingsPage member directory contract', () => {
  it('keeps project selection values admin-managed in the member tab', () => {
    expect(source).toContain('프로젝트 선택값');
    expect(source).toContain('새 담당조직(CIC)');
    expect(source).toContain('useProjectDepartmentSettings');
    expect(source).toContain('saveDepartmentOptions');
    expect(source).toContain('handleRemoveDepartment');
    expect(source).toContain('handleMoveDepartment');
    expect(source).toContain('이미 등록된 담당조직(CIC)입니다.');
    expect(source).toContain('<ArrowUp className="h-3.5 w-3.5" />');
    expect(source).toContain('<ArrowDown className="h-3.5 w-3.5" />');
    expect(source.indexOf('{renderProjectSelectionValuesCard()}')).toBeLessThan(source.indexOf('구성원 원장 추가/수정'));
    expect(source).toContain('xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]');
    expect(source).toContain('구성원 원장 추가/수정');
    expect(source).toContain("const PRIMARY_SETTINGS_TABS = ['org', 'members', 'templates', 'migration', 'permissions'] as const;");
    expect(source).not.toContain("'project-options'");
  });

  it('manages the canonical member directory through store CRUD', () => {
    expect(source).toContain('구성원 원장 추가/수정');
    expect(source).toContain('upsertMember({');
    expect(source).toContain('await removeMember(uid)');
    expect(source).toContain('Firebase UID');
    expect(source).toContain('이름, 이메일, UID 검색');
  });

  it('keeps the settings surface aligned with the MYSCube brand system', () => {
    expect(source).toContain('MyscWordmark');
    expect(source).toContain('text-primary');
    expect(source).toContain('data-[state=active]:bg-primary');
    expect(source).not.toContain('Primary Admin Settings');
    expect(source).not.toContain('운영 설정 범위');
  });

  it('keeps unauthorized settings access in place instead of redirecting home', () => {
    expect(source).toContain('settingsAccessBlocked');
    expect(source).toContain('설정 접근 권한이 없습니다');
    expect(source).not.toContain('navigate(resolveHomePath(role, activeWorkspace), { replace: true })');
  });
});
