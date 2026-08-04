import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  ClipboardList,
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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useBlocker } from 'react-router';
import {
  ACCOUNT_TYPE_LABELS,
  INTEREST_REFUND_POLICY_LABELS,
  BASIS_LABELS,
  LABOR_SETTLEMENT_BASIS_LABELS,
  getProjectContractTypeSelectableOptions,
  getProjectTypeSelectableOptions,
  normalizeProjectContractType,
  PROJECT_CURRENCY_LABELS,
  PROJECT_PHASE_LABELS,
  PROJECT_SETTLEMENT_SYSTEM_CODES,
  REGISTRATION_V2_BASIS_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  SETTLEMENT_TYPE_LABELS,
  SETTLEMENT_SYSTEM_LABELS,
  type AccountType,
  type InterestRefundPolicy,
  type Basis,
  type LaborSettlementBasis,
  type OrgMember,
  type FileAttachment,
  type ProjectCurrency,
  type ProjectFinancialYear,
  type ProjectFinancialInputFlags,
  type ProjectPaymentExpectedMonths,
  type ProjectPhase,
  type ProjectRequestContractAnalysis,
  type ProjectStatus,
  type ProjectTeamMemberAssignment,
  type ProjectType,
  type SettlementType,
  type SettlementSystemCode,
} from '../../data/types';
import { PROJECT_DEPARTMENT_OPTIONS, dedupeProjectDepartmentLabels } from '../../data/project-department-options';
import {
  buildProjectTeamMemberOptions,
  type ProjectTeamMemberOption,
} from '../../data/project-team-member-options';
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
import { isValidDriveUrl } from '../../platform/evidence-helpers';
import {
  createProjectEditorDraft,
  hasInvalidProjectContractPeriod,
  type ProjectEditorDraft,
  type ProjectEditorMode,
} from '../../platform/project-editor';
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
  hasInvalidProjectSettlementSupportMember,
  hasIncompleteProjectTeamMembers,
  hasProjectOperatingManager,
  isProjectSettlementSupportMember,
  normalizeProjectTeamMemberDraftRows,
  parseProjectTeamMemberIdentityInput,
  PROJECT_TEAM_MEMBER_ROLES,
  RETIRED_PROJECT_TEAM_MEMBER_ROLES,
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

type ProjectEditorStep = 'basic' | 'financial' | 'team' | 'review';

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
  requesterId?: string;
  departmentOptions?: string[];
  settlementSystemOptions?: string[];
  topSlot?: ReactNode;
  showCheckoutEntry?: boolean;
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
  documentPreviewUrls?: Partial<Record<ProjectRequestDocumentKind, string>>;
  documentPreviewStates?: Partial<Record<ProjectRequestDocumentKind, {
    status: 'idle' | 'loading' | 'ready' | 'error';
    error?: string;
  }>>;
  onLoadDocumentPreview?: (kind: ProjectRequestDocumentKind) => void | Promise<void>;
  onRemoveProjectDocument?: (kind: ProjectRequestDocumentKind) => void | Promise<void>;
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
  'proposal_word_original',
  'proposal_ppt_original',
  'presentation_ppt_original',
  'rfp_request_evidence',
];
const CHECKOUT_DOCUMENT_KINDS: ProjectRequestDocumentKind[] = [
  'performance_certificate',
  'tax_invoice',
  'final_settlement_report',
];
const PROJECT_DOCUMENT_LABELS: Record<ProjectRequestDocumentKind, string> = {
  contract: '계약서 PDF',
  customer_business_registration: '고객사 사업자등록증 PDF',
  quote: '산출내역서(견적서) PDF',
  proposal: '제안서 PDF',
  proposal_word_original: '제안서 Word 원본',
  proposal_ppt_original: '제안서 PPT 원본',
  presentation_ppt_original: '발표자료 PPT 원본',
  rfp_request_evidence: 'RFP/요청 메일 증빙',
  performance_certificate: '수행확인서 PDF',
  tax_invoice: '세금계산서 PDF',
  final_settlement_report: '최종 정산보고서 PDF',
};
const PROJECT_DOCUMENT_BUTTON_LABELS: Record<ProjectRequestDocumentKind, string> = {
  contract: '계약서',
  customer_business_registration: '사업자등록증',
  quote: '산출내역서(견적서)',
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
type RegistrationDocumentSlot = {
  number: number;
  label: string;
  description: string;
  kinds: ProjectRequestDocumentKind[];
};
const REGISTRATION_DOCUMENT_SLOTS: RegistrationDocumentSlot[] = [
  {
    number: 1,
    label: '계약서 *',
    description: '',
    kinds: ['contract'],
  },
  {
    number: 2,
    label: '고객사 사업자등록증 *',
    description: '',
    kinds: ['customer_business_registration'],
  },
  {
    number: 3,
    label: '산출내역서(견적서) *',
    description: '',
    kinds: ['quote'],
  },
  {
    number: 4,
    label: '제안서(워드)',
    description: '있을 시',
    kinds: ['proposal_word_original'],
  },
  {
    number: 5,
    label: '제안서(구글드라이브 링크)',
    description: '있을 시',
    kinds: ['proposal_ppt_original'],
  },
  {
    number: 6,
    label: '발표자료(구글드라이브 링크)',
    description: '있을 시',
    kinds: ['presentation_ppt_original'],
  },
  {
    number: 7,
    label: 'RFP',
    description: '없으면 사업요청사항을 확인할 수 있는 메일 본문 등 첨부',
    kinds: ['rfp_request_evidence'],
  },
];
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

function normalizeRestoredProjectEditorDraft(draft: ProjectEditorDraft, mode: ProjectEditorMode) {
  return createProjectEditorWizardDraft({
    ...draft,
    ...(mode === 'portal-register' || mode === 'portal-edit'
      ? { registrationRequirementsVersion: 2 as const }
      : {}),
  });
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
  options: ProjectTeamMemberOption[];
  optionMap: Record<string, ProjectTeamMemberOption>;
  selectedNames: Set<string>;
  currentTeamMemberOptionExists: boolean;
  onSelect: (patch: Partial<ProjectTeamMemberAssignment>) => void;
}

function TeamMemberSearchCombobox({
  member,
  options,
  optionMap,
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
    const option = optionMap[value];
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
            <CommandGroup heading={`${options.length}명 중 검색`}>
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
              {options.map((option) => {
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
  requesterId,
  departmentOptions,
  settlementSystemOptions = [],
  topSlot,
  showCheckoutEntry = false,
  actions,
  busyActionId,
  readOnly = false,
  onContractFileUpload,
  onProjectDocumentFileUpload,
  documentPreviewUrls,
  documentPreviewStates,
  onLoadDocumentPreview,
  onRemoveProjectDocument,
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
  const hasRequiredRegistrationDocuments = Boolean(
    draft.contractDocument
    && draft.customerBusinessRegistrationDocument
    && (draft.quoteDocument || draft.quoteSubmissionDeferred),
  );
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
    const isNewEditorSession = lastResetKeyRef.current !== resetKey;
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
    if (isNewEditorSession) setStepIndex(0);
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
    if (uploadInProgress || hasPendingRetryFile) return false;
    if (readOnly || !autosave?.key || autosave.disabled) return false;
    if (mode === 'portal-register' && !hasRequiredRegistrationDocuments) return false;
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
  }, [autosave?.disabled, autosave?.key, autosave?.onSave, draftKey, hasPendingRetryFile, hasRequiredRegistrationDocuments, mode, readOnly, uploadInProgress]);

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
    if (readOnly || !autosave?.key || autosave.disabled || restoreCandidate || uploadInProgress || hasPendingRetryFile) return undefined;
    const isInitialDraft = stepIndex === 0 && JSON.stringify(createProjectEditorDraft(draft)) === initialDraftFingerprint;
    if (isInitialDraft) return undefined;

    const timer = window.setTimeout(() => {
      void persistAutosaveSnapshot(draft, stepIndex);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [autosave?.disabled, autosave?.key, draft, hasPendingRetryFile, initialDraftFingerprint, persistAutosaveSnapshot, readOnly, restoreCandidate, stepIndex, uploadInProgress]);

  const restoreLocalDraft = () => {
    if (!restoreCandidate) return;
    setDraft(normalizeRestoredProjectEditorDraft(restoreCandidate.draft, mode));
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
    if (uploadInProgress || hasPendingRetryFile) {
      toast.error('첨부파일 처리를 완료한 뒤 임시저장해 주세요.');
      return;
    }
    const saved = await persistAutosaveSnapshot(draft, stepIndex);
    if (saved) toast.success('임시저장되었습니다.');
    else toast.error('임시저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  };

  const handleActionSubmit = async (actionId: string) => {
    if (submitInFlightRef.current) return;
    if (uploadInProgress || hasPendingRetryFile) {
      toast.error('첨부파일 처리를 완료한 뒤 최종 저장해 주세요.');
      return;
    }
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
  const hasTotalActualCostInput = financialInputFlags.totalActualCost;
  const hasSupportAmountInput = financialInputFlags.supportAmount;
  const usesRegistrationV2 = draft.registrationRequirementsVersion === 2;
  const hasMultiYearContract = Boolean(
    /^\d{4}-\d{2}-\d{2}$/.test(draft.contractStart)
    && /^\d{4}-\d{2}-\d{2}$/.test(draft.contractEnd)
    && draft.contractStart.slice(0, 4) !== draft.contractEnd.slice(0, 4),
  );
  const settlementDetailsEnabled = usesRegistrationV2 ? draft.basis !== 'NONE' : draft.settlementType !== 'NONE';
  const requiresSettlementConfirmations = usesRegistrationV2 ? draft.basis !== 'NONE' : draft.settlementType !== 'NONE';
  const showProjectCheckout = draft.status === 'COMPLETED' || draft.status === 'COMPLETED_PENDING_PAYMENT';
  const effectivePaymentPlan = hasMultiYearContract
    ? draft.financialYears.reduce((total, row) => ({
      contract: total.contract + (row.paymentPlan?.contract || 0),
      interim: total.interim + (row.paymentPlan?.interim || 0),
      final: total.final + (row.paymentPlan?.final || 0),
    }), { contract: 0, interim: 0, final: 0 })
    : draft.paymentPlan;
  const paymentPlanTotal = effectivePaymentPlan.contract + effectivePaymentPlan.interim + effectivePaymentPlan.final;
  const advanceInterimRatio = draft.contractAmount > 0
    ? (effectivePaymentPlan.contract + effectivePaymentPlan.interim) / draft.contractAmount
    : null;
  const requiresAdvanceInterimReason = paymentPlanTotal > 0
    && advanceInterimRatio !== null
    && advanceInterimRatio < 0.7;
  const profitRateLabel = formatProfitRatePercentInput(draft.profitRate);
  const teamMembersSummary = formatProjectTeamMembersSummary(draft.teamMembersDetailed, '', '\n');
  const projectTypeOptions = getProjectTypeSelectableOptions(draft.type);
  const contractTypeOptions = getProjectContractTypeSelectableOptions(draft.contractType);
  const teamMemberOptions = useMemo(() => buildProjectTeamMemberOptions(members), [members]);
  const teamMemberOptionMap = useMemo(() => Object.fromEntries(
    teamMemberOptions.map((option) => [option.value, option]),
  ) as Record<string, ProjectTeamMemberOption>, [teamMemberOptions]);
  const ownerOptions = useMemo(
    () => [...members]
      .filter((member) => (
        String(member.uid || '').trim()
        && String(member.status || '').trim().toUpperCase() === 'ACTIVE'
      ))
      .sort((left, right) => String(left.name || left.email || left.uid).localeCompare(String(right.name || right.email || right.uid), 'ko')),
    [members],
  );
  const executiveApproverOptions = useMemo(
    () => ownerOptions.filter((member) => (
      member.uid !== draft.registeredById && member.uid !== requesterId
    )),
    [draft.registeredById, requesterId, ownerOptions],
  );
  const selectedOwner = useMemo(
    () => ownerOptions.find((member) => member.uid === draft.registeredById) || null,
    [draft.registeredById, ownerOptions],
  );
  const linkedExecutiveApprover = useMemo(
    () => ownerOptions.find((member) => member.uid === draft.executiveApproverId) || null,
    [draft.executiveApproverId, ownerOptions],
  );
  const selectedExecutiveApprover = useMemo(
    () => executiveApproverOptions.find((member) => member.uid === draft.executiveApproverId) || null,
    [draft.executiveApproverId, executiveApproverOptions],
  );
  const isSelfExecutiveApprover = Boolean(
    draft.executiveApproverId
      && (draft.executiveApproverId === draft.registeredById || draft.executiveApproverId === requesterId),
  );
  const hasUnlinkedStoredOwner = Boolean(draft.registeredById && !selectedOwner);
  const hasUnlinkedStoredExecutiveApprover = Boolean(
    draft.executiveApproverId && !linkedExecutiveApprover,
  );

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

  useEffect(() => {
    if (!draft.executiveApproverId) return;
    const member = members.find((item) => item.uid === draft.executiveApproverId);
    if (!member) return;
    const name = member.name || member.email || member.uid;
    const email = member.email || '';
    if (draft.executiveApproverName === name && draft.executiveApproverEmail === email) return;
    setDraft((prev) => createProjectEditorDraft({
      ...prev,
      executiveApproverId: member.uid,
      executiveApproverName: name,
      executiveApproverEmail: email,
    }));
  }, [draft.executiveApproverEmail, draft.executiveApproverId, draft.executiveApproverName, members]);

  const update = <K extends keyof ProjectEditorDraft>(key: K, value: ProjectEditorDraft[K]) => {
    setDraft((prev) => createProjectEditorWizardDraft({ ...prev, [key]: value }));
  };

  const updateSettlementSystem = (value: string) => {
    setDraft((prev) => createProjectEditorWizardDraft({
      ...prev,
      settlementSystem: (value.startsWith('OTHER:') ? 'OTHER' : value) as SettlementSystemCode,
      settlementSystemOther: value.startsWith('OTHER:') ? value.slice('OTHER:'.length) : '',
    }));
  };

  const updateAmount = (key: 'contractAmount' | 'salesVatAmount' | 'totalRevenueAmount' | 'totalActualCost' | 'supportAmount', rawValue: string) => {
    setDraft((prev) => createProjectEditorWizardDraft({
      ...prev,
      [key]: parseProjectAmountInput(rawValue),
      financialInputFlags: updateFlag(prev.financialInputFlags, key, rawValue),
    }));
  };

  const updateFinancialYear = (
    index: number,
    key: 'contractAmount' | 'salesVatAmount' | 'totalRevenueAmount' | 'totalActualCost' | 'supportAmount' | 'paymentPlan' | 'paymentExpectedMonths' | 'advanceInterimBelow70Reason' | 'isSettled' | 'confirmed',
    value: number | string | boolean | ProjectFinancialYear['paymentPlan'] | ProjectFinancialYear['paymentExpectedMonths'],
  ) => {
    setDraft((prev) => {
      const financialYears = prev.financialYears.map((row, rowIndex) => (
        rowIndex === index ? { ...row, [key]: value } : row
      ));
      const total = (field: 'contractAmount' | 'salesVatAmount' | 'totalRevenueAmount' | 'totalActualCost' | 'supportAmount') => (
        financialYears.reduce((sum, row) => sum + row[field], 0)
      );
      return createProjectEditorWizardDraft({
        ...prev,
        financialYears,
        contractAmount: total('contractAmount'),
        salesVatAmount: total('salesVatAmount'),
        totalRevenueAmount: total('totalRevenueAmount'),
        totalActualCost: total('totalActualCost'),
        supportAmount: total('supportAmount'),
        financialInputFlags: {
          contractAmount: true,
          salesVatAmount: true,
          totalRevenueAmount: true,
          totalActualCost: true,
          supportAmount: true,
        },
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

  const removeProjectDocument = async (kind: ProjectRequestDocumentKind) => {
    setDocumentUploadState((prev) => ({ ...prev, [kind]: 'extracting' }));
    setDocumentUploadError((prev) => ({ ...prev, [kind]: '' }));
    try {
      await onRemoveProjectDocument?.(kind);
      setDraft((prev) => createProjectEditorWizardDraft({
        ...prev,
        ...(kind === 'contract'
          ? {
              contractDocument: initialContractDocument && !contractDocumentEditPolicy.canRemoveExistingContractDocument
                ? initialContractDocument
                : null,
              contractAnalysis: initialContractDocument && !contractDocumentEditPolicy.canRemoveExistingContractDocument
                ? initialContractAnalysis
                : null,
            }
          : { [PROJECT_DOCUMENT_FIELD[kind]]: null }),
      }));
      setDocumentUploadState((prev) => ({ ...prev, [kind]: 'idle' }));
      delete retryDocumentFileRef.current[kind];
      toast.success(`${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 첨부를 제거했습니다.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : `${PROJECT_DOCUMENT_BUTTON_LABELS[kind]} 첨부 제거에 실패했습니다.`;
      setDocumentUploadState((prev) => ({ ...prev, [kind]: 'error' }));
      setDocumentUploadError((prev) => ({ ...prev, [kind]: message }));
      toast.error('첨부 제거 실패', { description: message });
    }
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
      if (!draft.projectPurpose.trim()) issues.push({ step: 'basic', label: '프로젝트 목적' });
      if (!draft.description.trim()) issues.push({ step: 'basic', label: '프로젝트 주요 내용' });
      if (!draft.contractDocument) issues.push({ step: 'financial', label: '계약서 PDF' });
      if (draft.registrationConfirmations.modusignContractUsed === null) issues.push({ step: 'financial', label: '모두 싸인으로 진행하셨나요?' });
      if (draft.registrationConfirmations.modusignContractUsed === false && draft.registrationConfirmations.originalContractSubmitted !== true) {
        issues.push({ step: 'financial', label: '계약서를 써니(사업지원팀)에게 제출했습니다.' });
      }
      if (draft.registrationConfirmations.proposalPptOriginal && !isValidDriveUrl(draft.registrationConfirmations.proposalPptOriginal)) {
        issues.push({ step: 'financial', label: '제안서 구글드라이브 링크' });
      }
      if (draft.registrationConfirmations.presentationPptOriginal && !isValidDriveUrl(draft.registrationConfirmations.presentationPptOriginal)) {
        issues.push({ step: 'financial', label: '발표자료 구글드라이브 링크' });
      }
      if (onProjectDocumentFileUpload) {
        if (!draft.customerBusinessRegistrationDocument) issues.push({ step: 'financial', label: '고객사 사업자등록증 PDF' });
      }
      if (!draft.quoteDocument && !draft.quoteSubmissionDeferred) issues.push({ step: 'financial', label: '산출내역서(견적서) PDF 또는 이후 제출' });
      if (
        draft.contractStart.trim()
        && draft.contractEnd.trim()
        && hasInvalidProjectContractPeriod(draft.contractStart, draft.contractEnd)
      ) {
        issues.push({ step: 'financial', label: '계약 종료일은 시작일 이후여야 합니다.' });
      }
      const startYear = Number(draft.contractStart.slice(0, 4));
      const endYear = Number(draft.contractEnd.slice(0, 4));
      const expectedYears = Number.isSafeInteger(startYear) && Number.isSafeInteger(endYear) && startYear <= endYear
        ? Array.from({ length: endYear - startYear + 1 }, (_, offset) => startYear + offset)
        : [];
      const financialYearsComplete = expectedYears.length > 0
        && draft.financialYears.length === expectedYears.length
        && expectedYears.every((year) => draft.financialYears.some((row) => row.year === year && row.confirmed));
      const annualTotal = (field: 'contractAmount' | 'salesVatAmount' | 'totalRevenueAmount' | 'totalActualCost' | 'supportAmount') => (
        draft.financialYears.reduce((sum, row) => sum + row[field], 0)
      );
      const annualTotalsMatch = annualTotal('contractAmount') === draft.contractAmount
        && annualTotal('salesVatAmount') === draft.salesVatAmount
        && annualTotal('totalRevenueAmount') === draft.totalRevenueAmount
        && annualTotal('totalActualCost') === draft.totalActualCost
        && annualTotal('supportAmount') === draft.supportAmount;
      if (hasMultiYearContract && (!financialYearsComplete || !annualTotalsMatch)) {
        issues.push({ step: 'financial', label: '계약기간 전체 연도별 재무 확인' });
      }
      if (draft.settlementType === 'NONE') issues.push({ step: 'financial', label: '사업유형' });
      if (settlementDetailsEnabled && draft.settlementSystem === 'OTHER') {
        const customSystem = draft.settlementSystemOther.trim();
        if (!customSystem) issues.push({ step: 'financial', label: '기타 정산 시스템 이름' });
        if (customSystem.length > 100) issues.push({ step: 'financial', label: '기타 정산 시스템 이름은 100자 이하여야 합니다.' });
      }
      (!hasMultiYearContract ? ['contract', 'interim', 'final'] as const : []).forEach((field) => {
        if (draft.paymentPlan[field] > 0 && !draft.paymentExpectedMonths[field]) {
          const label = field === 'contract' ? '선금/계약금 입금 예상월' : field === 'interim' ? '중도금 입금 예상월' : '잔금 입금 예상월';
          issues.push({ step: 'financial', label });
        }
      });
      if (hasMultiYearContract) {
        draft.financialYears.forEach((row) => {
          (['contract', 'interim', 'final'] as const).forEach((field) => {
            if ((row.paymentPlan?.[field] || 0) > 0 && !row.paymentExpectedMonths?.[field]) {
              const label = field === 'contract' ? '선금/계약금' : field === 'interim' ? '중도금' : '잔금';
              issues.push({ step: 'financial', label: `${row.year}년 ${label} 예상 입금 시점` });
            }
          });
        });
      }
      const missingAnnualAdvanceInterimReason = hasMultiYearContract && draft.financialYears.some((row) => {
        const paymentPlan = row.paymentPlan || { contract: 0, interim: 0, final: 0 };
        const paymentTotal = paymentPlan.contract + paymentPlan.interim + paymentPlan.final;
        return paymentTotal > 0
          && row.contractAmount > 0
          && (paymentPlan.contract + paymentPlan.interim) / row.contractAmount < 0.7
          && !row.advanceInterimBelow70Reason?.trim();
      });
      if ((!hasMultiYearContract && requiresAdvanceInterimReason && !draft.advanceInterimBelow70Reason.trim()) || missingAnnualAdvanceInterimReason) {
        issues.push({ step: 'financial', label: '선금·중도금 70% 미만 사유' });
      }
    }
    if (showProjectCheckout) {
      if (draft.checkout.performanceCertificateDocumentApplicable && !draft.performanceCertificateDocument) {
        issues.push({ step: 'financial', label: '수행확인서 PDF' });
      }
      if (draft.checkout.taxInvoiceEvidenceConfirmed && !draft.taxInvoiceDocument) {
        issues.push({ step: 'financial', label: '세금계산서 PDF' });
      }
      if (requiresSettlementConfirmations && draft.checkout.finalSettlementReportConfirmed && !draft.finalSettlementReportDocument) {
        issues.push({ step: 'financial', label: '최종 정산보고서 PDF' });
      }
      if (requiresSettlementConfirmations && draft.checkout.evidenceDeletedAfterUsb && !draft.checkout.usbEvidenceSubmitted) {
        issues.push({ step: 'financial', label: 'USB 제출 확인' });
      }
    }
    if (!draft.managerName.trim()) issues.push({ step: 'team', label: 'PM' });
    if (isSelfExecutiveApprover) {
      issues.push({ step: 'team', label: '사업 담당자와 최종 결재자는 달라야 합니다.' });
    } else if (!draft.executiveApproverId || !selectedExecutiveApprover) {
      issues.push({ step: 'team', label: '최종 결재자 지정 (사업총괄)' });
    }
    if (usesRegistrationV2 && hasIncompleteProjectTeamMembers(draft.teamMembersDetailed)) {
      issues.push({ step: 'team', label: '참여인력 이름·역할' });
    }
    if (usesRegistrationV2 && !hasProjectOperatingManager(draft.teamMembersDetailed)) {
      issues.push({ step: 'team', label: '운영매니저 1인 이상' });
    }
    if (usesRegistrationV2 && hasInvalidProjectSettlementSupportMember(draft.teamMembersDetailed)) {
      issues.push({ step: 'team', label: '정산지원은 도담 또는 써니를 선택' });
    }
    return issues;
  }, [departmentOptionSet, draft, hasContractAmountInput, hasMultiYearContract, onProjectDocumentFileUpload, requiresAdvanceInterimReason, requiresSettlementConfirmations, selectedExecutiveApprover, showProjectCheckout, usesRegistrationV2]);

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
          onChange={(event) => update('name', event.target.value)}
          placeholder="예: 26농식품AC"
          className="mt-1 h-9 text-sm"
        />
        <p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted-foreground">
          계약연도+프로젝트명 형식으로 입력해 주세요. 다년도 사업은 같은 연도만 변경된 동일 프로젝트명을 사용해주세요.(재경팀이 부여하는 A_, C_와 같은 코드는 기입하지 않습니다)
        </p>
      </div>

      <div>
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
      </div>

      <div>
        <Label className="text-xs">사업관리 구글폴더링크</Label>
        <Input
          type="url"
          value={draft.businessManagementGoogleFolderLink}
          onChange={(event) => update('businessManagementGoogleFolderLink', event.target.value)}
          placeholder="https://drive.google.com/drive/folders/..."
          className="mt-1 h-9 text-sm"
        />
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          사업관리용 Google Drive 폴더 링크를 입력해 주세요.
        </p>
      </div>

      <div>
        <Label className="text-xs">프로젝트 목적{usesRegistrationV2 ? ' *' : ''}</Label>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          어떤 대상에게 어떤 가치를 제공하는 프로젝트인지 입력
          <span className="block">예: CJ푸드빌 새로운 점포를 만들어갈 사내기업가 육성</span>
        </p>
        <Textarea
          value={draft.projectPurpose}
          onChange={(event) => update('projectPurpose', event.target.value)}
          className="mt-1 min-h-[88px] text-sm"
        />
      </div>
      <div>
        <Label className="text-xs">프로젝트 주요 내용{usesRegistrationV2 ? ' *' : ''}</Label>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          프로젝트 주요 수행 내용, 범위, 산출물 등 프로그램 핵심 내용 요약
          <span className="block">예:</span>
          <span className="block">1. 사업제안서 작성 교육</span>
          <span className="block">2. 사업제안서 작성 - 25개팀 이상 1:1 코칭</span>
          <span className="block">3. 선정된 10개 팀 사업제안 구체화 1:1 컨설팅</span>
        </p>
        <Textarea
          value={draft.description}
          onChange={(event) => update('description', event.target.value)}
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

  const renderProjectDocumentUpload = (
    kind: ProjectRequestDocumentKind,
    options: {
      slotNumber?: number;
      label?: string;
      description?: string;
      embedded?: boolean;
      disabled?: boolean;
    } = {},
  ) => {
    const document = draft[PROJECT_DOCUMENT_FIELD[kind]] as FileAttachment | null;
    const documentDownloadURL = document ? (documentPreviewUrls?.[kind] || document.downloadURL) : '';
    const previewState = documentPreviewStates?.[kind];
    const uploadState = documentUploadState[kind];
    const uploadError = documentUploadError[kind];
    const inputRef = getDocumentInputRef(kind);
    const canRemove = canRemoveProjectDocuments && (kind === 'contract'
      ? contractDocumentEditPolicy.canRemoveCurrentContractDocument
      : Boolean(document));
    const removeLabel = kind === 'contract' ? contractDocumentEditPolicy.removeButtonLabel : '첨부 제거';
    const remove = () => { void removeProjectDocument(kind); };
    const description = options.description ?? (kind === 'contract'
      ? (contractAnalysisMergeMode === 'none'
          ? 'PDF를 올리면 계약서 원문과 검토용 첨부를 저장합니다. 입력값은 자동으로 바꾸지 않습니다.'
          : 'PDF를 올리면 계약명, 계약기간, 계약금액, 계약 대상 후보를 읽어와 빈 항목만 채웁니다.')
      : kind === 'proposal_word_original'
        ? '원본 DOCX를 올립니다. 파일이 없으면 아래에 미첨부 사유 또는 해당 없음을 적어주세요.'
        : kind === 'proposal_ppt_original' || kind === 'presentation_ppt_original'
          ? '원본 PPTX를 올립니다. 파일이 없으면 아래에 미첨부 사유 또는 해당 없음을 적어주세요.'
          : kind === 'rfp_request_evidence'
            ? 'RFP 또는 요청 메일 원본을 PDF, DOCX, EML, MSG 중 하나로 올려주세요.'
            : 'PDF를 올리면 검토용 첨부로 저장합니다.');

    return (
      <div
        key={kind}
        className={cn(
          options.embedded
            ? 'rounded-lg border border-slate-200 bg-white p-3'
            : 'rounded-xl border border-slate-200 bg-slate-50/70 p-4',
        )}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {options.slotNumber ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#001e46] text-[11px] font-semibold text-white">
                  {options.slotNumber}
                </span>
              ) : <FileText className="h-4 w-4 text-slate-600" />}
              <Label className="text-xs font-semibold">{options.label || PROJECT_DOCUMENT_LABELS[kind]}</Label>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {description}
            </p>
            {document ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
                <span className="max-w-full truncate font-medium text-slate-900">{document.name}</span>
                <span className="text-muted-foreground">
                  {(document.size / 1024 / 1024).toFixed(2)} MB
                </span>
                {documentDownloadURL ? (
                  <Button asChild type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px]">
                    <a href={documentDownloadURL} target="_blank" rel="noreferrer">원문 보기</a>
                  </Button>
                ) : document && previewState && onLoadDocumentPreview ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    disabled={previewState.status === 'loading'}
                    onClick={() => void onLoadDocumentPreview(kind)}
                  >
                    {previewState.status === 'loading' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    {previewState.status === 'error' ? '원문 다시 불러오기' : previewState.status === 'loading' ? '불러오는 중' : '원문 불러오기'}
                  </Button>
                ) : null}
                {canRemove ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px] text-rose-600"
                    disabled={uploadState === 'extracting'}
                    onClick={remove}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    {removeLabel}
                  </Button>
                ) : null}
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
            {previewState?.status === 'error' ? (
              <p className="mt-2 text-[11px] text-rose-600" role="alert">
                {previewState.error || '첨부 파일을 불러오지 못했습니다.'}
              </p>
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
              disabled={uploadState === 'extracting' || options.disabled}
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

  const renderRegistrationDocumentSlot = (slot: RegistrationDocumentSlot) => {
    return renderProjectDocumentUpload(slot.kinds[0], {
      slotNumber: slot.number,
      label: slot.label,
      description: slot.description,
    });
  };

  const renderFinancialStep = () => (
    <div className="space-y-4">
      {onContractFileUpload || onProjectDocumentFileUpload ? (
        <div className="space-y-3">
          {usesRegistrationV2 ? (
            <>
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-sm font-semibold text-[#001e46]">등록 제출서류 7종</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  1~2번은 필수, 3번은 첨부 또는 이후 제출로 진행할 수 있으며 4~7번은 선택입니다.
                </p>
              </div>
              {REGISTRATION_DOCUMENT_SLOTS.map((slot) => (
                <Fragment key={slot.number}>
                  {slot.number === 5 || slot.number === 6 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <Label className="text-xs">{slot.number}. {slot.label}</Label>
                      <p className="mt-1 text-[11px] text-muted-foreground">{slot.description}</p>
                      <Input
                        type="url"
                        value={slot.number === 5
                          ? draft.registrationConfirmations.proposalPptOriginal
                          : draft.registrationConfirmations.presentationPptOriginal}
                        onChange={(event) => update('registrationConfirmations', {
                          ...draft.registrationConfirmations,
                          [slot.number === 5 ? 'proposalPptOriginal' : 'presentationPptOriginal']: event.target.value,
                        })}
                        placeholder="https://drive.google.com/..."
                        className="mt-2 h-9 text-sm"
                      />
                    </div>
                  ) : slot.number === 1 || onProjectDocumentFileUpload ? renderRegistrationDocumentSlot(slot) : null}
                  {slot.number === 1 ? (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700">
                      <p className="mb-2 font-medium">모두 싸인으로 진행하셨나요? *</p>
                      <div className="flex gap-4">
                        {[true, false].map((value) => (
                          <label key={String(value)} className="flex items-center gap-2">
                            <input type="radio" checked={draft.registrationConfirmations.modusignContractUsed === value} onChange={() => update('registrationConfirmations', { ...draft.registrationConfirmations, modusignContractUsed: value, originalContractSubmitted: value ? null : draft.registrationConfirmations.originalContractSubmitted })} />
                            {value ? '예' : '아니오'}
                          </label>
                        ))}
                      </div>
                      {draft.registrationConfirmations.modusignContractUsed === false ? (
                        <label className="mt-3 flex items-center gap-2">
                          <Checkbox checked={draft.registrationConfirmations.originalContractSubmitted === true} onCheckedChange={(checked) => update('registrationConfirmations', { ...draft.registrationConfirmations, originalContractSubmitted: checked === true })} />
                          계약서를 써니(사업지원팀)에게 제출했습니다.
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                  {slot.number === 3 ? (
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700">
                      <Checkbox checked={draft.quoteSubmissionDeferred} onCheckedChange={(checked) => update('quoteSubmissionDeferred', checked === true)} />
                      산출내역서(견적서) 이후 제출(예외 처리)
                    </label>
                  ) : null}
                </Fragment>
              ))}
            </>
          ) : registrationDocumentKinds.map((kind) => renderProjectDocumentUpload(kind))}
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
            readOnly={usesRegistrationV2 && hasMultiYearContract}
            placeholder="0"
            className={cn('mt-1 h-9 text-sm', usesRegistrationV2 && hasMultiYearContract && 'bg-muted/40')}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {hasContractAmountInput ? `${PROJECT_CURRENCY_LABELS[draft.currency]} ${fmtKRW(draft.contractAmount)}` : '미입력'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div>
          <Label className="text-xs">총매출부가세</Label>
          <Input
            inputMode="numeric"
            value={formatProjectAmountInput(draft.salesVatAmount, hasSalesVatAmountInput)}
            onChange={(event) => updateAmount('salesVatAmount', event.target.value)}
            readOnly={usesRegistrationV2 && hasMultiYearContract}
            placeholder="0"
            className={cn('mt-1 h-9 text-sm', usesRegistrationV2 && hasMultiYearContract && 'bg-muted/40')}
          />
        </div>
        <div>
          <Label className="text-xs">총수익</Label>
          <Input
            inputMode="numeric"
            value={formatProjectAmountInput(draft.totalRevenueAmount, hasTotalRevenueAmountInput)}
            onChange={(event) => updateAmount('totalRevenueAmount', event.target.value)}
            readOnly={usesRegistrationV2 && hasMultiYearContract}
            placeholder="0"
            className={cn('mt-1 h-9 text-sm', usesRegistrationV2 && hasMultiYearContract && 'bg-muted/40')}
          />
        </div>
        <div>
          <Label className="text-xs">총실비(원가)</Label>
          <Input
            inputMode="numeric"
            value={formatProjectAmountInput(draft.totalActualCost, hasTotalActualCostInput)}
            onChange={(event) => updateAmount('totalActualCost', event.target.value)}
            readOnly={usesRegistrationV2 && hasMultiYearContract}
            placeholder="0"
            className={cn('mt-1 h-9 text-sm', usesRegistrationV2 && hasMultiYearContract && 'bg-muted/40')}
          />
        </div>
        <div>
          <Label className="text-xs">총지원금</Label>
          <Input
            inputMode="numeric"
            value={formatProjectAmountInput(draft.supportAmount, hasSupportAmountInput)}
            onChange={(event) => updateAmount('supportAmount', event.target.value)}
            readOnly={usesRegistrationV2 && hasMultiYearContract}
            placeholder="0"
            className={cn('mt-1 h-9 text-sm', usesRegistrationV2 && hasMultiYearContract && 'bg-muted/40')}
          />
        </div>
        <div>
          <Label className="text-xs">총수익률</Label>
          <Input value={profitRateLabel ? `${profitRateLabel}%` : '-'} readOnly className="mt-1 h-9 bg-muted/40 text-sm" />
          <p className="mt-1 text-[10px] text-muted-foreground">
            총수익 / 계약금액 기준 자동 계산
          </p>
        </div>
      </div>

      {usesRegistrationV2 && hasMultiYearContract ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div>
            <Label className="text-xs font-semibold">연도별 계약·재무 *</Label>
            <p className="mt-1 text-[11px] text-muted-foreground">
              다년도 사업은 계약기간의 모든 연도를 각각 입력하고 확인해야 하며, 위 합계는 연도별 입력값으로 자동 계산됩니다.
            </p>
          </div>
          {draft.financialYears.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-[12px] text-muted-foreground">
              계약 시작일과 종료일을 먼저 입력해 주세요.
            </p>
          ) : draft.financialYears.map((row, index) => (
            <div key={row.year} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-3 text-sm font-semibold text-slate-900">{row.year}년</div>
              <div className="grid gap-3 lg:grid-cols-6">
                {([
                  ['contractAmount', '계약금액'],
                  ['salesVatAmount', '매출 부가세'],
                  ['totalRevenueAmount', '수익'],
                  ['totalActualCost', '실비(원가)'],
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
                    value={`${(row.profitRate * 100).toFixed(2)}%`}
                    readOnly
                    className="mt-1 h-9 bg-muted/40 text-sm"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    연도별 계약금액과 총수익으로 자동 계산
                  </p>
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-[12px] text-slate-700">
                <Checkbox
                  checked={row.confirmed}
                  onCheckedChange={(checked) => updateFinancialYear(index, 'confirmed', checked === true)}
                />
                {row.year}년 금액을 계약서와 대조하여 확인했습니다.
              </label>
              <div className="mt-4 border-t border-slate-200 pt-4">
                {renderPaymentFields(row, index)}
              </div>
            </div>
          ))}
          <div>
            <Label className="text-xs">기타 메모</Label>
            <Textarea value={draft.paymentPlanDesc} onChange={(event) => update('paymentPlanDesc', event.target.value)} className="mt-1 min-h-[92px] bg-white text-sm" />
          </div>
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
          <Label className="text-xs">{usesRegistrationV2 ? '사업유형' : '정산 유형'}</Label>
          <Select
            value={usesRegistrationV2 && draft.settlementType === 'NONE' ? undefined : draft.settlementType}
            onValueChange={(value) => update('settlementType', value as SettlementType)}
          >
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder={usesRegistrationV2 ? '사업유형 선택' : '정산 유형 선택'} /></SelectTrigger>
            <SelectContent>
              {(Object.entries(SETTLEMENT_TYPE_LABELS) as [SettlementType, string][]).filter(([key]) => !usesRegistrationV2 || key !== 'NONE').map(([key, value]) => (
                <SelectItem key={key} value={key}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {usesRegistrationV2 ? (
          <div>
            <Label className="text-xs">정산 기준</Label>
            <Select value={draft.basis} onValueChange={(value) => update('basis', value as Basis)}>
              <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.entries(BASIS_LABELS) as [Basis, string][]).filter(([key]) => usesRegistrationV2 ? key !== '기타' : key !== 'NONE').map(([key]) => (
                  <SelectItem key={key} value={key}>{REGISTRATION_V2_BASIS_LABELS[key as Exclude<Basis, '기타'>]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : draft.settlementType === 'NONE' ? (
          <div className="lg:col-span-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-[12px] text-muted-foreground">
            정산 없음은 정산 기준·통장·정산 시스템 입력이 필요하지 않습니다.
          </div>
        ) : (
          <div>
            <Label className="text-xs">정산 기준</Label>
            <Select value={draft.basis === 'NONE' ? undefined : draft.basis} onValueChange={(value) => update('basis', value as Basis)}>
              <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="정산 기준 선택" /></SelectTrigger>
              <SelectContent>
                {(Object.entries(BASIS_LABELS) as [Basis, string][]).filter(([key]) => usesRegistrationV2 ? key !== '기타' : key !== 'NONE').map(([key, value]) => (
                  <SelectItem key={key} value={key}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {settlementDetailsEnabled ? (
          <>
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
              <Label className="text-xs">이자 반납 여부</Label>
              <Select value={draft.interestRefundPolicy || undefined} onValueChange={(value) => update('interestRefundPolicy', value as InterestRefundPolicy)}>
                <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="이자 반납 여부 선택" /></SelectTrigger>
                <SelectContent>
                  {(Object.entries(INTEREST_REFUND_POLICY_LABELS) as [InterestRefundPolicy, string][]).map(([key, value]) => (
                    <SelectItem key={key} value={key}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : usesRegistrationV2 ? (
          <div className="lg:col-span-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-[12px] text-muted-foreground">
            정산 기준이 정산없음이면 통장·정산 시스템 입력이 필요하지 않습니다.
          </div>
        ) : null}
      </div>

      {settlementDetailsEnabled ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <Label className="text-xs">정산 시스템</Label>
            <Select
              value={draft.settlementSystem === 'OTHER' && draft.settlementSystemOther.trim() ? `OTHER:${draft.settlementSystemOther.trim()}` : draft.settlementSystem}
              onValueChange={updateSettlementSystem}
            >
              <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[
                  ...PROJECT_SETTLEMENT_SYSTEM_CODES,
                  ...(PROJECT_SETTLEMENT_SYSTEM_CODES.includes(draft.settlementSystem) ? [] : [draft.settlementSystem]),
                ].map((key) => (
                  <SelectItem key={key} value={key}>{SETTLEMENT_SYSTEM_LABELS[key]}</SelectItem>
                ))}
                {[...settlementSystemOptions, draft.settlementSystemOther]
                  .map((value) => value.replace(/\s+/g, ' ').trim())
                  .filter((value, index, values) => value && values.findIndex((candidate) => candidate.toLocaleLowerCase('ko-KR') === value.toLocaleLowerCase('ko-KR')) === index)
                  .map((value) => (
                  <SelectItem key={`OTHER:${value}`} value={`OTHER:${value}`}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.settlementSystem === 'OTHER' ? (
              <Input
                value={draft.settlementSystemOther}
                onChange={(event) => update('settlementSystemOther', event.target.value)}
                placeholder="정산 시스템 이름 직접 입력"
                aria-label="기타 정산 시스템 이름"
                className="mt-2 h-9 text-sm"
              />
            ) : null}
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
      ) : null}
      {!hasMultiYearContract ? renderPaymentFields() : null}
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
        <div>
          <Label className="text-xs">최종 결재자 지정 (사업총괄) *</Label>
          <Select value={selectedExecutiveApprover?.uid} onValueChange={(value) => {
            const member = executiveApproverOptions.find((item) => item.uid === value);
            if (!member) return;
            setDraft((prev) => createProjectEditorDraft({
              ...prev,
              executiveApproverId: member.uid,
              executiveApproverName: member.name || member.email || member.uid,
              executiveApproverEmail: member.email || '',
            }));
          }} disabled={executiveApproverOptions.length === 0}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="구성원 원장에서 선택" /></SelectTrigger>
            <SelectContent>
              {executiveApproverOptions.map((member) => (
                <SelectItem key={member.uid} value={member.uid}>
                  {member.email ? `${member.name || member.uid} (${member.email})` : (member.name || member.uid)}
                </SelectItem>
              ))}
              {executiveApproverOptions.length === 0 ? (
                <SelectItem value="__no_org_members__" disabled>구성원 원장을 불러오는 중입니다</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            선택한 구성원이 조직장 승인 결재선의 대기 결재자로 표시됩니다.
          </p>
          {isSelfExecutiveApprover ? (
            <p className="mt-1 text-[11px] text-red-700">
              사업 담당자와 최종 결재자는 달라야 합니다.
            </p>
          ) : hasUnlinkedStoredExecutiveApprover ? (
            <p className="mt-1 text-[11px] text-red-700">
              현재 저장된 결재자 값이 구성원 원장에 없습니다. 원장에서 다시 선택해야 저장 후 연결됩니다.
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-xs">참여인력 (서류상·실제)</Label>
          <p className="mt-1 text-[10px] text-muted-foreground">계약·협약서에 남길 참여인력과 역할을 저장합니다.</p>
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
            const availableTeamMemberOptions = member.role === '정산지원'
              ? teamMemberOptions.filter((option) => isProjectSettlementSupportMember({
                memberName: option.name,
                memberNickname: option.nickname,
              }))
              : teamMemberOptions;
            const availableTeamMemberOptionMap = member.role === '정산지원'
              ? Object.fromEntries(availableTeamMemberOptions.map((option) => [option.value, option])) as Record<string, ProjectTeamMemberOption>
              : teamMemberOptionMap;
            const currentTeamMemberOptionExists = !member.memberName
              || availableTeamMemberOptions.some((option) => option.value === member.memberName);
            return (
              <div key={`team-member-${index}`} className="rounded-xl border border-border/60 bg-background/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold">팀원 {index + 1}</div>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-rose-600" onClick={() => removeTeamMember(index)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
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
                        options={availableTeamMemberOptions}
                        optionMap={availableTeamMemberOptionMap}
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
                        {RETIRED_PROJECT_TEAM_MEMBER_ROLES.includes(member.role as typeof RETIRED_PROJECT_TEAM_MEMBER_ROLES[number]) ? (
                          <SelectItem value={member.role} disabled>{member.role} (기존값 · 선택 불가)</SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                    {member.role === '정산지원' && !isProjectSettlementSupportMember(member) ? (
                      <p className="mt-1 text-[10px] text-red-700">정산지원은 도담 또는 써니를 선택해 주세요.</p>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );

  const renderPaymentFields = (financialYear?: ProjectFinancialYear, financialYearIndex?: number) => {
    const paymentPlan = financialYear?.paymentPlan || draft.paymentPlan;
    const updatePaymentPlan = (field: keyof typeof paymentPlan, value: number) => {
      if (financialYear && financialYearIndex !== undefined) {
        updateFinancialYear(financialYearIndex, 'paymentPlan', { ...paymentPlan, [field]: value });
      } else {
        update('paymentPlan', { ...paymentPlan, [field]: value });
      }
    };
    const paymentExpectedMonths = financialYear?.paymentExpectedMonths || draft.paymentExpectedMonths;
    const updatePaymentExpectedMonth = (field: keyof ProjectPaymentExpectedMonths, value: string) => {
      if (financialYear && financialYearIndex !== undefined) {
        updateFinancialYear(financialYearIndex, 'paymentExpectedMonths', { ...paymentExpectedMonths, [field]: value });
      } else {
        update('paymentExpectedMonths', { ...paymentExpectedMonths, [field]: value });
      }
    };
    const yearAdvanceInterimRatio = financialYear && financialYear.contractAmount > 0
      ? (paymentPlan.contract + paymentPlan.interim) / financialYear.contractAmount
      : null;
    const requiresYearAdvanceInterimReason = financialYear
      && paymentPlan.contract + paymentPlan.interim + paymentPlan.final > 0
      && yearAdvanceInterimRatio !== null
      && yearAdvanceInterimRatio < 0.7;
    return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <Label className="text-xs">선금/계약금 (원)</Label>
          <Input value={formatProjectAmountInput(paymentPlan.contract, true)} onChange={(event) => updatePaymentPlan('contract', parseProjectAmountInput(event.target.value))} className="mt-1 h-9 text-sm" />
          <p className="mt-1 text-[10px] text-muted-foreground">{formatPaymentPlanAmount(paymentPlan.contract, financialYear?.contractAmount || draft.contractAmount)}</p>
          <Label className="mt-3 block text-xs">예상 입금 시점{paymentPlan.contract > 0 ? ' *' : ''}</Label><Input type="month" aria-label={`${financialYear ? `${financialYear.year}년 ` : ''}선금/계약금 예상 입금 시점`} aria-required={paymentPlan.contract > 0} value={paymentExpectedMonths.contract} onChange={(event) => updatePaymentExpectedMonth('contract', event.target.value)} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">중도금 (원)</Label>
          <Input value={formatProjectAmountInput(paymentPlan.interim, true)} onChange={(event) => updatePaymentPlan('interim', parseProjectAmountInput(event.target.value))} className="mt-1 h-9 text-sm" />
          <p className="mt-1 text-[10px] text-muted-foreground">{formatPaymentPlanAmount(paymentPlan.interim, financialYear?.contractAmount || draft.contractAmount)}</p>
          <Label className="mt-3 block text-xs">예상 입금 시점{paymentPlan.interim > 0 ? ' *' : ''}</Label><Input type="month" aria-label={`${financialYear ? `${financialYear.year}년 ` : ''}중도금 예상 입금 시점`} aria-required={paymentPlan.interim > 0} value={paymentExpectedMonths.interim} onChange={(event) => updatePaymentExpectedMonth('interim', event.target.value)} className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">잔금 (원)</Label>
          <Input value={formatProjectAmountInput(paymentPlan.final, true)} onChange={(event) => updatePaymentPlan('final', parseProjectAmountInput(event.target.value))} className="mt-1 h-9 text-sm" />
          <p className="mt-1 text-[10px] text-muted-foreground">{formatPaymentPlanAmount(paymentPlan.final, financialYear?.contractAmount || draft.contractAmount)}</p>
          <Label className="mt-3 block text-xs">예상 입금 시점{paymentPlan.final > 0 ? ' *' : ''}</Label><Input type="month" aria-label={`${financialYear ? `${financialYear.year}년 ` : ''}잔금 예상 입금 시점`} aria-required={paymentPlan.final > 0} value={paymentExpectedMonths.final} onChange={(event) => updatePaymentExpectedMonth('final', event.target.value)} className="mt-1 h-9 text-sm" />
        </div>
      </div>
      {financialYear ? (
        <div>
          <label className="flex items-center gap-2 text-[12px] text-slate-700">
            <Checkbox checked={financialYear.isSettled === true} onCheckedChange={(checked) => updateFinancialYear(financialYearIndex!, 'isSettled', checked === true)} />
            {financialYear.year}년 계약/재무 정산 완료
          </label>
          <p className="ml-6 mt-1 text-[11px] text-muted-foreground">해당 연도의 계약금 수납과 정산 업무가 모두 끝났음을 표시합니다. 현금흐름 월결산과는 별개입니다.</p>
        </div>
      ) : null}
      {requiresYearAdvanceInterimReason ? (
        <div>
          <Label className="text-xs">{financialYear.year}년 선금·중도금 합계 70% 미만 사유 *</Label>
          <Textarea
            value={financialYear.advanceInterimBelow70Reason || ''}
            onChange={(event) => updateFinancialYear(financialYearIndex!, 'advanceInterimBelow70Reason', event.target.value)}
            placeholder="고객사 지급 조건 등 70% 미만인 이유를 입력"
            className="mt-1 min-h-[72px] text-sm"
          />
        </div>
      ) : null}
      {!financialYear && advanceInterimRatio !== null && paymentPlanTotal > 0 ? (
        <div className={`rounded-lg border px-3 py-2 text-[12px] ${requiresAdvanceInterimReason ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
          선금+중도금 비율 {(advanceInterimRatio * 100).toFixed(1)}%
        </div>
      ) : null}
      {!financialYear && requiresAdvanceInterimReason ? (
        <div>
          <Label className="text-xs">선금·중도금 합계 70% 미만 사유 *</Label>
          <Textarea
            value={draft.advanceInterimBelow70Reason}
            onChange={(event) => update('advanceInterimBelow70Reason', event.target.value)}
            placeholder="고객사 지급 조건 등 70% 미만인 이유를 입력"
            className="mt-1 min-h-[72px] text-sm"
          />
        </div>
      ) : null}
      {!financialYear ? <div>
        <Label className="text-xs">기타 메모</Label>
        <Textarea
          value={draft.paymentPlanDesc}
          onChange={(event) => update('paymentPlanDesc', event.target.value)}
          placeholder="예: 검수 완료 후 세금계산서 발행, 발행일로부터 14일 이내 입금"
          className="mt-1 min-h-[92px] text-sm"
        />
      </div> : null}
      {showProjectCheckout ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div>
            <Label className="text-xs font-semibold">종료사업 체크아웃</Label>
            <p className="mt-1 text-[11px] text-muted-foreground">완료 프로젝트의 입금·잔액·증빙·USB 인계를 확인합니다.</p>
          </div>
          {([
            ['finalPaymentReceived', '최종 잔금 입금을 확인했습니다.'],
            ['bankBalanceZero', '프로젝트 계좌 잔액을 0원으로 정리했습니다.'],
            ['performanceCertificateReceived', '실적증명 원본 5부 이상을 제출했거나 전자 플랫폼 업로드를 완료했습니다.'],
            ['taxInvoiceEvidenceConfirmed', '발행된 세금계산서가 있어 전체 PDF를 첨부해야 합니다.'],
            ...(requiresSettlementConfirmations
              ? [['finalSettlementReportConfirmed', '회계사 최종 정산보고서가 있어 PDF를 첨부해야 합니다.'] as const]
              : []),
          ] as const).map(([field, label]) => (
            <label key={field} className="flex items-center gap-2 text-[12px] text-slate-700">
              <Checkbox
                checked={draft.checkout[field]}
                onCheckedChange={(checked) => update('checkout', { ...draft.checkout, [field]: checked === true })}
              />
              {label}
            </label>
          ))}
          <label className="flex items-center gap-2 text-[12px] text-slate-700">
            <Checkbox
              checked={draft.checkout.performanceCertificateDocumentApplicable === true}
              onCheckedChange={(checked) => update('checkout', {
                ...draft.checkout,
                performanceCertificateDocumentApplicable: checked === true,
              })}
            />
            고객사가 발급한 실적증명 PDF가 있어 첨부해야 합니다.
          </label>
          {onProjectDocumentFileUpload ? (
            <div className="space-y-3 pt-1">
              {checkoutDocumentKinds.map((kind) => renderProjectDocumentUpload(kind))}
            </div>
          ) : null}
          {requiresSettlementConfirmations ? (
            <>
              <label className="flex items-center gap-2 text-[12px] text-slate-700">
                <Checkbox
                  checked={draft.checkout.usbEvidenceSubmitted}
                  onCheckedChange={(checked) => update('checkout', {
                    ...draft.checkout,
                    usbEvidenceSubmitted: checked === true,
                    evidenceDeletedAfterUsb: checked === true ? draft.checkout.evidenceDeletedAfterUsb : false,
                  })}
                />
                정산 종료 후 모든 정산 자료를 USB에 저장해 재무팀에 제출했습니다.
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
                사용 내역은 유지하고 증빙 파일을 삭제했습니다.
              </label>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
    );
  };

  const registrationDocumentReviewItems = [
    { number: 1, label: '계약서', value: draft.contractDocument?.name || '미첨부' },
    { number: 2, label: '고객사 사업자등록증', value: draft.customerBusinessRegistrationDocument?.name || '미첨부' },
    { number: 3, label: '산출내역서(견적서)', value: draft.quoteDocument?.name || (draft.quoteSubmissionDeferred ? '이후 제출(예외 처리)' : '미첨부') },
    {
      number: 4,
      label: '제안서(워드)',
      value: draft.proposalWordOriginalDocument?.name || '미첨부',
    },
    {
      number: 5,
      label: '제안서(구글드라이브 링크)',
      value: draft.registrationConfirmations.proposalPptOriginal || draft.proposalPptOriginalDocument?.name || '미입력',
    },
    {
      number: 6,
      label: '발표자료(구글드라이브 링크)',
      value: draft.registrationConfirmations.presentationPptOriginal || draft.presentationPptOriginalDocument?.name || '미입력',
    },
    { number: 7, label: 'RFP', value: draft.rfpRequestEvidenceDocument?.name || '미첨부' },
  ];

  const ReviewRow = ({ label, value, stacked = false }: { label: string; value: ReactNode; stacked?: boolean }) => (
    <div className={cn(
      'border-b border-border/50 last:border-0',
      stacked ? 'py-3' : 'flex items-start justify-between gap-3 py-2',
    )}>
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div className={cn(
        'whitespace-pre-line text-[12px] font-medium text-slate-900',
        stacked ? 'mt-2 w-full text-left' : 'text-right',
      )}>
        {value || '-'}
      </div>
    </div>
  );

  const renderReviewStep = () => (
    <div className="space-y-4">
      {submitIssues.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-[12px] text-red-700">
          제출 전 {submitIssues.map((issue) => issue.label).join(', ')} 입력이 필요합니다.
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card className="shadow-none lg:col-start-1 lg:row-start-1 lg:self-start">
          <CardHeader className="pb-2"><CardTitle className="text-sm">기본 정보</CardTitle></CardHeader>
          <CardContent>
            <ReviewRow label="담당조직(CIC)" value={draft.department} />
            <ReviewRow label="공식 계약명" value={draft.officialContractName} />
            <ReviewRow label="프로젝트명" value={draft.name} />
            <ReviewRow label="프로젝트 유형" value={PROJECT_TYPE_LABELS[draft.type]} />
            <ReviewRow label="계약서 유형" value={normalizeProjectContractType(draft.contractType)} />
            <ReviewRow label="계약 대상" value={draft.clientOrg} />
            <ReviewRow label="사업관리 구글폴더링크" value={draft.businessManagementGoogleFolderLink} />
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
        <Card className="shadow-none lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start">
          <CardHeader className="pb-2"><CardTitle className="text-sm">계약/재무</CardTitle></CardHeader>
          <CardContent>
            <ReviewRow label="기간" value={`${draft.contractStart || '-'} ~ ${draft.contractEnd || '-'}`} />
            <ReviewRow label="통화" value={PROJECT_CURRENCY_LABELS[draft.currency]} />
            <ReviewRow label="계약금액" value={formatStoredProjectAmount(draft.contractAmount, financialInputFlags.contractAmount)} />
            <ReviewRow label="총매출부가세" value={formatStoredProjectAmount(draft.salesVatAmount, financialInputFlags.salesVatAmount)} />
            <ReviewRow label="총수익" value={formatStoredProjectAmount(draft.totalRevenueAmount, financialInputFlags.totalRevenueAmount)} />
            <ReviewRow label="총실비(원가)" value={formatStoredProjectAmount(draft.totalActualCost, financialInputFlags.totalActualCost)} />
            <ReviewRow label="총지원금" value={formatStoredProjectAmount(draft.supportAmount, financialInputFlags.supportAmount)} />
            <ReviewRow label="총수익률" value={profitRateLabel ? `${profitRateLabel}%` : '-'} />
            <ReviewRow label={usesRegistrationV2 ? '사업유형' : '정산 유형'} value={SETTLEMENT_TYPE_LABELS[draft.settlementType]} />
            {usesRegistrationV2 && hasMultiYearContract ? (
              <ReviewRow label="정산 기준" value={REGISTRATION_V2_BASIS_LABELS[draft.basis as Exclude<Basis, '기타'>]} />
            ) : settlementDetailsEnabled ? (
              <ReviewRow label="정산 기준" value={draft.basis === 'NONE' ? '-' : BASIS_LABELS[draft.basis]} />
            ) : null}
            {settlementDetailsEnabled ? (
              <>
                <ReviewRow label="통장 유형" value={ACCOUNT_TYPE_LABELS[draft.accountType]} />
                <ReviewRow label="이자 반납 여부" value={draft.interestRefundPolicy ? INTEREST_REFUND_POLICY_LABELS[draft.interestRefundPolicy] : '-'} />
                <ReviewRow label="정산 시스템" value={draft.settlementSystem === 'OTHER' ? draft.settlementSystemOther : SETTLEMENT_SYSTEM_LABELS[draft.settlementSystem]} />
                <ReviewRow label="인건비 정산 기준" value={LABOR_SETTLEMENT_BASIS_LABELS[draft.laborSettlementBasis]} />
              </>
            ) : null}
            {usesRegistrationV2 ? (
              <>
                <ReviewRow
                  label="연도별 재무"
                  value={draft.financialYears.map((row) => (
                    `${row.year}년 계약 ${fmtKRW(row.contractAmount)}원 · 매출VAT ${fmtKRW(row.salesVatAmount)}원 · 총수익 ${fmtKRW(row.totalRevenueAmount)}원 · 총실비 ${fmtKRW(row.totalActualCost)}원 · 지원금 ${fmtKRW(row.supportAmount)}원 · 선금 ${fmtKRW(row.paymentPlan?.contract || 0)}원 (${row.paymentExpectedMonths?.contract || '-'}) · 중도금 ${fmtKRW(row.paymentPlan?.interim || 0)}원 (${row.paymentExpectedMonths?.interim || '-'}) · 잔금 ${fmtKRW(row.paymentPlan?.final || 0)}원 (${row.paymentExpectedMonths?.final || '-'}) · 정산 ${row.isSettled ? '완료' : '미완료'}${row.advanceInterimBelow70Reason ? ` · 70% 미만 사유 ${row.advanceInterimBelow70Reason}` : ''} · 수익률 ${(row.profitRate * 100).toFixed(2)}%${row.confirmed ? ' · 확인' : ' · 미확인'}`
                  )).join('\n')}
                />
                <ReviewRow
                  label="등록 제출서류 7종"
                  stacked
                  value={(
                    <div className="grid gap-1.5 text-left">
                      {registrationDocumentReviewItems.map((item) => (
                        <div
                          key={item.number}
                          className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2 rounded-md bg-slate-50 px-2.5 py-2"
                        >
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-[#001e46] text-[10px] font-semibold text-white">
                            {item.number}
                          </span>
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-slate-700">{item.label}</p>
                            <p className="mt-0.5 break-words text-[12px] text-slate-950">{item.value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                />
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card className="shadow-none lg:col-start-1 lg:row-start-2 lg:self-start">
          <CardHeader className="pb-2"><CardTitle className="text-sm">팀/인력</CardTitle></CardHeader>
          <CardContent>
            <ReviewRow label="PM" value={draft.managerName} />
            <ReviewRow label="담당자 계정" value={draft.managerId || '-'} />
            <ReviewRow label="최종 결재자 지정 (사업총괄)" value={draft.executiveApproverName} />
            <ReviewRow label="참여인력 (서류상·실제)" value={teamMembersSummary} />
          </CardContent>
        </Card>
        <Card className="shadow-none lg:col-start-1 lg:row-start-3 lg:self-start">
          <CardHeader className="pb-2"><CardTitle className="text-sm">계약/재무 입금 계획</CardTitle></CardHeader>
          <CardContent>
            <ReviewRow label="선금/계약금" value={formatPaymentPlanAmount(effectivePaymentPlan.contract, draft.contractAmount)} />
            {!hasMultiYearContract ? <ReviewRow label="선금/계약금 예상월" value={draft.paymentExpectedMonths.contract} /> : null}
            <ReviewRow label="중도금" value={formatPaymentPlanAmount(effectivePaymentPlan.interim, draft.contractAmount)} />
            {!hasMultiYearContract ? <ReviewRow label="중도금 예상월" value={draft.paymentExpectedMonths.interim} /> : null}
            <ReviewRow label="잔금" value={formatPaymentPlanAmount(effectivePaymentPlan.final, draft.contractAmount)} />
            {!hasMultiYearContract ? <ReviewRow label="잔금 예상월" value={draft.paymentExpectedMonths.final} /> : null}
            <ReviewRow label="선금+중도금 비율" value={advanceInterimRatio === null ? '-' : `${(advanceInterimRatio * 100).toFixed(1)}%`} />
            {requiresAdvanceInterimReason ? <ReviewRow label="70% 미만 사유" value={draft.advanceInterimBelow70Reason} /> : null}
            <ReviewRow label="기타 메모" value={draft.paymentPlanDesc} />
            {showProjectCheckout ? (
              <ReviewRow
                label="종료사업 체크아웃"
                value={`${[
                  draft.checkout.finalPaymentReceived,
                  draft.checkout.bankBalanceZero,
                  draft.checkout.performanceCertificateReceived,
                  draft.checkout.taxInvoiceEvidenceConfirmed,
                  draft.checkout.finalSettlementReportConfirmed,
                  draft.checkout.usbEvidenceSubmitted,
                  draft.checkout.evidenceDeletedAfterUsb,
                ].filter(Boolean).length}/7 확인`}
              />
            ) : null}
          </CardContent>
        </Card>
        {draft.contractDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={{
                ...draft.contractDocument,
                downloadURL: documentPreviewUrls?.contract || draft.contractDocument.downloadURL,
              }}
              privateDraftAttachment={Boolean(documentPreviewStates?.contract) && !(documentPreviewUrls?.contract || draft.contractDocument.downloadURL)}
              previewState={documentPreviewStates?.contract}
              onLoadPreview={onLoadDocumentPreview ? () => onLoadDocumentPreview('contract') : undefined}
              title="계약서 원문"
              description="등록하려는 계약서가 맞는지 꼭 확인해주세요!"
              descriptionClassName="text-rose-600"
            />
          </div>
        ) : null}
        {draft.quoteDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={{
                ...draft.quoteDocument,
                downloadURL: documentPreviewUrls?.quote || draft.quoteDocument.downloadURL,
              }}
              privateDraftAttachment={Boolean(documentPreviewStates?.quote) && !(documentPreviewUrls?.quote || draft.quoteDocument.downloadURL)}
              previewState={documentPreviewStates?.quote}
              onLoadPreview={onLoadDocumentPreview ? () => onLoadDocumentPreview('quote') : undefined}
              title="견적서 원문"
              description="첨부한 견적서가 맞는지 확인해주세요."
            />
          </div>
        ) : null}
        {draft.proposalDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={{
                ...draft.proposalDocument,
                downloadURL: documentPreviewUrls?.proposal || draft.proposalDocument.downloadURL,
              }}
              privateDraftAttachment={Boolean(documentPreviewStates?.proposal) && !(documentPreviewUrls?.proposal || draft.proposalDocument.downloadURL)}
              previewState={documentPreviewStates?.proposal}
              onLoadPreview={onLoadDocumentPreview ? () => onLoadDocumentPreview('proposal') : undefined}
              title="제안서 원문"
              description="첨부한 제안서가 맞는지 확인해주세요."
            />
          </div>
        ) : null}
        {draft.rfpRequestEvidenceDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={{
                ...draft.rfpRequestEvidenceDocument,
                downloadURL: documentPreviewUrls?.rfp_request_evidence || draft.rfpRequestEvidenceDocument.downloadURL,
              }}
              privateDraftAttachment={Boolean(documentPreviewStates?.rfp_request_evidence) && !(documentPreviewUrls?.rfp_request_evidence || draft.rfpRequestEvidenceDocument.downloadURL)}
              previewState={documentPreviewStates?.rfp_request_evidence}
              onLoadPreview={onLoadDocumentPreview ? () => onLoadDocumentPreview('rfp_request_evidence') : undefined}
              title="RFP/요청 메일 증빙 원문"
              description="첨부한 RFP 또는 요청 메일 증빙이 맞는지 확인해주세요."
            />
          </div>
        ) : null}
        {draft.customerBusinessRegistrationDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={{
                ...draft.customerBusinessRegistrationDocument,
                downloadURL: documentPreviewUrls?.customer_business_registration || draft.customerBusinessRegistrationDocument.downloadURL,
              }}
              privateDraftAttachment={Boolean(documentPreviewStates?.customer_business_registration) && !(documentPreviewUrls?.customer_business_registration || draft.customerBusinessRegistrationDocument.downloadURL)}
              previewState={documentPreviewStates?.customer_business_registration}
              onLoadPreview={onLoadDocumentPreview ? () => onLoadDocumentPreview('customer_business_registration') : undefined}
              title="고객사 사업자등록증 원문"
              description="첨부한 고객사 사업자등록증이 맞는지 확인해주세요."
            />
          </div>
        ) : null}
        {showProjectCheckout && draft.performanceCertificateDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={{
                ...draft.performanceCertificateDocument,
                downloadURL: documentPreviewUrls?.performance_certificate || draft.performanceCertificateDocument.downloadURL,
              }}
              privateDraftAttachment={Boolean(documentPreviewStates?.performance_certificate) && !(documentPreviewUrls?.performance_certificate || draft.performanceCertificateDocument.downloadURL)}
              previewState={documentPreviewStates?.performance_certificate}
              onLoadPreview={onLoadDocumentPreview ? () => onLoadDocumentPreview('performance_certificate') : undefined}
              title="수행확인서 원문"
              description="종료사업 수행확인서 증빙입니다."
            />
          </div>
        ) : null}
        {showProjectCheckout && draft.taxInvoiceDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={{
                ...draft.taxInvoiceDocument,
                downloadURL: documentPreviewUrls?.tax_invoice || draft.taxInvoiceDocument.downloadURL,
              }}
              privateDraftAttachment={Boolean(documentPreviewStates?.tax_invoice) && !(documentPreviewUrls?.tax_invoice || draft.taxInvoiceDocument.downloadURL)}
              previewState={documentPreviewStates?.tax_invoice}
              onLoadPreview={onLoadDocumentPreview ? () => onLoadDocumentPreview('tax_invoice') : undefined}
              title="세금계산서 원문"
              description="종료사업 세금계산서 증빙입니다."
            />
          </div>
        ) : null}
        {showProjectCheckout && draft.finalSettlementReportDocument ? (
          <div className="lg:col-span-2">
            <ContractDocumentPreview
              document={{
                ...draft.finalSettlementReportDocument,
                downloadURL: documentPreviewUrls?.final_settlement_report || draft.finalSettlementReportDocument.downloadURL,
              }}
              privateDraftAttachment={Boolean(documentPreviewStates?.final_settlement_report) && !(documentPreviewUrls?.final_settlement_report || draft.finalSettlementReportDocument.downloadURL)}
              previewState={documentPreviewStates?.final_settlement_report}
              onLoadPreview={onLoadDocumentPreview ? () => onLoadDocumentPreview('final_settlement_report') : undefined}
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

      {showCheckoutEntry && showProjectCheckout ? (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between border-[#001e46] text-[#001e46]"
          data-testid="project-checkout-entry"
          onClick={() => setStepIndex(STEPS.findIndex((item) => item.id === 'financial'))}
        >
          <span>Project Check out</span>
          <span className="text-xs text-slate-500">체크리스트와 증빙 업로드 열기</span>
        </Button>
      ) : null}

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

      <div className="space-y-4">
      <Card className="border-slate-200/80 shadow-sm">
        <CardContent className="p-3">
          <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>{stepIndex + 1} / {STEPS.length}</span>
            <span>{step.label}</span>
          </div>
          <Progress value={((stepIndex + 1) / STEPS.length) * 100} />
          <div className="mt-4 grid gap-1.5 lg:grid-cols-5">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const active = index === stepIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setStepIndex(index)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors lg:justify-center lg:py-3 ${
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

      <div className="z-20 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
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
                disabled={readOnly || autosaveState === 'saving' || uploadInProgress || hasPendingRetryFile || (mode === 'portal-register' && !hasRequiredRegistrationDocuments)}
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
                    disabled={readOnly || autosaveState === 'saving' || uploadInProgress || hasPendingRetryFile || !!busyActionId || action.disabled || !canSubmit}
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
