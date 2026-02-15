import type { ParticipationEntry } from './types';
import type { ParticipationProject } from './participation-data';
import type { HrAnnouncement, ProjectChangeAlert } from './hr-announcements-store';

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
  projects: ParticipationProject[],
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
