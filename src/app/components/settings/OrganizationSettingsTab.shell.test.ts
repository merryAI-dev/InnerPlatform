import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'OrganizationSettingsTab.tsx'), 'utf8');
const settingsPage = readFileSync(resolve(import.meta.dirname, 'SettingsPage.tsx'), 'utf8');
const departmentStore = readFileSync(
  resolve(import.meta.dirname, '../../data/project-department-settings.tsx'),
  'utf8',
);
const hrConsole = readFileSync(
  resolve(import.meta.dirname, '../people/PersonHrConsole.tsx'),
  'utf8',
);

describe('조직 설정', () => {
  it('설정 페이지에서 열 수 있다', () => {
    expect(settingsPage).toContain('<OrganizationSettingsTab />');
    expect(settingsPage).toContain('소속·직급');
  });

  it('지우기 대신 숨기기만 둔다 — 쓰이던 이름이 사라지면 그 사람들의 소속이 뜻을 잃는다', () => {
    expect(source).toContain('숨기기');
    expect(source).not.toContain('조직 삭제');
    expect(source).toContain('toggleGroupActive');
    expect(source).toContain('toggleTeamActive');
  });

  it('이름을 바꿔도 저장된 데이터는 자동으로 따라가지 않고, 몇 명인지 보고 관리자가 고른다', () => {
    expect(source).toContain('함께 옮기기');
    expect(source).toContain('updatePersonProfileViaBff');
    expect(source).toContain('FIELD_LABELS[renamePlan.field]');
    expect(source).toContain('countUsage');
  });

  it('직급도 여기서 고치고, 목록과 어긋난 값은 몇 명인지 보여 준다', () => {
    // 재경·사내벤처는 별도 체계를 쓴다. 목록에 없는 값도 저장되므로 여기서 정리하거나 목록에 더한다.
    expect(source).toContain('직급 목록');
    expect(source).toContain('usePersonGradeSettings');
    expect(source).toContain('목록에 없는 값을 쓰는 사람');
    expect(source).toContain('staleGrades');
    expect(source).toContain('모든 인력의 소속·팀·직급이 지금 목록과 맞습니다.');
  });

  it('프로젝트 담당조직과 인력 소속이 같은 조직 목록에서 뻗어 나온다', () => {
    // 두 곳에서 따로 고치면 조직 개편이 한쪽에만 반영된다.
    expect(departmentStore).toContain('useOrganizationSettings()');
    expect(departmentStore).toContain('activeTeamLabels(groups)');
    expect(hrConsole).toContain('useOrganizationSettings()');
    expect(hrConsole).toContain('optionsWithCurrentValue(groupOptions, form.departmentTop)');
    expect(hrConsole).toContain('optionsWithCurrentValue(teamOptions, form.departmentMid)');
  });
});
