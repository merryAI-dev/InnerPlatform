import { describe, expect, it } from 'vitest';
import { restoreExecutiveReviewAfterWithdraw } from './routes/project-info-drafts.mjs';

describe('restoreExecutiveReviewAfterWithdraw', () => {
  it('puts back the approval that the change request had interrupted', () => {
    const restored = restoreExecutiveReviewAfterWithdraw({
      executiveReviewStatus: 'PENDING',
      executiveReviewHistory: [
        { status: 'PENDING', previousStatus: null, reviewedAt: '2026-03-18T00:00:00.000Z' },
        {
          status: 'APPROVED',
          previousStatus: 'PENDING',
          reviewedAt: '2026-04-01T00:00:00.000Z',
          reviewedById: 'head-1',
          reviewedByName: '조직장',
          reviewComment: '승인합니다',
        },
        { status: 'PENDING', previousStatus: 'APPROVED', reviewedAt: '2026-08-04T00:00:00.000Z' },
      ],
    });
    expect(restored.executiveReviewStatus).toBe('APPROVED');
    expect(restored.executiveReviewedById).toBe('head-1');
    expect(restored.executiveReviewedByName).toBe('조직장');
    expect(restored.executiveReviewComment).toBe('승인합니다');
    expect(restored.executiveReviewedAt).toBe('2026-04-01T00:00:00.000Z');
  });

  it('restores the most recent decision when a project was approved then rejected', () => {
    const restored = restoreExecutiveReviewAfterWithdraw({
      executiveReviewHistory: [
        { status: 'APPROVED', reviewedById: 'head-1' },
        { status: 'REVISION_REJECTED', reviewedById: 'head-2', reviewComment: '보완 필요' },
        { status: 'PENDING', previousStatus: 'REVISION_REJECTED' },
      ],
    });
    expect(restored.executiveReviewStatus).toBe('REVISION_REJECTED');
    expect(restored.executiveReviewedById).toBe('head-2');
    expect(restored.executiveReviewComment).toBe('보완 필요');
  });

  it('leaves a never-decided project pending with no fabricated reviewer', () => {
    const restored = restoreExecutiveReviewAfterWithdraw({
      executiveReviewStatus: 'PENDING',
      executiveReviewHistory: [
        { status: 'PENDING', previousStatus: null, reviewedById: 'pm-1', reviewComment: 'PM 신규 등록' },
      ],
    });
    expect(restored.executiveReviewStatus).toBe('PENDING');
    expect(restored.executiveReviewedById).toBeNull();
    expect(restored.executiveReviewedByName).toBeNull();
    expect(restored.executiveReviewComment).toBeNull();
    expect(restored.executiveReviewedAt).toBeNull();
  });

  it('treats a missing or empty history as never decided', () => {
    expect(restoreExecutiveReviewAfterWithdraw({}).executiveReviewStatus).toBe('PENDING');
    expect(restoreExecutiveReviewAfterWithdraw({ executiveReviewHistory: [] }).executiveReviewStatus).toBe('PENDING');
    expect(restoreExecutiveReviewAfterWithdraw(null).executiveReviewStatus).toBe('PENDING');
  });

  it('ignores history rows that carry no usable status', () => {
    const restored = restoreExecutiveReviewAfterWithdraw({
      executiveReviewHistory: [
        { status: 'APPROVED', reviewedById: 'head-1' },
        { status: '' },
        { previousStatus: 'APPROVED' },
      ],
    });
    expect(restored.executiveReviewStatus).toBe('APPROVED');
    expect(restored.executiveReviewedById).toBe('head-1');
  });
});
