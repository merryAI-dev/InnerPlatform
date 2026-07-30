import { describe, expect, it } from 'vitest';
import {
  cashflowSheetLabApplySchema,
  projectExecutiveReviewSchema,
  projectManagementPlanningReviewSchema,
} from './schemas.mjs';

describe('cashflowSheetLabApplySchema', () => {
  it('requires bounded typed pending-approval acceptance evidence', () => {
    expect(cashflowSheetLabApplySchema.safeParse({
      stageRunId: 'stage-1',
      acceptPendingApprovalDifferences: true,
      pendingApprovalDifferenceCount: 160,
      pendingApprovalDifferenceManifestHash: `sha256:${'a'.repeat(64)}`,
    }).success).toBe(true);
    expect(cashflowSheetLabApplySchema.safeParse({
      stageRunId: 'stage-1', pendingApprovalDifferenceCount: -1,
    }).success).toBe(false);
    expect(cashflowSheetLabApplySchema.safeParse({
      stageRunId: 'stage-1', pendingApprovalDifferenceManifestHash: 'forged',
    }).success).toBe(false);
  });
});

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
