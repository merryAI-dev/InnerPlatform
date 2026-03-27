import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { usePortalStore } from '../../data/portal-store';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { getAuthInstance } from '../../lib/firebase';
import {
  processProjectRequestContractViaBff,
  type ProjectRequestContractAnalysisResult,
} from '../../lib/platform-bff-client';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { PlatformApiError } from '../../platform/api-client';
import {
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  PROJECT_TYPE_LABELS,
  SETTLEMENT_TYPE_LABELS,
  type AccountType,
  type Basis,
  type ProjectRequestContractAnalysis,
  type SettlementType,
  type ProjectTeamMemberAssignment,
  type ProjectType,
} from '../../data/types';
import { PROJECT_DEPARTMENT_OPTIONS } from '../../data/project-department-options';
import { PROJECT_TEAM_MEMBER_OPTION_MAP, PROJECT_TEAM_MEMBER_OPTIONS } from '../../data/project-team-member-options';
import { type ProjectProposalDraft } from './project-proposal';
import {
  formatProjectTeamMembersSummary,
  hasIncompleteProjectTeamMembers,
  normalizeProjectTeamMembers,
} from '../../platform/project-team-members';
import { Progress } from '../ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

type Step = 'contract' | 'basic' | 'financial' | 'team' | 'review';
type ContractAnalysisState = 'idle' | 'extracting' | 'analyzing' | 'ready' | 'error';
type AnalysisFieldKey = keyof ProjectRequestContractAnalysis['fields'];
const MAX_CONTRACT_UPLOAD_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_CONTRACT_UPLOAD_SIZE_LABEL = '4MB';

const STEPS: Array<{
  key: Step;
  label: string;
  icon: typeof FileText;
  desc: string;
}> = [
  { key: 'contract', label: '계약서 업로드', icon: FileText, desc: 'PDF 업로드와 AI 기본값 생성 (선택)' },
  { key: 'basic', label: '기본 정보', icon: Building2, desc: '계약명, 등록명, 계약 대상' },
  { key: 'financial', label: '재무 정보', icon: Wallet, desc: '기간, 계약금액, 정산 기준' },
  { key: 'team', label: '팀 구성', icon: Users, desc: '담당자와 참고사항' },
  { key: 'review', label: '검토 및 제출', icon: ClipboardList, desc: '최종 확인 후 제출' },
];

const initialProposal: ProjectProposalDraft = {
  name: '',
  officialContractName: '',
  type: 'D1',
  description: '',
  clientOrg: '',
  department: '',
  contractAmount: 0,
  salesVatAmount: 0,
  totalRevenueAmount: 0,
  supportAmount: 0,
  contractStart: '',
  contractEnd: '',
  settlementType: 'TYPE1',
  basis: '공급가액',
  accountType: 'DEDICATED',
  paymentPlanDesc: '',
  settlementGuide: '',
  projectPurpose: '',
  managerName: '',
  teamName: '',
  teamMembers: '',
  teamMembersDetailed: [],
  participantCondition: '',
  note: '',
  contractDocument: null,
  contractAnalysis: null,
};

function fmtKRW(value: number) {
  if (!value) return '0';
  return value.toLocaleString('ko-KR');
}

function isTextBlank(value: string | null | undefined) {
  return !String(value || '').trim();
}

function toSuggestedProjectName(value: string) {
  const normalized = String(value || '')
    .replace(/\s+/g, '')
    .replace(/[()[\]{}]/g, '')
    .replace(/(계약서|협약서|용역|과업|계약|협약|사업|운영)$/g, '')
    .trim();
  return normalized.slice(0, 10);
}

function sanitizeOfficialContractName(value: string) {
  const normalized = String(value || '')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  const stripped = normalized
    .replace(/\s*(계약서|협약서|제안서|합의서|신청서|확인서|각서|문서)(\s*(초안|사본|원본|최종본|최종))?\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || normalized;
}

function mergeAnalysisIntoDraft(
  draft: ProjectProposalDraft,
  analysis: ProjectRequestContractAnalysisResult,
  options?: { overwriteExisting?: boolean },
): ProjectProposalDraft {
  const overwriteExisting = Boolean(options?.overwriteExisting);
  const next = { ...draft, contractAnalysis: analysis };
  const shouldApplyText = (value: string, current: string) => overwriteExisting || isTextBlank(current);
  const shouldApplyNumber = (value: number | null, current: number) => value !== null && (overwriteExisting || !current);
  const officialContractName = sanitizeOfficialContractName(analysis.fields.officialContractName.value);
  const suggestedProjectName =
    analysis.fields.suggestedProjectName.value || officialContractName;

  if (shouldApplyText(officialContractName, draft.officialContractName)) {
    next.officialContractName = officialContractName;
  }
  if (shouldApplyText(suggestedProjectName, draft.name)) {
    next.name = toSuggestedProjectName(suggestedProjectName);
  }
  if (shouldApplyText(analysis.fields.clientOrg.value, draft.clientOrg)) {
    next.clientOrg = analysis.fields.clientOrg.value;
  }
  if (shouldApplyText(analysis.fields.projectPurpose.value, draft.projectPurpose)) {
    next.projectPurpose = analysis.fields.projectPurpose.value;
  }
  if (shouldApplyText(analysis.fields.description.value, draft.description)) {
    next.description = analysis.fields.description.value;
  }
  if (shouldApplyText(analysis.fields.contractStart.value, draft.contractStart)) {
    next.contractStart = analysis.fields.contractStart.value;
  }
  if (shouldApplyText(analysis.fields.contractEnd.value, draft.contractEnd)) {
    next.contractEnd = analysis.fields.contractEnd.value;
  }
  if (shouldApplyNumber(analysis.fields.contractAmount.value, draft.contractAmount)) {
    next.contractAmount = analysis.fields.contractAmount.value || 0;
  }
  if (shouldApplyNumber(analysis.fields.salesVatAmount.value, draft.salesVatAmount)) {
    next.salesVatAmount = analysis.fields.salesVatAmount.value || 0;
  }
  return next;
}

function confidenceLabel(confidence: ProjectRequestContractAnalysis['fields'][AnalysisFieldKey]['confidence']) {
  if (confidence === 'high') return '높음';
  if (confidence === 'medium') return '보통';
  return '낮음';
}

function confidenceBadgeClass(confidence: ProjectRequestContractAnalysis['fields'][AnalysisFieldKey]['confidence']) {
  if (confidence === 'high') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  if (confidence === 'medium') return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  return 'bg-slate-500/15 text-slate-700 dark:text-slate-300';
}

function resolveContractUploadUiState(
  contractAnalysisState: ContractAnalysisState,
  hasContractDocument: boolean,
) {
  if (contractAnalysisState === 'extracting') {
    return {
      cardClass: 'border-teal-300 bg-teal-50/70 dark:border-teal-700/50 dark:bg-teal-950/20',
      surfaceClass: 'border-teal-300/70 bg-white/85 dark:border-teal-700/50 dark:bg-teal-950/30',
      badgeClass: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
      buttonClass: 'bg-teal-600 text-white hover:bg-teal-700',
      statusLabel: 'PDF 텍스트 추출 중',
      title: '계약서를 읽는 중입니다',
      description: 'PDF 텍스트를 먼저 추출한 뒤, AI 초안 생성 단계로 넘어갑니다.',
      ctaLabel: '처리 중...',
    };
  }
  if (contractAnalysisState === 'analyzing') {
    return {
      cardClass: 'border-teal-300 bg-teal-50/70 dark:border-teal-700/50 dark:bg-teal-950/20',
      surfaceClass: 'border-teal-300/70 bg-white/85 dark:border-teal-700/50 dark:bg-teal-950/30',
      badgeClass: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
      buttonClass: 'bg-teal-600 text-white hover:bg-teal-700',
      statusLabel: 'AI 초안 생성 중',
      title: '기본 정보를 채우는 중입니다',
      description: '공식 계약명, 계약 대상, 기간, 금액을 자동으로 읽어 초안을 만들고 있습니다.',
      ctaLabel: '분석 중...',
    };
  }
  if (hasContractDocument && contractAnalysisState === 'ready') {
    return {
      cardClass: 'border-emerald-300 bg-emerald-50/80 dark:border-emerald-700/50 dark:bg-emerald-950/20',
      surfaceClass: 'border-emerald-300/70 bg-white/90 dark:border-emerald-700/50 dark:bg-emerald-950/30',
      badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      buttonClass: 'bg-emerald-600 text-white hover:bg-emerald-700',
      statusLabel: '업로드 및 초안 생성 완료',
      title: '계약서 업로드가 완료됐습니다',
      description: '오른쪽 AI 초안을 확인하고, 아래 단계에서 사람 기준으로 한 번만 검토하면 됩니다.',
      ctaLabel: '계약서 다시 업로드',
    };
  }
  if (hasContractDocument) {
    return {
      cardClass: 'border-amber-300 bg-amber-50/80 dark:border-amber-700/50 dark:bg-amber-950/20',
      surfaceClass: 'border-amber-300/70 bg-white/90 dark:border-amber-700/50 dark:bg-amber-950/30',
      badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      buttonClass: 'bg-amber-600 text-white hover:bg-amber-700',
      statusLabel: '업로드 완료',
      title: '계약서는 올라갔지만 확인이 더 필요합니다',
      description: 'AI 초안 생성이 실패했거나 일부만 읽혔을 수 있습니다. 직접 보완하거나 다시 업로드할 수 있습니다.',
      ctaLabel: '계약서 다시 업로드',
    };
  }
  if (contractAnalysisState === 'error') {
    return {
      cardClass: 'border-rose-300 bg-rose-50/80 dark:border-rose-700/50 dark:bg-rose-950/20',
      surfaceClass: 'border-rose-300/70 bg-white/90 dark:border-rose-700/50 dark:bg-rose-950/30',
      badgeClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
      buttonClass: 'bg-rose-600 text-white hover:bg-rose-700',
      statusLabel: '업로드 오류',
      title: '계약서 업로드를 다시 시도해 주세요',
      description: 'PDF 업로드나 AI 초안 생성 중 문제가 있었습니다. 계약서를 다시 올리면 바로 재시도할 수 있습니다.',
      ctaLabel: '계약서 다시 업로드',
    };
  }
  return {
    cardClass: 'border-teal-200 bg-gradient-to-br from-teal-50/80 via-white to-cyan-50/70 dark:border-teal-800/40 dark:from-teal-950/20 dark:via-background dark:to-cyan-950/10',
    surfaceClass: 'border-teal-200/80 bg-white/90 dark:border-teal-800/40 dark:bg-teal-950/20',
    badgeClass: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
    buttonClass: 'bg-teal-600 text-white hover:bg-teal-700',
    statusLabel: '선택 사항',
    title: '계약서 PDF를 올리면 AI가 기본값을 채워줍니다',
    description: '건너뛰어도 괜찮아요! 다음 단계에서 직접 입력할 수 있습니다.',
    ctaLabel: '계약서 PDF 업로드',
  };
}

function isFileReadError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotReadableError';
}

function createEmptyTeamMember(): ProjectTeamMemberAssignment {
  return {
    memberName: '',
    memberNickname: '',
    role: '',
    participationRate: 0,
  };
}

function resolveContractUploadErrorMessage(error: unknown) {
  if (error instanceof PlatformApiError) {
    if (error.status === 413) {
      return `계약서 PDF는 ${MAX_CONTRACT_UPLOAD_SIZE_LABEL} 이하만 업로드할 수 있습니다. 파일을 압축하거나 필요한 페이지만 추려 다시 시도해 주세요.`;
    }
    if (error.status === 403) {
      return '현재 로그인 상태로 계약서 업로드를 완료하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.';
    }
  }
  return resolveApiErrorMessage(error, '계약서 업로드에 실패했습니다. 다시 시도해 주세요.');
}

export function PortalProjectRegister() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const { orgId } = useFirebase();
  const { portalUser, projects, createProjectRequest } = usePortalStore();

  const [step, setStep] = useState<Step>('contract');
  const [highestVisitedIdx, setHighestVisitedIdx] = useState(0);
  const [form, setForm] = useState<ProjectProposalDraft>({
    ...initialProposal,
    managerName: portalUser?.name || authUser?.name || '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingContract, setIsUploadingContract] = useState(false);
  const [contractAnalysisState, setContractAnalysisState] = useState<ContractAnalysisState>('idle');
  const [analysisError, setAnalysisError] = useState('');
  const contractFileInputRef = useRef<HTMLInputElement | null>(null);

  const currentStepIdx = STEPS.findIndex((item) => item.key === step);
  const currentStep = STEPS[currentStepIdx];
  const CurrentStepIcon = currentStep.icon;
  const progress = ((currentStepIdx + 1) / STEPS.length) * 100;

  const projectNameOptions = useMemo(
    () => Array.from(new Set(projects.map((project) => String(project.name || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko')),
    [projects],
  );
  const clientOrgOptions = useMemo(
    () => Array.from(new Set(projects.map((project) => String(project.clientOrg || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko')),
    [projects],
  );

  const analysis = form.contractAnalysis || null;
  const analysisField = (key: AnalysisFieldKey) => analysis?.fields[key] || null;
  const hasContractDocument = Boolean(form.contractDocument);
  const contractUploadUi = resolveContractUploadUiState(contractAnalysisState, hasContractDocument);
  const normalizedTeamMembers = useMemo(
    () => normalizeProjectTeamMembers(form.teamMembersDetailed),
    [form.teamMembersDetailed],
  );
  const teamMembersSummary = useMemo(
    () => formatProjectTeamMembersSummary(normalizedTeamMembers, form.teamMembers),
    [normalizedTeamMembers, form.teamMembers],
  );
  const hasIncompleteTeamRows = useMemo(
    () => hasIncompleteProjectTeamMembers(form.teamMembersDetailed),
    [form.teamMembersDetailed],
  );

  const canProceed = () => {
    if (step === 'contract') {
      return !isUploadingContract && contractAnalysisState !== 'extracting' && contractAnalysisState !== 'analyzing';
    }
    if (step === 'basic') {
      return Boolean(form.department && form.officialContractName.trim() && form.name.trim() && form.clientOrg.trim() && form.type);
    }
    if (step === 'financial') {
      return form.contractAmount > 0 && Boolean(form.contractStart) && Boolean(form.contractEnd);
    }
    if (step === 'team') {
      return Boolean(form.managerName.trim()) && !hasIncompleteTeamRows;
    }
    return true;
  };

  const update = (key: keyof ProjectProposalDraft, value: ProjectProposalDraft[keyof ProjectProposalDraft]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const syncTeamMembers = (members: ProjectTeamMemberAssignment[]) => {
    const normalized = normalizeProjectTeamMembers(members);
    const summary = formatProjectTeamMembersSummary(normalized, '');
    setForm((prev) => ({
      ...prev,
      teamMembersDetailed: members,
      teamMembers: summary === '-' ? '' : summary,
    }));
  };

  const addTeamMember = () => {
    syncTeamMembers([...(form.teamMembersDetailed || []), createEmptyTeamMember()]);
  };

  const updateTeamMember = (index: number, patch: Partial<ProjectTeamMemberAssignment>) => {
    const next = [...(form.teamMembersDetailed || [])];
    const current = next[index] || createEmptyTeamMember();
    next[index] = { ...current, ...patch };
    syncTeamMembers(next);
  };

  const removeTeamMember = (index: number) => {
    const next = [...(form.teamMembersDetailed || [])];
    next.splice(index, 1);
    syncTeamMembers(next);
  };

  const handleContractDocumentSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!/pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast.error('계약서 파일은 PDF로 업로드해 주세요.');
      input.value = '';
      return;
    }
    if (!authUser?.uid) {
      toast.error('로그인 정보를 확인할 수 없습니다.');
      input.value = '';
      return;
    }
    if (file.size > MAX_CONTRACT_UPLOAD_SIZE_BYTES) {
      const message = `계약서 PDF는 ${MAX_CONTRACT_UPLOAD_SIZE_LABEL} 이하만 업로드할 수 있습니다. 파일을 압축하거나 필요한 페이지만 추려 다시 시도해 주세요.`;
      setContractAnalysisState('error');
      setAnalysisError(message);
      toast.error(message);
      input.value = '';
      return;
    }
    setIsUploadingContract(true);
    setContractAnalysisState('extracting');
    setAnalysisError('');

    try {
      const idToken = authUser.idToken || await getAuthInstance()?.currentUser?.getIdToken() || undefined;
      const processed = await processProjectRequestContractViaBff({
        tenantId: orgId,
        actor: {
          uid: authUser.uid,
          email: authUser.email,
          role: authUser.role,
          idToken,
        },
        file,
      });
      const contractDocument = processed.contractDocument;
      const nextAnalysis: ProjectRequestContractAnalysisResult | null = processed.analysis || null;

      setForm((prev) => {
        const base = {
          ...prev,
          contractDocument,
          contractAnalysis: nextAnalysis || null,
        };
        return nextAnalysis ? mergeAnalysisIntoDraft(base, nextAnalysis, { overwriteExisting: false }) : base;
      });

      if (nextAnalysis) {
        setContractAnalysisState('ready');
        toast.success(`계약서 업로드 및 AI 초안 생성 완료: ${file.name}`);
      } else {
        setContractAnalysisState('error');
        toast.success(`계약서 업로드 완료: ${file.name}`);
      }
      const basicIdx = STEPS.findIndex((s) => s.key === 'basic');
      setHighestVisitedIdx((prev) => Math.max(prev, basicIdx));
      setStep('basic');
    } catch (error) {
      console.error('[PortalProjectRegister] contract upload failed:', error);
      setContractAnalysisState('error');
      if (isFileReadError(error)) {
        setAnalysisError('선택한 파일을 브라우저가 읽지 못했습니다. 파일을 다시 선택하거나 다른 PDF로 시도해 주세요.');
        toast.error('파일을 읽지 못했습니다. 같은 파일을 다시 선택하거나 다시 다운로드한 PDF로 시도해 주세요.');
      } else {
        const message = resolveContractUploadErrorMessage(error);
        setAnalysisError(message);
        toast.error(message);
      }
    } finally {
      setIsUploadingContract(false);
      input.value = '';
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    // contractDocument is now optional — PDF upload can be skipped

    setIsSubmitting(true);
    try {
      const payload = {
        ...form,
        teamMembersDetailed: normalizedTeamMembers,
        teamMembers: teamMembersSummary === '-' ? '' : teamMembersSummary,
      };
      const createdId = await createProjectRequest(payload);
      if (!createdId) {
        toast.error('사업 등록 제안 저장에 실패했습니다. 다시 시도해 주세요.');
        return;
      }
      setForm(payload);
      setSubmitted(true);
      toast.success('사업 등록 제안이 저장되었습니다. 관리자 검토를 기다려주세요.');
    } catch (error: any) {
      console.error('[PortalProjectRegister] create project request failed:', error);
      toast.error(error?.message || '사업 등록 제안 저장에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: 'linear-gradient(135deg, #059669, #0d9488)' }}
        >
          <CheckCircle2 className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-[18px]" style={{ fontWeight: 700 }}>사업 등록 제안 완료</h2>
        <p className="mt-2 text-[13px] text-muted-foreground">
          <span style={{ fontWeight: 600 }}>&quot;{form.name}&quot;</span> 사업 등록 제안이 저장되었습니다.
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">관리자 검토 후 포털에서 바로 관리할 수 있습니다.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" onClick={() => navigate('/portal')}>대시보드로</Button>
          <Button
            onClick={() => {
              setSubmitted(false);
              setForm({
                ...initialProposal,
                managerName: portalUser?.name || authUser?.name || '',
              });
              setStep('contract');
              setContractAnalysisState('idle');
              setAnalysisError('');
            }}
          >
            추가 등록
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-[12px]" onClick={() => navigate('/portal')}>
          <ArrowLeft className="h-3.5 w-3.5" />
          돌아가기
        </Button>
      </div>

      <Card className="border-border/60">
        <CardHeader className="gap-4 pb-4">
          <div className="space-y-1">
            <CardTitle className="text-[18px]" style={{ fontWeight: 700 }}>사업 등록 제안</CardTitle>
            <p className="text-[12px] text-muted-foreground">
              계약서 PDF를 올리면 AI가 기본 정보를 채워주고, 없으면 직접 입력할 수 있습니다.
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{currentStepIdx + 1} / {STEPS.length} 단계</span>
              <span>{currentStep.label}</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
          {/* Mobile: active step only with prev/next hints */}
          <div className="flex items-center gap-2 md:hidden">
            {currentStepIdx > 0 ? (
              <button
                type="button"
                onClick={() => setStep(STEPS[currentStepIdx - 1].key)}
                className="flex-shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                ← {STEPS[currentStepIdx - 1].label}
              </button>
            ) : <span className="flex-shrink-0" />}
            <button
              type="button"
              className={[
                'flex-1 rounded-xl border px-3 py-3 text-left transition-colors',
                'border-teal-500/40 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-300',
              ].join(' ')}
            >
              <div className="flex items-center gap-2">
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-500 text-white text-[10px]"
                  style={{ fontWeight: 700 }}
                >
                  {currentStepIdx + 1}
                </div>
                {(() => { const Icon = currentStep.icon; return <Icon className="h-4 w-4" />; })()}
              </div>
              <div className="mt-2 text-[12px]" style={{ fontWeight: 600 }}>{currentStep.label}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{currentStep.desc}</div>
            </button>
            {currentStepIdx < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => {
                  if (currentStepIdx + 1 <= currentStepIdx) setStep(STEPS[currentStepIdx + 1].key);
                }}
                className="flex-shrink-0 text-[11px] text-muted-foreground opacity-50"
              >
                {STEPS[currentStepIdx + 1].label} →
              </button>
            ) : <span className="flex-shrink-0" />}
          </div>
          {/* Desktop: full 5-column grid */}
          <div className="hidden md:grid md:grid-cols-5 gap-2">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const active = item.key === step;
              const done = index < currentStepIdx;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    if (index <= currentStepIdx) setStep(item.key);
                  }}
                  className={[
                    'rounded-xl border px-3 py-3 text-left transition-colors',
                    active
                      ? 'border-teal-500/40 bg-teal-50 text-teal-700 dark:border-teal-700 dark:bg-teal-950/30 dark:text-teal-300'
                      : done
                        ? 'border-emerald-500/20 bg-emerald-50 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/20 dark:text-emerald-300'
                        : 'border-border/60 bg-background text-foreground',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={[
                        'flex h-7 w-7 items-center justify-center rounded-full text-[10px]',
                        done ? 'bg-emerald-500 text-white' : active ? 'bg-teal-500 text-white' : 'bg-muted text-muted-foreground',
                      ].join(' ')}
                      style={{ fontWeight: 700 }}
                    >
                      {done ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                    </div>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-[12px]" style={{ fontWeight: 600 }}>{item.label}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{item.desc}</div>
                </button>
              );
            })}
          </div>
        </CardHeader>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CurrentStepIcon className="h-4 w-4 text-teal-600" />
            <CardTitle className="text-[15px]" style={{ fontWeight: 700 }}>{currentStep.label}</CardTitle>
          </div>
          <p className="text-[11px] text-muted-foreground">{currentStep.desc}</p>
        </CardHeader>
        <CardContent className="space-y-5 p-5">
          {step === 'contract' && (
            <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
              <Card className={contractUploadUi.cardClass}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-[13px]">1. 계약서 업로드</CardTitle>
                    <Badge className={`border-0 ${contractUploadUi.badgeClass}`}>
                      {contractUploadUi.statusLabel}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    계약서 PDF를 올리면 AI가 기본 정보를 채워줍니다. <span className="font-semibold text-teal-600 dark:text-teal-400">건너뛰어도 괜찮아요!</span>
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <input
                    ref={contractFileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={handleContractDocumentSelect}
                  />
                  <div className={`rounded-2xl border border-dashed p-5 shadow-sm transition-colors ${contractUploadUi.surfaceClass}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-[15px]" style={{ fontWeight: 700 }}>{contractUploadUi.title}</div>
                        <p className="max-w-xl text-[11px] leading-5 text-muted-foreground">
                          {contractUploadUi.description}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge className={`border-0 ${contractUploadUi.badgeClass}`}>PDF 선택</Badge>
                        <Badge className="border-0 bg-slate-500/15 text-slate-700 dark:text-slate-300">업로드 후 AI 초안 자동 생성</Badge>
                      </div>
                    </div>

                    <div className="mt-5">
                      <Button
                        type="button"
                        className={`h-14 w-full gap-2 text-[14px] shadow-sm ${contractUploadUi.buttonClass}`}
                        onClick={() => contractFileInputRef.current?.click()}
                        disabled={isUploadingContract}
                      >
                        {isUploadingContract ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {contractUploadUi.ctaLabel}
                      </Button>
                      <button
                        type="button"
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 text-[13px] font-semibold text-teal-700 transition-colors hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300 dark:hover:bg-teal-950/50"
                        onClick={() => {
                          const basicIdx = STEPS.findIndex((s) => s.key === 'basic');
                          setHighestVisitedIdx((prev) => Math.max(prev, basicIdx));
                          setStep('basic');
                        }}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        PDF 없이 직접 입력하기
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>계약이 확정되었다는 서류를 업로드해 주세요.</span>
                      <span>날인이 되어 있지 않아도 됩니다.</span>
                      <span>스캔본도 가능하지만 텍스트 PDF가 더 잘 읽힙니다.</span>
                    </div>
                    {form.contractDocument ? (
                      <div className="mt-4 rounded-xl border border-border/60 bg-background/80 px-4 py-3 text-[11px]">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div style={{ fontWeight: 700 }}>{form.contractDocument.name}</div>
                            <div className="mt-1 text-muted-foreground">
                              {(form.contractDocument.size / 1024 / 1024).toFixed(2)} MB · {form.contractDocument.uploadedAt.slice(0, 10)}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <a
                              href={form.contractDocument.downloadURL}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[11px] text-teal-600 transition-colors hover:bg-teal-50 dark:hover:bg-teal-950/20"
                            >
                              업로드된 파일 보기
                            </a>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-8 text-[11px]"
                              onClick={() => {
                                setForm((prev) => ({ ...prev, contractDocument: null, contractAnalysis: null }));
                                setContractAnalysisState('idle');
                                setAnalysisError('');
                              }}
                            >
                              첨부 제거
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-teal-200/60 bg-teal-50/50 px-4 py-3 text-[11px] text-teal-700 dark:border-teal-800/40 dark:bg-teal-950/20 dark:text-teal-300">
                        <span className="font-semibold">PDF 없이도 진행 가능!</span> 위의 <span className="font-medium">&quot;PDF 없이 직접 입력하기&quot;</span> 버튼을 눌러 다음 단계로 넘어가세요.
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                    <div className="flex items-center gap-2 text-[12px]" style={{ fontWeight: 600 }}>
                      <Sparkles className="h-4 w-4 text-teal-600" />
                      2. AI 기본값 채우기
                    </div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      업로드 후 공식 계약명, 등록 프로젝트명, 계약 대상, 계약 기간, 계약금액 초안을 자동으로 채웁니다.
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                      <Badge className="border-0 bg-slate-500/15 text-slate-700 dark:text-slate-300">사람 검토 필수</Badge>
                      <Badge className="border-0 bg-teal-500/15 text-teal-700 dark:text-teal-300">담당팀/정산유형은 수동 선택</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-[13px]">Merry의 분석 초안</CardTitle>
                    {analysis ? (
                      <Badge className="border-0 bg-teal-500/15 text-teal-700 dark:text-teal-300">
                        {analysis.provider === 'anthropic' ? 'Merry의 분석' : 'Merry 기본 분석'}
                      </Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {contractAnalysisState === 'extracting' || contractAnalysisState === 'analyzing' ? (
                    <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-6 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-teal-600" />
                      <p className="mt-3 text-[12px]" style={{ fontWeight: 600 }}>
                        {contractAnalysisState === 'extracting' ? 'PDF 텍스트 추출 중…' : 'AI가 계약서 초안을 만들고 있습니다…'}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        공식 계약명, 계약 대상, 기간, 금액을 기본 정보에 먼저 채웁니다.
                      </p>
                    </div>
                  ) : analysis ? (
                    <>
                      <div className="rounded-xl bg-teal-50 px-3 py-3 text-[11px] text-teal-800 dark:bg-teal-950/20 dark:text-teal-200">
                        <div className="flex items-center justify-between gap-2">
                          <span style={{ fontWeight: 600 }}>AI 요약</span>
                          <span className="text-[10px] text-teal-700/80 dark:text-teal-200/80">{analysis.extractedAt.slice(0, 16).replace('T', ' ')}</span>
                        </div>
                        <p className="mt-2 leading-5">{analysis.summary}</p>
                      </div>

                      <div className="space-y-2 rounded-xl border border-border/60 p-3">
                        <div className="text-[11px]" style={{ fontWeight: 600 }}>바로 채운 항목</div>
                        <SuggestedField label="공식 계약명" field={analysis.fields.officialContractName} />
                        <SuggestedField label="등록 프로젝트명" field={analysis.fields.suggestedProjectName} />
                        <SuggestedField label="계약 대상" field={analysis.fields.clientOrg} />
                        <SuggestedField label="프로젝트 목적" field={analysis.fields.projectPurpose} />
                        <SuggestedField label="주요 내용" field={analysis.fields.description} />
                        <SuggestedField label="계약 시작일" field={analysis.fields.contractStart} />
                        <SuggestedField label="계약 종료일" field={analysis.fields.contractEnd} />
                        <SuggestedField label="계약금액" field={analysis.fields.contractAmount} />
                        <SuggestedField label="매출 부가세" field={analysis.fields.salesVatAmount} />
                      </div>

                      {analysis.warnings.length > 0 ? (
                        <div className="rounded-xl bg-amber-50 px-3 py-3 text-[11px] text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                          <div style={{ fontWeight: 600 }}>확인 필요</div>
                          <ul className="mt-2 space-y-1 list-disc pl-4">
                            {analysis.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {analysis.nextActions.length > 0 ? (
                        <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3 text-[11px]">
                          <div style={{ fontWeight: 600 }}>다음으로 할 일</div>
                          <ul className="mt-2 space-y-1 list-disc pl-4 text-muted-foreground">
                            {analysis.nextActions.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div className="rounded-xl border border-teal-200 bg-teal-50/70 px-3 py-3 text-[11px] text-teal-800 dark:border-teal-800/40 dark:bg-teal-950/20 dark:text-teal-200">
                        Merry의 분석 초안은 이미 다음 단계의 기본 정보에 반영되었습니다. 아래 단계에서 사람 기준으로 바로 수정해 주세요.
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-6 text-[11px] text-muted-foreground">
                      계약서를 업로드하면 AI가 기본 정보를 먼저 채워 줍니다. 스캔본이면 일부 항목은 사람이 직접 보완해야 할 수 있습니다.
                    </div>
                  )}

                  {analysisError ? (
                    <div className="rounded-xl bg-rose-50 px-3 py-3 text-[11px] text-rose-700 dark:bg-rose-950/20 dark:text-rose-300">
                      {analysisError}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          )}

          {step === 'basic' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-[11px]">신청자(별명)</Label>
                  <Input
                    value={portalUser?.name || authUser?.name || ''}
                    readOnly
                    className="mt-1 h-9 bg-muted/40 text-[12px]"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">담당팀 *</Label>
                  <Select value={form.department || undefined} onValueChange={(value) => update('department', value)}>
                    <SelectTrigger className="mt-1 h-9 text-[12px]">
                      <SelectValue placeholder="담당팀 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_DEPARTMENT_OPTIONS.map((department) => (
                        <SelectItem key={department} value={department}>{department}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <FieldLabel label="공식 계약명 *" field={analysisField('officialContractName')} />
                <Input
                  value={form.officialContractName}
                  onChange={(event) => update('officialContractName', event.target.value)}
                  placeholder="계약서 상의 공식 명칭"
                  className="mt-1 h-9 text-[12px]"
                />
                <FieldEvidence field={analysisField('officialContractName')} />
              </div>

              <div>
                <FieldLabel label="등록 프로젝트명 (10글자 이내) *" field={analysisField('suggestedProjectName')} />
                <datalist id="project-name-options">
                  {projectNameOptions.map((name) => <option key={name} value={name} />)}
                </datalist>
                <Input
                  value={form.name}
                  onChange={(event) => update('name', event.target.value.slice(0, 10))}
                  placeholder="예: 뷰티풀커넥트"
                  list="project-name-options"
                  className="mt-1 h-9 text-[12px]"
                />
                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>계약서 공식 명칭과 별도로, 내부에서 짧게 쓰는 이름을 적어 주세요.</span>
                  <span>{form.name.length}/10자</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-[11px]">프로젝트 유형 *</Label>
                  <Select value={form.type} onValueChange={(value) => update('type', value)}>
                    <SelectTrigger className="mt-1 h-9 text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(PROJECT_TYPE_LABELS) as [ProjectType, string][]).map(([key, value]) => (
                        <SelectItem key={key} value={key}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <FieldLabel label="계약 대상 *" field={analysisField('clientOrg')} />
                  <datalist id="client-org-options">
                    {clientOrgOptions.map((name) => <option key={name} value={name} />)}
                  </datalist>
                  <Input
                    value={form.clientOrg}
                    onChange={(event) => update('clientOrg', event.target.value)}
                    placeholder="예: KOICA, 서울시, 아모레퍼시픽재단"
                    list="client-org-options"
                    className="mt-1 h-9 text-[12px]"
                  />
                  <FieldEvidence field={analysisField('clientOrg')} />
                </div>
              </div>

              <div>
                <FieldLabel label="프로젝트 목적" field={analysisField('projectPurpose')} />
                <Textarea
                  value={form.projectPurpose}
                  onChange={(event) => update('projectPurpose', event.target.value)}
                  placeholder="예: 어떤 대상에게 어떤 가치를 제공하는 사업인지 적어 주세요."
                  className="mt-1 min-h-[90px] text-[12px]"
                />
                <FieldEvidence field={analysisField('projectPurpose')} />
              </div>

              <div>
                <FieldLabel label="프로젝트 주요 내용" field={analysisField('description')} />
                <Textarea
                  value={form.description}
                  onChange={(event) => update('description', event.target.value)}
                  placeholder="프로젝트 주요 수행 내용, 범위, 산출물 등을 적어 주세요."
                  className="mt-1 min-h-[110px] text-[12px]"
                />
                <FieldEvidence field={analysisField('description')} />
              </div>
            </div>
          )}

          {step === 'financial' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel label="계약 시작일 *" field={analysisField('contractStart')} />
                  <Input
                    type="date"
                    value={form.contractStart}
                    onChange={(event) => update('contractStart', event.target.value)}
                    className="mt-1 h-9 text-[12px]"
                  />
                  <FieldEvidence field={analysisField('contractStart')} />
                </div>
                <div>
                  <FieldLabel label="계약 종료일 *" field={analysisField('contractEnd')} />
                  <Input
                    type="date"
                    value={form.contractEnd}
                    onChange={(event) => update('contractEnd', event.target.value)}
                    className="mt-1 h-9 text-[12px]"
                  />
                  <FieldEvidence field={analysisField('contractEnd')} />
                </div>
              </div>

              <div>
                <FieldLabel label="계약금액 (계약서 내 기재된 총 금액) *" field={analysisField('contractAmount')} />
                <Input
                  type="number"
                  value={form.contractAmount || ''}
                  onChange={(event) => update('contractAmount', Number(event.target.value) || 0)}
                  placeholder="0"
                  className="mt-1 h-9 text-[12px]"
                />
                <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <FieldEvidence field={analysisField('contractAmount')} />
                  {form.contractAmount > 0 ? <span>{fmtKRW(form.contractAmount)}원</span> : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <FieldLabel label="매출 부가세" field={analysisField('salesVatAmount')} />
                  <Input
                    type="number"
                    value={form.salesVatAmount || ''}
                    onChange={(event) => update('salesVatAmount', Number(event.target.value) || 0)}
                    placeholder="0"
                    className="mt-1 h-9 text-[12px]"
                  />
                  <FieldEvidence field={analysisField('salesVatAmount')} />
                </div>
                <div>
                  <Label className="text-[11px]">총수익</Label>
                  <Input
                    type="number"
                    value={form.totalRevenueAmount || ''}
                    onChange={(event) => update('totalRevenueAmount', Number(event.target.value) || 0)}
                    placeholder="0"
                    className="mt-1 h-9 text-[12px]"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">지원금</Label>
                  <Input
                    type="number"
                    value={form.supportAmount || ''}
                    onChange={(event) => update('supportAmount', Number(event.target.value) || 0)}
                    placeholder="0"
                    className="mt-1 h-9 text-[12px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <Label className="text-[11px]">정산 유형</Label>
                  <Select value={form.settlementType} onValueChange={(value) => update('settlementType', value as SettlementType)}>
                    <SelectTrigger className="mt-1 h-9 text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(SETTLEMENT_TYPE_LABELS) as [SettlementType, string][]).map(([key, value]) => (
                        <SelectItem key={key} value={key}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">정산 기준</Label>
                  <Select value={form.basis} onValueChange={(value) => update('basis', value as Basis)}>
                    <SelectTrigger className="mt-1 h-9 text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(BASIS_LABELS) as [Basis, string][]).map(([key, value]) => (
                        <SelectItem key={key} value={key}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px]">통장 유형</Label>
                  <Select value={form.accountType} onValueChange={(value) => update('accountType', value as AccountType)}>
                    <SelectTrigger className="mt-1 h-9 text-[12px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(ACCOUNT_TYPE_LABELS) as [AccountType, string][]).map(([key, value]) => (
                        <SelectItem key={key} value={key}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-[11px]">선금/중도금/잔금 비율(%) 및 금액, 입금예상시점</Label>
                <Textarea
                  value={form.paymentPlanDesc}
                  onChange={(event) => update('paymentPlanDesc', event.target.value)}
                  placeholder="예: 선금 50%(5천만원, 4월), 중도금 30%(6월), 잔금 20%(완료 후 2주)"
                  className="mt-1 min-h-[82px] text-[12px]"
                />
              </div>

              <div>
                <Label className="text-[11px]">사업비 수령 방식 및 정산 기준</Label>
                <Textarea
                  value={form.settlementGuide}
                  onChange={(event) => update('settlementGuide', event.target.value)}
                  placeholder="예: 이나라도움 수령, 공급가액 기준, 선지급 후 정산"
                  className="mt-1 min-h-[82px] text-[12px]"
                />
              </div>
            </div>
          )}

          {step === 'team' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-[11px]">PM (메인 담당자) *</Label>
                  <Input
                    value={form.managerName}
                    onChange={(event) => update('managerName', event.target.value)}
                    placeholder="메인 담당자명"
                    className="mt-1 h-9 text-[12px]"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">참여기업 조건</Label>
                  <Input
                    value={form.participantCondition}
                    onChange={(event) => update('participantCondition', event.target.value)}
                    placeholder="참여기업 자격 조건"
                    className="mt-1 h-9 text-[12px]"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="text-[11px]">팀원 구성</Label>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      팀원을 선택하고 역할과 참여율(%)을 같이 입력해 주세요.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-[11px]"
                    onClick={addTeamMember}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    팀원 추가
                  </Button>
                </div>

                {form.teamMembersDetailed.length === 0 ? (
                  <div className="mt-2 rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-5 text-[11px] text-muted-foreground">
                    아직 추가된 팀원이 없습니다. `팀원 추가`를 눌러 역할과 참여율을 함께 입력해 주세요.
                  </div>
                ) : (
                  <div className="mt-2 space-y-3">
                    {form.teamMembersDetailed.map((member, index) => {
                      const selectedNames = new Set(
                        form.teamMembersDetailed
                          .map((item, itemIndex) => (itemIndex === index ? '' : item.memberName))
                          .filter(Boolean),
                      );
                      return (
                        <div key={`${member.memberName || 'member'}-${index}`} className="rounded-xl border border-border/60 bg-background/70 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px]" style={{ fontWeight: 600 }}>팀원 {index + 1}</div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px] text-rose-600 hover:text-rose-700"
                              onClick={() => removeTeamMember(index)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_120px]">
                            <div>
                              <Label className="text-[11px]">팀원</Label>
                              <Select
                                value={member.memberName || undefined}
                                onValueChange={(value) => {
                                  const option = PROJECT_TEAM_MEMBER_OPTION_MAP[value];
                                  updateTeamMember(index, {
                                    memberName: option?.name || value,
                                    memberNickname: option?.nickname || '',
                                  });
                                }}
                              >
                                <SelectTrigger className="mt-1 h-9 text-[12px]">
                                  <SelectValue placeholder="팀원 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                  {PROJECT_TEAM_MEMBER_OPTIONS.map((option) => (
                                    <SelectItem
                                      key={option.value}
                                      value={option.value}
                                      disabled={selectedNames.has(option.value)}
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <Label className="text-[11px]">역할</Label>
                              <Input
                                value={member.role}
                                onChange={(event) => updateTeamMember(index, { role: event.target.value })}
                                placeholder="예: PM, 운영, 정산지원"
                                className="mt-1 h-9 text-[12px]"
                              />
                            </div>

                            <div>
                              <Label className="text-[11px]">참여율(%)</Label>
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step={1}
                                value={member.participationRate || ''}
                                onChange={(event) => updateTeamMember(index, { participationRate: Number(event.target.value) || 0 })}
                                placeholder="0"
                                className="mt-1 h-9 text-[12px]"
                              />
                            </div>
                          </div>

                          {(!member.memberName || !member.role.trim() || member.participationRate <= 0) ? (
                            <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
                              팀원, 역할, 참여율을 모두 입력해야 다음 단계로 넘어갈 수 있습니다.
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <Label className="text-[11px]">기타 참고사항</Label>
                <Textarea
                  value={form.note}
                  onChange={(event) => update('note', event.target.value)}
                  placeholder="관리자에게 전달할 추가 참고사항"
                  className="mt-1 min-h-[90px] text-[12px]"
                />
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-[11px] text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-200">
                <div className="flex items-center gap-2" style={{ fontWeight: 600 }}>
                  <AlertTriangle className="h-4 w-4" />
                  제출 전 최종 확인
                </div>
                <p className="mt-1">계약서 공식 명칭, 등록 프로젝트명, 계약금액, 기간을 한 번 더 확인한 뒤 제출해 주세요.</p>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <SummaryCard title="기본 정보">
                  <ReviewRow label="신청자" value={portalUser?.name || authUser?.name || '-'} />
                  <ReviewRow label="담당팀" value={form.department || '-'} />
                  <ReviewRow label="공식 계약명" value={form.officialContractName || '-'} />
                  <ReviewRow label="등록명" value={form.name || '-'} />
                  <ReviewRow label="프로젝트 유형" value={PROJECT_TYPE_LABELS[form.type]} />
                  <ReviewRow label="계약 대상" value={form.clientOrg || '-'} />
                  <ReviewRow label="프로젝트 목적" value={form.projectPurpose || '-'} />
                  <ReviewRow label="주요 내용" value={form.description || '-'} />
                </SummaryCard>

                <SummaryCard title="재무 정보">
                  <ReviewRow label="계약 시작일" value={form.contractStart || '-'} />
                  <ReviewRow label="계약 종료일" value={form.contractEnd || '-'} />
                  <ReviewRow label="계약금액" value={`${fmtKRW(form.contractAmount)}원`} highlight />
                  <ReviewRow label="매출 부가세" value={`${fmtKRW(form.salesVatAmount)}원`} />
                  <ReviewRow label="총수익" value={`${fmtKRW(form.totalRevenueAmount)}원`} />
                  <ReviewRow label="지원금" value={`${fmtKRW(form.supportAmount)}원`} />
                  <ReviewRow label="정산 유형" value={SETTLEMENT_TYPE_LABELS[form.settlementType]} />
                  <ReviewRow label="정산 기준" value={BASIS_LABELS[form.basis]} />
                  <ReviewRow label="통장 유형" value={ACCOUNT_TYPE_LABELS[form.accountType]} />
                  <ReviewRow label="입금 계획" value={form.paymentPlanDesc || '-'} />
                  <ReviewRow label="사업비 수령/정산" value={form.settlementGuide || '-'} />
                </SummaryCard>

                <SummaryCard title="팀 구성">
                  <ReviewRow label="PM" value={form.managerName || '-'} />
                  <ReviewRow label="팀원" value={teamMembersSummary} />
                  <ReviewRow label="참여조건" value={form.participantCondition || '-'} />
                  <ReviewRow label="참고사항" value={form.note || '-'} />
                </SummaryCard>

                <SummaryCard title="계약서 및 AI 초안">
                  {form.contractDocument ? (
                    <>
                      <ReviewRow label="첨부 파일" value={form.contractDocument.name} />
                      <ReviewRow label="AI 요약" value={analysis?.summary || '-'} />
                      <ReviewRow label="확인 필요" value={analysis?.warnings.join(', ') || '-'} />
                    </>
                  ) : (
                    <p className="text-[12px] text-muted-foreground">계약서 없이 등록합니다</p>
                  )}
                </SummaryCard>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1 text-[12px]"
          disabled={currentStepIdx === 0}
          onClick={() => setStep(STEPS[currentStepIdx - 1].key)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          이전
        </Button>

        {step === 'review' ? (
          <Button
            size="sm"
            className="h-9 gap-1.5 text-[12px]"
            style={{ background: 'linear-gradient(135deg, #0d9488, #059669)' }}
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {isSubmitting ? '제출 중...' : '관리자에게 제출'}
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-9 gap-1 text-[12px]"
            disabled={!canProceed()}
            onClick={() => {
              const nextIdx = currentStepIdx + 1;
              setHighestVisitedIdx((prev) => Math.max(prev, nextIdx));
              setStep(STEPS[nextIdx].key);
            }}
          >
            다음
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function FieldLabel({
  label,
  field,
}: {
  label: string;
  field: ProjectRequestContractAnalysis['fields'][AnalysisFieldKey] | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-[11px]">{label}</Label>
      {field?.value ? (
        <Badge className={`border-0 text-[10px] ${confidenceBadgeClass(field.confidence)}`}>
          AI 초안 · {confidenceLabel(field.confidence)}
        </Badge>
      ) : null}
    </div>
  );
}

function FieldEvidence({
  field,
}: {
  field: ProjectRequestContractAnalysis['fields'][AnalysisFieldKey] | null;
}) {
  if (!field?.evidence) return null;
  return (
    <p className="mt-1 text-[10px] text-muted-foreground">
      계약서 근거: {field.evidence}
    </p>
  );
}

function SuggestedField({
  label,
  field,
}: {
  label: string;
  field: ProjectRequestContractAnalysis['fields'][AnalysisFieldKey];
}) {
  const value = typeof field.value === 'number'
    ? `${fmtKRW(field.value)}원`
    : field.value || '-';
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <Badge className={`border-0 text-[10px] ${confidenceBadgeClass(field.confidence)}`}>
          {confidenceLabel(field.confidence)}
        </Badge>
      </div>
      <div className="mt-1" style={{ fontWeight: 600 }}>{value}</div>
      {field.evidence ? (
        <div className="mt-1 text-[10px] text-muted-foreground">{field.evidence}</div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-[12px]">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function ReviewRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="w-[88px] shrink-0 text-muted-foreground">{label}</span>
      <span className={highlight ? 'text-teal-600 dark:text-teal-400' : ''} style={{ fontWeight: highlight ? 600 : 500 }}>
        {value}
      </span>
    </div>
  );
}
