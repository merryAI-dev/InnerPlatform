import { describe, expect, it } from 'vitest';
import type { Project, ProjectRequest } from '../data/types';
import { buildPortalProjectReviewFeedback } from './portal-project-review-feedback';

const project = {
  id: 'project-1', slug: 'project-1', orgId: 'mysc', name: '프로젝트',
  executiveReviewStatus: 'APPROVED',
  executiveReviewHistory: [{ status: 'APPROVED', reviewedAt: '2026-07-10T01:00:00.000Z', reviewedById: 'head-1', reviewedByName: '조직장', reviewComment: '계약 조건 확인했습니다.' }],
  managementPlanningReviewStatus: 'REVISION_REJECTED',
  managementPlanningReviewHistory: [{ status: 'REVISION_REJECTED', reviewedAt: '2026-07-11T01:00:00.000Z', reviewedById: 'planning-1', reviewedByName: '경영기획실', reviewComment: '프로젝트 코드를 다시 확인해 주세요.' }],
} as Project;

describe('portal project review feedback', () => {
  it('keeps the organization approval and exposes the distinct management-planning rejection', () => {
    const request = {
      id: 'request-1', status: 'REJECTED', payload: { note: '계약 범위를 보완해 제출합니다.' },
      requestedByName: '실무자', requestedAt: '2026-07-09T01:00:00.000Z',
      reviewedByName: '경영기획실', reviewedAt: '2026-07-11T01:00:00.000Z', reviewComment: '프로젝트 코드를 다시 확인해 주세요.',
    } as ProjectRequest;

    expect(buildPortalProjectReviewFeedback(project, request)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '경영기획실 반려 메모', reviewerName: '경영기획실' }),
      expect.objectContaining({ label: '조직장 승인 메모', reviewerName: '조직장' }),
      expect.objectContaining({ label: '실무자 제출 메모', reviewerName: '실무자' }),
    ]));
  });
});
