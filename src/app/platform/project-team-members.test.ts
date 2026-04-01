import { describe, expect, it } from 'vitest';
import {
  formatProjectTeamMembersSummary,
  hasIncompleteProjectTeamMembers,
  normalizeProjectTeamMembers,
} from './project-team-members';

describe('project-team-members', () => {
  it('formats completed team members into a readable summary', () => {
    const result = formatProjectTeamMembersSummary([
      { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 60 },
      { memberName: '변민욱', memberNickname: '보람', role: '운영', participationRate: 40 },
    ]);

    expect(result).toContain('김다은 (데이나) / PM / 60%');
    expect(result).toContain('변민욱 (보람) / 운영 / 40%');
  });

  it('formats team member without participation rate (omits rate)', () => {
    const result = formatProjectTeamMembersSummary([
      { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 0 },
    ]);

    expect(result).toBe('김다은 (데이나) / PM');
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
});
