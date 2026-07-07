import { describe, expect, it } from 'vitest';
import { buildAdminCommandItems, searchAdminCommandItems } from './admin-command-index';

describe('admin command index', () => {
  const project = {
    id: 'project-1',
    name: '2026 더큰 제주',
    shortName: '더큰제주',
    department: '경기팀',
    clientOrg: '제주특별자치도',
    managerName: '해니',
  };

  it('finds admin endpoints by operator keywords, not only page labels', () => {
    const items = buildAdminCommandItems({
      role: 'admin',
      projects: [project],
    });

    expect(searchAdminCommandItems(items, '계약서')[0]).toMatchObject({
      label: '프로젝트 등록/승인',
      to: '/projects/migration-audit',
    });
    expect(searchAdminCommandItems(items, 'CIC')[0]).toMatchObject({
      label: '프로젝트 등록/승인',
      to: '/projects/migration-audit',
    });
    expect(searchAdminCommandItems(items, '권한')[0]).toMatchObject({
      label: '권한/사용자',
      to: '/users',
    });
    expect(searchAdminCommandItems(items, '정산')[0]).toMatchObject({
      label: 'PM 사업비 입력',
      to: '/portal/weekly-expenses',
      category: 'PM',
    });
    expect(searchAdminCommandItems(items, '조직장')[0]).toMatchObject({
      label: '권한/사용자',
      to: '/users',
    });
    expect(searchAdminCommandItems(items, '수정 제출')[0]).toMatchObject({
      label: '프로젝트 등록/승인',
      to: '/projects/migration-audit',
    });
    expect(searchAdminCommandItems(items, '담당조직')[0]).toMatchObject({
      label: '프로젝트',
      to: '/projects',
    });
    expect(searchAdminCommandItems(items, '더큰 제주')[0]).toMatchObject({
      label: '2026 더큰 제주',
      to: '/projects/project-1',
      category: '관리자',
    });
  });

  it('keeps project-registration searches focused on feature endpoints, not project records', () => {
    const items = buildAdminCommandItems({
      role: 'admin',
      projects: [{
        ...project,
        id: 'eco-cmk',
        name: '에코스타트업 CMK',
        shortName: '에코스타트업',
      }],
    });
    const results = searchAdminCommandItems(items, '프로젝트 등록', 8);
    const labels = results.map((item) => item.label);

    expect(labels).toContain('프로젝트 등록/승인');
    expect(labels).toContain('PM 프로젝트 등록 요청');
    expect(labels).not.toContain('에코스타트업 CMK');
    expect(results.every((item) => item.kind === 'page')).toBe(true);
  });

  it('only indexes currently exposed admin surfaces', () => {
    const items = buildAdminCommandItems({
      role: 'admin',
      projects: [],
    });
    const labels = items.map((item) => item.label);

    expect(labels.slice(0, 5)).toEqual([
      '대시보드',
      '프로젝트',
      '프로젝트 등록/승인',
      '캐시플로 모니터링',
      '권한/사용자',
    ]);
    expect(labels).not.toContain('기능 검색');
    expect(items.filter((item) => item.category === '관리자').length).toBeGreaterThan(0);
    expect(items.filter((item) => item.category === 'PM').length).toBeGreaterThan(0);
    expect(searchAdminCommandItems(items, '예산 편집')[0]).toMatchObject({
      label: 'PM 예산 편집',
      to: '/portal/budget',
      category: 'PM',
    });
    expect(searchAdminCommandItems(items, '증빙')[0]).toMatchObject({
      label: 'PM 사업비 입력',
      to: '/portal/weekly-expenses',
      category: 'PM',
    });
    expect(searchAdminCommandItems(items, '사업비 관리')[0]).toMatchObject({
      label: '캐시플로 모니터링',
      to: '/cashflow',
      category: '관리자',
    });
    expect(searchAdminCommandItems(items, '승인 대기열')[0]).toMatchObject({
      label: '프로젝트 등록/승인',
      to: '/projects/migration-audit',
      category: '관리자',
    });
    expect(searchAdminCommandItems(items, '설정')).toEqual([]);
  });
});
