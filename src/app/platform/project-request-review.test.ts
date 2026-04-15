import { describe, expect, it } from 'vitest';
import type { ProjectRequest } from '../data/types';
import { buildProjectRequestReviewModel } from './project-request-review';

function createRequest(overrides: Partial<ProjectRequest> = {}): ProjectRequest {
  const base: ProjectRequest = {
    id: 'req-1',
    status: 'PENDING',
    payload: {
      name: 'AI 계약서 검토 요청',
      officialContractName: 'AI 계약서 검토 요청',
      type: 'D1',
      description: '기본 설명',
      clientOrg: '클라이언트',
      department: '기획팀',
      contractAmount: 12000000,
      salesVatAmount: 1200000,
      totalRevenueAmount: 13200000,
      supportAmount: 0,
      financialInputFlags: {
        contractAmount: true,
        salesVatAmount: true,
        totalRevenueAmount: true,
        supportAmount: false,
      },
      contractStart: '2026-04-01',
      contractEnd: '2026-12-31',
      settlementType: 'TYPE1',
      basis: '공급가액',
      accountType: 'OPERATING',
      fundInputMode: 'BANK_UPLOAD',
      paymentPlanDesc: '선금 50%, 잔금 50%',
      settlementGuide: '잔금은 검수 후 지급',
      projectPurpose: '사업 목적',
      managerName: '보람',
      teamName: '플랫폼팀',
      teamMembers: '보람(PL)',
      participantCondition: '조건 없음',
      note: '검토 필요',
      contractDocument: null,
      contractAnalysis: null,
    },
    requestedBy: 'u-1',
    requestedByName: '요청자',
    requestedByEmail: 'requester@example.com',
    requestedAt: '2026-04-15T00:00:00.000Z',
  };
  return {
    ...base,
    ...overrides,
    payload: {
      ...base.payload,
      ...(overrides.payload || {}),
    },
  };
}

describe('project-request-review', () => {
  it('derives missing fields and approval checklist groups from a request payload', () => {
    const model = buildProjectRequestReviewModel(createRequest());

    expect(model.summary.missingCount).toBeGreaterThan(0);
    expect(model.missingFields.map((item) => item.label)).toContain('계약서 PDF');
    expect(model.missingFields.map((item) => item.label)).toContain('계약 분석 초안');
    expect(model.checklistGroups.map((group) => group.label)).toEqual([
      '기본 정보',
      '계약 및 증빙',
      '핵심 재무',
      '정산',
      '팀/비고',
    ]);
    expect(model.badges.map((badge) => badge.label)).toEqual(expect.arrayContaining([
      expect.stringContaining('누락'),
      expect.stringContaining('확인 필요'),
    ]));
  });

  it('surfaces ai contract highlights, warnings, and next actions', () => {
    const model = buildProjectRequestReviewModel(createRequest({
      payload: {
        contractDocument: {
          path: 'docs/contract.pdf',
          name: 'contract.pdf',
          downloadURL: 'https://example.com/contract.pdf',
          size: 1000,
          contentType: 'application/pdf',
          uploadedAt: '2026-04-15T00:00:00.000Z',
        },
        contractAnalysis: {
          provider: 'anthropic',
          model: 'claude-3-7-sonnet',
          summary: '공식 계약명과 계약 기간, 금액이 추출되었습니다.',
          warnings: ['계약 종료일은 수기 확인이 필요합니다.'],
          nextActions: ['계약금액을 원문과 대조하세요.'],
          extractedAt: '2026-04-15T01:00:00.000Z',
          fields: {
            officialContractName: { value: 'AI 계약서 검토 요청', confidence: 'high', evidence: '본문 1행' },
            suggestedProjectName: { value: 'AI 계약서 검토 요청', confidence: 'medium', evidence: '제목 줄' },
            clientOrg: { value: '클라이언트', confidence: 'high', evidence: '상대방 표기' },
            projectPurpose: { value: '사업 목적', confidence: 'low', evidence: '본문 요약' },
            description: { value: '기본 설명', confidence: 'medium', evidence: '요약 문단' },
            contractStart: { value: '2026-04-01', confidence: 'high', evidence: '시작일 표기' },
            contractEnd: { value: '2026-12-31', confidence: 'low', evidence: '종료일 표기' },
            contractAmount: { value: 12000000, confidence: 'medium', evidence: '금액 표기' },
            salesVatAmount: { value: 1200000, confidence: 'high', evidence: '부가세 표기' },
          },
        },
      },
    }));

    expect(model.analysis.summary).toContain('추출');
    expect(model.analysis.warnings).toEqual(['계약 종료일은 수기 확인이 필요합니다.']);
    expect(model.analysis.nextActions).toEqual(['계약금액을 원문과 대조하세요.']);
    expect(model.analysis.highlights.map((item) => item.label)).toEqual([
      '공식계약명',
      '등록명',
      '계약 대상',
      '사업 목적',
      '주요 내용',
      '계약 시작일',
      '계약 종료일',
      '계약금액',
      '매출 부가세',
    ]);
    expect(model.analysis.highlights.some((item) => item.status === 'needs-check')).toBe(true);
    expect(model.badges.some((badge) => badge.label.includes('AI'))).toBe(true);
  });
});
