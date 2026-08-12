import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import { matchesProjectSearch } from './project-search';

const project = {
  id: 'p1773817948751',
  name: '26농식품AC',
  officialContractName: '농식품 창업기업 액셀러레이팅 계약',
  groupwareName: '2026 농식품 AC',
  clientOrg: '한국농업기술진흥원',
  department: '엑셀러레이팅 CIC',
  managerName: '메씨리',
  registeredByName: '해니',
  type: 'ACCELERATING',
  teamMembersDetailed: [
    { memberName: '김메리', memberNickname: '메리', role: 'PM' },
    { memberName: '이동료', memberNickname: '동료', role: '운영진' },
  ],
} as Project;

describe('matchesProjectSearch', () => {
  it.each([
    '농식품ac',
    '창업기업 액셀러레이팅',
    '2026 농식품',
    '농업기술',
    '엑셀러레이팅 cic',
    '메씨리',
    '해니',
    '김메리',
    '동료',
    '운영진',
    'p1773817948751',
  ])('matches partial text across project identity fields: %s', (query) => {
    expect(matchesProjectSearch(project, query)).toBe(true);
  });

  it('ignores surrounding spaces and letter case', () => {
    expect(matchesProjectSearch(project, '  AC  ')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesProjectSearch(project, '현금흐름')).toBe(false);
  });
});
