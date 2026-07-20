import { describe, expect, it } from 'vitest';
import {
  projectExecutiveReviewSchema,
  projectManagementPlanningReviewSchema,
} from './schemas.mjs';

describe('projectExecutiveReviewSchema', () => {
  it('accepts a project code as an approval payload field', () => {
    expect(projectExecutiveReviewSchema.safeParse({ reviewStatus: 'APPROVED', projectCode: 'PRJ-2026-001' }).success).toBe(true);
    expect(projectExecutiveReviewSchema.safeParse({ reviewStatus: 'REVISION_REJECTED', reviewComment: '계약서 보완' }).success).toBe(true);
  });

  it('accepts a planning agreement with a project code', () => {
    expect(projectExecutiveReviewSchema.safeParse({ reviewStatus: 'PLANNING_AGREED', projectCode: 'PRJ-2026-001' }).success).toBe(true);
  });

  it('requires a code to agree and a reason to reject in management planning', () => {
    expect(projectManagementPlanningReviewSchema.safeParse({
      reviewStatus: 'AGREED', projectCode: 'PRJ-2026-001',
    }).success).toBe(true);
    expect(projectManagementPlanningReviewSchema.safeParse({ reviewStatus: 'AGREED' }).success).toBe(false);
    expect(projectManagementPlanningReviewSchema.safeParse({ reviewStatus: 'REVISION_REJECTED' }).success).toBe(false);
    expect(projectManagementPlanningReviewSchema.safeParse({
      reviewStatus: 'REVISION_REJECTED', reviewComment: '계약 기준 보완',
    }).success).toBe(true);
  });
});
