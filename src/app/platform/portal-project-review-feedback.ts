import type { Project, ProjectRequest } from '../data/types';
import { getManagementPlanningReview, type ManagementPlanningReviewStatus } from './project-management-planning-review';

export interface PortalProjectReviewFeedback {
  id: string;
  label: string;
  reviewerName: string;
  reviewedAt: string;
  comment: string;
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function isVisibleComment(value: unknown): boolean {
  const comment = text(value);
  return Boolean(comment && comment !== 'PM 신규 등록');
}

function executiveLabel(status: string): string {
  if (status === 'APPROVED') return '조직장 승인 메모';
  if (status === 'REVISION_REJECTED') return '조직장 반려 메모';
  if (status === 'DUPLICATE_DISCARDED') return '조직장 폐기 메모';
  return '실무자 제출 메모';
}

function planningLabel(status: ManagementPlanningReviewStatus): string {
  if (status === 'AGREED') return '경영기획실 합의 메모';
  if (status === 'REVISION_REJECTED') return '경영기획실 반려 메모';
  return '경영기획실 검토 메모';
}

export function hasManagementPlanningReview(project: Project): boolean {
  return Boolean(
    project.managementPlanningReviewStatus
    || project.managementPlanningReviewedAt
    || project.managementPlanningReviewedById
    || project.managementPlanningReviewedByName
    || project.managementPlanningReviewComment
    || project.managementPlanningReviewHistory?.length
    || project.projectCode,
  );
}

export function buildPortalProjectReviewFeedback(project: Project, request: ProjectRequest | null): PortalProjectReviewFeedback[] {
  const feedback: PortalProjectReviewFeedback[] = [];
  const seen = new Set<string>();
  const add = (entry: Omit<PortalProjectReviewFeedback, 'id'>) => {
    if (!isVisibleComment(entry.comment)) return;
    const key = [entry.label, entry.reviewerName, entry.reviewedAt, entry.comment].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    feedback.push({ ...entry, id: `feedback-${feedback.length}-${key}` });
  };

  (project.executiveReviewHistory || []).forEach((entry) => add({
    label: executiveLabel(entry.status),
    reviewerName: text(entry.reviewedByName),
    reviewedAt: text(entry.reviewedAt),
    comment: text(entry.reviewComment),
  }));

  const managementReview = getManagementPlanningReview(project);
  managementReview.history.forEach((entry) => add({
    label: planningLabel(entry.status),
    reviewerName: text(entry.reviewedByName),
    reviewedAt: text(entry.reviewedAt),
    comment: text(entry.reviewComment),
  }));
  const managementCommentInHistory = managementReview.history.some((entry) => text(entry.reviewComment) === managementReview.reviewComment);
  if (!managementCommentInHistory) add({
    label: planningLabel(managementReview.status),
    reviewerName: text(managementReview.reviewedByName),
    reviewedAt: text(managementReview.reviewedAt),
    comment: managementReview.reviewComment,
  });

  add({
    label: '실무자 제출 메모',
    reviewerName: text(request?.requestedByName),
    reviewedAt: text(request?.requestedAt),
    comment: text(request?.payload?.note),
  });
  if (request?.status === 'PENDING' && project.executiveReviewStatus === 'APPROVED' && managementReview.status === 'PENDING') add({
    label: '실무자 재제출 메모',
    reviewerName: text(request.requestedByName),
    reviewedAt: text(request.requestedAt),
    comment: text(request.reviewComment),
  });
  if (request?.status === 'REJECTED') {
    const comment = text(request.reviewComment || request.rejectedReason);
    if (!feedback.some((entry) => entry.comment === comment && entry.label.includes('반려 메모'))) add({
      label: managementReview.status === 'REVISION_REJECTED' ? '경영기획실 반려 메모' : '검토 반려 메모',
      reviewerName: text(request.reviewedByName),
      reviewedAt: text(request.reviewedAt),
      comment,
    });
  }
  return feedback.sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt));
}
