import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  ClipboardList,
  CreditCard,
  FileText,
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
  Users,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useBlocker } from 'react-router';
import {
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  LABOR_SETTLEMENT_BASIS_LABELS,
  getProjectContractTypeSelectableOptions,
  getDefaultSettlementSheetPolicyForFundInputMode,
  getProjectTypeSelectableOptions,
  normalizeProjectContractType,
  normalizeSettlementSheetPolicy,
  PROJECT_CURRENCY_LABELS,
  PROJECT_FUND_INPUT_MODE_LABELS,
  PROJECT_PHASE_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  SETTLEMENT_TYPE_LABELS,
  SETTLEMENT_SYSTEM_LABELS,
  type AccountType,
  type Basis,
  type LaborSettlementBasis,
  type OrgMember,
  type FileAttachment,
  type ProjectCurrency,
  type ProjectFinancialInputFlags,
  type ProjectFundInputMode,
  type ProjectPhase,
  type ProjectRequestContractAnalysis,
  type ProjectStatus,
  type ProjectTeamMemberAssignment,
  type ProjectType,
  type SettlementType,
  type SettlementSystemCode,
} from '../../data/types';
import { PROJECT_DEPARTMENT_OPTIONS, dedupeProjectDepartmentLabels } from '../../data/project-department-options';
import { PROJECT_TEAM_MEMBER_OPTION_MAP, PROJECT_TEAM_MEMBER_OPTIONS } from '../../data/project-team-member-options';
import {
  formatProjectAmountInput,
  formatStoredProjectAmount,
  hasExplicitProjectAmountInput,
  normalizeProjectFinancialInputFlags,
  parseProjectAmountInput,
} from '../../platform/project-contract-amount';
import { buildContractDocumentEditPolicy } from '../../platform/project-contract-document-policy';
import {
  PROJECT_REQUEST_DOCUMENT_UPLOAD_MAX_SIZE_BYTES,
  PROJECT_REQUEST_DOCUMENT_UPLOAD_MAX_SIZE_LABEL,
  PROJECT_PRIVATE_DRAFT_DOCUMENT_UPLOAD_MAX_SIZE_BYTES,
  PROJECT_PRIVATE_DRAFT_DOCUMENT_UPLOAD_MAX_SIZE_LABEL,
  getProjectDocumentUploadAccept,
  isProjectDocumentFileAllowed,
  type ProjectRequestDocumentKind,
} from '../../platform/project-contract-upload';
import { formatProfitRatePercentInput } from '../../platform/project-financials';
import { createProjectEditorDraft, type ProjectEditorDraft, type ProjectEditorMode } from '../../platform/project-editor';
import { normalizeProjectDepartment } from '../../platform/project-cic';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import {
  formatProjectTeamMembersSummary,
  hasIncompleteProjectTeamMembers,
  normalizeProjectTeamMemberDraftRows,
  parseProjectTeamMemberIdentityInput,
  PROJECT_TEAM_MEMBER_ROLES,
} from '../../platform/project-team-members';
import { shouldResetProjectEditorDraft } from './project-editor-reset';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Checkbox } from '../ui/checkbox';
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
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '../ui/command';
import { cn } from '../ui/utils';

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
  embeddedInShell?: boolean;
  members?: OrgMember[];
  departmentOptions?: string[];
  topSlot?: ReactNode;
  actions: ProjectEditorAction[];
  busyActionId?: string | null;
  readOnly?: boolean;
  onContractFileUpload?: (file: File) => Promise<{
    contractDocument: ProjectEditorDraft['contractDocument'];
    contractAnalysis: ProjectRequestContractAnalysis | null;
  }>;
  onProjectDocumentFileUpload?: (input: { kind: ProjectRequestDocumentKind; file: File }) => Promise<{
    document: FileAttachment;
    contractAnalysis: ProjectRequestContractAnalysis | null;
  }>;
  contractAnalysisMergeMode?: 'fill-empty' | 'none';
  canRemoveContractDocument?: boolean;
  canRemoveProjectDocuments?: boolean;
  autosave?: {
    key: string;
    disabled?: boolean;
    onSave?: (draft: ProjectEditorDraft, stepIndex: number) => void | Promise<void>;
    onDiscard?: () => void | Promise<void>;
  };
  onCancel?: () => void | Promise<void>;
  onLeave?: () => void | Promise<void>;
  onSubmit: (draft: ProjectEditorDraft, actionId: string) => void | Promise<void>;
}

const PROJECT_EDITOR_AUTOSAVE_SCHEMA_VERSION = 1;

type ContractUploadState = 'idle' | 'extracting' | 'ready' | 'error';
const REGISTRATION_DOCUMENT_KINDS: ProjectRequestDocumentKind[] = [
  'contract',
  'customer_business_registration',
  'quote',
  'proposal',
  'rfp_request_evidence',
];
const CHECKOUT_DOCUMENT_KINDS: ProjectRequestDocumentKind[] = [
  'performance_certificate',
  'tax_invoice',
  'final_settlement_report',
];
const PROJECT_DOCUMENT_LABELS: Record<ProjectRequestDocumentKind, string> = {
  contract: '계약서 PDF',
  customer_business_registration: '발주처 사업자등록증 PDF',
  quote: '견적서 PDF',
  proposal: '제안서 PDF *',
  proposal_word_original: '제안서 Word 원본 (선택)',
  proposal_ppt_original: '제안서 PPT 원본 (선택)',
  presentation_ppt_original: '발표자료 PPT 원본 (선택)',
  rfp_request_evidence: 'RFP 또는 요청 메일 증빙 (제안서가 없는 경우) *',
  performance_certificate: '수행확인서 PDF',
  tax_invoice: '세금계산서 PDF',
  final_settlement_report: '최종 정산보고서 PDF',
};
const PROJECT_DOCUMENT_BUTTON_LABELS: Record<ProjectRequestDocumentKind, string> = {
  contract: '계약서',
  customer_business_registration: '사업자등록증',
  quote: '견적서',
  proposal: '제안서',
  proposal_word_original: '제안서 Word 원본',
  proposal_ppt_original: '제안서 PPT 원본',
  presentation_ppt_original: '발표자료 PPT 원본',
  rfp_request_evidence: 'RFP/요청 메일 증빙',
  performance_certificate: '수행확인서',
  tax_invoice: '세금계산서',
  final_settlement_report: '최종 정산보고서',
};
const PROJECT_DOCUMENT_FIELD: Record<ProjectRequestDocumentKind, keyof ProjectEditorDraft> = {
  contract: 'contractDocument',
  customer_business_registration: 'customerBusinessRegistrationDocument',
  quote: 'quoteDocument',
  proposal: 'proposalDocument',
  proposal_word_original: 'proposalWordOriginalDocument',
  proposal_ppt_original: 'proposalPptOriginalDocument',
  presentation_ppt_original: 'presentationPptOriginalDocument',
  rfp_request_evidence: 'rfpRequestEvidenceDocument',
  performance_certificate: 'performanceCertificateDocument',
  tax_invoice: 'taxInvoiceDocument',
  final_settlement_report: 'finalSettlementReportDocument',
};
const OPTIONAL_REGISTRATION_DOCUMENT_NOTE_FIELD = {
  proposal_word_original: 'proposalWordOriginal',
  proposal_ppt_original: 'proposalPptOriginal',
  presentation_ppt_original: 'presentationPptOriginal',
} as const;
type AutosaveState = 'idle' | 'saving' | 'saved' | 'error';
type StoredProjectEditorDraft = {
  schemaVersion: number;
  draftKey: string;
  draft: ProjectEditorDraft;
  stepIndex: number;
  updatedAt: string;
};

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

const PROJECT_EDITOR_FORM_SURFACE_CLASS = [
  '[&_[data-slot=input]]:border-slate-300',
  '[&_[data-slot=input]]:bg-white',
  '[&_[data-slot=input]]:shadow-[inset_0_1px_0_rgba(15,23,42,0.03)]',
  '[&_[data-slot=input]]:focus-visible:border-slate-400',
  '[&_[data-slot=input]]:focus-visible:ring-slate-200',
  '[&_[data-slot=select-trigger]]:border',
  '[&_[data-slot=select-trigger]]:border-slate-300',
  '[&_[data-slot=select-trigger]]:bg-white',
  '[&_[data-slot=select-trigger]]:shadow-[inset_0_1px_0_rgba(15,23,42,0.03)]',
  '[&_[data-slot=select-trigger]]:focus-visible:border-slate-400',
  '[&_[data-slot=select-trigger]]:focus-visible:ring-slate-200',
  '[&_[data-slot=textarea]]:border-slate-300',
  '[&_[data-slot=textarea]]:bg-white',
  '[&_[data-slot=textarea]]:shadow-[inset_0_1px_0_rgba(15,23,42,0.03)]',
  '[&_[data-slot=textarea]]:focus-visible:border-slate-400',
  '[&_[data-slot=textarea]]:focus-visible:ring-slate-200',
  '[&_[role=combobox]]:border-slate-300',
  '[&_[role=combobox]]:bg-white',
  '[&_[role=combobox]]:shadow-[inset_0_1px_0_rgba(15,23,42,0.03)]',
].join(' ');

function getProjectEditorAutosaveStorageKey(key: string) {
  return `mysc:project-editor-autosave:${key}`;
}

function readStoredProjectEditorDraft(key: string): StoredProjectEditorDraft | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(getProjectEditorAutosaveStorageKey(key)) || 'null') as StoredProjectEditorDraft | null;
    if (!parsed || parsed.schemaVersion !== PROJECT_EDITOR_AUTOSAVE_SCHEMA_VERSION || !parsed.draft) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredProjectEditorDraft(key: string, value: StoredProjectEditorDraft) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(getProjectEditorAutosaveStorageKey(key), JSON.stringify(value));
}

function removeStoredProjectEditorDraft(key: string) {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(getProjectEditorAutosaveStorageKey(key));
}

function formatAutosaveTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtKRW(value: number) {
  return value ? value.toLocaleString('ko-KR') : '0';
}

function readText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumberSuggestion(value: ProjectRequestContractAnalysis['fields']['contractAmount'] | undefined) {
  return typeof value?.value === 'number' && Number.isFinite(value.value) ? value.value : null;
}

function mergeContractAnalysisIntoDraft(
  prev: ProjectEditorDraft,
  analysis: ProjectRequestContractAnalysis | null,
): ProjectEditorDraft {
  if (!analysis) return prev;
  const currentFlags = normalizeProjectFinancialInputFlags(prev.financialInputFlags);
  const suggestedContractAmount = readNumberSuggestion(analysis.fields.contractAmount);
  const suggestedSalesVatAmount = readNumberSuggestion(analysis.fields.salesVatAmount);
  const shouldApplyContractAmount = !currentFlags.contractAmount && suggestedContractAmount != null;
  const shouldApplySalesVatAmount = !currentFlags.salesVatAmount && suggestedSalesVatAmount != null;

  return createProjectEditorDraft({
    ...prev,
    officialContractName: prev.officialContractName || readText(analysis.fields.officialContractName?.value),
    clientOrg: prev.clientOrg || readText(analysis.fields.clientOrg?.value),
    contractStart: prev.contractStart || readText(analysis.fields.contractStart?.value),
    contractEnd: prev.contractEnd || readText(analysis.fields.contractEnd?.value),
    projectPurpose: prev.projectPurpose || readText(analysis.fields.projectPurpose?.value),
    description: prev.description || readText(analysis.fields.description?.value),
    contractAmount: shouldApplyContractAmount ? suggestedContractAmount : prev.contractAmount,
    salesVatAmount: shouldApplySalesVatAmount ? suggestedSalesVatAmount : prev.salesVatAmount,
    financialInputFlags: {
      ...currentFlags,
      contractAmount: currentFlags.contractAmount || suggestedContractAmount != null,
      salesVatAmount: currentFlags.salesVatAmount || suggestedSalesVatAmount != null,
    },
  });
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
    inputMode: 'search',
    memberName: '',
    memberNickname: '',
    role: '',
    participationRate: 0,
    isDocumentOnly: false,
    laborAllocationStartMonth: '',
    laborAllocationEndMonth: '',
  };
}

function formatTeamMemberIdentityInput(member: ProjectTeamMemberAssignment): string {
  const name = String(member.memberName || '').trim();
  const nickname = String(member.memberNickname || '').trim();
  if (!nickname) return name;
  return `${name}(${nickname})`;
}

function isAdminMode(mode: ProjectEditorMode) {
  return mode === 'admin';
}

function canEditProjectStatus(mode: ProjectEditorMode) {
  return mode === 'admin' || mode === 'portal-edit';
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

interface TeamMemberSearchComboboxProps {
  member: ProjectTeamMemberAssignment;
  selectedNames: Set<string>;
  currentTeamMemberOptionExists: boolean;
  onSelect: (patch: Partial<ProjectTeamMemberAssignment>) => void;
}

function TeamMemberSearchCombobox({
  member,
  selectedNames,
  currentTeamMemberOptionExists,
  onSelect,
}: TeamMemberSearchComboboxProps) {
  const [open, setOpen] = useState(false);
  const selectedLabel = member.memberName
    ? (member.memberNickname ? `${member.memberName} (${member.memberNickname})` : member.memberName)
    : '';

  const handleSelect = (value: string) => {
    if (value === 'none') {
      onSelect({ memberName: '', memberNickname: '' });
      setOpen(false);
      return;
    }
    const option = PROJECT_TEAM_MEMBER_OPTION_MAP[value];
    onSelect({
      inputMode: 'search',
      identityInput: undefined,
      memberName: option?.name || value,
      memberNickname: option?.nickname || '',
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={selectedLabel ? `팀원 선택: ${selectedLabel}` : '팀원 검색'}
          aria-expanded={open}
          className="mt-1 h-9 w-full justify-between px-3 text-left text-sm font-normal"
        >
          <span className={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
            {selectedLabel || '팀원 검색'}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="이름/닉네임으로 검색" />
          <CommandList className="max-h-[260px]">
            <CommandEmpty>검색 결과가 없습니다</CommandEmpty>
            <CommandGroup heading="선택">
              <CommandItem value="none 선택 안 함" onSelect={() => handleSelect('none')}>
                <Check className={cn('h-4 w-4', !member.memberName ? 'opacity-100' : 'opacity-0')} />
                선택 안 함
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading={`${PROJECT_TEAM_MEMBER_OPTIONS.length}명 중 검색`}>
              {!currentTeamMemberOptionExists && member.memberName ? (
                <CommandItem
                  value={`${member.memberName} ${member.memberNickname}`}
                  onSelect={() => {
                    onSelect({
                      memberName: member.memberName,
                      memberNickname: member.memberNickname,
                    });
                    setOpen(false);
                  }}
                >
                  <Check className="h-4 w-4 opacity-100" />
                  <span className="truncate">
                    {member.memberNickname ? `${member.memberName} (${member.memberNickname})` : member.memberName}
                  </span>
                </CommandItem>
              ) : null}
              {PROJECT_TEAM_MEMBER_OPTIONS.map((option) => {
                const disabled = selectedNames.has(option.value);
                const selected = option.value === member.memberName;
                return (
                  <CommandItem
                    key={option.value}
                    value={`${option.name} ${option.nickname} ${option.label}`}
                    disabled={disabled}
                    onSelect={() => handleSelect(option.value)}
                  >
                    <Check className={cn('h-4 w-4', selected ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate">{option.label}</span>
                    {disabled ? (
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">이미 추가됨</span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ProjectEditorWizard({
  mode,
  initialDraft,
  draftKey,
  title,
  description,
  embeddedInShell = false,
  members = [],
  departmentOptions,
  topSlot,
  actions,
  busyActionId,
  readOnly = false,
  onContractFileUpload,
  onProjectDocumentFileUpload,
  contractAnalysisMergeMode = 'fill-empty',
  canRemoveContractDocument,
  canRemoveProjectDocuments = true,
  autosave,
  onCancel,
  onLeave,
  onSubmit,
}: ProjectEditorWizardProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<ProjectEditorDraft>(() => createProjectEditorWizardDraft(initialDraft));
  const [documentUploadState, setDocumentUploadState] = useState<Record<ProjectRequestDocumentKind, ContractUploadState>>({
    contract: 'idle',
    customer_business_registration: 'idle',
    quote: 'idle',
    proposal: 'idle',
    proposal_word_original: 'idle',
    proposal_ppt_original: 'idle',
    presentation_ppt_original: 'idle',
    rfp_request_evidence: 'idle',
    performance_certificate: 'idle',
    tax_invoice: 'idle',
    final_settlement_report: 'idle',
  });
  const [documentUploadError, setDocumentUploadError] = useState<Record<ProjectRequestDocumentKind, string>>({
    contract: '',
    customer_business_registration: '',
    quote: '',
    proposal: '',
    proposal_word_original: '',
    proposal_ppt_original: '',
    presentation_ppt_original: '',
    rfp_request_evidence: '',
    performance_certificate: '',
    tax_invoice: '',
    final_settlement_report: '',
  });
  const [restoreCandidate, setRestoreCandidate] = useState<StoredProjectEditorDraft | null>(null);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>('idle');
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [exitIntent, setExitIntent] = useState<'cancel' | 'route' | null>(null);
  const [exitBusy, setExitBusy] = useState(false);
  const [lastAutosavedAt, setLastAutosavedAt] = useState('');
  const [preloadWarningVisible, setPreloadWarningVisible] = useState(false);
  const contractUploadInputRef = useRef<HTMLInputElement | null>(null);
  const quoteUploadInputRef = useRef<HTMLInputElement | null>(null);
  const proposalUploadInputRef = useRef<HTMLInputElement | null>(null);
  const proposalWordOriginalUploadInputRef = useRef<HTMLInputElement | null>(null);
  const proposalPptOriginalUploadInputRef = useRef<HTMLInputElement | null>(null);
  const presentationPptOriginalUploadInputRef = useRef<HTMLInputElement | null>(null);
  const rfpRequestEvidenceUploadInputRef = useRef<HTMLInputElement | null>(null);
  const customerBusinessRegistrationUploadInputRef = useRef<HTMLInputElement | null>(null);
  const performanceCertificateUploadInputRef = useRef<HTMLInputElement | null>(null);
  const taxInvoiceUploadInputRef = useRef<HTMLInputElement | null>(null);
  const finalSettlementReportUploadInputRef = useRef<HTMLInputElement | null>(null);
  const retryDocumentFileRef = useRef<Partial<Record<ProjectRequestDocumentKind, File>>>({});
  const submitInFlightRef = useRef(false);
  const exitInFlightRef = useRef(false);
  const leaveApprovedRef = useRef(false);
  const draftRef = useRef(draft);
  const lastPersistedFingerprintRef = useRef(JSON.stringify(createProjectEditorDraft(initialDraft)));
  const lastResetKeyRef = useRef<string | null>(null);
  const initialDraftFingerprint = useMemo(() => JSON.stringify(createProjectEditorDraft(initialDraft)), [initialDraft]);
  const initialContractDocument = initialDraft.contractDocument ?? null;
  const initialContractAnalysis = initialDraft.contractAnalysis ?? null;
  const normalizedDepartmentOptions = useMemo(
    () => dedupeProjectDepartmentLabels(departmentOptions ? departmentOptions : [...PROJECT_DEPARTMENT_OPTIONS]),
    [departmentOptions],
  );
  const departmentOptionSet = useMemo(() => new Set(normalizedDepartmentOptions), [normalizedDepartmentOptions]);
  const selectedDepartment = normalizeProjectDepartment(draft.department);
  const canUseSelectedDepartment = selectedDepartment && departmentOptionSet.has(selectedDepartment);
  const canRemoveExistingContractDocument = canRemoveContractDocument ?? isAdminMode(mode);
  const contractDocumentEditPolicy = buildContractDocumentEditPolicy({
    current: draft.contractDocument,
    initial: initialContractDocument,
    canRemoveExistingContractDocument,
  });
  const currentDraftFingerprint = JSON.stringify(createProjectEditorDraft(draft));
  const uploadInProgress = Object.values(documentUploadState).some((state) => state === 'extracting');
  const registrationDocumentKinds = onProjectDocumentFileUpload
    ? REGISTRATION_DOCUMENT_KINDS
    : REGISTRATION_DOCUMENT_KINDS.filter((kind) => kind === 'contract');
  const checkoutDocumentKinds = onProjectDocumentFileUpload ? CHECKOUT_DOCUMENT_KINDS : [];
  const documentUploadMaxBytes = mode === 'admin'
    ? PROJECT_REQUEST_DOCUMENT_UPLOAD_MAX_SIZE_BYTES
    : PROJECT_PRIVATE_DRAFT_DOCUMENT_UPLOAD_MAX_SIZE_BYTES;
  const documentUploadMaxLabel = mode === 'admin'
    ? PROJECT_REQUEST_DOCUMENT_UPLOAD_MAX_SIZE_LABEL
    : PROJECT_PRIVATE_DRAFT_DOCUMENT_UPLOAD_MAX_SIZE_LABEL;
  const hasPendingRetryFile = [...registrationDocumentKinds, ...checkoutDocumentKinds]
    .some((kind) => Boolean(retryDocumentFileRef.current[kind]));
  const hasUnsavedInput = currentDraftFingerprint !== lastPersistedFingerprintRef.current;
  const shouldBlockNavigation = hasUnsavedInput || uploadInProgress || hasPendingRetryFile;
  const shouldConfirmExit = shouldBlockNavigation || (Boolean(onLeave) && !readOnly);
  const blocker = useBlocker(shouldConfirmExit);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const resetKey = `${draftKey}::${autosave?.key || ''}`;
    const currentFingerprint = JSON.stringify(createProjectEditorDraft(draftRef.current));
    if (!shouldResetProjectEditorDraft({
      lastResetKey: lastResetKeyRef.current,
      resetKey,
      currentFingerprint,
      lastPersistedFingerprint: lastPersistedFingerprintRef.current,
      incomingFingerprint: initialDraftFingerprint,
    })) return;
    lastResetKeyRef.current = resetKey;
    const nextDraft = createProjectEditorWizardDraft(initialDraft);
    lastPersistedFingerprintRef.current = JSON.stringify(createProjectEditorDraft(nextDraft));
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setStepIndex(0);
    setDocumentUploadState({
      contract: 'idle',
      customer_business_registration: 'idle',
      quote: 'idle',
      proposal: 'idle',
      proposal_word_original: 'idle',
      proposal_ppt_original: 'idle',
      presentation_ppt_original: 'idle',
      rfp_request_evidence: 'idle',
      performance_certificate: 'idle',
      tax_invoice: 'idle',
      final_settlement_report: 'idle',
    });
    setDocumentUploadError({
      contract: '',
      customer_business_registration: '',
      quote: '',
      proposal: '',
      proposal_word_original: '',
      proposal_ppt_original: '',
      presentation_ppt_original: '',
      rfp_request_evidence: '',
      performance_certificate: '',
      tax_invoice: '',
      final_settlement_report: '',
    });
    setAutosaveState('idle');
    setLastAutosavedAt('');
    setPreloadWarningVisible(false);
    setRestoreCandidate(autosave?.key ? readStoredProjectEditorDraft(autosave.key) : null);
  }, [autosave?.key, draftKey, initialDraft, initialDraftFingerprint]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePreloadError = () => setPreloadWarningVisible(true);
    window.addEventListener('mysc:preloadError', handlePreloadError);
    return () => window.removeEventListener('mysc:preloadError', handlePreloadError);
  }, []);

  const persistAutosaveSnapshot = useCallback(async (
    nextDraft: ProjectEditorDraft,
    nextStepIndex: number,
  ) => {
    if (readOnly || !autosave?.key || autosave.disabled) return false;
    const now = new Date().toISOString();
    const storedDraft: StoredProjectEditorDraft = {
      schemaVersion: PROJECT_EDITOR_AUTOSAVE_SCHEMA_VERSION,
      draftKey,
      draft: createProjectEditorDraft(nextDraft),
      stepIndex: nextStepIndex,
      updatedAt: now,
    };
    setAutosaveState('saving');
    try {
      writeStoredProjectEditorDraft(autosave.key, storedDraft);
      await autosave.onSave?.(storedDraft.draft, nextStepIndex);
      lastPersistedFingerprintRef.current = JSON.stringify(storedDraft.draft);
      setLastAutosavedAt(now);
      setAutosaveState('saved');
      return true;
    } catch (error) {
      console.error('[ProjectEditorWizard] autosave failed:', error);
      setLastAutosavedAt(now);
      setAutosaveState('error');
      return false;
    }
  }, [autosave?.disabled, autosave?.key, autosave?.onSave, draftKey, readOnly]);

  const saveDraftAndRelease = useCallback(async () => {
    if (uploadInProgress || hasPendingRetryFile) {
      toast.error('첨부파일 업로드를 완료한 뒤 나갈 수 있습니다.');
      return false;
    }
    if (hasUnsavedInput && autosave?.key && !autosave.disabled && !readOnly) {
      if (!await persistAutosaveSnapshot(draft, stepIndex)) {
        toast.error('임시저장에 실패해 수정 세션을 종료하지 않았습니다.');
        return false;
      }
    }
    try {
      await onLeave?.();
      return true;
    } catch (error) {
      console.error('[ProjectEditorWizard] edit session release failed:', error);
      toast.error('수정 세션을 종료하지 못했습니다. 현재 화면에서 다시 시도해 주세요.');
      return false;
    }
  }, [autosave?.disabled, autosave?.key, draft, hasPendingRetryFile, hasUnsavedInput, onLeave, persistAutosaveSnapshot, readOnly, stepIndex, uploadInProgress]);

  const releaseWithoutSaving = useCallback(async () => {
    if (uploadInProgress || hasPendingRetryFile) {
      toast.error('첨부파일 업로드를 완료한 뒤 나갈 수 있습니다.');
      return false;
    }
    try {
      await onLeave?.();
      if (autosave?.key) removeStoredProjectEditorDraft(autosave.key);
      return true;
    } catch (error) {
      console.error('[ProjectEditorWizard] edit session release failed:', error);
      toast.error('수정 세션을 종료하지 못했습니다. 현재 화면에서 다시 시도해 주세요.');
      return false;
    }
  }, [autosave?.key, hasPendingRetryFile, onLeave, uploadInProgress]);

  const finishExit = useCallback(async (saveBeforeExit: boolean) => {
    if (exitInFlightRef.current) return;
    exitInFlightRef.current = true;
    setExitBusy(true);
    try {
      const canLeave = saveBeforeExit
        ? await saveDraftAndRelease()
        : await releaseWithoutSaving();
      if (!canLeave) return;
      leaveApprovedRef.current = true;
      setExitDialogOpen(false);
      if (exitIntent === 'route' && blocker.state === 'blocked') blocker.proceed();
      else await onCancel?.();
      setExitIntent(null);
    } finally {
      exitInFlightRef.current = false;
      setExitBusy(false);
    }
  }, [blocker, exitIntent, onCancel, releaseWithoutSaving, saveDraftAndRelease]);

  const requestCancel = () => {
    if (exitInFlightRef.current) return;
    if (!shouldConfirmExit) {
      void onCancel?.();
      return;
    }
    setExitIntent('cancel');
    setExitDialogOpen(true);
  };

  useEffect(() => {
    if (!shouldConfirmExit || typeof window === 'undefined') return undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [shouldConfirmExit]);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (leaveApprovedRef.current) {
      leaveApprovedRef.current = false;
      blocker.proceed();
      return;
    }
    setExitIntent('route');
    setExitDialogOpen(true);
  }, [blocker]);

  useEffect(() => {
    if (readOnly || !autosave?.key || autosave.disabled || restoreCandidate) return undefined;
    const isInitialDraft = stepIndex === 0 && JSON.stringify(createProjectEditorDraft(draft)) === initialDraftFingerprint;
    if (isInitialDraft) return undefined;

    const timer = window.setTimeout(() => {
      void persistAutosaveSnapshot(draft, stepIndex);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [autosave?.disabled, autosave?.key, draft, initialDraftFingerprint, persistAutosaveSnapshot, readOnly, restoreCandidate, stepIndex]);

  const restoreLocalDraft = () => {
    if (!restoreCandidate) return;
    setDraft(createProjectEditorWizardDraft(restoreCandidate.draft));
    setStepIndex(Math.max(0, Math.min(STEPS.length - 1, restoreCandidate.stepIndex || 0)));
    setLastAutosavedAt(restoreCandidate.updatedAt);
    setAutosaveState('saved');
    setRestoreCandidate(null);
  };

  const discardLocalDraft = () => {
    if (autosave?.key) removeStoredProjectEditorDraft(autosave.key);
    setRestoreCandidate(null);
    void autosave?.onDiscard?.();
  };

  const handleManualAutosave = async () => {
    const saved = await persistAutosaveSnapshot(draft, stepIndex);
    if (saved) toast.success('임시저장되었습니다.');
    else toast.error('임시저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  };

  const handleActionSubmit = async (actionId: string) => {
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    try {
      if (autosave?.key && !await persistAutosaveSnapshot(draft, stepIndex)) {
        throw new Error('최신 입력을 임시저장하지 못해 최종 저장을 중단했습니다.');
      }
      await onSubmit(createProjectEditorDraft(draft), actionId);
      lastPersistedFingerprintRef.current = JSON.stringify(createProjectEditorDraft(draft));
      if (autosave?.key) removeStoredProjectEditorDraft(autosave.key);
      setAutosaveState('idle');
      setLastAutosavedAt('');
    } catch (error) {
      console.error('[ProjectEditorWizard] submit failed:', error);
      toast.error(error instanceof Error ? error.message : '저장에 실패했습니다.');
    } finally {
      submitInFlightRef.current = false;
    }
  };

  const step = STEPS[stepIndex];
  const financialInputFlags = useMemo(
    () => normalizeProjectFinancialInputFlags(draft.financialInputFlags),
    [draft.financialInputFlags],
  );
  const hasContractAmountInput = financialInputFlags.contractAmount;
  const hasSalesVatAmountInput = financialInputFlags.salesVatAmount;
  const hasTotalRevenueAmountInput = financialInputFlags.totalRevenueAmount;
  const hasSupportAmountInput = financialInputFlags.supportAmount;
  const usesRegistrationV2 = draft.registrationRequirementsVersion === 2;
  const showProjectCheckout = draft.status === 'COMPLETED' || draft.status === 'COMPLETED_PENDING_PAYMENT';
  const paymentPlanTotal = draft.paymentPlan.contract + draft.paymentPlan.interim + draft.paymentPlan.final;
  const advanceInterimRatio = draft.contractAmount > 0
    ? (draft.paymentPlan.contract + draft.paymentPlan.interim) / draft.contractAmount
    : null;
  const requiresAdvanceInterimReason = paymentPlanTotal > 0
    && advanceInterimRatio !== null
    && advanceInterimRatio < 0.7;
  const profitRateLabel = formatProfitRatePercentInput(draft.profitRate);
  const teamMembersSummary = formatProjectTeamMembersSummary(draft.teamMembersDetailed, '', '\n');
  const projectTypeOptions = getProjectTypeSelectableOptions(draft.type);
  const contractTypeOptions = getProjectContractTypeSelectableOptions(draft.contractType);
  const ownerOptions = useMemo(
    () => [...members]
      .filter((member) => String(member.uid || '').trim())
      .sort((left, right) => String(left.name || left.email || left.uid).localeCompare(String(right.name || right.email || right.uid), 'ko')),
    [members],
  );
  const selectedOwner = useMemo(
    () => ownerOptions.find((member) => member.uid === draft.registeredById) || null,
    [draft.registeredById, ownerOptions],
  );
  const hasUnlinkedStoredOwner = Boolean(draft.registeredById && !selectedOwner);

  useEffect(() => {
    if (!draft.registeredById) return;
    const member = members.find((item) => item.uid === draft.registeredById);
    if (!member) return;
    if (
      draft.registeredByName === member.name
      && draft.registeredByEmail === (member.email || '')
      && draft.managerId === member.uid
      && draft.managerName === member.name
    ) return;
    setDraft((prev) => createProjectEditorDraft({
      ...prev,
      registeredById: member.uid,
      registeredByName: member.name,
      registeredByEmail: member.email || '',
      managerId: member.uid,
      managerName: member.name,
    }));
  }, [draft.managerId, draft.managerName, draft.registeredByEmail, draft.registeredById, draft.registeredByName, members]);

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

  const updateFinancialYear = (
    index: number,
    key: 'contractAmount' | 'salesVatAmount' | 'totalRevenueAmount' | 'supportAmount' | 'profitRate' | 'confirmed',
    value: number | boolean,
  ) => {
    setDraft((prev) => {
      const financialYears = prev.financialYears.map((row, rowIndex) => (
        rowIndex === index ? { ...row, [key]: value } : row
      ));
      const total = (field: 'contractAmount' | 'salesVatAmount' | 'totalRevenueAmount' | 'supportAmount') => (
        financialYears.reduce((sum, row) => sum + row[field], 0)
      );
      return createProjectEditorWizardDraft({
        ...prev,
        financialYears,
        contractAmount: total('contractAmount'),
        salesVatAmount: total('salesVatAmount'),
        totalRevenueAmount: total('totalRevenueAmount'),
        supportAmount: total('supportAmount'),
        financialInputFlags: {
          contractAmount: true,
          salesVatAmount: true,
          totalRevenueAmount: true,
          supportAmount: true,
        },
      });
    });
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

  const getDocumentInputRef = (kind: ProjectRequestDocumentKind) => ({
    contract: contractUploadInputRef,
    customer_business_registration: customerBusinessRegistrationUploadInputRef,
    quote: quoteUploadInputRef,
    proposal: proposalUploadInputRef,
    proposal_word_original: proposalWordOriginalUploadInputRef,
    proposal_ppt_original: proposalPptOriginalUploadInputRef,
    presentation_ppt_original: presentationPptOriginalUploadInputRef,
    rfp_request_evidence: rfpRequestEvidenceUploadInputRef,
    performance_certificate: performanceCertificateUploadInputRef,
    tax_invoice: taxInvoiceUploadInputRef,
    final_settlement_report: finalSettlementReportUploadInputRef,
  }[kind]);

  const uploadProjectDocument = async (kind: ProjectRequestDocumentKind, file: File) => {
    if (onProjectDocumentFileUpload) {
      return onProjectDocumentFileUpload({ kind, file });
    }
    if (kind === 'contract' && onContractFileUpload) {
      const processed = await onContractFileUpload(file);
      return {
        document: processed.contractDocument as FileAttachment,
        contractAnalysis: processed.contractAnalysis,
      };
    }
    throw new Error(`${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 업로드를 사용할 수 없는 화면입니다.`);
  };

  const processProjectDocument = async (
    kind: ProjectRequestDocumentKind,
    file: File,
    input?: HTMLInputElement,
  ) => {
    retryDocumentFileRef.current[kind] = file;
    setDocumentUploadState((prev) => ({ ...prev, [kind]: 'extracting' }));
    setDocumentUploadError((prev) => ({ ...prev, [kind]: '' }));
    try {
      const processed = await uploadProjectDocument(kind, file);
      setDraft((prev) => {
        if (kind === 'contract') {
          const nextDraft = createProjectEditorWizardDraft({
            ...prev,
            contractDocument: processed.document,
            contractAnalysis: processed.contractAnalysis,
          });
          return contractAnalysisMergeMode === 'none'
            ? nextDraft
            : mergeContractAnalysisIntoDraft(nextDraft, processed.contractAnalysis);
        }
        const noteField = OPTIONAL_REGISTRATION_DOCUMENT_NOTE_FIELD[
          kind as keyof typeof OPTIONAL_REGISTRATION_DOCUMENT_NOTE_FIELD
        ];
        return createProjectEditorWizardDraft({
          ...prev,
          [PROJECT_DOCUMENT_FIELD[kind]]: processed.document,
          ...(noteField ? {
            registrationOptionalDocumentNotes: {
              ...prev.registrationOptionalDocumentNotes,
              [noteField]: '',
            },
          } : {}),
        });
      });
      setDocumentUploadState((prev) => ({ ...prev, [kind]: 'ready' }));
      toast.success(`${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 업로드 완료: ${file.name}`);
      delete retryDocumentFileRef.current[kind];
      if (input) input.value = '';
    } catch (error) {
      console.error(`[ProjectEditorWizard] ${kind} upload failed:`, error);
      const message = error instanceof Error ? error.message : `${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 업로드에 실패했습니다.`;
      setDocumentUploadState((prev) => ({ ...prev, [kind]: 'error' }));
      setDocumentUploadError((prev) => ({ ...prev, [kind]: message }));
      toast.error(message);
    }
  };

  const handleProjectDocumentSelect = async (kind: ProjectRequestDocumentKind, event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!isProjectDocumentFileAllowed(kind, file)) {
      toast.error(`${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 파일 형식을 확인해 주세요.`);
      input.value = '';
      return;
    }
    if (file.size > documentUploadMaxBytes) {
      const message = `${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 파일은 ${documentUploadMaxLabel} 이하만 업로드할 수 있습니다.`;
      setDocumentUploadState((prev) => ({ ...prev, [kind]: 'error' }));
      setDocumentUploadError((prev) => ({ ...prev, [kind]: message }));
      toast.error(message);
      input.value = '';
      return;
    }
    await processProjectDocument(kind, file, input);
  };

  const removeContractDocument = () => {
    setDraft((prev) => createProjectEditorWizardDraft({
      ...prev,
      contractDocument: initialContractDocument && !contractDocumentEditPolicy.canRemoveExistingContractDocument
        ? initialContractDocument
        : null,
      contractAnalysis: initialContractDocument && !contractDocumentEditPolicy.canRemoveExistingContractDocument
        ? initialContractAnalysis
        : null,
    }));
    setDocumentUploadState((prev) => ({ ...prev, contract: 'idle' }));
    setDocumentUploadError((prev) => ({ ...prev, contract: '' }));
    delete retryDocumentFileRef.current.contract;
  };

  const removeSupplementalDocument = (kind: Exclude<ProjectRequestDocumentKind, 'contract'>) => {
    setDraft((prev) => createProjectEditorWizardDraft({
      ...prev,
      [PROJECT_DOCUMENT_FIELD[kind]]: null,
    }));
    setDocumentUploadState((prev) => ({ ...prev, [kind]: 'idle' }));
    setDocumentUploadError((prev) => ({ ...prev, [kind]: '' }));
    delete retryDocumentFileRef.current[kind];
  };

  const submitIssues = useMemo(() => {
    const issues: Array<{ step: ProjectEditorStep; label: string }> = [];
    const normalizedDepartment = normalizeProjectDepartment(draft.department);
    if (!normalizedDepartment || !departmentOptionSet.has(normalizedDepartment)) issues.push({ step: 'basic', label: '담당조직(CIC)' });
    if (!draft.name.trim()) issues.push({ step: 'basic', label: '프로젝트명' });
    if ((usesRegistrationV2 || draft.type !== 'I1') && !draft.contractStart.trim()) issues.push({ step: 'financial', label: '계약 시작일' });
    if ((usesRegistrationV2 || draft.type !== 'I1') && !draft.contractEnd.trim()) issues.push({ step: 'financial', label: '계약 종료일' });
    if (draft.type !== 'I1' && !hasContractAmountInput) issues.push({ step: 'financial', label: '계약금액' });
    if (usesRegistrationV2) {
      if (!draft.officialContractName.trim()) issues.push({ step: 'basic', label: '공식 계약명' });
      if (!draft.clientOrg.trim()) issues.push({ step: 'basic', label: '계약 대상' });
      if (!draft.groupwareName.trim()) issues.push({ step: 'basic', label: '그룹웨어 등록명' });
      if (!draft.projectPurpose.trim()) issues.push({ step: 'basic', label: '프로젝트 목적' });
      if (!draft.description.trim()) issues.push({ step: 'basic', label: '프로젝트 주요 내용' });
      if (!draft.contractDocument) issues.push({ step: 'financial', label: '계약서 PDF' });
      if (!draft.customerBusinessRegistrationDocument) issues.push({ step: 'financial', label: '발주처 사업자등록증 PDF' });
      if (!draft.quoteDocument) issues.push({ step: 'financial', label: '견적서 PDF' });
      if (!draft.proposalDocument && !draft.rfpRequestEvidenceDocument) {
        issues.push({ step: 'financial', label: '제안서 또는 RFP/요청 메일 증빙' });
      }
      const startYear = Number(draft.contractStart.slice(0, 4));
      const endYear = Number(draft.contractEnd.slice(0, 4));
      const expectedYears = Number.isSafeInteger(startYear) && Number.isSafeInteger(endYear) && startYear <= endYear
        ? Array.from({ length: endYear - startYear + 1 }, (_, offset) => startYear + offset)
        : [];
      const financialYearsComplete = expectedYears.length > 0
        && draft.financialYears.length === expectedYears.length
        && expectedYears.every((year) => draft.financialYears.some((row) => row.year === year && row.confirmed));
      const annualTotal = (field: 'contractAmount' | 'salesVatAmount' | 'totalRevenueAmount' | 'supportAmount') => (
        draft.financialYears.reduce((sum, row) => sum + row[field], 0)
      );
      const annualTotalsMatch = annualTotal('contractAmount') === draft.contractAmount
        && annualTotal('salesVatAmount') === draft.salesVatAmount
        && annualTotal('totalRevenueAmount') === draft.totalRevenueAmount
        && annualTotal('supportAmount') === draft.supportAmount;
      if (!financialYearsComplete || !annualTotalsMatch) issues.push({ step: 'financial', label: '계약기간 전체 연도별 재무 확인' });
      if (draft.registrationConfirmations.laborIncludesFourInsurance !== true) issues.push({ step: 'payment', label: '4대보험 포함 확인' });
      if (draft.registrationConfirmations.laborIncludesRetirementPay !== true) issues.push({ step: 'payment', label: '퇴직급여 포함 확인' });
      if (!draft.registrationConfirmations.customerSettlementBasisConfirmed) issues.push({ step: 'payment', label: '발주처 정산 기준 확인' });
      if (draft.registrationConfirmations.modusignContractUsed === null) issues.push({ step: 'payment', label: '모두싸인 사용 여부' });
      if (
        draft.registrationConfirmations.modusignContractUsed === false
        && draft.registrationConfirmations.originalContractSubmitted !== true
      ) issues.push({ step: 'payment', label: '계약서 원본 제출 확인' });
      (['contract', 'interim', 'final'] as const).forEach((field) => {
        if (draft.paymentPlan[field] > 0 && !draft.paymentExpectedMonths[field]) {
          const label = field === 'contract' ? '선금/계약금 입금 예상월' : field === 'interim' ? '중도금 입금 예상월' : '잔금 입금 예상월';
          issues.push({ step: 'payment', label });
        }
      });
      if (requiresAdvanceInterimReason && !draft.advanceInterimBelow70Reason.trim()) {
        issues.push({ step: 'payment', label: '선금·중도금 70% 미만 사유' });
      }
    }
    if (showProjectCheckout) {
      if (draft.checkout.performanceCertificateReceived && !draft.performanceCertificateDocument) {
        issues.push({ step: 'payment', label: '수행확인서 PDF' });
      }
      if (draft.checkout.taxInvoiceEvidenceConfirmed && !draft.taxInvoiceDocument) {
        issues.push({ step: 'payment', label: '세금계산서 PDF' });
      }
      if (draft.checkout.finalSettlementReportConfirmed && !draft.finalSettlementReportDocument) {
        issues.push({ step: 'payment', label: '최종 정산보고서 PDF' });
      }
      if (draft.checkout.evidenceDeletedAfterUsb && !draft.checkout.usbEvidenceSubmitted) {
        issues.push({ step: 'payment', label: 'USB 제출 확인' });
      }
    }
    if (!draft.managerName.trim()) issues.push({ step: 'team', label: 'PM' });
    if (usesRegistrationV2 && hasIncompleteProjectTeamMembers(draft.teamMembersDetailed)) {
      issues.push({ step: 'team', label: '참여인력 이름·역할·서류상 여부' });
    }
    return issues;
  }, [departmentOptionSet, draft, hasContractAmountInput, requiresAdvanceInterimReason, showProjectCheckout, usesRegistrationV2]);

  const canSubmit = submitIssues.length === 0;

  const renderBasicStep = () => (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label className="text-xs">담당조직(CIC) *</Label>
          <Select value={canUseSelectedDepartment ? selectedDepartment : undefined} onValueChange={(value) => update('department', value)}>
            <SelectTrigger className="mt-1 h-9 text-sm">
              <SelectValue placeholder="담당조직 선택" />
            </SelectTrigger>
            <SelectContent>
              {normalizedDepartmentOptions.map((department) => (
                <SelectItem key={department} value={department}>{department}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        <Label className="text-xs">공식 계약명{usesRegistrationV2 ? ' *' : ''}</Label>
        <Input
          value={draft.officialContractName}
          onChange={(event) => update('officialContractName', event.target.value)}
          placeholder="계약서에 기재된 계약명 그대로 입력"
          className="mt-1 h-9 text-sm"
        />
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          띄어쓰기를 포함해 계약서 표기와 동일하게 입력해 주세요.
        </p>
      </div>

      <div>
        <Label className="text-xs">프로젝트명 *</Label>
        <Input
          value={draft.name}
          onChange={(event) => update('name', event.target.value.slice(0, mode === 'portal-register' ? 10 : 80))}
          placeholder="예: 26농식품AC"
          className="mt-1 h-9 text-sm"
        />
        <div className="mt-1 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p className="max-w-3xl text-[11px] leading-5 text-muted-foreground">
            계약연도+프로젝트명 형식으로 입력해 주세요. 재경팀이 부여하는 프로젝트 코드는 직접 입력하지 않습니다. 다년도 사업은 같은 프로젝트명을 사용해 주세요.
          </p>
          {mode === 'portal-register' ? (
            <p className="shrink-0 text-[10px] text-muted-foreground">{draft.name.length}/10자</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label className="text-xs">계약 대상{usesRegistrationV2 ? ' *' : ''}</Label>
          <Input
            value={draft.clientOrg}
            onChange={(event) => update('clientOrg', event.target.value)}
            placeholder="예: 주식회사 ○○"
            className="mt-1 h-9 text-sm"
          />
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            사업자등록증상 법인명을 띄어쓰기까지 동일하게 입력해 주세요.
          </p>
        </div>
        <div>
          <Label className="text-xs">그룹웨어 등록명{usesRegistrationV2 ? ' *' : ''}</Label>
          <Input
            value={draft.groupwareName}
            onChange={(event) => update('groupwareName', event.target.value)}
            placeholder="예: 2026 IBS그린임팩트펀드"
            className="mt-1 h-9 text-sm"
          />
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            계약연도+프로젝트명으로 입력합니다. 재경팀 코드는 직접 입력하지 않으며, 다년도 사업도 동일 이름을 사용합니다.
          </p>
        </div>
      </div>

      <div>
        <Label className="text-xs">프로젝트 목적{usesRegistrationV2 ? ' *' : ''}</Label>
        <Textarea
          value={draft.projectPurpose}
          onChange={(event) => update('projectPurpose', event.target.value)}
          placeholder="어떤 대상에게 어떤 가치를 제공하는 프로젝트인지 입력&#10;예: CJ푸드빌 새로운 점포를 만들어갈 사내기업가 육성"
          className="mt-1 min-h-[88px] text-sm"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">계약 목적을 한두 문장으로 요약합니다.</p>
      </div>
      <div>
        <Label className="text-xs">프로젝트 주요 내용{usesRegistrationV2 ? ' *' : ''}</Label>
        <Textarea
          value={draft.description}
          onChange={(event) => update('description', event.target.value)}
          placeholder="프로젝트 주요 수행 내용, 범위, 산출물 등 프로그램 핵심 내용 요약&#10;예: 1. 사업제안서 작성 교육&#10;2. 사업제안서 작성 - 25개팀 이상 1:1 코칭&#10;3. 선정된 10개 팀 사업제안 구체화 1:1 컨설팅"
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

  const renderProjectDocumentUpload = (kind: ProjectRequestDocumentKind) => {
    const document = draft[PROJECT_DOCUMENT_FIELD[kind]] as FileAttachment | null;
    const uploadState = documentUploadState[kind];
    const uploadError = documentUploadError[kind];
    const inputRef = getDocumentInputRef(kind);
    const canRemove = canRemoveProjectDocuments && (kind === 'contract'
      ? contractDocumentEditPolicy.canRemoveCurrentContractDocument
      : Boolean(document));
    const removeLabel = kind === 'contract' ? contractDocumentEditPolicy.removeButtonLabel : '첨부 제거';
    const remove = kind === 'contract' ? removeContractDocument : () => removeSupplementalDocument(kind);
    const optionalNoteField = OPTIONAL_REGISTRATION_DOCUMENT_NOTE_FIELD[
      kind as keyof typeof OPTIONAL_REGISTRATION_DOCUMENT_NOTE_FIELD
    ];

    return (
      <div key={kind} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-600" />
              <Label className="text-xs font-semibold">{PROJECT_DOCUMENT_LABELS[kind]}</Label>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {kind === 'contract'
                ? (contractAnalysisMergeMode === 'none'
                    ? 'PDF를 올리면 계약서 원문과 검토용 첨부를 저장합니다. 입력값은 자동으로 바꾸지 않습니다.'
                    : 'PDF를 올리면 계약명, 계약기간, 계약금액, 계약 대상 후보를 읽어와 빈 항목만 채웁니다.')
                : kind === 'proposal_word_original'
                  ? '원본 DOCX를 올립니다. 파일이 없으면 아래에 미첨부 사유 또는 해당 없음을 적어주세요.'
                  : kind === 'proposal_ppt_original' || kind === 'presentation_ppt_original'
                    ? '원본 PPTX를 올립니다. 파일이 없으면 아래에 미첨부 사유 또는 해당 없음을 적어주세요.'
                    : kind === 'rfp_request_evidence'
                      ? 'RFP 또는 요청 메일 원본을 PDF, DOCX, EML, MSG 중 하나로 올려주세요.'
                      : 'PDF를 올리면 검토용 첨부로 저장합니다.'}
            </p>
            {document ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                <span className="max-w-full truncate font-medium text-slate-900">{document.name}</span>
                <span className="text-muted-foreground">
                  {(document.size / 1024 / 1024).toFixed(2)} MB
                </span>
                {document.downloadURL ? (
                  <Button asChild type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]">
                    <a href={document.downloadURL} target="_blank" rel="noreferrer">원문 보기</a>
                  </Button>
                ) : null}
                {canRemove ? (
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-rose-600" onClick={remove}>
                    <X className="mr-1 h-3.5 w-3.5" />
                    {removeLabel}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {optionalNoteField && !document ? (
              <div className="mt-3">
                <Label className="text-[11px]">미첨부 사유 / 해당 없음 *</Label>
                <Input
                  value={draft.registrationOptionalDocumentNotes[optionalNoteField]}
                  onChange={(event) => update('registrationOptionalDocumentNotes', {
                    ...draft.registrationOptionalDocumentNotes,
                    [optionalNoteField]: event.target.value,
                  })}
                  placeholder="예: 해당 없음 / 발주처에서 원본을 제공하지 않음"
                  className="mt-1 h-9 bg-white text-sm"
                />
              </div>
            ) : null}
            {kind === 'contract' && contractDocumentEditPolicy.isExistingContractDocumentLocked ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                기존 계약서는 관리자 화면에서만 제거할 수 있습니다.
              </p>
            ) : null}
            {kind === 'contract' && draft.contractAnalysis ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] leading-5 text-slate-700">
                <span className="font-semibold text-[#001e46]">분석 요약</span>
                <span className="ml-2">{draft.contractAnalysis.summary}</span>
              </div>
            ) : null}
            {uploadError ? (
              <p className="mt-2 text-[11px] text-rose-600">{uploadError}</p>
            ) : null}
          </div>
          <div className="shrink-0">
            <input
              ref={inputRef}
              type="file"
              accept={getProjectDocumentUploadAccept(kind)}
              className="hidden"
              onChange={(event) => handleProjectDocumentSelect(kind, event)}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 lg:w-auto"
              disabled={uploadState === 'extracting'}
              onClick={() => {
                const retryFile = retryDocumentFileRef.current[kind];
                if (retryFile) void processProjectDocument(kind, retryFile, inputRef.current || undefined);
                else inputRef.current?.click();
              }}
            >
              {uploadState === 'extracting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {retryDocumentFileRef.current[kind]
                ? `${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 다시 시도`
                : document
                  ? `${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 교체`
                  : `${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 업로드`}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderFinancialStep = () => (
    <div className="space-y-4">
      {onContractFileUpload || onProjectDocumentFileUpload ? (
        <div className="space-y-3">
          {registrationDocumentKinds.map((kind) => renderProjectDocumentUpload(kind))}
        </div>
      ) : null}

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

      {canEditProjectStatus(mode) ? (
        <div className={`grid gap-4 ${isAdminMode(mode) ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
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
          {isAdminMode(mode) ? (
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
          ) : null}
          {isAdminMode(mode) ? renderContractTypeSelect() : null}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {renderContractTypeSelect()}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[160px_minmax(0,1fr)]">
        <div>
          <Label className="text-xs">통화</Label>
          <Select value={draft.currency} onValueChange={(value) => update('currency', (value === 'USD' ? 'USD' : 'KRW') as ProjectCurrency)}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PROJECT_CURRENCY_LABELS) as ProjectCurrency[]).map((currency) => (
                <SelectItem key={currency} value={currency}>{PROJECT_CURRENCY_LABELS[currency]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">계약금액 *</Label>
          <Input
            inputMode="numeric"
            value={formatProjectAmountInput(draft.contractAmount, hasContractAmountInput)}
            onChange={(event) => updateAmount('contractAmount', event.target.value)}
            readOnly={usesRegistrationV2}
            placeholder="0"
            className={cn('mt-1 h-9 text-sm', usesRegistrationV2 && 'bg-muted/40')}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {hasContractAmountInput ? `${PROJECT_CURRENCY_LABELS[draft.currency]} ${fmtKRW(draft.contractAmount)}` : '미입력'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <div>
          <Label className="text-xs">매출 부가세</Label>
          <Input
            inputMode="numeric"
            value={formatProjectAmountInput(draft.salesVatAmount, hasSalesVatAmountInput)}
            onChange={(event) => updateAmount('salesVatAmount', event.target.value)}
            readOnly={usesRegistrationV2}
            placeholder="0"
            className={cn('mt-1 h-9 text-sm', usesRegistrationV2 && 'bg-muted/40')}
          />
        </div>
        <div>
          <Label className="text-xs">총수익</Label>
          <Input
            inputMode="numeric"
            value={formatProjectAmountInput(draft.totalRevenueAmount, hasTotalRevenueAmountInput)}
            onChange={(event) => updateAmount('totalRevenueAmount', event.target.value)}
            readOnly={usesRegistrationV2}
            placeholder="0"
            className={cn('mt-1 h-9 text-sm', usesRegistrationV2 && 'bg-muted/40')}
          />
        </div>
        <div>
          <Label className="text-xs">지원금</Label>
          <Input
            inputMode="numeric"
            value={formatProjectAmountInput(draft.supportAmount, hasSupportAmountInput)}
            onChange={(event) => updateAmount('supportAmount', event.target.value)}
            readOnly={usesRegistrationV2}
            placeholder="0"
            className={cn('mt-1 h-9 text-sm', usesRegistrationV2 && 'bg-muted/40')}
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

      {usesRegistrationV2 ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div>
            <Label className="text-xs font-semibold">연도별 계약·재무 *</Label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              계약기간의 모든 연도를 각각 입력하고 확인해야 하며, 위 합계는 연도별 입력값으로 자동 계산됩니다.
            </p>
          </div>
          {draft.financialYears.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-[12px] text-muted-foreground">
              계약 시작일과 종료일을 먼저 입력해 주세요.
            </p>
          ) : draft.financialYears.map((row, index) => (
            <div key={row.year} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-3 text-sm font-semibold text-slate-900">{row.year}년</div>
              <div className="grid gap-3 lg:grid-cols-5">
                {([
                  ['contractAmount', '계약금액'],
                  ['salesVatAmount', '매출 부가세'],
                  ['totalRevenueAmount', '총수익'],
                  ['supportAmount', '지원금'],
                ] as const).map(([field, label]) => (
                  <div key={field}>
                    <Label className="text-[11px]">{label}</Label>
                    <Input
                      inputMode="numeric"
                      value={formatProjectAmountInput(row[field], true)}
                      onChange={(event) => updateFinancialYear(index, field, parseProjectAmountInput(event.target.value))}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                ))}
                <div>
                  <Label className="text-[11px]">수익률(%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={Number((row.profitRate * 100).toFixed(2))}
                    onChange={(event) => updateFinancialYear(
                      index,
                      'profitRate',
                      Math.min(1, Math.max(0, Number(event.target.value) / 100 || 0)),
                    )}
                    className="mt-1 h-9 text-sm"
                  />
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-[12px] text-slate-700">
                <Checkbox
                  checked={row.confirmed}
                  onCheckedChange={(checked) => updateFinancialYear(index, 'confirmed', checked === true)}
                />
                {row.year}년 금액을 계약서와 대조하여 확인했습니다.
              </label>
            </div>
          ))}
        </div>
      ) : null}

      {mode === 'admin' ? (
        <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 lg:grid-cols-2">
          <div>
          <Label className="text-xs">당해연도 예산</Label>
            <Input
              inputMode="numeric"
              value={formatProjectAmountInput(draft.budgetCurrentYear, draft.budgetCurrentYear > 0)}
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
              value={formatProjectAmountInput(draft.taxInvoiceAmount, draft.taxInvoiceAmount > 0)}
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
          <Select
            value={draft.settlementType}
            onValueChange={(value) => update('settlementType', value as SettlementType)}
          >
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="정산 유형 선택" /></SelectTrigger>
            <SelectContent>
              {(Object.entries(SETTLEMENT_TYPE_LABELS) as [SettlementType, string][]).map(([key, value]) => (
                <SelectItem key={key} value={key}>{value}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">정산 기준</Label>
          <Select
            value={draft.basis}
            onValueChange={(value) => update('basis', value as Basis)}
          >
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="정산 기준 선택" /></SelectTrigger>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label className="text-xs">정산 시스템</Label>
          <Select value={draft.settlementSystem} onValueChange={(value) => update('settlementSystem', value as SettlementSystemCode)}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.entries(SETTLEMENT_SYSTEM_LABELS) as [SettlementSystemCode, string][]).map(([key, value]) => (
                <SelectItem key={key} value={key}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">인건비 정산 기준</Label>
          <Select value={draft.laborSettlementBasis} onValueChange={(value) => update('laborSettlementBasis', value as LaborSettlementBasis)}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.entries(LABOR_SETTLEMENT_BASIS_LABELS) as [LaborSettlementBasis, string][]).map(([key, value]) => (
                <SelectItem key={key} value={key}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

    </div>
  );

  const renderTeamStep = () => (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label className="text-xs">사업 담당자 *</Label>
          <Select value={selectedOwner?.uid} onValueChange={(value) => {
            const member = ownerOptions.find((item) => item.uid === value);
            if (!member) return;
            setDraft((prev) => createProjectEditorDraft({
              ...prev,
              registeredById: member.uid,
              registeredByName: member.name || member.email || member.uid,
              registeredByEmail: member.email || '',
              managerId: member.uid,
              managerName: member.name || member.email || member.uid,
            }));
          }} disabled={ownerOptions.length === 0}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="구성원 원장에서 선택" /></SelectTrigger>
            <SelectContent>
              {ownerOptions.map((member) => (
                <SelectItem key={member.uid} value={member.uid}>
                  {member.email ? `${member.name || member.uid} (${member.email})` : (member.name || member.uid)}
                </SelectItem>
              ))}
              {ownerOptions.length === 0 ? (
                <SelectItem value="__no_org_members__" disabled>구성원 원장을 불러오는 중입니다</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            구성원 원장(orgs/{'{'}orgId{'}'}/members)의 UID를 저장합니다. 프로젝트 현황과 실무자 포털 노출은 이 UID 기준으로 연결됩니다.
          </p>
          {hasUnlinkedStoredOwner ? (
            <p className="mt-1 text-[11px] text-red-700">
              현재 저장된 담당자 값이 구성원 원장에 없습니다. 원장에서 다시 선택해야 저장 후 연결됩니다.
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-xs">서류상 참여인력</Label>
          <p className="mt-1 text-[10px] text-muted-foreground">계약·협약서에 남길 참여인력, 역할, 참여율을 같은 구조로 저장합니다.</p>
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
            const teamMemberInputMode = member.inputMode === 'manual' ? 'manual' : 'search';
            const selectedNames = new Set(
              draft.teamMembersDetailed
                .map((item, itemIndex) => (itemIndex === index ? '' : item.memberName))
                .filter(Boolean),
            );
            const currentTeamMemberOptionExists = !member.memberName
              || PROJECT_TEAM_MEMBER_OPTIONS.some((option) => option.value === member.memberName);
            return (
              <div key={`team-member-${index}`} className="rounded-xl border border-border/60 bg-background/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold">팀원 {index + 1}</div>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-rose-600" onClick={() => removeTeamMember(index)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-[132px_minmax(0,1.4fr)_minmax(0,1fr)_110px_120px_140px_140px]">
                  <div>
                    <Label className="text-xs">입력 방식</Label>
                    <Select
                      value={teamMemberInputMode}
                      onValueChange={(value) => updateTeamMember(index, {
                        inputMode: value === 'manual' ? 'manual' : 'search',
                        identityInput: value === 'manual' ? '' : undefined,
                        memberName: '',
                        memberNickname: '',
                      })}
                    >
                      <SelectTrigger className="mt-1 h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="search">팀원 검색</SelectItem>
                        <SelectItem value="manual">직접 입력</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">팀원</Label>
                    {teamMemberInputMode === 'search' ? (
                      <TeamMemberSearchCombobox
                        member={member}
                        selectedNames={selectedNames}
                        currentTeamMemberOptionExists={currentTeamMemberOptionExists}
                        onSelect={(patch) => updateTeamMember(index, patch)}
                      />
                    ) : (
                      <Input
                        value={member.identityInput ?? formatTeamMemberIdentityInput(member)}
                        onChange={(event) => updateTeamMember(index, {
                          inputMode: 'manual',
                          identityInput: event.target.value,
                          ...parseProjectTeamMemberIdentityInput(event.target.value),
                        })}
                        placeholder="이름(별명)"
                        className="mt-1 h-9 text-sm"
                      />
                    )}
                  </div>
                  <div>
                    <Label className="text-xs">역할</Label>
                    <Select value={member.role || undefined} onValueChange={(value) => updateTeamMember(index, { role: value })}>
                      <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="역할 선택" /></SelectTrigger>
                      <SelectContent>
                        {PROJECT_TEAM_MEMBER_ROLES.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                      </SelectContent>
                    </Select>
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
                  <label className="flex items-center gap-2 self-end pb-2 text-[12px] text-slate-700">
                    <Checkbox
                      checked={member.isDocumentOnly === true}
                      onCheckedChange={(checked) => updateTeamMember(index, { isDocumentOnly: checked === true })}
                    />
                    서류상 인력
                  </label>
                  <div>
                    <Label className="text-xs">인건비 시작월</Label>
                    <Input
                      type="month"
                      value={member.laborAllocationStartMonth || ''}
                      onChange={(event) => updateTeamMember(index, { laborAllocationStartMonth: event.target.value })}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">인건비 종료월</Label>
                    <Input
                      type="month"
                      value={member.laborAllocationEndMonth || ''}
                      onChange={(event) => updateTeamMember(index, { laborAllocationEndMonth: event.target.value })}
                      className="mt-1 h-9 text-sm"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );

  const renderPaymentStep = () => (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <Label className="text-xs">선금/계약금 (원)</Label>
          <Input value={formatProjectAmountInput(draft.paymentPlan.contract, true)} onChange={(event) => update('paymentPlan', { ...draft.paymentPlan, contract: parseProjectAmountInput(event.target.value) })} className="mt-1 h-9 text-sm" />
          <p className="mt-1 text-[10px] text-muted-foreground">{formatPaymentPlanAmount(draft.paymentPlan.contract, draft.contractAmount)}</p>
          <Label className="mt-3 block text-xs">입금 예상월{draft.paymentPlan.contract > 0 ? ' *' : ''}</Label>
          <Input type="month" value={draft.paymentExpectedMonths.contract} onChange={(event) => update('paymentExpectedMonths', { ...draft.paymentExpectedMonths, contract: event.target.value })} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">중도금 (원)</Label>
          <Input value={formatProjectAmountInput(draft.paymentPlan.interim, true)} onChange={(event) => update('paymentPlan', { ...draft.paymentPlan, interim: parseProjectAmountInput(event.target.value) })} className="mt-1 h-9 text-sm" />
          <p className="mt-1 text-[10px] text-muted-foreground">{formatPaymentPlanAmount(draft.paymentPlan.interim, draft.contractAmount)}</p>
          <Label className="mt-3 block text-xs">입금 예상월{draft.paymentPlan.interim > 0 ? ' *' : ''}</Label>
          <Input type="month" value={draft.paymentExpectedMonths.interim} onChange={(event) => update('paymentExpectedMonths', { ...draft.paymentExpectedMonths, interim: event.target.value })} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">잔금 (원)</Label>
          <Input value={formatProjectAmountInput(draft.paymentPlan.final, true)} onChange={(event) => update('paymentPlan', { ...draft.paymentPlan, final: parseProjectAmountInput(event.target.value) })} className="mt-1 h-9 text-sm" />
          <p className="mt-1 text-[10px] text-muted-foreground">{formatPaymentPlanAmount(draft.paymentPlan.final, draft.contractAmount)}</p>
          <Label className="mt-3 block text-xs">입금 예상월{draft.paymentPlan.final > 0 ? ' *' : ''}</Label>
          <Input type="month" value={draft.paymentExpectedMonths.final} onChange={(event) => update('paymentExpectedMonths', { ...draft.paymentExpectedMonths, final: event.target.value })} className="mt-1 h-9 text-sm" />
        </div>
      </div>
      {advanceInterimRatio !== null && paymentPlanTotal > 0 ? (
        <div className={`rounded-lg border px-3 py-2 text-[12px] ${requiresAdvanceInterimReason ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
          선금+중도금 비율 {(advanceInterimRatio * 100).toFixed(1)}%
        </div>
      ) : null}
      {requiresAdvanceInterimReason ? (
        <div>
          <Label className="text-xs">선금·중도금 합계 70% 미만 사유 *</Label>
          <Textarea
            value={draft.advanceInterimBelow70Reason}
            onChange={(event) => update('advanceInterimBelow70Reason', event.target.value)}
            placeholder="발주처 지급 조건 등 70% 미만인 이유를 입력"
            className="mt-1 min-h-[72px] text-sm"
          />
        </div>
      ) : null}
      <div>
        <Label className="text-xs">입금 계획 설명</Label>
        <Textarea
          value={draft.paymentPlanDesc}
          onChange={(event) => update('paymentPlanDesc', event.target.value)}
          placeholder="예: 검수 완료 후 세금계산서 발행, 발행일로부터 14일 이내 입금"
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
      <div>
        <Label className="text-xs">기타 참고사항</Label>
        <Textarea value={draft.note} onChange={(event) => update('note', event.target.value)} className="mt-1 min-h-[88px] text-sm" />
      </div>
      {usesRegistrationV2 ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div>
            <Label className="text-xs font-semibold">등록 전 확인사항 *</Label>
            <p className="mt-1 text-[11px] text-muted-foreground">계약 및 정산 기준을 사람이 직접 대조한 뒤 체크해 주세요.</p>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-slate-700">
            <Checkbox
              checked={draft.registrationConfirmations.laborIncludesFourInsurance === true}
              onCheckedChange={(checked) => update('registrationConfirmations', {
                ...draft.registrationConfirmations,
                laborIncludesFourInsurance: checked === true,
              })}
            />
            인건비에 4대보험 사업주 부담분이 포함되어 있습니다.
          </label>
          <label className="flex items-center gap-2 text-[12px] text-slate-700">
            <Checkbox
              checked={draft.registrationConfirmations.laborIncludesRetirementPay === true}
              onCheckedChange={(checked) => update('registrationConfirmations', {
                ...draft.registrationConfirmations,
                laborIncludesRetirementPay: checked === true,
              })}
            />
            인건비에 퇴직급여 충당액이 포함되어 있습니다.
          </label>
          <label className="flex items-center gap-2 text-[12px] text-slate-700">
            <Checkbox
              checked={draft.registrationConfirmations.customerSettlementBasisConfirmed}
              onCheckedChange={(checked) => update('registrationConfirmations', {
                ...draft.registrationConfirmations,
                customerSettlementBasisConfirmed: checked === true,
              })}
            />
            발주처와 정산 기준을 확인했습니다.
          </label>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <Label className="text-xs">모두싸인으로 계약했나요? *</Label>
              <Select
                value={draft.registrationConfirmations.modusignContractUsed === null
                  ? undefined
                  : (draft.registrationConfirmations.modusignContractUsed ? 'yes' : 'no')}
                onValueChange={(value) => update('registrationConfirmations', {
                  ...draft.registrationConfirmations,
                  modusignContractUsed: value === 'yes',
                  originalContractSubmitted: value === 'yes'
                    ? false
                    : draft.registrationConfirmations.originalContractSubmitted,
                })}
              >
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="선택" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">예</SelectItem>
                  <SelectItem value="no">아니요</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.registrationConfirmations.modusignContractUsed === false ? (
              <label className="mt-6 flex items-center gap-2 text-[12px] text-slate-700">
                <Checkbox
                  checked={draft.registrationConfirmations.originalContractSubmitted === true}
                  onCheckedChange={(checked) => update('registrationConfirmations', {
                    ...draft.registrationConfirmations,
                    originalContractSubmitted: checked === true,
                  })}
                />
                계약서 원본을 Sunny에게 제출했습니다.
              </label>
            ) : null}
          </div>
        </div>
      ) : null}
      {showProjectCheckout ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div>
            <Label className="text-xs font-semibold">종료사업 체크아웃</Label>
            <p className="mt-1 text-[11px] text-muted-foreground">완료 프로젝트의 입금·잔액·증빙·USB 인계를 확인합니다.</p>
          </div>
          {([
            ['finalPaymentReceived', '최종 잔금 입금을 확인했습니다.'],
            ['bankBalanceZero', '사업 전용계좌 잔액이 0원입니다.'],
            ['performanceCertificateReceived', '수행확인서 원본을 수령했습니다.'],
            ['taxInvoiceEvidenceConfirmed', '세금계산서 발행 내역을 확인했습니다.'],
            ['finalSettlementReportConfirmed', '최종 정산보고서를 확인했습니다.'],
          ] as const).map(([field, label]) => (
            <label key={field} className="flex items-center gap-2 text-[12px] text-slate-700">
              <Checkbox
                checked={draft.checkout[field]}
                onCheckedChange={(checked) => update('checkout', { ...draft.checkout, [field]: checked === true })}
              />
              {label}
            </label>
          ))}
          {onProjectDocumentFileUpload ? (
            <div className="space-y-3 pt-1">
              {checkoutDocumentKinds.map((kind) => renderProjectDocumentUpload(kind))}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-[12px] text-slate-700">
            <Checkbox
              checked={draft.checkout.usbEvidenceSubmitted}
              onCheckedChange={(checked) => update('checkout', {
                ...draft.checkout,
                usbEvidenceSubmitted: checked === true,
                evidenceDeletedAfterUsb: checked === true ? draft.checkout.evidenceDeletedAfterUsb : false,
              })}
            />
            정산 USB를 제출했습니다.
          </label>
          <label className="flex items-center gap-2 text-[12px] text-slate-700">
            <Checkbox
              checked={draft.checkout.evidenceDeletedAfterUsb}
              disabled={!draft.checkout.usbEvidenceSubmitted}
              onCheckedChange={(checked) => update('checkout', {
                ...draft.checkout,
                evidenceDeletedAfterUsb: checked === true,
              })}
            />
            USB 제출 후 로컬·임시 증빙 파일을 삭제했습니다.
          </label>
        </div>
      ) : null}
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
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-[12px] text-red-700">
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
            <ReviewRow label="프로젝트 주요 내용" value={draft.description} />
            {canEditProjectStatus(mode) ? (
              <>
                <ReviewRow label="프로젝트 진행 상태" value={PROJECT_STATUS_LABELS[draft.status]} />
                {isAdminMode(mode) ? <ReviewRow label="프로젝트 구분" value={PROJECT_PHASE_LABELS[draft.phase]} /> : null}
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">계약/재무</CardTitle></CardHeader>
          <CardContent>
            <ReviewRow label="기간" value={`${draft.contractStart || '-'} ~ ${draft.contractEnd || '-'}`} />
            <ReviewRow label="통화" value={PROJECT_CURRENCY_LABELS[draft.currency]} />
            <ReviewRow label="계약금액" value={formatStoredProjectAmount(draft.contractAmount, financialInputFlags.contractAmount)} />
            <ReviewRow label="매출 부가세" value={formatStoredProjectAmount(draft.salesVatAmount, financialInputFlags.salesVatAmount)} />
            <ReviewRow label="총수익" value={formatStoredProjectAmount(draft.totalRevenueAmount, financialInputFlags.totalRevenueAmount)} />
            <ReviewRow label="지원금" value={formatStoredProjectAmount(draft.supportAmount, financialInputFlags.supportAmount)} />
            <ReviewRow label="수익률" value={profitRateLabel ? `${profitRateLabel}%` : '-'} />
            <ReviewRow label="정산 유형" value={SETTLEMENT_TYPE_LABELS[draft.settlementType]} />
            <ReviewRow label="정산 기준" value={BASIS_LABELS[draft.basis]} />
            <ReviewRow label="통장 유형" value={ACCOUNT_TYPE_LABELS[draft.accountType]} />
            <ReviewRow label="정산 시스템" value={SETTLEMENT_SYSTEM_LABELS[draft.settlementSystem]} />
            <ReviewRow label="인건비 정산 기준" value={LABOR_SETTLEMENT_BASIS_LABELS[draft.laborSettlementBasis]} />
            <ReviewRow label="자금 입력 방식" value={PROJECT_FUND_INPUT_MODE_LABELS[draft.fundInputMode]} />
            {usesRegistrationV2 ? (
              <>
                <ReviewRow
                  label="연도별 재무"
                  value={draft.financialYears.map((row) => (
                    `${row.year}년 계약 ${fmtKRW(row.contractAmount)}원 · 매출VAT ${fmtKRW(row.salesVatAmount)}원 · 총수익 ${fmtKRW(row.totalRevenueAmount)}원 · 지원금 ${fmtKRW(row.supportAmount)}원 · 수익률 ${(row.profitRate * 100).toFixed(2)}%${row.confirmed ? ' · 확인' : ' · 미확인'}`
                  )).join('\n')}
                />
                <ReviewRow
                  label="등록 필수 첨부"
                  value={[
                    `1. 계약서: ${draft.contractDocument?.name || '미첨부'}`,
                    `2. 사업자등록증: ${draft.customerBusinessRegistrationDocument?.name || '미첨부'}`,
                    `3. 견적서: ${draft.quoteDocument?.name || '미첨부'}`,
                    `4. 제안서 또는 RFP/요청 메일: ${draft.proposalDocument?.name || draft.rfpRequestEvidenceDocument?.name || '미첨부'}`,
                  ].join('\n')}
                />
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">팀/인력</CardTitle></CardHeader>
          <CardContent>
            <ReviewRow label="PM" value={draft.managerName} />
            <ReviewRow label="담당자 계정" value={draft.managerId || '-'} />
            <ReviewRow label="서류상 참여인력" value={teamMembersSummary} />
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="pb-2"><CardTitle className="text-sm">입금/정산</CardTitle></CardHeader>
          <CardContent>
            <ReviewRow label="선금/계약금" value={formatPaymentPlanAmount(draft.paymentPlan.contract, draft.contractAmount)} />
            <ReviewRow label="선금/계약금 예상월" value={draft.paymentExpectedMonths.contract} />
            <ReviewRow label="중도금" value={formatPaymentPlanAmount(draft.paymentPlan.interim, draft.contractAmount)} />
            <ReviewRow label="중도금 예상월" value={draft.paymentExpectedMonths.interim} />
            <ReviewRow label="잔금" value={formatPaymentPlanAmount(draft.paymentPlan.final, draft.contractAmount)} />
            <ReviewRow label="잔금 예상월" value={draft.paymentExpectedMonths.final} />
            <ReviewRow label="선금+중도금 비율" value={advanceInterimRatio === null ? '-' : `${(advanceInterimRatio * 100).toFixed(1)}%`} />
            {requiresAdvanceInterimReason ? <ReviewRow label="70% 미만 사유" value={draft.advanceInterimBelow70Reason} /> : null}
            <ReviewRow label="입금 계획" value={draft.paymentPlanDesc} />
            <ReviewRow label="입금/정산 안내" value={draft.settlementGuide} />
            <ReviewRow label="최종 입금 메모" value={draft.finalPaymentNote} />
            <ReviewRow label="기타 참고사항" value={draft.note} />
            {usesRegistrationV2 ? (
              <ReviewRow
                label="등록 확인사항"
                value={[
                  `4대보험 ${draft.registrationConfirmations.laborIncludesFourInsurance ? '확인' : '미확인'}`,
                  `퇴직급여 ${draft.registrationConfirmations.laborIncludesRetirementPay ? '확인' : '미확인'}`,
                  `발주처 정산기준 ${draft.registrationConfirmations.customerSettlementBasisConfirmed ? '확인' : '미확인'}`,
                  `모두싸인 ${draft.registrationConfirmations.modusignContractUsed === null ? '미선택' : draft.registrationConfirmations.modusignContractUsed ? '사용' : '미사용'}`,
                  draft.registrationConfirmations.modusignContractUsed === false
                    ? `원본 제출 ${draft.registrationConfirmations.originalContractSubmitted ? '확인' : '미확인'}`
                    : '',
                ].filter(Boolean).join(' · ')}
              />
            ) : null}
            {showProjectCheckout ? (
              <ReviewRow
                label="종료사업 체크아웃"
                value={`${Object.values(draft.checkout).filter(Boolean).length}/7 확인`}
              />
            ) : null}
          </CardContent>
        </Card>
        {draft.contractDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={draft.contractDocument}
              privateDraftAttachment={mode === 'portal-register' && !draft.contractDocument.downloadURL}
              title="계약서 원문"
              description="등록하려는 계약서가 맞는지 꼭 확인해주세요!"
              descriptionClassName="text-rose-600"
            />
          </div>
        ) : null}
        {draft.quoteDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={draft.quoteDocument}
              privateDraftAttachment={mode === 'portal-register' && !draft.quoteDocument.downloadURL}
              title="견적서 원문"
              description="첨부한 견적서가 맞는지 확인해주세요."
            />
          </div>
        ) : null}
        {draft.proposalDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={draft.proposalDocument}
              privateDraftAttachment={mode === 'portal-register' && !draft.proposalDocument.downloadURL}
              title="제안서 원문"
              description="첨부한 제안서가 맞는지 확인해주세요."
            />
          </div>
        ) : null}
        {draft.customerBusinessRegistrationDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={draft.customerBusinessRegistrationDocument}
              privateDraftAttachment={!draft.customerBusinessRegistrationDocument.downloadURL}
              title="발주처 사업자등록증 원문"
              description="첨부한 발주처 사업자등록증이 맞는지 확인해주세요."
            />
          </div>
        ) : null}
        {showProjectCheckout && draft.performanceCertificateDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={draft.performanceCertificateDocument}
              privateDraftAttachment={!draft.performanceCertificateDocument.downloadURL}
              title="수행확인서 원문"
              description="종료사업 수행확인서 증빙입니다."
            />
          </div>
        ) : null}
        {showProjectCheckout && draft.taxInvoiceDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={draft.taxInvoiceDocument}
              privateDraftAttachment={!draft.taxInvoiceDocument.downloadURL}
              title="세금계산서 원문"
              description="종료사업 세금계산서 증빙입니다."
            />
          </div>
        ) : null}
        {showProjectCheckout && draft.finalSettlementReportDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={draft.finalSettlementReportDocument}
              privateDraftAttachment={!draft.finalSettlementReportDocument.downloadURL}
              title="최종 정산보고서 원문"
              description="종료사업 최종 정산보고서 증빙입니다."
            />
          </div>
        ) : null}
      </div>
      {usesRegistrationV2 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] text-slate-700">
          최종 저장 후 사업관리 폴더가 자동 생성되며, 프로젝트 상세 화면에서 열 수 있습니다.
        </div>
      ) : null}
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
    <div className="mx-auto w-full max-w-6xl space-y-5">
      {embeddedInShell ? (
        onCancel ? (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="gap-2" onClick={requestCancel}>
              <ArrowLeft className="h-4 w-4" />
              나가기
            </Button>
          </div>
        ) : null
      ) : (
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
            <Button variant="outline" className="gap-2" onClick={requestCancel}>
              <ArrowLeft className="h-4 w-4" />
              나가기
            </Button>
          ) : null}
        </div>
      )}

      {topSlot}

      {preloadWarningVisible ? (
        <div className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-semibold text-slate-950">새 버전이 배포되었습니다</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600">
                작성 중인 내용 보호를 위해 자동 새로고침은 막았습니다. 임시저장 후 새로고침하면 됩니다.
              </p>
            </div>
            {autosave?.key ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleManualAutosave()}
              >
                지금 임시저장
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {restoreCandidate ? (
        <div className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-semibold text-slate-950">이전에 작성 중이던 임시저장이 있습니다</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600">
                {formatAutosaveTime(restoreCandidate.updatedAt) || '최근'}에 저장된 작성 내용을 불러올 수 있습니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={discardLocalDraft}>
                버리기
              </Button>
              <Button type="button" size="sm" onClick={restoreLocalDraft}>
                임시저장 불러오기
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
      <Card className="border-slate-200/80 shadow-sm lg:sticky lg:top-4">
        <CardContent className="p-3">
          <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>{stepIndex + 1} / {STEPS.length}</span>
            <span>{step.label}</span>
          </div>
          <Progress value={((stepIndex + 1) / STEPS.length) * 100} />
          <div className="mt-4 grid gap-1.5">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const active = index === stepIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStepIndex(index)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    active ? 'border-[#001e46] bg-slate-50 text-[#001e46]' : 'border-border bg-white text-muted-foreground hover:bg-muted/40'
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
        <CardContent className={cn('space-y-5', PROJECT_EDITOR_FORM_SURFACE_CLASS)}>
          <fieldset disabled={readOnly} className="contents">
            {renderStep()}
          </fieldset>
        </CardContent>
      </Card>
      </div>

      <div className="z-20 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur lg:sticky lg:bottom-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <CalendarRange className="h-4 w-4" />
            <span>{draft.contractStart || '-'} ~ {draft.contractEnd || '-'}</span>
            <span className="hidden lg:inline">·</span>
            <span className="hidden lg:inline">{draft.name || '프로젝트명 미입력'}</span>
            {autosave?.key ? (
              <>
                <span className="hidden lg:inline">·</span>
                <span className={autosaveState === 'error' ? 'text-red-600' : 'text-muted-foreground'}>
                  {autosaveState === 'saving'
                    ? '임시저장 중'
                    : autosaveState === 'saved'
                      ? `임시저장됨${lastAutosavedAt ? ` ${formatAutosaveTime(lastAutosavedAt)}` : ''}`
                      : autosaveState === 'error'
                        ? '임시저장 실패'
                        : '임시저장 대기'}
                </span>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {autosave?.key ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleManualAutosave()}
                disabled={readOnly || autosaveState === 'saving'}
                className="gap-2"
              >
                {autosaveState === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                임시저장
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => setStepIndex((value) => Math.max(0, value - 1))}
              disabled={stepIndex === 0}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              이전
            </Button>
            {stepIndex < STEPS.length - 1 ? (
              <Button type="button" onClick={() => setStepIndex((value) => Math.min(STEPS.length - 1, value + 1))} className="gap-2">
                다음
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              actions.map((action) => {
                const Icon = action.icon || CheckCircle2;
                return (
                  <Button
                    key={action.id}
                    type="button"
                    variant={action.variant || 'default'}
                    disabled={readOnly || autosaveState === 'saving' || !!busyActionId || action.disabled || !canSubmit}
                    onClick={() => void handleActionSubmit(action.id)}
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

      <AlertDialog
        open={exitDialogOpen}
        onOpenChange={(open) => {
          if (open || exitBusy) return;
          setExitDialogOpen(false);
          setExitIntent(null);
          if (blocker.state === 'blocked') blocker.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>수정 세션을 종료할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {shouldBlockNavigation
                ? '작성 중인 내용과 첨부 상태를 확인한 뒤 종료 방법을 선택해 주세요.'
                : '페이지를 이동하면 현재 프로젝트의 수정 선점이 종료됩니다.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={exitBusy}>계속 작성</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={exitBusy}
              onClick={() => void finishExit(false)}
            >
              저장하지 않고 종료
            </Button>
            <AlertDialogAction
              disabled={exitBusy || uploadInProgress || hasPendingRetryFile}
              onClick={(event) => {
                event.preventDefault();
                void finishExit(true);
              }}
            >
              임시저장 후 종료
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
