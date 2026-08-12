import type { ParticipationEntry } from './types';
import type { HrAnnouncement, ProjectChangeAlert } from './hr-announcements-store';

/** 알림에 이름을 붙이는 데 필요한 최소 정보. 실제 Project 를 그대로 넘길 수 있다. */
export interface AlertProjectRef {
  id: string;
  name: string;
  shortName?: string;
}

export function deriveAffectedProjectIds(
  employeeId: string,
  participationEntries: ParticipationEntry[],
): string[] {
  return [...new Set(
    participationEntries
      .filter((entry) => entry.memberId === employeeId && entry.rate > 0)
      .map((entry) => entry.projectId),
  )];
}

export function buildProjectAlerts(
  announcement: HrAnnouncement,
  projects: AlertProjectRef[],
  nowIso: string,
): ProjectChangeAlert[] {
  return announcement.affectedProjectIds.map((projectId, index) => {
    const project = projects.find((item) => item.id === projectId);

    return {
      id: `pca-${announcement.id}-${index + 1}`,
      announcementId: announcement.id,
      projectId,
      projectName: project?.name || projectId,
      employeeId: announcement.employeeId,
      employeeName: announcement.employeeName,
      eventType: announcement.eventType,
      effectiveDate: announcement.effectiveDate,
      acknowledged: false,
      changeRequestCreated: false,
      createdAt: nowIso,
    };
  });
}
