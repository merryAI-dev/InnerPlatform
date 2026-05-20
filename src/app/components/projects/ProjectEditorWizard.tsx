import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Plus,
  Save,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  formatSettlementSheetPolicySummary,
  getProjectContractTypeSelectableOptions,
  getDefaultSettlementSheetPolicyForFundInputMode,
  getProjectTypeSelectableOptions,
  normalizeProjectContractType,
  normalizeSettlementSheetPolicy,
  PROJECT_FUND_INPUT_MODE_LABELS,
  PROJECT_PHASE_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  SETTLEMENT_TYPE_LABELS,
  type AccountType,
  type Basis,
  type OrgMember,
  type ProjectFinancialInputFlags,
  type ProjectFundInputMode,
  type ProjectPhase,
  type ProjectStatus,
  type ProjectTeamMemberAssignment,
  type ProjectType,
  type SettlementType,
} from '../../data/types';
import { PROJECT_DEPARTMENT_OPTIONS } from '../../data/project-department-options';
import { PROJECT_TEAM_MEMBER_OPTION_MAP, PROJECT_TEAM_MEMBER_OPTIONS } from '../../data/project-team-member-options';
import {
  formatProjectAmountInput,
  formatStoredProjectAmount,
  hasExplicitProjectAmountInput,
  normalizeProjectFinancialInputFlags,
  parseProjectAmountInput,
} from '../../platform/project-contract-amount';
import { formatProfitRatePercentInput } from '../../platform/project-financials';
import { createProjectEditorDraft, type ProjectEditorDraft, type ProjectEditorMode } from '../../platform/project-editor';
import {
  formatProjectTeamMembersSummary,
  normalizeProjectTeamMemberDraftRows,
} from '../../platform/project-team-members';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Progress } from '../ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Textarea } from '../ui/textarea';
import { ContractDocumentPreview } from './ContractDocumentPreview';
import { SettlementSheetPolicyFields } from './SettlementSheetPolicyFields';

type ProjectEditorStep = 'basic' | 'financial' | 'team' | 'payment' | 'review';

export interface ProjectEditorAction {
  id: string;
  label: string;
  icon?: typeof Save;
  variant?: 'default' | 'outline' | 'secondary' | 'destructive';
  disabled?: boolean;
}

interface ProjectEditorWizardProps {
  mode: ProjectEditorMode;
  initialDraft: ProjectEditorDraft;
  draftKey: string;
  title: string;
  description?: string;
  members?: OrgMember[];
  topSlot?: ReactNode;
  actions: ProjectEditorAction[];
  busyActionId?: string | null;
  onCancel?: () => void;
  onSubmit: (draft: ProjectEditorDraft, actionId: string) => void | Promise<void>;
}

const STEPS: Array<{
  id: ProjectEditorStep;
  label: string;
  icon: typeof Building2;
}> = [
  { id: 'basic', label: '기본 정보', icon: Building2 },
  { id: 'financial', label: '계약/재무', icon: Wallet },
  { id: 'team', label: '팀/인력', icon: Users },
  { id: 'payment', label: '입금/정산', icon: CreditCard },
  { id: 'review', label: '검토 및 저장', icon: ClipboardList },
];

function fmtKRW(value: number) {
  return value ? value.toLocaleString('ko-KR') : '0';
}

function formatPaymentPlanAmount(amount: number, contractAmount: number) {
  if (!Number.isFinite(amount)) return '-';
  const amountLabel = formatStoredProjectAmount(amount, true);
  if (!Number.isFinite(contractAmount) || contractAmount <= 0) return amountLabel;
  return `${amountLabel} (${((amount / contractAmount) * 100).toFixed(0)}%)`;
}

function updateFlag(flags: ProjectFinancialInputFlags, key: keyof ProjectFinancialInputFlags, rawValue: string) {
  return {
    ...normalizeProjectFinancialInputFlags(flags),
    [key]: hasExplicitProjectAmountInput(rawValue),
  };
}

function createEmptyTeamMember(): ProjectTeamMemberAssignment {
  return {
    memberName: '',
    memberNickname: '',
    role: '',
    participationRate: 0,
  };
}

function isAdminMode(mode: ProjectEditorMode) {
  return mode === 'admin';
}

function createProjectEditorWizardDraft(overrides: Partial<ProjectEditorDraft> = {}): ProjectEditorDraft {
  const draft = createProjectEditorDraft(overrides);
  if (!Array.isArray(overrides.teamMembersDetailed)) {
    return draft;
  }
  return {
    ...draft,
    teamMembersDetailed: normalizeProjectTeamMemberDraftRows(overrides.teamMembersDetailed),
  };
}

export function ProjectEditorWizard({
  mode,
  initialDraft,
  draftKey,
  title,
  description,
  members = [],
  topSlot,
  actions,
  busyActionId,
  onCancel,
  onSubmit,
}: ProjectEditorWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<ProjectEditorDraft>(() => createProjectEditorWizardDraft(initialDraft));

  useEffect(() => {
    setDraft(createProjectEditorWizardDraft(initialDraft));
    setStepIndex(0);
  }, [draftKey]);

  const step = STEPS[stepIndex];
  const financialInputFlags = useMemo(
    () => normalizeProjectFinancialInputFlags(draft.financialInputFlags),
    [draft.financialInputFlags],
  );
  const hasContractAmountInput = financialInputFlags.contractAmount;
  const hasSalesVatAmountInput = financialInputFlags.salesVatAmount;
  const hasTotalRevenueAmountInput = financialInputFlags.totalRevenueAmount;
  const hasSupportAmountInput = financialInputFlags.supportAmount;
  const profitRateLabel = formatProfitRatePercentInput(draft.profitRate);
  const teamMembersSummary = formatProjectTeamMembersSummary(draft.teamMembersDetailed, '', '\n');
  const projectTypeOptions = getProjectTypeSelectableOptions(draft.type);
  const contractTypeOptions = getProjectContractTypeSelectableOptions(draft.contractType);
  const managerOptions = useMemo(() => {
    const pmMembers = members.filter((member) => member.role === 'pm');
    if (!draft.managerId || pmMembers.some((member) => member.uid === draft.managerId)) {
      return pmMembers;
    }
    return [
      ...pmMembers,
      {
        uid: draft.managerId,
        name: draft.managerName || draft.managerId,
        email: '',
        role: 'pm' as const,
      },
    ];
  }, [draft.managerId, draft.managerName, members]);

  const update = <K extends keyof ProjectEditorDraft>(key: K, value: ProjectEditorDraft[K]) => {
    setDraft((prev) => createProjectEditorWizardDraft({ ...prev, [key]: value }));
  };

  const updateAmount = (key: 'contractAmount' | 'salesVatAmount' | 'totalRevenueAmount' | 'supportAmount', rawValue: string) => {
    setDraft((prev) => createProjectEditorWizardDraft({
      ...prev,
      [key]: parseProjectAmountInput(rawValue),
      financialInputFlags: updateFlag(prev.financialInputFlags, key, rawValue),
    }));
  };

  const updateFundInputMode = (modeValue: ProjectFundInputMode) => {
    setDraft((prev) => {
      const oldDefault = getDefaultSettlementSheetPolicyForFundInputMode(prev.fundInputMode);
      const currentPolicy = normalizeSettlementSheetPolicy(prev.settlementSheetPolicy, prev.fundInputMode);
      const shouldResetPolicy = currentPolicy.preset === oldDefault.preset;
      return createProjectEditorWizardDraft({
        ...prev,
        fundInputMode: modeValue,
        settlementSheetPolicy: shouldResetPolicy
          ? getDefaultSettlementSheetPolicyForFundInputMode(modeValue)
          : currentPolicy,
      });
    });
  };

  const addTeamMember = () => {
    setDraft((prev) => ({
      ...prev,
      teamMembersDetailed: [...prev.teamMembersDetailed, createEmptyTeamMember()],
    }));
  };

  const updateTeamMember = (index: number, patch: Partial<ProjectTeamMemberAssignment>) => {
    setDraft((prev) => {
      const next = [...prev.teamMembersDetailed];
      next[index] = { ...next[index], ...patch };
      return createProjectEditorWizardDraft({ ...prev, teamMembersDetailed: next });
    });
  };

  const removeTeamMember = (index: number) => {
    setDraft((prev) => createProjectEditorWizardDraft({
      ...prev,
      teamMembersDetailed: prev.teamMembersDetailed.filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const submitIssues = useMemo(() => {
    const issues: Array<{ step: ProjectEditorStep; label: string }> = [];
    if (!draft.department.trim()) issues.push({ step: 'basic', label: '담당조직(CIC)' });
    if (!draft.name.trim()) issues.push({ step: 'basic', label: '프로젝트명' });
    if (draft.type !== 'I1' && !draft.contractStart.trim()) issues.push({ step: 'financial', label: '계약 시작일' });
    if (draft.type !== 'I1' && !draft.contractEnd.trim()) issues.push({ step: 'financial', label: '계약 종료일' });
    if (draft.type !== 'I1' && !hasContractAmountInput) issues.push({ step: 'financial', label: '계약금액' });
    if (!draft.managerName.trim()) issues.push({ step: 'team', label: 'PM' });
    return issues;
  }, [draft, hasContractAmountInput]);

  const canSubmit = submitIssues.length === 0;

  const renderBasicStep = () => (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label className="text-xs">담당조직(CIC) *</Label>
          <datalist id={`project-editor-department-options-${mode}`}>
            {PROJECT_DEPARTMENT_OPTIONS.map((department) => <option key={department} value={department} />)}
          </datalist>
          <Input
            value={draft.department}
            onChange={(event) => update('department', event.target.value)}
            list={`project-editor-department-options-${mode}`}
            placeholder="예: 투자센터"
            className="mt-1 h-9 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">프로젝트 유형 *</Label>
          <Select value={draft.type} onValueChange={(value) => update('type', value as ProjectType)}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {projectTypeOptions.map((type) => (
                <SelectItem key={type} value={type}>{PROJECT_TYPE_LABELS[type]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="text-xs">공식 계약명</Label>
        <Input
          value={draft.officialContractName}
          onChange={(event) => update('officialContractName', event.target.value)}
          placeholder="계약서 또는 내부 관리용 공식 명칭"
          className="mt-1 h-9 text-sm"
        />
      </div>

      <div>
        <Label className="text-xs">프로젝트명 *</Label>
        <Input
          value={draft.name}
          onChange={(event) => update('name', event.target.value.slice(0, mode === 'portal-register' ? 10 : 80))}
          placeholder="예: 뷰티풀커넥트"
          className="mt-1 h-9 text-sm"
        />
        {mode === 'portal-register' ? (
          <p className="mt-1 text-[10px] text-muted-foreground">{draft.name.length}/10자</p>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label className="text-xs">계약 대상</Label>
          <Input
            value={draft.clientOrg}
            onChange={(event) => update('clientOrg', event.target.value)}
            placeholder="예: KOICA, 서울시, 아모레퍼시픽재단"
            className="mt-1 h-9 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">그룹웨어 등록명</Label>
          <Input
            value={draft.groupwareName}
            onChange={(event) => update('groupwareName', event.target.value)}
            placeholder="예: IBS그린임팩트펀드"
            className="mt-1 h-9 text-sm"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">프로젝트 목적</Label>
        <Textarea
          value={draft.projectPurpose}
          onChange={(event) => update('projectPurpose', event.target.value)}
          placeholder="어떤 대상에게 어떤 가치를 제공하는 프로젝트인지 입력"
          className="mt-1 min-h-[88px] text-sm"
        />
      </div>
      <div>
        <Label className="text-xs">프로젝트 주요 내용</Label>
        <Textarea
          value={draft.description}
          onChange={(event) => update('description', event.target.value)}
          placeholder="주요 수행 내용, 범위, 산출물"
          className="mt-1 min-h-[110px] text-sm"
        />
      </div>
    </div>
  );

  const renderContractTypeSelect = () => (
    <div>
      <Label className="text-xs">계약서 유형</Label>
      <Select
        value={normalizeProjectContractType(draft.contractType)}
        onValueChange={(value) => update('contractType', normalizeProjectContractType(value))}
      >
        <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {contractTypeOptions.map((contractType) => (
            <SelectItem key={contractType} value={contractType}>{contractType}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const renderFinancialStep = () => (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label className="text-xs">계약 시작일 *</Label>
          <Input type="date" value={draft.contractStart} onChange={(event) => update('contractStart', event.target.value)} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">계약 종료일 *</Label>
          <Input type="date" value={draft.contractEnd} onChange={(event) => update('contractEnd', event.target.value)} className="mt-1 h-9 text-sm" />
        </div>
      </div>

      {isAdminMode(mode) ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <Label className="text-xs">프로젝트 진행 상태</Label>
            <Select value={draft.status} onValueChange={(value) => update('status', value as ProjectStatus)}>
              <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((status) => (
                  <SelectItem key={status} value={status}>{PROJECT_STATUS_LABELS[status]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">프로젝트 구분</Label>
            <Select value={draft.phase} onValueChange={(value) => update('phase', value as ProjectPhase)}>
              <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(PROJECT_PHASE_LABELS) as ProjectPhase[]).map((phase) => (
                  <SelectItem key={phase} value={phase}>{PROJECT_PHASE_LABELS[phase]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {renderContractTypeSelect()}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {renderContractTypeSelect()}
        </div>
      )}

      <div>
        <Label className="text-xs">계약금액 (원) *</Label>
        <Input
          inputMode="numeric"
          value={hasContractAmountInput ? String(draft.contractAmount) : ''}
          onChange={(event) => updateAmount('contractAmount', event.target.value)}
          placeholder="0"
          className="mt-1 h-9 text-sm"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          {hasContractAmountInput ? `${fmtKRW(draft.contractAmount)}원` : '미입력'}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <div>
          <Label className="text-xs">매출 부가세</Label>
          <Input
            inputMode="numeric"
            value={hasSalesVatAmountInput ? String(draft.salesVatAmount) : ''}
            onChange={(event) => updateAmount('salesVatAmount', event.target.value)}
            placeholder="0"
            className="mt-1 h-9 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">총수익</Label>
          <Input
            inputMode="numeric"
            value={hasTotalRevenueAmountInput ? String(draft.totalRevenueAmount) : ''}
            onChange={(event) => updateAmount('totalRevenueAmount', event.target.value)}
            placeholder="0"
            className="mt-1 h-9 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">지원금</Label>
          <Input
            inputMode="numeric"
            value={hasSupportAmountInput ? String(draft.supportAmount) : ''}
            onChange={(event) => updateAmount('supportAmount', event.target.value)}
            placeholder="0"
            className="mt-1 h-9 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">수익률</Label>
          <Input value={profitRateLabel ? `${profitRateLabel}%` : '-'} readOnly className="mt-1 h-9 bg-muted/40 text-sm" />
          <p className="mt-1 text-[10px] text-muted-foreground">
            총수익 / 계약금액 기준 자동 계산
          </p>
        </div>
      </div>

      {mode === 'admin' ? (
        <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 lg:grid-cols-2">
          <div>
          <Label className="text-xs">당해연도 예산</Label>
            <Input
              inputMode="numeric"
              value={draft.budgetCurrentYear > 0 ? String(draft.budgetCurrentYear) : ''}
              onChange={(event) => update('budgetCurrentYear', parseProjectAmountInput(event.target.value))}
              placeholder="0"
              className="mt-1 h-9 bg-white text-sm"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {draft.budgetCurrentYear > 0 ? `${fmtKRW(draft.budgetCurrentYear)}원` : '미입력'}
            </p>
          </div>
          <div>
            <Label className="text-xs">세금계산서 발행액</Label>
            <Input
              inputMode="numeric"
              value={draft.taxInvoiceAmount > 0 ? String(draft.taxInvoiceAmount) : ''}
              onChange={(event) => update('taxInvoiceAmount', parseProjectAmountInput(event.target.value))}
              placeholder="0"
              className="mt-1 h-9 bg-white text-sm"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {draft.taxInvoiceAmount > 0 ? `${fmtKRW(draft.taxInvoiceAmount)}원` : '미입력'}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <div>
          <Label className="text-xs">정산 유형</Label>
          <Select value={draft.settlementType} onValueChange={(value) => update('settlementType', value as SettlementType)}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.entries(SETTLEMENT_TYPE_LABELS) as [SettlementType, string][]).map(([key, value]) => (
                <SelectItem key={key} value={key}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">정산 기준</Label>
          <Select value={draft.basis} onValueChange={(value) => update('basis', value as Basis)}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.entries(BASIS_LABELS) as [Basis, string][]).map(([key, value]) => (
                <SelectItem key={key} value={key}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">통장 유형</Label>
          <Select value={draft.accountType} onValueChange={(value) => update('accountType', value as AccountType)}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.entries(ACCOUNT_TYPE_LABELS) as [AccountType, string][]).map(([key, value]) => (
                <SelectItem key={key} value={key}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">자금 입력 방식</Label>
          <Select value={draft.fundInputMode} onValueChange={(value) => updateFundInputMode(value as ProjectFundInputMode)}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.entries(PROJECT_FUND_INPUT_MODE_LABELS) as [ProjectFundInputMode, string][]).map(([key, value]) => (
                <SelectItem key={key} value={key}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {draft.fundInputMode === 'DIRECT_ENTRY'
              ? '정산 시트 또는 엑셀 템플릿으로 직접 입력합니다.'
              : '통장내역 업로드 후 정산 시트로 이어서 입력합니다.'}
          </p>
        </div>
      </div>

      <SettlementSheetPolicyFields
        policy={draft.settlementSheetPolicy}
        onChange={(next) => update('settlementSheetPolicy', next)}
      />
    </div>
  );

  const renderTeamStep = () => (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label className="text-xs">PM *</Label>
          <Input value={draft.managerName} onChange={(event) => update('managerName', event.target.value)} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">담당자 계정</Label>
          <Select value={draft.managerId || 'none'} onValueChange={(value) => {
            const member = members.find((item) => item.uid === value);
            setDraft((prev) => createProjectEditorDraft({
              ...prev,
              managerId: value === 'none' ? '' : value,
              managerName: member?.name || prev.managerName,
            }));
          }}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">선택 안 함</SelectItem>
              {managerOptions.map((member) => (
                <SelectItem key={member.uid} value={member.uid}>
                  {member.email ? `${member.name} (${member.email})` : member.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label className="text-xs">사내기업팀</Label>
          <Input value={draft.teamName} onChange={(event) => update('teamName', event.target.value)} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">참여기업 조건</Label>
          <Input value={draft.participantCondition} onChange={(event) => update('participantCondition', event.target.value)} className="mt-1 h-9 text-sm" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-xs">팀원 구성</Label>
          <p className="mt-1 text-[10px] text-muted-foreground">팀원, 역할, 참여율을 같은 구조로 저장합니다.</p>
        </div>
        <Button type="button" onClick={addTeamMember} className="gap-2">
          <Plus className="h-4 w-4" />
          팀원 추가
        </Button>
      </div>

      {draft.teamMembersDetailed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-5 text-[12px] text-muted-foreground">
          아직 추가된 팀원이 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {draft.teamMembersDetailed.map((member, index) => {
            const selectedNames = new Set(
              draft.teamMembersDetailed
                .map((item, itemIndex) => (itemIndex === index ? '' : item.memberName))
                .filter(Boolean),
            );
            const currentTeamMemberOptionExists = !member.memberName
              || PROJECT_TEAM_MEMBER_OPTIONS.some((option) => option.value === member.memberName);
            return (
              <div key={`${member.memberName || 'member'}-${index}`} className="rounded-xl border border-border/60 bg-background/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold">팀원 {index + 1}</div>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-rose-600" onClick={() => removeTeamMember(index)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px]">
                  <div>
                    <Label className="text-xs">팀원</Label>
                    <Select
                      value={member.memberName || 'none'}
                      onValueChange={(value) => {
                        if (value === 'none') {
                          updateTeamMember(index, { memberName: '', memberNickname: '' });
                          return;
                        }
                        const option = PROJECT_TEAM_MEMBER_OPTION_MAP[value];
                        updateTeamMember(index, {
                          memberName: option?.name || value,
                          memberNickname: option?.nickname || '',
                        });
                      }}
                    >
                      <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="팀원 선택" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">선택 안 함</SelectItem>
                        {!currentTeamMemberOptionExists ? (
                          <SelectItem value={member.memberName}>
                            {member.memberNickname ? `${member.memberName} (${member.memberNickname})` : member.memberName}
                          </SelectItem>
                        ) : null}
                        {PROJECT_TEAM_MEMBER_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value} disabled={selectedNames.has(option.value)}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">역할</Label>
                    <Input value={member.role} onChange={(event) => updateTeamMember(index, { role: event.target.value })} className="mt-1 h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">참여율(%)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={member.participationRate || ''}
                      onChange={(event) => updateTeamMember(index, { participationRate: Number(event.target.value) || 0 })}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div>
        <Label className="text-xs">기타 참고사항</Label>
        <Textarea value={draft.note} onChange={(event) => update('note', event.target.value)} className="mt-1 min-h-[88px] text-sm" />
      </div>
    </div>
  );

  const renderPaymentStep = () => (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <Label className="text-xs">선금/계약금 (원)</Label>
          <Input value={formatProjectAmountInput(draft.paymentPlan.contract, true)} onChange={(event) => update('paymentPlan', { ...draft.paymentPlan, contract: parseProjectAmountInput(event.target.value) })} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">중도금 (원)</Label>
          <Input value={formatProjectAmountInput(draft.paymentPlan.interim, true)} onChange={(event) => update('paymentPlan', { ...draft.paymentPlan, interim: parseProjectAmountInput(event.target.value) })} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">잔금 (원)</Label>
          <Input value={formatProjectAmountInput(draft.paymentPlan.final, true)} onChange={(event) => update('paymentPlan', { ...draft.paymentPlan, final: parseProjectAmountInput(event.target.value) })} className="mt-1 h-9 text-sm" />
        </div>
      </div>
      <div>
        <Label className="text-xs">선금/중도금/잔금 비율 및 입금예상시점</Label>
        <Textarea
          value={draft.paymentPlanDesc}
          onChange={(event) => update('paymentPlanDesc', event.target.value)}
          placeholder="예: 선금 50%(5천만원, 4월), 중도금 30%(6월), 잔금 20%(완료 후 2주)"
          className="mt-1 min-h-[92px] text-sm"
        />
      </div>
      <div>
        <Label className="text-xs">입금/정산 안내</Label>
        <Textarea
          value={draft.settlementGuide}
          onChange={(event) => update('settlementGuide', event.target.value)}
          placeholder="예: 이나라도움 수령, 공급가액 기준, 선지급 후 정산"
          className="mt-1 min-h-[92px] text-sm"
        />
      </div>
      <div>
        <Label className="text-xs">최종 입금 메모</Label>
        <Textarea value={draft.finalPaymentNote} onChange={(event) => update('finalPaymentNote', event.target.value)} className="mt-1 min-h-[72px] text-sm" />
      </div>
    </div>
  );

  const ReviewRow = ({ label, value }: { label: string; value: ReactNode }) => (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 py-2 last:border-0">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="whitespace-pre-line text-right text-[12px] font-medium text-slate-900">{value || '-'}</span>
    </div>
  );

  const renderReviewStep = () => (
    <div className="space-y-4">
      {submitIssues.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          제출 전 {submitIssues.map((issue) => issue.label).join(', ')} 입력이 필요합니다.
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">기본 정보</CardTitle></CardHeader>
          <CardContent>
            <ReviewRow label="담당조직(CIC)" value={draft.department} />
            <ReviewRow label="공식 계약명" value={draft.officialContractName} />
            <ReviewRow label="프로젝트명" value={draft.name} />
            <ReviewRow label="프로젝트 유형" value={PROJECT_TYPE_LABELS[draft.type]} />
            <ReviewRow label="계약서 유형" value={normalizeProjectContractType(draft.contractType)} />
            <ReviewRow label="계약 대상" value={draft.clientOrg} />
            <ReviewRow label="그룹웨어 등록명" value={draft.groupwareName} />
            <ReviewRow label="프로젝트 목적" value={draft.projectPurpose} />
            {isAdminMode(mode) ? (
              <>
                <ReviewRow label="프로젝트 진행 상태" value={PROJECT_STATUS_LABELS[draft.status]} />
                <ReviewRow label="프로젝트 구분" value={PROJECT_PHASE_LABELS[draft.phase]} />
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">계약/재무</CardTitle></CardHeader>
          <CardContent>
            <ReviewRow label="기간" value={`${draft.contractStart || '-'} ~ ${draft.contractEnd || '-'}`} />
            <ReviewRow label="계약금액" value={formatStoredProjectAmount(draft.contractAmount, financialInputFlags.contractAmount)} />
            <ReviewRow label="매출 부가세" value={formatStoredProjectAmount(draft.salesVatAmount, financialInputFlags.salesVatAmount)} />
            <ReviewRow label="총수익" value={formatStoredProjectAmount(draft.totalRevenueAmount, financialInputFlags.totalRevenueAmount)} />
            <ReviewRow label="지원금" value={formatStoredProjectAmount(draft.supportAmount, financialInputFlags.supportAmount)} />
            <ReviewRow label="수익률" value={profitRateLabel ? `${profitRateLabel}%` : '-'} />
            <ReviewRow label="정산 유형" value={SETTLEMENT_TYPE_LABELS[draft.settlementType]} />
            <ReviewRow label="정산 기준" value={BASIS_LABELS[draft.basis]} />
            <ReviewRow label="통장 유형" value={ACCOUNT_TYPE_LABELS[draft.accountType]} />
            <ReviewRow label="자금 입력 방식" value={PROJECT_FUND_INPUT_MODE_LABELS[draft.fundInputMode]} />
            <ReviewRow label="정산 시트 정책" value={formatSettlementSheetPolicySummary(draft.settlementSheetPolicy)} />
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">팀/인력</CardTitle></CardHeader>
          <CardContent>
            <ReviewRow label="PM" value={draft.managerName} />
            <ReviewRow label="담당자 계정" value={draft.managerId || '-'} />
            <ReviewRow label="사내기업팀" value={draft.teamName} />
            <ReviewRow label="팀원" value={teamMembersSummary} />
            <ReviewRow label="참여 조건" value={draft.participantCondition} />
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">입금/정산</CardTitle></CardHeader>
          <CardContent>
            <ReviewRow label="선금/계약금" value={formatPaymentPlanAmount(draft.paymentPlan.contract, draft.contractAmount)} />
            <ReviewRow label="중도금" value={formatPaymentPlanAmount(draft.paymentPlan.interim, draft.contractAmount)} />
            <ReviewRow label="잔금" value={formatPaymentPlanAmount(draft.paymentPlan.final, draft.contractAmount)} />
            <ReviewRow label="입금 계획" value={draft.paymentPlanDesc} />
            <ReviewRow label="입금/정산 안내" value={draft.settlementGuide} />
            <ReviewRow label="최종 입금 메모" value={draft.finalPaymentNote} />
          </CardContent>
        </Card>
        {draft.contractDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={draft.contractDocument}
              title="계약서 원문"
              description="등록하려는 계약서가 맞는지 꼭 확인해주세요!"
              descriptionClassName="text-rose-600"
            />
          </div>
        ) : null}
      </div>
    </div>
  );

  const renderStep = () => {
    if (step.id === 'basic') return renderBasicStep();
    if (step.id === 'financial') return renderFinancialStep();
    if (step.id === 'team') return renderTeamStep();
    if (step.id === 'payment') return renderPaymentStep();
    return renderReviewStep();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="rounded-full">{STEPS.length}단계</Badge>
            <Badge variant="outline" className="rounded-full">{mode === 'admin' ? 'Admin' : 'Portal'}</Badge>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {onCancel ? (
          <Button variant="outline" className="gap-2" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
            나가기
          </Button>
        ) : null}
      </div>

      {topSlot}

      <Card className="border-slate-200/80 shadow-sm">
        <CardContent className="p-4">
          <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>{stepIndex + 1} / {STEPS.length}</span>
            <span>{step.label}</span>
          </div>
          <Progress value={((stepIndex + 1) / STEPS.length) * 100} />
          <div className="mt-4 grid gap-2 md:grid-cols-5">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const active = index === stepIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStepIndex(index)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    active ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-border bg-white text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200/90 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <step.icon className="h-4 w-4" />
            {step.label}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {renderStep()}
        </CardContent>
      </Card>

      <div className="z-20 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur lg:sticky lg:bottom-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <CalendarRange className="h-4 w-4" />
            <span>{draft.contractStart || '-'} ~ {draft.contractEnd || '-'}</span>
            <span className="hidden lg:inline">·</span>
            <span className="hidden lg:inline">{draft.name || '프로젝트명 미입력'}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setStepIndex((value) => Math.max(0, value - 1))}
              disabled={stepIndex === 0}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              이전
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button onClick={() => setStepIndex((value) => Math.min(STEPS.length - 1, value + 1))} className="gap-2">
                다음
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              actions.map((action) => {
                const Icon = action.icon || CheckCircle2;
                return (
                  <Button
                    key={action.id}
                    variant={action.variant || 'default'}
                    disabled={!!busyActionId || action.disabled || !canSubmit}
                    onClick={() => void onSubmit(createProjectEditorDraft(draft), action.id)}
                    className="gap-2"
                  >
                    <Icon className={`h-4 w-4 ${busyActionId === action.id ? 'animate-spin' : ''}`} />
                    {busyActionId === action.id ? '저장 중...' : action.label}
                  </Button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
