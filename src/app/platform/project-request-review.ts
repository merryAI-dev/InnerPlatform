import type {
  AiSuggestionConfidence,
  ProjectFinancialInputFlags,
  ProjectRequest,
  ProjectRequestContractAnalysis,
  ProjectRequestPayload,
  SettlementSheetPolicy,
} from '../data/types';
import {
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  PROJECT_FUND_INPUT_MODE_LABELS,
  SETTLEMENT_TYPE_LABELS,
} from '../data/types';

export type ProjectRequestReviewStatus = 'ready' | 'needs-check' | 'missing';
export type ProjectRequestReviewBadgeTone = 'neutral' | 'warning' | 'critical' | 'success';

export interface ProjectRequestReviewBadge {
  label: string;
  tone: ProjectRequestReviewBadgeTone;
}

export interface ProjectRequestReviewItem {
  key: string;
  label: string;
  value: string;
  status: ProjectRequestReviewStatus;
  note?: string;
}

export interface ProjectRequestReviewGroup {
  key: string;
  label: string;
  items: ProjectRequestReviewItem[];
}

export interface ProjectRequestReviewAnalysisHighlight {
  key: keyof ProjectRequestContractAnalysis['fields'];
  label: string;
  value: string;
  confidence: AiSuggestionConfidence;
  evidence: string;
  status: ProjectRequestReviewStatus;
}

export interface ProjectRequestReviewAnalysis {
  available: boolean;
  providerLabel: string;
  model: string;
  summary: string;
  warnings: string[];
  nextActions: string[];
  highlights: ProjectRequestReviewAnalysisHighlight[];
}

export interface ProjectRequestReviewFacts {
  financial: ProjectRequestReviewItem[];
  settlement: ProjectRequestReviewItem[];
}

export interface ProjectRequestReviewSummary {
  title: string;
  subtitle: string;
  decisionLabel: string;
  missingCount: number;
  needsCheckCount: number;
}

export interface ProjectRequestReviewModel {
  summary: ProjectRequestReviewSummary;
  badges: ProjectRequestReviewBadge[];
  missingFields: ProjectRequestReviewItem[];
  analysis: ProjectRequestReviewAnalysis;
  facts: ProjectRequestReviewFacts;
  checklistGroups: ProjectRequestReviewGroup[];
}

const ANALYSIS_FIELD_LABELS: Record<keyof ProjectRequestContractAnalysis['fields'], string> = {
  officialContractName: '공식계약명',
  suggestedProjectName: '등록명',
  clientOrg: '계약 대상',
  projectPurpose: '사업 목적',
  description: '주요 내용',
  contractStart: '계약 시작일',
  contractEnd: '계약 종료일',
  contractAmount: '계약금액',
  salesVatAmount: '매출 부가세',
};

function isBlank(value: unknown): boolean {
  return value == null || String(value).trim() === '';
}

function formatAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${Number(value).toLocaleString('ko-KR')}원`;
}

function formatShortAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const amount = Number(value);
  if (amount === 0) return '0원';
  if (Math.abs(amount) >= 1e8) return `${(amount / 1e8).toFixed(1)}억`;
  if (Math.abs(amount) >= 1e4) return `${(amount / 1e4).toFixed(0)}만`;
  return `${amount.toLocaleString('ko-KR')}원`;
}

function formatDate(value: string | undefined | null): string {
  if (isBlank(value)) return '-';
  return String(value).replace(/-/g, '.');
}

function formatDateRange(start?: string | null, end?: string | null): string {
  if (isBlank(start) && isBlank(end)) return '-';
  return `${formatDate(start)} ~ ${formatDate(end)}`;
}

function formatSettlementSheetPolicy(policy?: SettlementSheetPolicy | null): string {
  if (!policy) return '-';
  const presetLabel = policy.preset === 'STANDARD'
    ? '표준형'
    : policy.preset === 'DIRECT_ENTRY'
      ? '직접 입력형'
      : '잔액 추적형';
  return presetLabel;
}

function formatTeamMembers(payload: ProjectRequestPayload): string {
  if (payload.teamMembersDetailed && payload.teamMembersDetailed.length > 0) {
    return payload.teamMembersDetailed
      .map((member) => {
        const name = `${member.memberName}${member.memberNickname ? `(${member.memberNickname})` : ''}`;
        return member.role ? `${name} · ${member.role}` : name;
      })
      .join('\n');
  }
  return payload.teamMembers || '-';
}

function buildTextItem(
  key: string,
  label: string,
  value: string | null | undefined,
  extra?: { note?: string; status?: ProjectRequestReviewStatus },
): ProjectRequestReviewItem {
  const normalized = isBlank(value) ? '-' : String(value).trim();
  const status = extra?.status
    || (isBlank(value) ? 'missing' : 'ready');
  return {
    key,
    label,
    value: normalized,
    status,
    ...(extra?.note ? { note: extra.note } : {}),
  };
}

function buildMoneyItem(
  key: string,
  label: string,
  value: number | null | undefined,
  flags?: ProjectFinancialInputFlags,
): ProjectRequestReviewItem {
  const flag = flags?.[key as keyof ProjectFinancialInputFlags];
  const present = Number.isFinite(value as number) && Number(value) > 0;
  let status: ProjectRequestReviewStatus = 'ready';
  if (flag === true) {
    status = 'ready';
  } else if (flag === false) {
    status = present ? 'needs-check' : 'missing';
  } else if (!present) {
    status = 'missing';
  }
  return {
    key,
    label,
    value: formatShortAmount(value),
    status,
    ...(flag === false && present ? { note: '수기/AI 입력값 재확인 필요' } : {}),
  };
}

function buildSettlementPolicyItem(policy?: SettlementSheetPolicy | null): ProjectRequestReviewItem {
  return {
    key: 'settlementSheetPolicy',
    label: '정산 시트 정책',
    value: formatSettlementSheetPolicy(policy),
    status: policy ? 'ready' : 'needs-check',
    ...(policy ? {} : { note: '정산 시트 정책이 설정되지 않았습니다.' }),
  };
}

function formatSettlementType(value: ProjectRequestPayload['settlementType']): string {
  return SETTLEMENT_TYPE_LABELS[value] || value;
}

function formatBasis(value: ProjectRequestPayload['basis']): string {
  return BASIS_LABELS[value] || value;
}

function formatAccountType(value: ProjectRequestPayload['accountType']): string {
  return ACCOUNT_TYPE_LABELS[value] || value;
}

function formatFundInputMode(value: ProjectRequestPayload['fundInputMode']): string {
  if (!value) return '-';
  return PROJECT_FUND_INPUT_MODE_LABELS[value] || value;
}

function buildAnalysisHighlights(analysis?: ProjectRequestContractAnalysis | null): ProjectRequestReviewAnalysisHighlight[] {
  if (!analysis) return [];
  return (Object.entries(analysis.fields) as Array<[keyof ProjectRequestContractAnalysis['fields'], ProjectRequestContractAnalysis['fields'][keyof ProjectRequestContractAnalysis['fields']]]>)
    .map(([key, suggestion]) => ({
      key,
      label: ANALYSIS_FIELD_LABELS[key],
      value: suggestion.value == null || String(suggestion.value).trim() === ''
        ? '-'
        : String(suggestion.value).trim(),
      confidence: suggestion.confidence,
      evidence: suggestion.evidence,
      status: suggestion.value == null || String(suggestion.value).trim() === ''
        ? 'missing'
        : suggestion.confidence === 'high'
          ? 'ready'
          : 'needs-check',
    }));
}

function buildChecklistGroups(payload: ProjectRequestPayload, analysisHighlights: ProjectRequestReviewAnalysisHighlight[]): ProjectRequestReviewGroup[] {
  const analysisStatusByKey = new Map(
    analysisHighlights.map((item) => [item.key, item.status]),
  );

  const contractAnalysis = payload.contractAnalysis;
  const analysisItem: ProjectRequestReviewItem = contractAnalysis
    ? {
        key: 'contractAnalysis',
        label: '계약 분석 초안',
        value: contractAnalysis.summary || '요약 없음',
        status: contractAnalysis.warnings.length > 0 || contractAnalysis.nextActions.length > 0
          ? 'needs-check'
          : 'ready',
        ...(contractAnalysis.warnings.length > 0
          ? { note: contractAnalysis.warnings[0] }
          : contractAnalysis.nextActions[0]
            ? { note: contractAnalysis.nextActions[0] }
            : {}),
      }
    : {
        key: 'contractAnalysis',
        label: '계약 분석 초안',
        value: '분석 없음',
        status: 'missing',
        note: '계약서 분석 초안을 업로드해 주세요.',
    };

  const contractPeriodStatus = (() => {
    if (isBlank(payload.contractStart) || isBlank(payload.contractEnd)) return 'missing';
    const startStatus = analysisStatusByKey.get('contractStart');
    const endStatus = analysisStatusByKey.get('contractEnd');
    if (startStatus === 'needs-check' || endStatus === 'needs-check') return 'needs-check';
    return 'ready';
  })();

  const identityItems: ProjectRequestReviewItem[] = [
    buildTextItem('name', '등록명', payload.name),
    buildTextItem('officialContractName', '공식계약명', payload.officialContractName, {
      status: analysisStatusByKey.get('officialContractName') || undefined,
    }),
    buildTextItem('clientOrg', '계약 대상', payload.clientOrg, {
      status: analysisStatusByKey.get('clientOrg') || undefined,
    }),
    buildTextItem('department', '담당조직', payload.department),
    buildTextItem('managerName', '담당자', payload.managerName),
  ];

  const contractItems: ProjectRequestReviewItem[] = [
    buildTextItem('contractPeriod', '계약 기간', formatDateRange(payload.contractStart, payload.contractEnd), {
      status: contractPeriodStatus,
    }),
    buildTextItem('contractDocument', '계약서 PDF', payload.contractDocument?.name || '', {
      status: payload.contractDocument ? 'ready' : 'missing',
      ...(payload.contractDocument ? {} : { note: '계약서 파일이 첨부되지 않았습니다.' }),
    }),
    analysisItem,
    buildTextItem('projectPurpose', '사업 목적', payload.projectPurpose, {
      status: analysisStatusByKey.get('projectPurpose') || undefined,
    }),
    buildTextItem('description', '주요 내용', payload.description, {
      status: analysisStatusByKey.get('description') || undefined,
    }),
    buildTextItem('participantCondition', '참여조건', payload.participantCondition),
  ];

  const financialItems: ProjectRequestReviewItem[] = [
    buildMoneyItem('contractAmount', '계약금액', payload.contractAmount, payload.financialInputFlags),
    buildMoneyItem('salesVatAmount', '매출 부가세', payload.salesVatAmount, payload.financialInputFlags),
    buildMoneyItem('totalRevenueAmount', '총수익', payload.totalRevenueAmount, payload.financialInputFlags),
    buildMoneyItem('supportAmount', '지원금', payload.supportAmount, payload.financialInputFlags),
    buildTextItem('paymentPlanDesc', '입금계획', payload.paymentPlanDesc),
  ];

  const settlementItems: ProjectRequestReviewItem[] = [
    buildTextItem('settlementType', '정산 유형', formatSettlementType(payload.settlementType)),
    buildTextItem('basis', '정산 기준', formatBasis(payload.basis)),
    buildTextItem('accountType', '계좌 유형', formatAccountType(payload.accountType)),
    buildTextItem('fundInputMode', '입금 방식', formatFundInputMode(payload.fundInputMode)),
    buildSettlementPolicyItem(payload.settlementSheetPolicy),
    buildTextItem('settlementGuide', '정산 가이드', payload.settlementGuide),
  ];

  const teamItems: ProjectRequestReviewItem[] = [
    buildTextItem('teamName', '팀명', payload.teamName),
    buildTextItem('teamMembers', '팀원', formatTeamMembers(payload)),
    buildTextItem('note', '비고', payload.note),
  ];

  return [
    { key: 'identity', label: '기본 정보', items: identityItems },
    { key: 'contract', label: '계약 및 증빙', items: contractItems },
    { key: 'financial', label: '핵심 재무', items: financialItems },
    { key: 'settlement', label: '정산', items: settlementItems },
    { key: 'team', label: '팀/비고', items: teamItems },
  ];
}

function buildFacts(
  groups: ProjectRequestReviewGroup[],
): ProjectRequestReviewFacts {
  const financialGroup = groups.find((group) => group.key === 'financial');
  const settlementGroup = groups.find((group) => group.key === 'settlement');
  return {
    financial: financialGroup?.items.slice(0, 4) || [],
    settlement: settlementGroup?.items.slice(0, 4) || [],
  };
}

function countNeedsCheck(groups: ProjectRequestReviewGroup[], analysis: ProjectRequestReviewAnalysis): number {
  const checklistNeedsCheck = groups.flatMap((group) => group.items).filter((item) => item.status === 'needs-check').length;
  const analysisNeedsCheck = analysis.available
    ? analysis.warnings.length + analysis.highlights.filter((item) => item.status === 'needs-check').length
    : 1;
  return checklistNeedsCheck + analysisNeedsCheck;
}

export function buildProjectRequestReviewModel(request: ProjectRequest): ProjectRequestReviewModel {
  const title = request.payload.name || request.payload.officialContractName || '사업 등록 요청';
  const subtitle = `${request.requestedByName || request.requestedByEmail || '요청자'} · ${String(request.requestedAt || '').slice(0, 10) || '-'}`;
  const analysis = request.payload.contractAnalysis;
  const analysisHighlights = buildAnalysisHighlights(analysis);
  const checklistGroups = buildChecklistGroups(request.payload, analysisHighlights);
  const missingFields = checklistGroups.flatMap((group) => group.items).filter((item) => item.status === 'missing');
  const analysisModel: ProjectRequestReviewAnalysis = {
    available: !!analysis,
    providerLabel: analysis?.provider === 'anthropic' ? 'Anthropic' : analysis ? '휴리스틱' : '없음',
    model: analysis?.model || '-',
    summary: analysis?.summary || '계약서 분석 초안이 없습니다.',
    warnings: analysis?.warnings || ['계약서 분석이 없습니다.'],
    nextActions: analysis?.nextActions || ['계약서 PDF와 핵심 정보를 먼저 보완하세요.'],
    highlights: analysisHighlights,
  };
  const needsCheckCount = countNeedsCheck(checklistGroups, analysisModel);

  return {
    summary: {
      title,
      subtitle,
      decisionLabel: missingFields.length > 0
        ? '보완 필요'
        : needsCheckCount > 0
          ? '검토 필요'
          : '승인 후보',
      missingCount: missingFields.length,
      needsCheckCount,
    },
    badges: [
      { label: `${missingFields.length}건 누락`, tone: missingFields.length > 0 ? 'critical' : 'success' },
      { label: `${needsCheckCount}건 확인 필요`, tone: needsCheckCount > 0 ? 'warning' : 'neutral' },
      { label: request.payload.contractDocument ? '계약서 첨부' : '계약서 없음', tone: request.payload.contractDocument ? 'success' : 'critical' },
      { label: analysis?.summary ? 'AI 분석 있음' : 'AI 분석 없음', tone: analysis?.summary ? 'neutral' : 'warning' },
    ],
    missingFields,
    analysis: analysisModel,
    facts: buildFacts(checklistGroups),
    checklistGroups,
  };
}
