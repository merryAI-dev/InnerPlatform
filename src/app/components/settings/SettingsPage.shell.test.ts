import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'SettingsPage.tsx'), 'utf8');

describe('SettingsPage member directory contract', () => {
  it('keeps the admin DB surface limited to member and org databases', () => {
    expect(source).toContain("const PRIMARY_SETTINGS_TABS = ['members', 'tenants'] as const;");
    expect(source).toContain('관리자에게 필요한 멤버DB와 조직DB만 관리합니다');
    expect(source).toContain('구성원 원장 추가/수정');
    expect(source).toContain('조직DB');
    expect(source).not.toContain('프로젝트 선택값');
    expect(source).not.toContain('새 담당조직(CIC)');
    expect(source).not.toContain('useProjectDepartmentSettings');
    expect(source).not.toContain('saveDepartmentOptions');
    expect(source).not.toContain('handleMoveDepartment');
    expect(source).not.toContain('원장 템플릿');
    expect(source).not.toContain('데이터 마이그레이션');
    expect(source).not.toContain('조직 정보</CardTitle>');
    expect(source).not.toContain("value=\"templates\"");
    expect(source).not.toContain("value=\"migration\"");
    expect(source).not.toContain("value=\"org\"");
    expect(source).toContain('구성원 원장 추가/수정');
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

  it('restores the tenant ledger tab instead of falling back to org settings', () => {
    expect(source).toContain("import { TenantManagementTab } from './TenantManagementTab';");
    expect(source).toContain("PRIMARY_SETTINGS_TAB_SET.has(requestedTab) ? requestedTab : 'members'");
    expect(source).toContain('setTab(initialTab)');
    expect(source).toContain('<TabsTrigger value="tenants"');
    expect(source).toContain('조직DB');
    expect(source).toContain('<TabsContent value="tenants">');
    expect(source).toContain('<TenantManagementTab />');
  });
});
