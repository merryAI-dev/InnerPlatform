import { describe, expect, it } from 'vitest';
import { buildProjectTeamMemberSyncKeys } from './projects.mjs';

// 참여행 문서 ID 가 이 키로 만들어진다(`pte-{사업}-{키}`). 키가 바뀌면 연결이 끊기고,
// 키가 겹치면 참여행이 서로 덮어써 참여율이 사라진다. 두 가지를 함께 지킨다.
describe('참여행 연결 키', () => {
  it('역할을 넣지 않는다 - 역할명을 고쳐도 같은 사람의 연결이 유지되어야 한다', () => {
    const before = buildProjectTeamMemberSyncKeys([
      { memberName: '김정태', memberNickname: '에이블', role: '사업 총괄' },
    ]);
    const afterRoleRename = buildProjectTeamMemberSyncKeys([
      { memberName: '김정태', memberNickname: '에이블', role: '총괄책임자' },
    ]);
    expect(before).toEqual(['에이블']);
    expect(afterRoleRename).toEqual(before);
  });

  it('닉네임이 없으면 이름으로 만든다', () => {
    expect(buildProjectTeamMemberSyncKeys([{ memberName: '노성진', role: '사업총괄' }])).toEqual(['노성진']);
  });

  it('한 사업에 같은 사람이 두 역할로 있으면 그때만 역할을 덧붙인다', () => {
    expect(buildProjectTeamMemberSyncKeys([
      { memberNickname: '에이블', role: '사업총괄' },
      { memberNickname: '에이블', role: '서류총괄' },
      { memberNickname: '유자', role: '실무책임자' },
    ])).toEqual(['에이블__사업총괄', '에이블__서류총괄', '유자']);
  });

  it('겹치는 사람의 키가 서로 달라 참여행이 덮어써지지 않는다', () => {
    const keys = buildProjectTeamMemberSyncKeys([
      { memberNickname: '에이블', role: '사업총괄' },
      { memberNickname: '에이블', role: '서류총괄' },
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('사람도 역할도 비어 있으면 자리표시자로 채워 키가 빈 문자열이 되지 않는다', () => {
    expect(buildProjectTeamMemberSyncKeys([{}, {}])).toEqual(['member__role', 'member__role']);
  });

  it('명단이 비었거나 배열이 아니면 빈 결과를 준다', () => {
    expect(buildProjectTeamMemberSyncKeys([])).toEqual([]);
    expect(buildProjectTeamMemberSyncKeys(undefined)).toEqual([]);
  });
});
