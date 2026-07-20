import type {
  Project,
  ProjectManagementPlanningReviewStatus,
} from '../data/types';

export type ManagementPlanningReviewStatus = ProjectManagementPlanningReviewStatus;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStatus(value: unknown): ManagementPlanningReviewStatus {
  return value === 'AGREED' || value === 'REVISION_REJECTED' ? value : 'PENDING';
}

export function getManagementPlanningReview(project: Project) {
  const managementHistory = Array.isArray(project.managementPlanningReviewHistory)
    ? project.managementPlanningReviewHistory
    : [];
  const legacyAgreement = project.managementPlanningReviewStatus == null
    ? [...(project.executiveReviewHistory || [])].reverse().find((entry) => entry.status === 'PLANNING_AGREED')
    : undefined;
  const legacyHistory = legacyAgreement ? [{
    status: 'AGREED' as const,
    previousStatus: null,
    reviewedAt: text(legacyAgreement.reviewedAt),
    reviewedById: text(legacyAgreement.reviewedById),
    reviewedByName: text(legacyAgreement.reviewedByName),
    reviewComment: text(legacyAgreement.reviewComment),
    projectCode: text(legacyAgreement.projectCode || project.projectCode),
  }] : [];
  return {
    status: legacyAgreement ? 'AGREED' as const : readStatus(project.managementPlanningReviewStatus),
    reviewedAt: text(project.managementPlanningReviewedAt || legacyAgreement?.reviewedAt),
    reviewedByName: text(project.managementPlanningReviewedByName || legacyAgreement?.reviewedByName),
    reviewComment: text(project.managementPlanningReviewComment || legacyAgreement?.reviewComment),
    projectCode: text(project.projectCode),
    history: managementHistory.length > 0 ? managementHistory : legacyHistory,
  };
}

export function getManagementPlanningReviewLabel(status: ManagementPlanningReviewStatus): string {
  if (status === 'AGREED') return '합의 완료';
  if (status === 'REVISION_REJECTED') return '반려';
  return '합의 대기';
}
