import { describe, expect, it } from 'vitest';
import {
  formatProjectTeamMembersSummary,
  hasIncompleteProjectTeamMembers,
  normalizeProjectTeamMemberDraftRows,
  normalizeProjectTeamMembers,
  parseProjectTeamMemberIdentityInput,
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

  it('treats member with name and role but no rate as complete', () => {
    expect(hasIncompleteProjectTeamMembers([
      { memberName: '김다은', memberNickname: '', role: 'PM', participationRate: 0 },
    ])).toBe(false);
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
