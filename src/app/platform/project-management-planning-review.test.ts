import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import {
  getManagementPlanningReview,
  getManagementPlanningReviewLabel,
} from './project-management-planning-review';

const project = {
  id: 'project-1',
  slug: 'project-1',
  orgId: 'mysc',
  name: '테스트 프로젝트',
} as Project;

describe('management planning project review', () => {
  it('keeps executive approval separate while reading management-planning status and code', () => {
    const review = getManagementPlanningReview({
      ...project,
      executiveReviewStatus: 'APPROVED',
      managementPlanningReviewStatus: 'AGREED',
      managementPlanningReviewedByName: '경영기획실',
      managementPlanningReviewComment: '코드 부여 완료',
      projectCode: 'MYSC-2026-001',
    } as Project);

    expect(review).toMatchObject({
      status: 'AGREED',
      reviewedByName: '경영기획실',
      projectCode: 'MYSC-2026-001',
    });
    expect(getManagementPlanningReviewLabel(review.status)).toBe('합의 완료');
  });

  it('adapts legacy planning agreements to read-only agreed records', () => {
    const review = getManagementPlanningReview({
      ...project,
      executiveReviewStatus: 'APPROVED',
      projectCode: 'OLD-2026-001',
      executiveReviewHistory: [{
        status: 'PLANNING_AGREED',
        reviewedAt: '2026-07-20T09:00:00.000Z',
        reviewedById: 'u-planning',
        reviewedByName: '경영기획실',
        projectCode: 'OLD-2026-001',
      }],
    } as Project);

    expect(review).toMatchObject({
      status: 'AGREED',
      projectCode: 'OLD-2026-001',
      history: [{ status: 'AGREED', reviewedByName: '경영기획실' }],
    });
  });

  it('treats unreviewed projects as awaiting management-planning review', () => {
    expect(getManagementPlanningReview(project).status).toBe('PENDING');
  });
});
