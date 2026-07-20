import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { toast } from 'sonner';
import { useAuth } from '../../data/auth-store';
import { useAppStore } from '../../data/store';
import type { Project, ProjectExecutiveReviewStatus, ProjectRequest } from '../../data/types';
import { getOrgRootPath } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';
import {
  isPlatformApiEnabled,
  reviewProjectExecutiveStatusViaBff,
  reviewProjectManagementPlanningStatusViaBff,
} from '../../lib/platform-bff-client';
import { downloadProjectAttachmentViaBff, downloadProjectRequestAttachmentViaBff } from '../../lib/project-request-attachment-client';
import {
  type MigrationAuditConsoleRecord,
  type MigrationAuditConsoleStatus,
  buildMigrationAuditConsoleRecords,
  collectMigrationAuditCicOptions,
  deriveMigrationAuditStatus,
  filterMigrationAuditConsoleRecords,
  summarizeMigrationAuditConsole,
} from '../../platform/project-migration-console';
import { getManagementPlanningReview } from '../../platform/project-management-planning-review';
import { resolveProjectRequestKind, resolveProjectRequestPayload } from '../../platform/project-change-request';
import { resolveMigrationReviewContractDocument } from '../../platform/project-migration-review-dossier';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { MigrationAuditControlBar } from './migration-audit/MigrationAuditControlBar';
import { MigrationAuditRecordList } from './migration-audit/MigrationAuditRecordList';
import { MigrationAuditDocumentDialog } from './migration-audit/MigrationAuditDocumentDialog';
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
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';

type ReviewActionMode = 'approve' | 'reject' | 'discard';
export type ProjectRegistrationReviewStage = 'executive' | 'managementPlanning';
type ProjectRequestCollectionName = 'project_requests' | 'projectRequests';
type ProjectRequestWithSource = ProjectRequest & { __collectionName?: ProjectRequestCollectionName };

const PROJECT_REQUEST_COLLECTIONS: ProjectRequestCollectionName[] = ['project_requests', 'projectRequests'];

function getReviewDialogTitle(mode: ReviewActionMode, reviewStage: ProjectRegistrationReviewStage): string {
  if (reviewStage === 'managementPlanning') return mode === 'approve' ? '프로젝트 코드 부여에 합의할까요?' : '프로젝트 코드를 반려할까요?';
  if (mode === 'approve') return '이 프로젝트를 승인할까요?';
  if (mode === 'reject') return '수정 요청 후 반려할까요?';
  return '이 프로젝트를 중복·폐기할까요?';
}

function getReviewDialogDescription(mode: ReviewActionMode, reviewStage: ProjectRegistrationReviewStage): string {
  if (reviewStage === 'managementPlanning') {
    return mode === 'approve'
      ? '조직장 승인이 끝난 프로젝트에 코드를 부여하고 경영기획실 합의로 기록합니다.'
      : '반려 사유를 남기면 PM에게 다시 전달되어 보완 후 재제출할 수 있습니다.';
  }
  if (mode === 'approve') return 'PM이 올린 원문을 기준으로 이 프로젝트를 등록 대상으로 확정합니다.';
  if (mode === 'reject') return '수정이 필요한 이유를 반드시 남기고 PM이 다시 보완하도록 돌려보냅니다.';
  return '중복 또는 폐기 대상으로 정리하고, 판단 근거를 반드시 남깁니다.';
}

function getProjectRequestReviewDescription(mode: ReviewActionMode, request: ProjectRequest | null | undefined, reviewStage: ProjectRegistrationReviewStage): string {
  if (reviewStage === 'managementPlanning' || resolveProjectRequestKind(request) !== 'CHANGE') return getReviewDialogDescription(mode, reviewStage);
  if (mode === 'approve') return 'PM이 제출한 수정 값을 프로젝트 원장에 반영하고 변경 요청을 승인 완료로 닫습니다.';
  if (mode === 'reject') return '프로젝트 원장은 유지하고, 수정이 필요한 이유를 남겨 PM에게 돌려보냅니다.';
  return '프로젝트 원장은 유지하고, 중복 또는 폐기된 수정 요청으로 정리합니다.';
}

function toExecutiveStatus(mode: ReviewActionMode): ProjectExecutiveReviewStatus {
  if (mode === 'approve') return 'APPROVED';
  if (mode === 'reject') return 'REVISION_REJECTED';
  return 'DUPLICATE_DISCARDED';
}

function buildExecutiveRecords(records: MigrationAuditConsoleRecord[]): MigrationAuditConsoleRecord[] {
  // Legacy planning agreements were made before the management-planning state split.
  // They remain eligible for the designated organization head's decision, but are shown as pending.
  return records.map((record) => record.status === 'PLANNING_AGREED' ? { ...record, status: 'PENDING' } : record);
}

function toManagementPlanningConsoleStatus(project: Project): MigrationAuditConsoleStatus {
  const status = getManagementPlanningReview(project).status;
  if (status === 'AGREED') return 'APPROVED';
  if (status === 'REVISION_REJECTED') return 'REVISION_REJECTED';
  return 'PENDING';
}

function buildManagementPlanningRecords(records: MigrationAuditConsoleRecord[]): MigrationAuditConsoleRecord[] {
  return records
    .filter((record) => deriveMigrationAuditStatus(record.project, record.request) === 'APPROVED')
    .map((record) => ({ ...record, status: toManagementPlanningConsoleStatus(record.project) }));
}

type ProjectMigrationAuditPageProps = {
  embedded?: boolean;
  reviewScope?: 'all' | 'pending';
  reviewStage?: ProjectRegistrationReviewStage;
};

export function ProjectMigrationAuditPage({
  embedded = false,
  reviewScope = 'all',
  reviewStage = 'executive',
}: ProjectMigrationAuditPageProps = {}) {
  const { user: authUser } = useAuth();
  const { projects, currentUser } = useAppStore();
  const { db, isOnline, orgId } = useFirebase();
  const [requests, setRequests] = useState<ProjectRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [cicFilter, setCicFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MigrationAuditConsoleStatus>('PENDING');
  const [searchQuery, setSearchQuery] = useState('');
  const [inboxScope, setInboxScope] = useState<'MINE' | 'ALL'>('MINE');
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ReviewActionMode | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [acting, setActing] = useState(false);
  const [secureContractDocument, setSecureContractDocument] = useState({ key: '', url: '', error: '' });
  const isManagementPlanning = reviewStage === 'managementPlanning';

  useEffect(() => {
    if (!db || !isOnline) {
      setRequests([]);
      setLoadingRequests(false);
      return undefined;
    }

    setLoadingRequests(true);
    const sourceRows = new Map<ProjectRequestCollectionName, ProjectRequestWithSource[]>();
    const initializedSources = new Set<ProjectRequestCollectionName>();
    let disposed = false;
    const publish = () => {
      if (disposed) return;
      setRequests(Array.from(sourceRows.values()).flat());
      if (initializedSources.size === PROJECT_REQUEST_COLLECTIONS.length) setLoadingRequests(false);
    };
    const unsubscribers = PROJECT_REQUEST_COLLECTIONS.map((collectionName) => onSnapshot(
      query(collection(db, `${getOrgRootPath(orgId)}/${collectionName}`), orderBy('requestedAt', 'desc')),
      (snapshot) => {
        sourceRows.set(collectionName, snapshot.docs.map((docSnap) => ({
          ...(docSnap.data() as ProjectRequest),
          id: String((docSnap.data() as ProjectRequest).id || docSnap.id),
          __collectionName: collectionName,
        })));
        initializedSources.add(collectionName);
        publish();
      },
      (error) => {
        console.error(`[ProjectMigrationAuditPage] ${collectionName} listen error:`, error);
        sourceRows.set(collectionName, []);
        initializedSources.add(collectionName);
        publish();
      },
    ));
    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [db, isOnline, orgId]);

  const records = useMemo(() => buildMigrationAuditConsoleRecords(projects, requests), [projects, requests]);
  const stageRecords = useMemo(() => {
    if (isManagementPlanning) return buildManagementPlanningRecords(records);
    return buildExecutiveRecords(records);
  }, [isManagementPlanning, records]);
  const scopedRecords = useMemo(() => reviewScope === 'pending'
    ? stageRecords.filter((record) => record.status === 'PENDING')
    : stageRecords, [reviewScope, stageRecords]);
  const reviewerDepartment = String(authUser?.department || '').trim();
  const inboxRecords = useMemo(() => {
    if (isManagementPlanning || inboxScope === 'ALL') return scopedRecords;
    return scopedRecords.filter((record) => {
      const approverId = resolveProjectRequestPayload(record.request)?.executiveApproverId || record.project.executiveApproverId;
      return Boolean(authUser?.uid && approverId === authUser.uid);
    });
  }, [authUser?.uid, inboxScope, isManagementPlanning, scopedRecords]);
  const summaryRecords = useMemo(() => filterMigrationAuditConsoleRecords(inboxRecords, { cic: cicFilter, status: 'ALL', searchQuery }), [cicFilter, inboxRecords, searchQuery]);
  const filteredRecords = useMemo(() => filterMigrationAuditConsoleRecords(summaryRecords, { cic: cicFilter, status: statusFilter, searchQuery }), [cicFilter, searchQuery, statusFilter, summaryRecords]);
  const summary = useMemo(() => summarizeMigrationAuditConsole(summaryRecords), [summaryRecords]);
  const cicOptions = useMemo(() => collectMigrationAuditCicOptions(inboxRecords), [inboxRecords]);
  const openRecord = useMemo(() => summaryRecords.find((record) => record.id === openRecordId) || null, [openRecordId, summaryRecords]);
  const contractDocument = openRecord ? resolveMigrationReviewContractDocument(openRecord.project, openRecord.request) : null;
  const contractDocumentPath = String(contractDocument?.path || '').trim();
  const contractDownloadUrl = String(contractDocument?.downloadURL || '').trim();
  const requestContractPath = String(resolveProjectRequestPayload(openRecord?.request)?.contractDocument?.path || '').trim();
  const requestId = String(openRecord?.request?.id || '').trim();
  const projectId = String(openRecord?.project.id || '').trim();
  const contractAttachmentSource = requestId && contractDocumentPath === requestContractPath ? 'request' : projectId && contractDocumentPath ? 'project' : '';
  const contractAttachmentId = contractAttachmentSource === 'request' ? requestId : projectId;
  const secureContractDocumentKey = contractAttachmentSource && contractAttachmentId && contractDocumentPath ? `${contractAttachmentSource}:${contractAttachmentId}:${contractDocumentPath}` : '';
  const secureContractDocumentUrl = secureContractDocument.key === secureContractDocumentKey ? secureContractDocument.url : '';
  const privateAttachmentError = secureContractDocument.key === secureContractDocumentKey ? secureContractDocument.error : '';
  const designatedApproverId = resolveProjectRequestPayload(openRecord?.request)?.executiveApproverId || openRecord?.project.executiveApproverId;
  const canExecutiveFinalize = Boolean(authUser?.uid && designatedApproverId === authUser.uid);
  const role = String(authUser?.role || '').trim().toLowerCase();
  const canManagementPlanningFinalize = role === 'admin' || role === 'finance';
  const canFinalize = isManagementPlanning ? canManagementPlanningFinalize : canExecutiveFinalize;

  useEffect(() => {
    setSecureContractDocument({ key: secureContractDocumentKey, url: '', error: '' });
    if (!isPlatformApiEnabled() || !authUser?.uid || !contractAttachmentSource || !contractAttachmentId || !contractDocumentPath || contractDownloadUrl) return undefined;
    let disposed = false;
    let objectUrl = '';
    const actor = { uid: authUser.uid, email: authUser.email, role: authUser.role, idToken: authUser.idToken };
    const download = contractAttachmentSource === 'request'
      ? downloadProjectRequestAttachmentViaBff({ tenantId: orgId, actor, requestId, documentKind: 'contract' })
      : downloadProjectAttachmentViaBff({ tenantId: orgId, actor, projectId, documentKind: 'contract' });
    void download.then(({ blob }) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setSecureContractDocument({ key: secureContractDocumentKey, url: objectUrl, error: '' });
    }).catch((error) => {
      if (disposed) return;
      console.error('[ProjectMigrationAuditPage] private attachment download failed:', error);
      setSecureContractDocument({ key: secureContractDocumentKey, url: '', error: '보안 원문을 불러오지 못했습니다. 권한 또는 파일 처리 상태를 확인해 주세요.' });
    });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [authUser?.email, authUser?.idToken, authUser?.role, authUser?.uid, contractAttachmentId, contractAttachmentSource, contractDocumentPath, contractDownloadUrl, orgId, projectId, requestId, secureContractDocumentKey]);

  async function handleConfirmAction() {
    if (!openRecord || !actionMode) return;
    if (!canFinalize) {
      toast.error(isManagementPlanning ? '경영기획실 담당자만 처리할 수 있습니다.' : '지정된 조직장만 처리할 수 있습니다.');
      return;
    }
    const trimmedComment = reviewComment.trim();
    const trimmedProjectCode = projectCode.trim();
    const reviewerName = currentUser?.name || authUser?.name || currentUser?.email || authUser?.email || '관리자';
    if (!isPlatformApiEnabled() || !authUser?.uid) {
      toast.error('프로젝트 처리 서버가 연결되어 있지 않아 저장하지 않았습니다.');
      return;
    }

    if (isManagementPlanning) {
      if (actionMode === 'discard') return;
      if (actionMode === 'approve' && !trimmedProjectCode) {
        toast.error('프로젝트 코드를 입력해 주세요.');
        return;
      }
      if (actionMode === 'reject' && !trimmedComment) {
        toast.error('반려 사유를 입력해 주세요.');
        return;
      }
      setActing(true);
      try {
        await reviewProjectManagementPlanningStatusViaBff({
          tenantId: orgId,
          actor: { uid: authUser.uid, email: authUser.email, role: authUser.role, idToken: authUser.idToken },
          projectId: openRecord.project.id,
          review: {
            requestId: openRecord.request?.id,
            reviewStatus: actionMode === 'approve' ? 'AGREED' : 'REVISION_REJECTED',
            projectCode: actionMode === 'approve' ? trimmedProjectCode : undefined,
            reviewComment: trimmedComment || undefined,
            reviewerName,
          },
        });
        toast.success(actionMode === 'approve' ? '프로젝트 코드를 부여하고 합의했습니다.' : '반려 사유를 PM에게 전달했습니다.', { description: openRecord.title });
        setActionMode(null);
        setReviewComment('');
        setProjectCode('');
      } catch (error) {
        toast.error('경영기획실 합의 저장 실패', { description: error instanceof Error ? error.message : '다시 시도해 주세요.' });
      } finally {
        setActing(false);
      }
      return;
    }

    const nextExecutiveStatus = toExecutiveStatus(actionMode);
    if (nextExecutiveStatus !== 'APPROVED' && !trimmedComment) {
      toast.error(actionMode === 'reject' ? '반려 사유를 입력해 주세요.' : '폐기 사유를 입력해 주세요.');
      return;
    }
    setActing(true);
    try {
      await reviewProjectExecutiveStatusViaBff({
        tenantId: orgId,
        actor: { uid: authUser.uid, email: authUser.email, role: authUser.role, idToken: authUser.idToken },
        projectId: openRecord.project.id,
        review: { requestId: openRecord.request?.id, reviewStatus: nextExecutiveStatus, reviewComment: trimmedComment || undefined, reviewerName },
      });
      toast.success(actionMode === 'approve' ? '프로젝트를 승인했습니다.' : actionMode === 'reject' ? '수정 요청 후 반려로 처리했습니다.' : '중복·폐기로 처리했습니다.', { description: openRecord.title });
      setActionMode(null);
      setReviewComment('');
    } catch (error) {
      toast.error('조직장 결재 저장 실패', { description: error instanceof Error ? error.message : '다시 시도해 주세요.' });
    } finally {
      setActing(false);
    }
  }

  const pageTitle = isManagementPlanning ? '프로젝트 코드 부여' : 'PM 등록 프로젝트 검토';
  const pageDescription = isManagementPlanning
    ? '조직장 승인이 끝난 프로젝트를 확인하고, 경영기획실 합의와 함께 프로젝트 코드를 부여합니다.'
    : '내게 배정된 프로젝트 등록 요청을 먼저 확인하고, 문서형 팝업에서 기안·조직장 결재선과 등록 내용을 검토합니다.';

  return (
    <div className="space-y-6">
      {!embedded ? <PageHeader icon={ClipboardCheck} iconGradient={isManagementPlanning ? 'linear-gradient(135deg, #0f2f57 0%, #174a7c 100%)' : 'linear-gradient(135deg, #0f766e 0%, #0ea5e9 100%)'} title={pageTitle} description={pageDescription} badge={isManagementPlanning ? '경영기획실 합의' : '대표 검토'} /> : null}
      {!db || !isOnline ? <Card><CardContent className="p-4 text-[12px] text-muted-foreground">Firebase 연결이 없어서 PM 등록 프로젝트와 접수 이력을 읽지 못했습니다. Firestore 연결 후 다시 확인해 주세요.</CardContent></Card> : null}
      <MigrationAuditControlBar cicOptions={cicOptions} cicFilter={cicFilter} onCicFilterChange={setCicFilter} inboxScope={inboxScope} onInboxScopeChange={setInboxScope} reviewerDepartment={reviewerDepartment} statusFilter={statusFilter} onStatusFilterChange={setStatusFilter} searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} summary={summary} reviewStage={reviewStage} />
      {loadingRequests ? <Card><CardContent className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />PM 등록 프로젝트와 접수 이력을 불러오는 중입니다…</CardContent></Card> : <MigrationAuditRecordList records={filteredRecords} onOpen={(record) => setOpenRecordId(record.id)} reviewStage={reviewStage} />}
      <MigrationAuditDocumentDialog open={!!openRecord} record={openRecord} acting={acting} canFinalize={canFinalize} contractDocumentDownloadURL={secureContractDocumentUrl || contractDownloadUrl} contractDocumentError={privateAttachmentError} reviewStage={reviewStage} onOpenChange={(open) => { if (!open) setOpenRecordId(null); }} onApprove={() => { setActionMode('approve'); setReviewComment(''); setProjectCode(''); }} onReject={() => { setActionMode('reject'); setReviewComment(isManagementPlanning ? '' : (openRecord?.project.executiveReviewComment || '')); setProjectCode(''); }} />
      <AlertDialog open={!!actionMode} onOpenChange={(open) => { if (!open) { setActionMode(null); setReviewComment(''); setProjectCode(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{getReviewDialogTitle(actionMode || 'approve', reviewStage)}</AlertDialogTitle><AlertDialogDescription>{getProjectRequestReviewDescription(actionMode || 'approve', openRecord?.request, reviewStage)}</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-2">
            {isManagementPlanning && actionMode === 'approve' ? <div className="space-y-2"><label htmlFor="management-planning-project-code" className="text-[12px] font-medium text-slate-700">프로젝트 코드</label><Input id="management-planning-project-code" value={projectCode} onChange={(event) => setProjectCode(event.target.value)} placeholder="예: MYSC-2026-001" className="rounded-none border-slate-400" autoComplete="off" /><p className="text-[11px] leading-5 text-slate-500">합의 저장과 함께 프로젝트 원장에 저장되며, 이후 운영 화면의 기준 코드로 사용됩니다.</p></div> : null}
            <p className="text-[12px] font-medium text-slate-700">{actionMode === 'approve' ? (isManagementPlanning ? '합의 메모' : '승인 메모') : actionMode === 'reject' ? '반려 사유' : '폐기 사유'}</p>
            <Textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder={actionMode === 'approve' ? (isManagementPlanning ? '합의 판단 근거를 남길 수 있습니다.' : '승인 판단 근거를 남길 수 있습니다.') : 'PM이 보완 내용을 이해할 수 있도록 반려 사유를 남겨 주세요.'} className="min-h-[120px]" />
          </div>
          <AlertDialogFooter><AlertDialogCancel disabled={acting}>취소</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); void handleConfirmAction(); }} disabled={acting || (isManagementPlanning && actionMode === 'approve' && !projectCode.trim()) || (actionMode !== 'approve' && !reviewComment.trim())}>{acting ? '저장 중...' : actionMode === 'approve' ? (isManagementPlanning ? '합의 및 코드 저장' : '승인 저장') : actionMode === 'reject' ? '반려 저장' : '폐기 저장'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
