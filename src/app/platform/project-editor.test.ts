import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import {
  getProjectTypeSelectableOptions,
  normalizeProjectContractType,
  PROJECT_CONTRACT_TYPE_OPTIONS,
  PROJECT_TYPE_LABELS,
} from '../data/types';
import {
  buildProjectEditorDraftFromProject,
  buildProjectEditorProjectPatch,
  buildProjectEditorReviewChanges,
  buildProjectRequestPayloadFromDraft,
  createProjectEditorDraft,
} from './project-editor';

const baseProject: Project = {
  id: 'p-1',
  slug: 'test-project',
  orgId: 'mysc',
  registrationSource: 'pm_portal',
  executiveReviewStatus: 'APPROVED',
  executiveReviewHistory: [{
    status: 'APPROVED',
    previousStatus: 'PENDING',
    reviewedAt: '2026-05-01T00:00:00.000Z',
    reviewedById: 'admin-1',
    reviewedByName: '관리자',
  }],
  name: '기후테크',
  officialContractName: '기후테크 공식 계약',
  status: 'CONTRACT_PENDING',
  type: 'D1',
  phase: 'CONFIRMED',
  contractAmount: 100_000,
  contractStart: '2026-01-01',
  contractEnd: '2026-12-31',
  settlementType: 'TYPE5',
  basis: '공급대가',
  accountType: 'DEDICATED',
  fundInputMode: 'BANK_UPLOAD',
  paymentPlan: { contract: 0, interim: 0, final: 0 },
  paymentPlanDesc: '선금 50%, 잔금 50%',
  clientOrg: 'KOICA',
  groupwareName: '기후테크GW',
  participantCondition: '참여기업 조건',
  teamMembersDetailed: [
    { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 60 },
  ],
  contractType: '계약서(날인)',
  projectPurpose: '목적',
  totalRevenueAmount: 91_000,
  supportAmount: 5_000,
  salesVatAmount: 9_000,
  financialInputFlags: {
    contractAmount: true,
    salesVatAmount: true,
    totalRevenueAmount: true,
    supportAmount: true,
  },
  settlementGuide: '이나라도움 수령',
  contractDocument: null,
  contractAnalysis: null,
  department: '개발협력',
  teamName: '데이나팀',
  managerId: 'pm-1',
  managerName: '김다은',
  budgetCurrentYear: 100_000,
  taxInvoiceAmount: 0,
  profitRate: 0.01,
  profitAmount: 1_000,
  isSettled: false,
  finalPaymentNote: '',
  confirmerName: '',
  lastCheckedAt: '',
  cashflowDiffNote: '',
  description: '주요 내용',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('project editor draft mapping', () => {
  it('uses the same canonical dropdown values for every project editor surface', () => {
    expect(getProjectTypeSelectableOptions()).toEqual(Object.keys(PROJECT_TYPE_LABELS));
    expect(getProjectTypeSelectableOptions()).toContain('I2');
    expect(getProjectTypeSelectableOptions()).toContain('I3');
    expect(PROJECT_CONTRACT_TYPE_OPTIONS).toEqual([
      '계약서(날인)',
      '협약서(날인)',
      '전자계약 시스템',
      '기타',
    ]);
    expect(normalizeProjectContractType('발주기관 전자시스템')).toBe('전자계약 시스템');
  });

  it('hydrates edit draft from project canonical values and normalizes stale profit fields', () => {
    const draft = buildProjectEditorDraftFromProject(baseProject);

    expect(draft.totalRevenueAmount).toBe(91_000);
    expect(draft.profitAmount).toBe(91_000);
    expect(draft.profitRate).toBe(0.91);
    expect(draft.teamMembersDetailed).toEqual([
      { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 60 },
    ]);
  });

  it('treats an explicit empty project team list as the current edit value', () => {
    const draft = buildProjectEditorDraftFromProject(
      {
        ...baseProject,
        teamMembersDetailed: [],
      },
      {
        teamMembersDetailed: [
          { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 60 },
        ],
      },
    );

    expect(draft.teamMembersDetailed).toEqual([]);
  });

  it('serializes the same detailed team, finance, and payment fields into request payload', () => {
    const draft = createProjectEditorDraft({
      ...buildProjectEditorDraftFromProject(baseProject),
      teamMembersDetailed: [
        { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 60 },
        { memberName: '변민욱', memberNickname: '보람', role: '운영', participationRate: 40 },
      ],
      groupwareName: '기후테크GW',
      paymentPlan: { contract: 50_000, interim: 30_000, final: 20_000 },
      finalPaymentNote: '잔금은 검수 후 2주 이내',
      contractAnalysis: { provider: 'heuristic', summary: '기존 분석값' } as never,
    });

    const payload = buildProjectRequestPayloadFromDraft(draft);

    expect(payload.totalRevenueAmount).toBe(91_000);
    expect(payload.teamMembersDetailed).toEqual([
      { memberName: '김다은', memberNickname: '데이나', role: 'PM', participationRate: 60 },
      { memberName: '변민욱', memberNickname: '보람', role: '운영', participationRate: 40 },
    ]);
    expect(payload.teamMembers).toBe('김다은 (데이나) / PM / 60%, 변민욱 (보람) / 운영 / 40%');
    expect(payload.groupwareName).toBe('기후테크GW');
    expect(payload.paymentPlan).toEqual({ contract: 50_000, interim: 30_000, final: 20_000 });
    expect(payload.finalPaymentNote).toBe('잔금은 검수 후 2주 이내');
    expect(payload.contractAnalysis).toEqual({ provider: 'heuristic', summary: '기존 분석값' });
  });

  it('resets approved PM portal edits to executive review pending without writing hidden business status fields', () => {
    const draft = createProjectEditorDraft({
      ...buildProjectEditorDraftFromProject(baseProject),
      name: '기후테크수정',
      status: 'IN_PROGRESS',
    });

    const patch = buildProjectEditorProjectPatch(draft, {
      baseProject,
      mode: 'portal-edit',
      actorId: 'pm-1',
      actorName: '김다은',
      now: '2026-05-19T00:00:00.000Z',
    });

    expect(patch.status).toBeUndefined();
    expect(patch.phase).toBeUndefined();
    expect(patch.contractAnalysis).toBeNull();
    expect(patch.executiveReviewStatus).toBe('PENDING');
    expect(patch.executiveReviewHistory?.at(-1)).toMatchObject({
      status: 'PENDING',
      previousStatus: 'APPROVED',
      reviewedById: 'pm-1',
      reviewedByName: '김다은',
    });
    expect(patch.executiveReviewHistory?.at(-1)?.changes).toEqual(
      expect.arrayContaining([
        {
          key: 'name',
          label: '프로젝트명',
          before: '기후테크',
          after: '기후테크수정',
        },
      ]),
    );
  });

  it('logs deterministic changes when an already pending PM portal project is edited again', () => {
    const pendingProject: Project = {
      ...baseProject,
      executiveReviewStatus: 'PENDING',
      executiveReviewHistory: [
        {
          status: 'PENDING',
          previousStatus: null,
          reviewedAt: '2026-05-01T00:00:00.000Z',
          reviewedById: 'pm-1',
          reviewedByName: '김다은',
        },
      ],
    };
    const draft = createProjectEditorDraft({
      ...buildProjectEditorDraftFromProject(pendingProject),
      paymentPlanDesc: '선금 80%, 잔금 20%',
    });

    const patch = buildProjectEditorProjectPatch(draft, {
      baseProject: pendingProject,
      mode: 'portal-edit',
      actorId: 'pm-1',
      actorName: '김다은',
      now: '2026-05-20T00:00:00.000Z',
    });

    expect(patch.executiveReviewStatus).toBe('PENDING');
    expect(patch.executiveReviewHistory?.at(-1)).toMatchObject({
      status: 'PENDING',
      previousStatus: 'PENDING',
      reviewedById: 'pm-1',
      reviewedByName: '김다은',
    });
    expect(patch.executiveReviewHistory?.at(-1)?.changes).toEqual(
      expect.arrayContaining([
        {
          key: 'paymentPlanDesc',
          label: '입금 계획',
          before: '선금 50%, 잔금 50%',
          after: '선금 80%, 잔금 20%',
        },
      ]),
    );
  });

  it('builds deterministic before-after review changes for CIC review', () => {
    const draft = createProjectEditorDraft({
      ...buildProjectEditorDraftFromProject(baseProject),
      name: '기후테크수정',
      totalRevenueAmount: 93_000,
      managerName: '변민욱',
    });

    const changes = buildProjectEditorReviewChanges(baseProject, draft);

    expect(changes).toEqual(expect.arrayContaining([
      {
        key: 'name',
        label: '프로젝트명',
        before: '기후테크',
        after: '기후테크수정',
      },
      {
        key: 'totalRevenueAmount',
        label: '총수익',
        before: '91,000원',
        after: '93,000원',
      },
      {
        key: 'managerName',
        label: 'PM',
        before: '김다은',
        after: '변민욱',
      },
    ]));
  });

  it('syncs the stored CIC value from the edited 담당조직', () => {
    const existingProject = {
      ...baseProject,
      cic: 'CIC1',
      department: 'CIC1',
    };
    const draft = createProjectEditorDraft({
      ...buildProjectEditorDraftFromProject(existingProject),
      department: 'CIC2',
    });

    const patch = buildProjectEditorProjectPatch(draft, {
      baseProject: existingProject,
      mode: 'admin',
      actorId: 'admin-1',
      actorName: '관리자',
      now: '2026-05-20T00:00:00.000Z',
    });

    expect(patch.department).toBe('CIC2');
    expect(patch.cic).toBe('CIC2');
  });

  it('keeps zero-won payment split values visible in deterministic review changes', () => {
    const draft = createProjectEditorDraft({
      ...buildProjectEditorDraftFromProject({
        ...baseProject,
        paymentPlan: { contract: 50_000, interim: 30_000, final: 20_000 },
      }),
      paymentPlan: { contract: 0, interim: 30_000, final: 0 },
    });

    const changes = buildProjectEditorReviewChanges({
      ...baseProject,
      paymentPlan: { contract: 50_000, interim: 30_000, final: 20_000 },
    }, draft);

    expect(changes).toEqual(expect.arrayContaining([
      {
        key: 'paymentPlan',
        label: '입금 분할',
        before: '선금/계약금 50,000원 · 중도금 30,000원 · 잔금 20,000원',
        after: '선금/계약금 0원 · 중도금 30,000원 · 잔금 0원',
      },
    ]));
  });

  it('normalizes legacy contract type values before payload and project patch serialization', () => {
    const draft = createProjectEditorDraft({
      ...buildProjectEditorDraftFromProject(baseProject),
      contractType: '발주기관 전자시스템',
    });

    const payload = buildProjectRequestPayloadFromDraft(draft);
    const patch = buildProjectEditorProjectPatch(draft, {
      baseProject,
      mode: 'admin',
      actorId: 'admin-1',
      actorName: '관리자',
      now: '2026-05-19T00:00:00.000Z',
    });

    expect(draft.contractType).toBe('전자계약 시스템');
    expect(payload.contractType).toBe('전자계약 시스템');
    expect(patch.contractType).toBe('전자계약 시스템');
  });

  it('normalizes legacy dropdown values before they reach Select components', () => {
    const draft = buildProjectEditorDraftFromProject({
      ...baseProject,
      type: 'UNKNOWN' as never,
      status: 'OLD_STATUS' as never,
      phase: 'OLD_PHASE' as never,
      settlementType: 'MONTHLY' as never,
      basis: 'SUPPLY_AMOUNT' as never,
      accountType: 'LEGACY_ACCOUNT' as never,
      fundInputMode: 'MANUAL' as never,
    });

    expect(draft.type).toBe('D1');
    expect(draft.status).toBe('CONTRACT_PENDING');
    expect(draft.phase).toBe('CONFIRMED');
    expect(draft.settlementType).toBe('NONE');
    expect(draft.basis).toBe('공급가액');
    expect(draft.accountType).toBe('NONE');
    expect(draft.fundInputMode).toBe('BANK_UPLOAD');
  });
});
