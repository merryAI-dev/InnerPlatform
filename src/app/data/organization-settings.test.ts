import { describe, expect, it } from 'vitest';
import {
  activeTeamLabels,
  buildDefaultOrganizationGroups,
  buildOrganizationSettingsDoc,
  normalizeOrganizationGroups,
  optionsWithCurrentValue,
  resolveOrganizationGroups,
} from './organization-settings';

describe('조직 목록', () => {
  it('설정 문서가 없으면 기본 조직으로 시작한다 — 빈 드롭다운을 보이지 않게', () => {
    const groups = resolveOrganizationGroups(null);
    expect(groups.map((group) => group.label)).toEqual([
      '대표이사실', '리더십·전략 총괄그룹', '자본·투자 운용그룹', 'CIC 사내벤처기업',
    ]);
    expect(activeTeamLabels(groups)).toContain('CIC 1');
    expect(activeTeamLabels(groups)).toContain('EXR팀');
  });

  it('숨긴 조직·팀은 선택지에서 빠지지만 목록에서는 사라지지 않는다', () => {
    const groups = buildDefaultOrganizationGroups().map((group) => (
      group.label === 'CIC 사내벤처기업'
        ? { ...group, teams: group.teams.map((team) => (team.label === 'CIC 1' ? { ...team, active: false } : team)) }
        : group
    ));
    expect(activeTeamLabels(groups)).not.toContain('CIC 1');
    expect(groups.flatMap((g) => g.teams.map((t) => t.label))).toContain('CIC 1');
  });

  it('지금 저장된 값이 목록에 없어도 드롭다운에서 삼키지 않는다', () => {
    // 드롭다운이 기존 값을 지우면 저장하는 순간 소속이 조용히 바뀐다.
    expect(optionsWithCurrentValue(['CIC 1', 'CIC 2'], 'CIC1')).toEqual(['CIC 1', 'CIC 2', 'CIC1']);
    expect(optionsWithCurrentValue(['CIC 1'], 'CIC 1')).toEqual(['CIC 1']);
    expect(optionsWithCurrentValue(['CIC 1'], '')).toEqual(['CIC 1']);
  });

  it('빈 이름과 중복 이름은 버리고 순서를 다시 매긴다', () => {
    const normalized = normalizeOrganizationGroups([
      { id: 'b', label: '나중', sortOrder: 5, teams: [{ label: '팀A' }, { label: '팀A' }, { label: '  ' }] },
      { id: 'a', label: '먼저', sortOrder: 1, teams: [] },
      { label: '   ' },
      { id: 'c', label: '먼저', teams: [] },
    ]);
    expect(normalized.map((group) => group.label)).toEqual(['먼저', '나중']);
    expect(normalized[1].teams.map((team) => team.label)).toEqual(['팀A']);
  });

  it('저장 문서는 순서를 다시 매기고 누가 언제 고쳤는지 남긴다', () => {
    const doc = buildOrganizationSettingsDoc({
      groups: buildDefaultOrganizationGroups(),
      actorId: 'actor-a',
      now: '2026-08-27T00:00:00.000Z',
    });
    expect(doc.version).toBe(1);
    expect(doc.updatedBy).toBe('actor-a');
    expect(doc.groups.map((group) => group.sortOrder)).toEqual([0, 1, 2, 3]);
    expect(doc.groups[0].teams.map((team) => team.sortOrder)).toEqual([0, 1, 2]);
  });
});
