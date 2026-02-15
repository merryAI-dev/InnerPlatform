import { describe, expect, it } from 'vitest';
import type { HrAnnouncement } from './hr-announcements-store';
import { buildProjectAlerts, deriveAffectedProjectIds } from './hr-announcements.helpers';

describe('hr-announcements helpers', () => {
  it('derives unique affected project ids for an employee', () => {
    const projectIds = deriveAffectedProjectIds('e01', [
      {
        id: 'pe-1',
        memberId: 'e01',
        memberName: 'A',
        projectId: 'p001',
        projectName: 'P1',
        rate: 50,
        settlementSystem: 'E_NARA_DOUM',
        clientOrg: 'KOICA',
        periodStart: '2026-01',
        periodEnd: '2026-12',
        isDocumentOnly: false,
        note: '',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'pe-2',
        memberId: 'e01',
        memberName: 'A',
        projectId: 'p001',
        projectName: 'P1',
        rate: 20,
        settlementSystem: 'E_NARA_DOUM',
        clientOrg: 'KOICA',
        periodStart: '2026-01',
        periodEnd: '2026-12',
        isDocumentOnly: false,
        note: '',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'pe-3',
        memberId: 'e02',
        memberName: 'B',
        projectId: 'p002',
        projectName: 'P2',
        rate: 100,
        settlementSystem: 'E_NARA_DOUM',
        clientOrg: 'KOICA',
        periodStart: '2026-01',
        periodEnd: '2026-12',
        isDocumentOnly: false,
        note: '',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);

    expect(projectIds).toEqual(['p001']);
  });

  it('builds project alerts from announcement + project metadata', () => {
    const announcement: HrAnnouncement = {
      id: 'hra-1',
      employeeId: 'e01',
      employeeName: '홍길동',
      employeeNickname: '길동',
      eventType: 'RESIGNATION',
      effectiveDate: '2026-02-01',
      announcedAt: '2026-01-01T00:00:00Z',
      announcedBy: '관리자',
      description: '퇴사',
      affectedProjectIds: ['p001'],
      resolved: false,
    };

    const alerts = buildProjectAlerts(
      announcement,
      [{ id: 'p001', name: '프로젝트A', shortName: 'A', clientOrg: 'KOICA', settlement: 'ACCOUNTANT', settlementNote: '', phase: '계약완료', periodDesc: '' }],
      '2026-01-01T00:00:00Z',
    );

    expect(alerts[0].projectName).toBe('프로젝트A');
    expect(alerts[0].announcementId).toBe('hra-1');
    expect(alerts[0].acknowledged).toBe(false);
  });
});
