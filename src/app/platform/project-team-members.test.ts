import { describe, expect, it } from 'vitest';
import {
  formatProjectTeamMembersSummary,
  hasInvalidProjectTeamMemberLaborPeriod,
  hasIncompleteProjectTeamMembers,
  hasInvalidProjectSettlementSupportMember,
  hasProjectOperatingManager,
  normalizeProjectTeamMemberDraftRows,
  normalizeProjectTeamMembers,
  parseProjectTeamMemberIdentityInput,
  PROJECT_TEAM_MEMBER_ROLES,
  projectTeamMembersForWrite,
} from './project-team-members';

describe('project-team-members', () => {
  it('formats completed team members into a readable summary', () => {
    const result = formatProjectTeamMembersSummary([
      { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 60, laborAllocationStartMonth: '2026-03', laborAllocationEndMonth: '2026-08' },
      { memberName: '변민욱', memberNickname: '보람', role: '운영', participationRate: 40 },
    ]);

    expect(result).toContain('김다은 (데이나) / PM / 60% / 인건비 2026-03~2026-08');
    expect(result).toContain('변민욱 (보람) / 운영 / 40%');
  });

  it('formats team member without participation rate (omits rate)', () => {
    const result = formatProjectTeamMembersSummary([
      { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 0 },
    ]);

    expect(result).toBe('김다은 (데이나) / PM');
  });

  it('formats saved partial team rows instead of hiding them from review surfaces', () => {
    const result = formatProjectTeamMembersSummary([
      { memberName: '김다은', memberNickname: '데이나', role: '', participationRate: 0 },
    ]);

    expect(result).toBe('김다은 (데이나)');
  });

  it('keeps empty draft rows while editing before save normalization', () => {
    expect(normalizeProjectTeamMemberDraftRows([
      { memberName: '', memberNickname: '', role: '', participationRate: 0 },
    ])).toEqual([
      { memberName: '', memberNickname: '', role: '', participationRate: 0 },
    ]);
    expect(normalizeProjectTeamMembers([
      { memberName: '', memberNickname: '', role: '', participationRate: 0, laborAllocationStartMonth: '2026-04' },
    ])).toEqual([
      { memberName: '', memberNickname: '', role: '', participationRate: 0, laborAllocationStartMonth: '2026-04' },
    ]);
    expect(normalizeProjectTeamMembers([
      { memberName: '', memberNickname: '', role: '', participationRate: 0, laborAllocationStartMonth: '2026-4' },
    ])).toEqual([]);
  });

  it('preserves raw manual identity input while editing so Korean IME composition is not reformatted', () => {
    expect(normalizeProjectTeamMemberDraftRows([
      {
        inputMode: 'manual',
        identityInput: ' 박지연 ( 느티',
        memberName: '박지연 ( 느티',
        memberNickname: '',
        role: '',
        participationRate: 0,
      },
    ])).toEqual([
      {
        inputMode: 'manual',
        identityInput: ' 박지연 ( 느티',
        memberName: '박지연 ( 느티',
        memberNickname: '',
        role: '',
        participationRate: 0,
      },
    ]);
  });

  it('treats member with a PPT role and explicit document-only choice but no rate as complete', () => {
    expect(hasIncompleteProjectTeamMembers([
      { memberName: '김다은', memberNickname: '', role: '총괄책임자', participationRate: 0, isDocumentOnly: false },
    ])).toBe(false);
  });

  it('preserves the retired final-responsible role on legacy rows', () => {
    expect(hasIncompleteProjectTeamMembers([
      { memberName: '김다은', memberNickname: '', role: '사업 최종 책임자', participationRate: 50, isDocumentOnly: false },
    ])).toBe(false);
  });

  it('rejects a legacy free-text role or missing document-only choice in v2 completeness checks', () => {
    expect(hasIncompleteProjectTeamMembers([
      { memberName: '김다은', memberNickname: '', role: 'PM', participationRate: 50 },
    ])).toBe(true);
  });

  it('detects incomplete rows but keeps normalized values trimmed', () => {
    const members = normalizeProjectTeamMembers([
      { memberName: ' 김다은 ', memberNickname: ' 데이나 ', role: ' ', participationRate: 50 },
      { memberName: '', memberNickname: '', role: '', participationRate: 0 },
    ]);

    expect(members).toEqual([
      { memberName: '김다은', memberNickname: '데이나', role: '', participationRate: 50 },
    ]);
    expect(hasIncompleteProjectTeamMembers(members)).toBe(true);
  });

  it('rejects a reversed labor allocation period before submit', () => {
    expect(hasInvalidProjectTeamMemberLaborPeriod([{
      memberName: '김다은',
      memberNickname: '',
      role: '운영매니저',
      participationRate: 50,
      isDocumentOnly: false,
      laborAllocationStartMonth: '2026-09',
      laborAllocationEndMonth: '2026-03',
    }])).toBe(true);
    expect(hasInvalidProjectTeamMemberLaborPeriod([{
      memberName: '김다은',
      memberNickname: '',
      role: '운영매니저',
      participationRate: 50,
      isDocumentOnly: false,
      laborAllocationStartMonth: '2026-03',
      laborAllocationEndMonth: '2026-09',
    }])).toBe(false);
    expect(hasInvalidProjectTeamMemberLaborPeriod([{
      memberName: '김다은',
      memberNickname: '',
      role: '운영매니저',
      participationRate: 50,
      isDocumentOnly: false,
      laborAllocationStartMonth: '2026-13',
      laborAllocationEndMonth: '2027-01',
    }])).toBe(true);
  });

  it('requires at least one operating manager for registration v2', () => {
    expect(hasProjectOperatingManager([])).toBe(false);
    expect(hasProjectOperatingManager([
      { memberName: '김다은', memberNickname: '', role: '실무책임자', participationRate: 50, isDocumentOnly: false },
    ])).toBe(false);
    expect(hasProjectOperatingManager([
      { memberName: '김다은', memberNickname: '', role: '운영매니저', participationRate: 50, isDocumentOnly: false },
    ])).toBe(true);
    expect(hasProjectOperatingManager([
      { memberName: '김다은', memberNickname: '', role: '운영매니저', participationRate: 0, isDocumentOnly: true },
    ])).toBe(false);
  });

  it('keeps the retired final-responsible role readable without offering it for new selection', () => {
    expect(PROJECT_TEAM_MEMBER_ROLES).not.toContain('사업 최종 책임자');
    expect(projectTeamMembersForWrite([
      { memberName: '기존 책임자', memberNickname: '', role: '사업 최종 책임자', participationRate: 0, isDocumentOnly: false },
      { memberName: '운영자', memberNickname: '', role: '운영매니저', participationRate: 100, isDocumentOnly: false },
    ])).toEqual([
      { memberName: '기존 책임자', memberNickname: '', role: '사업 최종 책임자', participationRate: 0, isDocumentOnly: false },
      { memberName: '운영자', memberNickname: '', role: '운영매니저', participationRate: 100, isDocumentOnly: false },
    ]);
  });

  it('allows only 도담 or 써니 as settlement support', () => {
    expect(hasInvalidProjectSettlementSupportMember([
      { memberName: '송성미', memberNickname: '도담', role: '정산지원', participationRate: 0, isDocumentOnly: false },
      { memberName: '최지윤', memberNickname: '써니', role: '정산지원', participationRate: 0, isDocumentOnly: false },
    ])).toBe(false);
    expect(hasInvalidProjectSettlementSupportMember([
      { memberName: '다른 구성원', memberNickname: '', role: '정산지원', participationRate: 0, isDocumentOnly: false },
    ])).toBe(true);
  });

  it('parses manual identity input in 이름(별명) format', () => {
    expect(parseProjectTeamMemberIdentityInput('박지연(느티)')).toEqual({
      memberName: '박지연',
      memberNickname: '느티',
    });
    expect(parseProjectTeamMemberIdentityInput(' 박지연 ( 느티 ) ')).toEqual({
      memberName: '박지연',
      memberNickname: '느티',
    });
    expect(parseProjectTeamMemberIdentityInput('느티')).toEqual({
      memberName: '느티',
      memberNickname: '',
    });
  });
});
