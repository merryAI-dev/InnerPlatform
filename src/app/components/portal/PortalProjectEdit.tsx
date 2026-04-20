import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  FileText,
  Loader2,
  Save,
  SendHorizontal,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';
import { collection, doc, limit, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { getAuthInstance, getOrgCollectionPath, getOrgDocumentPath } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';
import {
  isPlatformApiEnabled,
  processProjectRequestContractViaBff,
  resubmitProjectExecutiveReviewViaBff,
  type ProjectRequestContractAnalysisResult,
  upsertProjectViaBff,
} from '../../lib/platform-bff-client';
import {
  createSettlementSheetPolicy,
  getDefaultSettlementSheetPolicyForFundInputMode,
  normalizeBasis,
  getProjectTypeSelectableOptions,
  normalizeSettlementSheetPolicy,
  normalizeSettlementType,
  normalizeProjectFundInputMode,
  PROJECT_TYPE_LABELS,
  PROJECT_FUND_INPUT_MODE_LABELS,
  SETTLEMENT_TYPE_LABELS,
  BASIS_LABELS,
  ACCOUNT_TYPE_LABELS,
  type Project,
  type ProjectType,
  type ProjectFundInputMode,
  type SettlementSheetPolicy,
  type SettlementType,
  type Basis,
  type AccountType,
  type ProjectRequest,
  type ProjectRequestContractAnalysis,
  type ProjectFinancialInputFlags,
} from '../../data/types';
import { PROJECT_DEPARTMENT_OPTIONS } from '../../data/project-department-options';
import { resolveProjectCic } from '../../platform/project-cic';
import {
  createEmptyProjectFinancialInputFlags,
  hasExplicitProjectAmountInput,
  normalizeProjectFinancialInputFlags,
} from '../../platform/project-contract-amount';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
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
import { SettlementSheetPolicyFields } from '../projects/SettlementSheetPolicyFields';

const MAX_CONTRACT_UPLOAD_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_CONTRACT_UPLOAD_SIZE_LABEL = '4MB';

type ContractUploadState = 'idle' | 'extracting' | 'ready' | 'error';

interface PortalProjectEditFormState {
  name: string;
  officialContractName: string;
  type: ProjectType;
  department: string;
  clientOrg: string;
  contractAmount: number;
  salesVatAmount: number;
  financialInputFlags: ProjectFinancialInputFlags;
  contractStart: string;
  contractEnd: string;
  settlementType: SettlementType;
  basis: Basis;
  accountType: AccountType;
  fundInputMode: ProjectFundInputMode;
  settlementSheetPolicy: SettlementSheetPolicy;
  managerName: string;
  teamName: string;
  participantCondition: string;
  projectPurpose: string;
  note: string;
  contractDocument: Project['contractDocument'];
  contractAnalysis: ProjectRequestContractAnalysis | null;
}

function fmtKRW(value: number) {
  if (!value) return '0';
  return value.toLocaleString('ko-KR');
}

function readText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumberSuggestion(
  value: ProjectRequestContractAnalysis['fields']['contractAmount'] | undefined,
) {
  return typeof value?.value === 'number' && Number.isFinite(value.value) ? value.value : null;
}

function buildProjectRequestPayloadSnapshot(params: {
  project: Project;
  request: ProjectRequest | null;
  form: PortalProjectEditFormState;
}) {
  const { project, request, form } = params;
  const base: Partial<ProjectRequest['payload']> = request?.payload || {};
  return {
    ...base,
    name: form.name.trim(),
    officialContractName: form.officialContractName.trim(),
    type: form.type,
    description: project.description || base.description || '',
    clientOrg: form.clientOrg.trim(),
    department: form.department,
    contractAmount: form.contractAmount,
    salesVatAmount: form.salesVatAmount,
    totalRevenueAmount: project.totalRevenueAmount ?? base.totalRevenueAmount ?? 0,
    supportAmount: project.supportAmount ?? base.supportAmount ?? 0,
    financialInputFlags: form.financialInputFlags,
    contractStart: form.contractStart,
    contractEnd: form.contractEnd,
    settlementType: form.settlementType,
    basis: form.basis,
    accountType: form.accountType,
    fundInputMode: form.fundInputMode,
    settlementSheetPolicy: form.settlementSheetPolicy,
    paymentPlanDesc: project.paymentPlanDesc || base.paymentPlanDesc || '',
    settlementGuide: project.settlementGuide || base.settlementGuide || '',
    projectPurpose: form.projectPurpose.trim(),
    managerName: form.managerName.trim(),
    teamName: form.teamName.trim(),
    teamMembers: base.teamMembers || '',
    teamMembersDetailed: project.teamMembersDetailed || base.teamMembersDetailed || [],
    participantCondition: form.participantCondition.trim(),
    note: form.note.trim(),
    contractDocument: form.contractDocument ?? null,
    contractAnalysis: form.contractAnalysis ?? null,
  };
}

function mergeContractAnalysisIntoForm(
  prev: PortalProjectEditFormState,
  analysis: ProjectRequestContractAnalysisResult,
) {
  const nextFinancialInputFlags = normalizeProjectFinancialInputFlags(prev.financialInputFlags);
  const suggestedContractAmount = readNumberSuggestion(analysis.fields.contractAmount);
  const suggestedSalesVatAmount = readNumberSuggestion(analysis.fields.salesVatAmount);

  return {
    ...prev,
    officialContractName: prev.officialContractName || readText(analysis.fields.officialContractName?.value),
    clientOrg: prev.clientOrg || readText(analysis.fields.clientOrg?.value),
    contractStart: prev.contractStart || readText(analysis.fields.contractStart?.value),
    contractEnd: prev.contractEnd || readText(analysis.fields.contractEnd?.value),
    projectPurpose: prev.projectPurpose || readText(analysis.fields.projectPurpose?.value),
    contractAmount: nextFinancialInputFlags.contractAmount || suggestedContractAmount == null
      ? prev.contractAmount
      : suggestedContractAmount,
    salesVatAmount: nextFinancialInputFlags.salesVatAmount || suggestedSalesVatAmount == null
      ? prev.salesVatAmount
      : suggestedSalesVatAmount,
    financialInputFlags: {
      ...nextFinancialInputFlags,
      contractAmount: nextFinancialInputFlags.contractAmount || suggestedContractAmount != null,
      salesVatAmount: nextFinancialInputFlags.salesVatAmount || suggestedSalesVatAmount != null,
    },
  };
}

function resolveExecutiveBanner(project: Project, request: ProjectRequest | null) {
  const status = project.executiveReviewStatus || request?.reviewOutcome || 'PENDING';
  const reason = project.executiveReviewComment || request?.rejectedReason || request?.reviewComment || '';
  if (status === 'APPROVED') {
    return {
      tone: 'neutral' as const,
      title: '리뷰 완료',
      description: 'CIC 대표 리뷰가 완료된 프로젝트입니다. 이후 보완이 필요하면 같은 화면에서 수정하고 다시 리뷰 흐름을 이어갈 수 있습니다.',
    };
  }
  if (status === 'REVISION_REJECTED') {
    return {
      tone: 'warning' as const,
      title: '반려 사유',
      description: reason || 'CIC 대표가 수정을 요청했습니다. 보완 후 저장하고 다시 제출해 주세요.',
    };
  }
  if (status === 'DUPLICATE_DISCARDED') {
    return {
      tone: 'danger' as const,
      title: '중복·폐기 사유',
      description: reason || 'CIC 대표가 중복 또는 폐기 대상으로 판단했습니다. 필요 시 내용을 수정해 다시 제출할 수 있습니다.',
    };
  }
  if (status === 'PENDING' && project.registrationSource === 'pm_portal') {
    return {
      tone: 'neutral' as const,
      title: 'CIC 대표 리뷰 대기',
      description: '현재 수정본이 CIC 대표 리뷰 큐에 올라가 있습니다. 필요한 보완만 저장하고, 다시 제출은 필요한 경우에만 누르세요.',
    };
  }
  return null;
}

function bannerToneClass(tone: 'warning' | 'danger' | 'neutral') {
  if (tone === 'danger') return 'border-rose-300 bg-rose-50 text-rose-950';
  if (tone === 'neutral') return 'border-sky-300 bg-sky-50 text-sky-950';
  return 'border-amber-300 bg-amber-50 text-amber-950';
}

export function PortalProjectEdit() {
  const navigate = useNavigate();
  const { orgId, db, isOnline } = useFirebase();
  const { user: authUser } = useAuth();
  const { myProject, transactions, expenseSheets, expenseSheetRows, bankStatementRows } = usePortalStore();
  const contractUploadInputRef = useRef<HTMLInputElement | null>(null);

  const [savingAction, setSavingAction] = useState<'save' | 'resubmit' | null>(null);
  const [requestDoc, setRequestDoc] = useState<ProjectRequest | null>(null);
  const [contractUploadState, setContractUploadState] = useState<ContractUploadState>('idle');
  const [analysisError, setAnalysisError] = useState('');
  const [resubmitComment, setResubmitComment] = useState('');
  const [form, setForm] = useState<PortalProjectEditFormState>({
    name: '',
    officialContractName: '',
    type: 'D1',
    department: '',
    clientOrg: '',
    contractAmount: 0,
    salesVatAmount: 0,
    financialInputFlags: createEmptyProjectFinancialInputFlags(),
    contractStart: '',
    contractEnd: '',
    settlementType: 'NONE',
    basis: 'NONE',
    accountType: 'NONE',
    fundInputMode: 'BANK_UPLOAD',
    settlementSheetPolicy: createSettlementSheetPolicy('STANDARD'),
    managerName: '',
    teamName: '',
    participantCondition: '',
    projectPurpose: '',
    note: '',
    contractDocument: null,
    contractAnalysis: null,
  });

  useEffect(() => {
    if (myProject) {
      setForm({
        name: myProject.name || '',
        officialContractName: myProject.officialContractName || '',
        type: myProject.type || 'D1',
        department: myProject.department || '',
        clientOrg: myProject.clientOrg || '',
        contractAmount: myProject.contractAmount || 0,
        salesVatAmount: myProject.salesVatAmount || 0,
        financialInputFlags: normalizeProjectFinancialInputFlags(myProject.financialInputFlags),
        contractStart: myProject.contractStart || '',
        contractEnd: myProject.contractEnd || '',
        settlementType: normalizeSettlementType(myProject.settlementType),
        basis: normalizeBasis(myProject.basis),
        accountType: myProject.accountType || 'NONE',
        fundInputMode: normalizeProjectFundInputMode(myProject.fundInputMode),
        settlementSheetPolicy: normalizeSettlementSheetPolicy(myProject.settlementSheetPolicy, myProject.fundInputMode),
        managerName: myProject.managerName || '',
        teamName: myProject.teamName || '',
        participantCondition: myProject.participantCondition || '',
        projectPurpose: myProject.projectPurpose || '',
        note: '',
        contractDocument: myProject.contractDocument || null,
        contractAnalysis: myProject.contractAnalysis || null,
      });
    }
  }, [myProject]);

  useEffect(() => {
    if (!db || !isOnline || !myProject?.id) {
      setRequestDoc(null);
      return undefined;
    }

    const requestQuery = query(
      collection(db, getOrgCollectionPath(orgId, 'projectRequests')),
      where('approvedProjectId', '==', myProject.id),
      limit(1),
    );

    const unsubscribe = onSnapshot(
      requestQuery,
      (snapshot) => {
        setRequestDoc(snapshot.empty ? null : (snapshot.docs[0].data() as ProjectRequest));
      },
      (error) => {
        console.error('[PortalProjectEdit] request listen failed:', error);
        setRequestDoc(null);
      },
    );

    return () => unsubscribe();
  }, [db, isOnline, myProject?.id, orgId]);

  const departmentOptions = useMemo(
    () => Array.from(new Set([
      ...PROJECT_DEPARTMENT_OPTIONS,
      myProject?.department || '',
    ].filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko')),
    [myProject?.department],
  );
  const projectTypeOptions = useMemo(
    () => getProjectTypeSelectableOptions(form.type),
    [form.type],
  );
  const financialInputFlags = useMemo(
    () => normalizeProjectFinancialInputFlags(form.financialInputFlags),
    [form.financialInputFlags],
  );
  const hasContractAmountInput = financialInputFlags.contractAmount;
  const hasSalesVatAmountInput = financialInputFlags.salesVatAmount;
  const hasExistingFundActivity = useMemo(() => (
    transactions.some((tx) => tx.projectId === myProject?.id)
    || (bankStatementRows?.rows?.length || 0) > 0
    || expenseSheets.some((sheet) => (sheet.rows?.length || 0) > 0)
    || (expenseSheetRows?.length || 0) > 0
  ), [transactions, myProject?.id, bankStatementRows?.rows?.length, expenseSheets, expenseSheetRows]);

  const executiveBanner = useMemo(
    () => (myProject ? resolveExecutiveBanner(myProject, requestDoc) : null),
    [myProject, requestDoc],
  );
  const canResubmit = myProject?.executiveReviewStatus === 'REVISION_REJECTED'
    || myProject?.executiveReviewStatus === 'DUPLICATE_DISCARDED';
  const saving = savingAction !== null;

  if (!myProject) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">배정된 프로젝트가 없습니다.</p>
      </div>
    );
  }

  const update = <K extends keyof PortalProjectEditFormState>(key: K, value: PortalProjectEditFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const updateFundInputMode = (nextMode: ProjectFundInputMode) => {
    if (nextMode === form.fundInputMode) return;
    if (hasExistingFundActivity) {
      const confirmed = window.confirm('이미 주간 입력 또는 통장내역 데이터가 있습니다. 입력 방식을 바꾸면 이후 작업 흐름만 바뀌고 기존 데이터는 유지됩니다. 계속할까요?');
      if (!confirmed) return;
    }
    setForm((prev) => {
      const shouldResetPolicy = prev.settlementSheetPolicy.preset === getDefaultSettlementSheetPolicyForFundInputMode(prev.fundInputMode).preset;
      return {
        ...prev,
        fundInputMode: nextMode,
        settlementSheetPolicy: shouldResetPolicy
          ? getDefaultSettlementSheetPolicyForFundInputMode(nextMode)
          : prev.settlementSheetPolicy,
      };
    });
  };

  const buildProjectPayload = (): Project => ({
    ...myProject,
    name: form.name.trim(),
    officialContractName: form.officialContractName.trim(),
    type: form.type,
    department: form.department,
    cic: resolveProjectCic({ cic: myProject.cic, department: form.department }),
    clientOrg: form.clientOrg.trim(),
    contractAmount: form.contractAmount,
    salesVatAmount: form.salesVatAmount,
    financialInputFlags,
    contractStart: form.contractStart,
    contractEnd: form.contractEnd,
    settlementType: form.settlementType,
    basis: form.basis,
    accountType: form.accountType,
    fundInputMode: form.fundInputMode,
    settlementSheetPolicy: form.settlementSheetPolicy,
    managerName: form.managerName.trim(),
    teamName: form.teamName.trim(),
    participantCondition: form.participantCondition.trim(),
    projectPurpose: form.projectPurpose.trim(),
    contractDocument: form.contractDocument || null,
    contractAnalysis: form.contractAnalysis || null,
    updatedAt: new Date().toISOString(),
  });

  const persistProject = async () => {
    if (!orgId || !myProject || !authUser?.uid) return null;
    const nextProject = buildProjectPayload();
    if (isPlatformApiEnabled()) {
      const idToken = authUser.idToken || await getAuthInstance()?.currentUser?.getIdToken() || undefined;
      await upsertProjectViaBff({
        tenantId: orgId,
        actor: {
          uid: authUser.uid,
          email: authUser.email,
          role: authUser.role,
          idToken,
        },
        project: {
          ...nextProject,
          expectedVersion: myProject.version ?? 1,
        },
      });
    } else if (db) {
      await setDoc(
        doc(db, getOrgDocumentPath(orgId, 'projects', myProject.id)),
        nextProject,
        { merge: true },
      );
    }
    return nextProject;
  };

  const handleSave = async () => {
    if (!orgId || !authUser?.uid || !form.name.trim()) return;
    setSavingAction('save');
    try {
      await persistProject();
      toast.success('프로젝트 정보가 저장되었습니다.', {
        description: '반려 상태라면 내용을 더 보완한 뒤 “수정 후 다시 제출”로 CIC 대표 리뷰 큐에 다시 올리세요.',
      });
    } catch (err) {
      toast.error('저장에 실패했습니다. 다시 시도해주세요.');
      console.error('[PortalProjectEdit] save failed:', err);
    } finally {
      setSavingAction(null);
    }
  };

  const handleResubmit = async () => {
    if (!orgId || !authUser?.uid || !myProject || !requestDoc) {
      toast.error('다시 제출할 CIC 대표 리뷰 요청 정보를 찾지 못했습니다.');
      return;
    }

    setSavingAction('resubmit');
    try {
      const nextProject = await persistProject();
      if (!nextProject) throw new Error('project_not_saved');

      if (isPlatformApiEnabled()) {
        const idToken = authUser.idToken || await getAuthInstance()?.currentUser?.getIdToken() || undefined;
        await resubmitProjectExecutiveReviewViaBff({
          tenantId: orgId,
          actor: {
            uid: authUser.uid,
            email: authUser.email,
            role: authUser.role,
            idToken,
          },
          projectId: myProject.id,
          payload: {
            requestId: requestDoc.id,
            reviewComment: resubmitComment.trim() || undefined,
            reviewerName: authUser.name || authUser.email || 'PM',
          },
        });
      } else if (db) {
        const now = new Date().toISOString();
        await setDoc(
          doc(db, getOrgDocumentPath(orgId, 'projects', myProject.id)),
          {
            executiveReviewStatus: 'PENDING',
            executiveReviewedAt: now,
            executiveReviewedById: authUser.uid,
            executiveReviewedByName: authUser.name || authUser.email || 'PM',
            executiveReviewComment: resubmitComment.trim() || null,
            executiveReviewHistory: [
              ...(Array.isArray(nextProject.executiveReviewHistory) ? nextProject.executiveReviewHistory : []),
              {
                status: 'PENDING',
                previousStatus: myProject.executiveReviewStatus || 'PENDING',
                reviewedAt: now,
                reviewedById: authUser.uid,
                reviewedByName: authUser.name || authUser.email || 'PM',
                reviewComment: resubmitComment.trim() || null,
              },
            ],
            updatedAt: now,
          },
          { merge: true },
        );
        await setDoc(
          doc(db, getOrgDocumentPath(orgId, 'projectRequests', requestDoc.id)),
          {
            status: 'PENDING',
            reviewOutcome: null,
            reviewedBy: null,
            reviewedByName: null,
            reviewedAt: null,
            reviewComment: null,
            rejectedReason: null,
            approvedProjectId: myProject.id,
            payload: buildProjectRequestPayloadSnapshot({
              project: nextProject,
              request: requestDoc,
              form,
            }),
            updatedAt: now,
          },
          { merge: true },
        );
      }

      toast.success('수정 후 다시 제출했습니다.', {
        description: 'CIC 대표 리뷰 큐에서 이 프로젝트를 다시 확인할 수 있습니다.',
      });
      setResubmitComment('');
    } catch (error) {
      console.error('[PortalProjectEdit] resubmit failed:', error);
      toast.error('다시 제출에 실패했습니다.', {
        description: error instanceof Error ? error.message : '잠시 후 다시 시도해 주세요.',
      });
    } finally {
      setSavingAction(null);
    }
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
      setContractUploadState('error');
      setAnalysisError(message);
      toast.error(message);
      input.value = '';
      return;
    }

    setContractUploadState('extracting');
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
      setForm((prev) => mergeContractAnalysisIntoForm({
        ...prev,
        contractDocument: processed.contractDocument,
        contractAnalysis: processed.analysis || null,
      }, processed.analysis));
      setContractUploadState('ready');
      toast.success(`계약서 PDF 업로드 및 분석 완료: ${file.name}`);
    } catch (error) {
      console.error('[PortalProjectEdit] contract upload failed:', error);
      setContractUploadState('error');
      setAnalysisError(error instanceof Error ? error.message : '계약서 업로드 실패');
      toast.error('계약서 업로드에 실패했습니다.');
    } finally {
      input.value = '';
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/portal')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> 돌아가기
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">프로젝트 수정</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{myProject.name}</p>
        </div>
      </div>

      {executiveBanner ? (
        <div className={`rounded-[28px] border px-5 py-5 ${bannerToneClass(executiveBanner.tone)}`}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-white/80 p-2">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                {canResubmit ? '반려 사유' : '리뷰 상태'}
              </p>
              <h2 className="mt-1 text-[17px] font-semibold">{executiveBanner.title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6">{executiveBanner.description}</p>
              {canResubmit ? (
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
                  <div>
                    <Label className="text-[11px] font-semibold uppercase tracking-[0.16em]">다시 제출 메모</Label>
                    <Textarea
                      value={resubmitComment}
                      onChange={(event) => setResubmitComment(event.target.value)}
                      placeholder="보완한 내용을 CIC 대표 리뷰에서 바로 이해할 수 있게 짧게 남길 수 있습니다."
                      className="mt-2 min-h-[88px] border-white/70 bg-white/85 text-[13px] text-slate-900"
                    />
                  </div>
                  <div className="rounded-2xl border border-white/60 bg-white/70 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">다음 액션</p>
                    <p className="mt-2 text-[12px] leading-6 text-slate-700">
                      수정사항을 저장한 뒤 아래 footer의 <span className="font-semibold text-slate-950">수정 후 다시 제출</span>을 누르면 CIC 대표 리뷰 큐로 즉시 복귀합니다.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <Card className="border-slate-200/90 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Building2 className="h-4 w-4" /> 기본 정보
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <Label className="text-xs">프로젝트명 (등록명)</Label>
              <Input value={form.name} onChange={(e) => update('name', e.target.value)} className="text-sm" />
            </div>
            <div>
              <Label className="text-xs">계약서 상 정식명</Label>
              <Input value={form.officialContractName} onChange={(e) => update('officialContractName', e.target.value)} className="text-sm" />
            </div>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <Label className="text-xs">사업 유형</Label>
              <Select value={form.type} onValueChange={(v) => update('type', v as ProjectType)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {projectTypeOptions.map((type) => (
                    <SelectItem key={type} value={type}>{PROJECT_TYPE_LABELS[type]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">담당조직</Label>
              <datalist id="portal-project-edit-department-options">
                {departmentOptions.map((department) => <option key={department} value={department} />)}
              </datalist>
              <Input
                value={form.department}
                onChange={(e) => update('department', e.target.value)}
                list="portal-project-edit-department-options"
                className="text-sm"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">발주기관 (계약기관)</Label>
            <Input value={form.clientOrg} onChange={(e) => update('clientOrg', e.target.value)} className="text-sm" />
          </div>
          <div>
            <Label className="text-xs">사업 목적</Label>
            <Textarea
              value={form.projectPurpose}
              onChange={(e) => update('projectPurpose', e.target.value)}
              className="min-h-[72px] text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200/90 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4" /> 계약서 PDF
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
            <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">첨부 상태</p>
              {form.contractDocument ? (
                <div className="mt-3 space-y-2">
                  <p className="text-[15px] font-semibold text-slate-950">{form.contractDocument.name}</p>
                  <p className="text-[12px] text-slate-600">
                    {(form.contractDocument.size / 1024 / 1024).toFixed(2)} MB · {form.contractDocument.uploadedAt.slice(0, 10)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" className="rounded-full">
                      <a href={form.contractDocument.downloadURL} target="_blank" rel="noreferrer">첨부 계약서 보기</a>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="rounded-full"
                      onClick={() => setForm((prev) => ({ ...prev, contractDocument: null, contractAnalysis: null }))}
                    >
                      첨부 제거
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-[13px] leading-6 text-slate-600">
                  계약서 PDF를 새로 올리면 CIC 대표 리뷰 dossier에도 같은 파일과 분석 요약이 바로 보입니다.
                </p>
              )}
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">업로드 액션</p>
              <div className="mt-3 space-y-2">
                <input
                  ref={contractUploadInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={handleContractDocumentSelect}
                />
                <Button
                  type="button"
                  className="w-full gap-2 rounded-2xl"
                  onClick={() => contractUploadInputRef.current?.click()}
                  disabled={contractUploadState === 'extracting'}
                >
                  {contractUploadState === 'extracting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  계약서 PDF 업로드
                </Button>
                <p className="text-[12px] leading-6 text-slate-600">
                  업로드 후 AI가 사업 기간, 계약금액, 발주기관 후보를 읽어와 현재 초안을 보조합니다.
                </p>
              </div>
            </div>
          </div>

          {form.contractAnalysis ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">계약서 분석 요약</p>
                  <p className="mt-2 text-[14px] font-medium text-slate-950">{form.contractAnalysis.summary}</p>
                </div>
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                  {contractUploadState === 'ready' ? '분석 완료' : '원문 보유'}
                </div>
              </div>
              {form.contractAnalysis.warnings.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800">주의 사항</p>
                  <ul className="mt-2 space-y-1 text-[12px] leading-6 text-amber-900">
                    {form.contractAnalysis.warnings.map((warning) => (
                      <li key={warning}>• {warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {form.contractAnalysis.nextActions.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">다음 액션</p>
                  <ul className="mt-2 space-y-1 text-[12px] leading-6 text-slate-700">
                    {form.contractAnalysis.nextActions.map((action) => (
                      <li key={action}>• {action}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : analysisError ? (
            <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-[12px] leading-6 text-rose-900">
              {analysisError}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-slate-200/90 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Wallet className="h-4 w-4" /> 재무 정보
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <Label className="text-xs">계약금액 (원)</Label>
              <Input
                type="number"
                value={hasContractAmountInput ? String(form.contractAmount) : ''}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  update('financialInputFlags', {
                    ...financialInputFlags,
                    contractAmount: hasExplicitProjectAmountInput(nextValue),
                  });
                  update('contractAmount', Number(nextValue) || 0);
                }}
                className="text-sm"
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">{hasContractAmountInput ? `${fmtKRW(form.contractAmount)}원` : '미입력'}</p>
            </div>
            <div>
              <Label className="text-xs">매출부가세 (원)</Label>
              <Input
                type="number"
                value={hasSalesVatAmountInput ? String(form.salesVatAmount) : ''}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  update('financialInputFlags', {
                    ...financialInputFlags,
                    salesVatAmount: hasExplicitProjectAmountInput(nextValue),
                  });
                  update('salesVatAmount', Number(nextValue) || 0);
                }}
                className="text-sm"
              />
            </div>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <Label className="text-xs">계약 시작일</Label>
              <Input type="date" value={form.contractStart} onChange={(e) => update('contractStart', e.target.value)} className="text-sm" />
            </div>
            <div>
              <Label className="text-xs">계약 종료일</Label>
              <Input type="date" value={form.contractEnd} onChange={(e) => update('contractEnd', e.target.value)} className="text-sm" />
            </div>
          </div>
          <div className="grid gap-3 xl:grid-cols-4">
            <div>
              <Label className="text-xs">정산 유형</Label>
              <Select value={form.settlementType} onValueChange={(v) => update('settlementType', v as SettlementType)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SETTLEMENT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">정산 기준</Label>
              <Select value={form.basis} onValueChange={(v) => update('basis', v as Basis)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BASIS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">통장 유형</Label>
              <Select value={form.accountType} onValueChange={(v) => update('accountType', v as AccountType)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">자금 입력 방식</Label>
              <Select value={form.fundInputMode} onValueChange={(v) => updateFundInputMode(v as ProjectFundInputMode)}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PROJECT_FUND_INPUT_MODE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {form.fundInputMode === 'DIRECT_ENTRY'
                  ? '주간 사업비 시트 또는 엑셀 템플릿으로 직접 입력합니다.'
                  : '통장내역 업로드 후 주간 표로 이어서 작업합니다.'}
              </p>
            </div>
          </div>
          <SettlementSheetPolicyFields
            policy={form.settlementSheetPolicy}
            onChange={(next) => update('settlementSheetPolicy', next)}
          />
        </CardContent>
      </Card>

      <Card className="border-slate-200/90 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4" /> 팀 구성
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <Label className="text-xs">메인 담당자</Label>
              <Input value={form.managerName} onChange={(e) => update('managerName', e.target.value)} className="text-sm" />
            </div>
            <div>
              <Label className="text-xs">사내기업팀 (팀장)</Label>
              <Input value={form.teamName} onChange={(e) => update('teamName', e.target.value)} className="text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">참여기업 조건</Label>
            <Textarea
              value={form.participantCondition}
              onChange={(e) => update('participantCondition', e.target.value)}
              className="min-h-[72px] text-sm"
            />
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-20">
        <div className="rounded-[28px] border border-slate-200 bg-white/95 px-5 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">저장 및 재제출</p>
              <p className="mt-1 text-[12px] leading-6 text-slate-600">
                저장은 초안을 유지하고, <span className="font-semibold text-slate-950">수정 후 다시 제출</span>은 같은 프로젝트를 CIC 대표 리뷰 큐로 되돌립니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate('/portal')}>
                취소
              </Button>
              <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="gap-2">
                {savingAction === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                저장
              </Button>
              <Button
                onClick={handleResubmit}
                disabled={saving || !form.name.trim() || !canResubmit}
                className="gap-2 rounded-full bg-slate-950 text-white hover:bg-slate-800"
              >
                {savingAction === 'resubmit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                수정 후 다시 제출
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
