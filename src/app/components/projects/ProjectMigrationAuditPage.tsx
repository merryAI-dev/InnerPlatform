import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { useAuth } from '../../data/auth-store';
import { useAppStore } from '../../data/store';
import type { ProjectExecutiveReviewStatus, ProjectRequest } from '../../data/types';
import { getOrgRootPath } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';
import { isPlatformApiEnabled, reviewProjectExecutiveStatusViaBff } from '../../lib/platform-bff-client';
import { downloadProjectAttachmentViaBff, downloadProjectRequestAttachmentViaBff } from '../../lib/project-request-attachment-client';
import {
  type MigrationAuditConsoleStatus,
  buildMigrationAuditConsoleRecords,
  collectMigrationAuditCicOptions,
  filterMigrationAuditConsoleRecords,
  isSameMigrationAuditCic,
  summarizeMigrationAuditConsole,
} from '../../platform/project-migration-console';
import {
  resolveProjectRequestKind,
  resolveProjectRequestPayload,
} from '../../platform/project-change-request';
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

type ReviewActionMode = 'agree' | 'approve' | 'reject';
type WorkflowStage = 'planning' | 'approval';
type ProjectRequestCollectionName = 'project_requests' | 'projectRequests';
type ProjectRequestWithSource = ProjectRequest & {
  __collectionName?: ProjectRequestCollectionName;
};

const PROJECT_REQUEST_COLLECTIONS: ProjectRequestCollectionName[] = ['project_requests', 'projectRequests'];

function getReviewDialogTitle(mode: ReviewActionMode): string {
  if (mode === 'agree') return '이 프로젝트에 합의할까요?';
  if (mode === 'approve') return '이 프로젝트를 승인할까요?';
  if (mode === 'reject') return '수정 요청 후 반려할까요?';
  return '';
}

function getReviewDialogDescription(mode: ReviewActionMode): string {
  if (mode === 'agree') return '경영기획실 합의와 함께 프로젝트 코드를 부여하고, 지정 조직장에게 최종 승인을 요청합니다.';
  if (mode === 'approve') return '경영기획실 합의가 끝난 문서를 최종 승인합니다.';
  if (mode === 'reject') return '수정이 필요한 이유를 반드시 남기고 PM이 다시 보완하도록 돌려보냅니다.';
  return '';
}

function getProjectRequestReviewDescription(mode: ReviewActionMode, request: ProjectRequest | null | undefined): string {
  const isChangeRequest = resolveProjectRequestKind(request) === 'CHANGE';
  if (!isChangeRequest || mode === 'agree') return getReviewDialogDescription(mode);
  if (mode === 'approve') return 'PM이 제출한 수정 중 값을 프로젝트 원장에 반영하고 변경 요청을 승인 완료로 닫습니다.';
  if (mode === 'reject') return '프로젝트 원장은 유지하고, 수정이 필요한 이유를 남겨 PM에게 돌려보냅니다.';
  return '프로젝트 원장은 유지하고, 중복 또는 폐기된 수정 요청으로 정리합니다.';
}

function toExecutiveStatus(mode: ReviewActionMode): ProjectExecutiveReviewStatus {
  if (mode === 'agree') return 'PLANNING_AGREED';
  if (mode === 'approve') return 'APPROVED';
  if (mode === 'reject') return 'REVISION_REJECTED';
  return 'PENDING';
}

type ProjectMigrationAuditPageProps = {
  embedded?: boolean;
  reviewScope?: 'all' | 'pending';
  defaultInboxScope?: 'MINE' | 'ALL';
  workflowStage?: WorkflowStage;
};

export function ProjectMigrationAuditPage({
  embedded = false,
  reviewScope = 'all',
  defaultInboxScope = 'MINE',
  workflowStage = 'approval',
}: ProjectMigrationAuditPageProps = {}) {
  const { user: authUser } = useAuth();
  const { projects, currentUser } = useAppStore();
  const { db, isOnline, orgId } = useFirebase();

  const [requests, setRequests] = useState<ProjectRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [cicFilter, setCicFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MigrationAuditConsoleStatus>(
    workflowStage === 'planning' ? 'PENDING' : 'PLANNING_AGREED',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [inboxScope, setInboxScope] = useState<'MINE' | 'ALL'>(defaultInboxScope);
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ReviewActionMode | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [acting, setActing] = useState(false);
  const [secureContractDocument, setSecureContractDocument] = useState({ key: '', url: '', error: '' });

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
      if (initializedSources.size === PROJECT_REQUEST_COLLECTIONS.length) {
        setLoadingRequests(false);
      }
    };

    const unsubscribers = PROJECT_REQUEST_COLLECTIONS.map((collectionName) => {
      const requestQuery = query(
        collection(db, `${getOrgRootPath(orgId)}/${collectionName}`),
        orderBy('requestedAt', 'desc'),
      );

      return onSnapshot(
        requestQuery,
        (snapshot) => {
          sourceRows.set(
            collectionName,
            snapshot.docs.map((docSnap) => ({
              ...(docSnap.data() as ProjectRequest),
              id: String((docSnap.data() as ProjectRequest).id || docSnap.id),
              __collectionName: collectionName,
            })),
          );
          initializedSources.add(collectionName);
          publish();
        },
        (error) => {
          console.error(`[ProjectMigrationAuditPage] ${collectionName} listen error:`, error);
          sourceRows.set(collectionName, []);
          initializedSources.add(collectionName);
          publish();
        },
      );
    });

    return () => {
      disposed = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [db, isOnline, orgId]);

  const records = useMemo(
    () => buildMigrationAuditConsoleRecords(projects, requests),
    [projects, requests],
  );

  const scopedRecords = useMemo(
    () => reviewScope === 'pending'
      ? records.filter((record) => (
          workflowStage === 'planning'
            ? record.status === 'PENDING'
            : record.status === 'PLANNING_AGREED'
        ))
      : records,
    [records, reviewScope, workflowStage],
  );

  const reviewerDepartment = String(authUser?.department || '').trim();
  const inboxRecords = useMemo(
    () => inboxScope === 'MINE'
      ? scopedRecords.filter((record) => workflowStage === 'planning'
        ? reviewerDepartment && isSameMigrationAuditCic(record.cic, reviewerDepartment)
        : (resolveProjectRequestPayload(record.request)?.executiveApproverId || record.project.executiveApproverId) === authUser?.uid,
      )
      : scopedRecords,
    [authUser?.uid, inboxScope, reviewerDepartment, scopedRecords, workflowStage],
  );

  const summaryRecords = useMemo(
    () => filterMigrationAuditConsoleRecords(inboxRecords, {
      cic: cicFilter,
      status: 'ALL',
      searchQuery,
    }),
    [cicFilter, inboxRecords, searchQuery],
  );

  const filteredRecords = useMemo(
    () => filterMigrationAuditConsoleRecords(summaryRecords, {
      cic: cicFilter,
      status: statusFilter,
      searchQuery,
    }),
    [cicFilter, searchQuery, statusFilter, summaryRecords],
  );

  const summary = useMemo(
    () => summarizeMigrationAuditConsole(summaryRecords),
    [summaryRecords],
  );

  const cicOptions = useMemo(
    () => collectMigrationAuditCicOptions(inboxRecords),
    [inboxRecords],
  );

  const openRecord = useMemo(
    () => summaryRecords.find((record) => record.id === openRecordId) || null,
    [openRecordId, summaryRecords],
  );
  const contractDocument = resolveProjectRequestPayload(openRecord?.request)?.contractDocument || openRecord?.project.contractDocument;
  const contractPath = String(contractDocument?.path || '').trim();
  const contractDownloadUrl = String(contractDocument?.downloadURL || '').trim();
  const requestId = String(openRecord?.request?.id || '').trim();
  const projectId = String(openRecord?.project.id || '').trim();
  const usePendingRequestAttachment = openRecord?.request?.status === 'PENDING';
  const secureContractDocumentKey = (usePendingRequestAttachment ? requestId : projectId) && contractPath
    ? `${usePendingRequestAttachment ? requestId : projectId}:${contractPath}`
    : '';
  const secureContractDocumentUrl = secureContractDocument.key === secureContractDocumentKey
    ? secureContractDocument.url
    : '';
  const privateAttachmentError = secureContractDocument.key === secureContractDocumentKey
    ? secureContractDocument.error
    : '';

  useEffect(() => {
    setSecureContractDocument({ key: secureContractDocumentKey, url: '', error: '' });
    if (
      !isPlatformApiEnabled()
      || !authUser?.uid
      || !projectId
      || !contractPath
      || contractDownloadUrl
    ) return undefined;

    let disposed = false;
    let objectUrl = '';
    const actor = {
      uid: authUser.uid,
      email: authUser.email,
      role: authUser.role,
      idToken: authUser.idToken,
    };
    const download = usePendingRequestAttachment && requestId
      ? downloadProjectRequestAttachmentViaBff({ tenantId: orgId, actor, requestId, documentKind: 'contract' })
      : downloadProjectAttachmentViaBff({ tenantId: orgId, actor, projectId, documentKind: 'contract' });
    void download.then(({ blob }) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setSecureContractDocument({ key: secureContractDocumentKey, url: objectUrl, error: '' });
    }).catch((error) => {
      if (disposed) return;
      console.error('[ProjectMigrationAuditPage] private attachment download failed:', error);
      setSecureContractDocument({
        key: secureContractDocumentKey,
        url: '',
        error: '보안 원문을 불러오지 못했습니다. 권한 또는 파일 처리 상태를 확인해 주세요.',
      });
    });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    authUser?.email,
    authUser?.idToken,
    authUser?.role,
    authUser?.uid,
    orgId,
    contractDownloadUrl,
    contractPath,
    projectId,
    requestId,
    secureContractDocumentKey,
    usePendingRequestAttachment,
  ]);

  async function handleConfirmAction() {
    if (!openRecord || !actionMode) return;

    const nextExecutiveStatus = toExecutiveStatus(actionMode);
    const trimmedComment = reviewComment.trim();
    const trimmedProjectCode = projectCode.trim();
    const reviewerName = currentUser?.name || authUser?.name || currentUser?.email || authUser?.email || '관리자';
    if (nextExecutiveStatus === 'PLANNING_AGREED' && !trimmedProjectCode) {
      toast.error('프로젝트 코드를 입력해 주세요.');
      return;
    }
    if (nextExecutiveStatus === 'REVISION_REJECTED' && !trimmedComment) {
      toast.error('반려 사유를 입력해 주세요.');
      return;
    }
    if (!isPlatformApiEnabled() || !authUser?.uid) {
      toast.error('프로젝트 처리 서버가 연결되어 있지 않아 저장하지 않았습니다.');
      return;
    }

    setActing(true);
    try {
      const response = await reviewProjectExecutiveStatusViaBff({
        tenantId: orgId,
        actor: {
          uid: authUser.uid,
          email: authUser.email,
          role: authUser.role,
          idToken: authUser.idToken,
        },
        projectId: openRecord.project.id,
        review: {
          requestId: openRecord.request?.id,
          reviewStatus: nextExecutiveStatus,
          reviewComment: trimmedComment || undefined,
          reviewerName,
          projectCode: actionMode === 'agree' ? trimmedProjectCode : undefined,
        },
      });
      if (response.slackDelivered === false && response.slackReason) {
        console.warn('[ProjectMigrationAuditPage] executive review slack not delivered:', response.slackReason);
      }

      toast.success(
        actionMode === 'agree'
          ? '경영기획실 합의를 완료했습니다. 지정 조직장 승인 대기 상태입니다.'
          : actionMode === 'approve'
            ? '프로젝트를 승인했습니다.'
          : actionMode === 'reject'
            ? '수정 요청 후 반려로 처리했습니다.'
            : '',
        {
          description: openRecord.title,
        },
      );
      setActionMode(null);
      setReviewComment('');
      setProjectCode('');
    } catch (error) {
      toast.error(actionMode === 'agree' ? '경영기획실 합의 저장 실패' : '조직장 결재 저장 실패', {
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
      });
    } finally {
      setActing(false);
    }
  }

  const pageDescription = workflowStage === 'planning'
    ? '프로젝트 코드 부여와 경영기획실 합의가 필요한 등록 문서를 확인합니다.'
    : '경영기획실 합의가 끝난 문서를 지정 조직장이 최종 승인 또는 반려합니다.';

  return (
    <div className="space-y-6">
      {!embedded ? (
        <PageHeader
          icon={ClipboardCheck}
          iconGradient="linear-gradient(135deg, #0f766e 0%, #0ea5e9 100%)"
          title={workflowStage === 'planning' ? '경영기획실 프로젝트 합의' : 'PM 등록 프로젝트 승인'}
          description={pageDescription}
          badge={workflowStage === 'planning' ? '코드 부여·합의' : '지정 조직장 결재'}
        />
      ) : null}

      {!db || !isOnline ? (
        <Card>
          <CardContent className="p-4 text-[12px] text-muted-foreground">
            Firebase 연결이 없어서 PM 등록 프로젝트와 접수 이력을 읽지 못했습니다. Firestore 연결 후 다시 확인해 주세요.
          </CardContent>
        </Card>
      ) : null}

      <MigrationAuditControlBar
        cicOptions={cicOptions}
        cicFilter={cicFilter}
        onCicFilterChange={setCicFilter}
        inboxScope={inboxScope}
        onInboxScopeChange={setInboxScope}
        reviewerDepartment={reviewerDepartment}
        workflowStage={workflowStage}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        summary={summary}
      />

      {loadingRequests ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            PM 등록 프로젝트와 접수 이력을 불러오는 중입니다…
          </CardContent>
        </Card>
      ) : (
        <MigrationAuditRecordList records={filteredRecords} onOpen={(record) => setOpenRecordId(record.id)} />
      )}

      <MigrationAuditDocumentDialog
        open={!!openRecord}
        record={openRecord}
        reviewerName={currentUser?.name || authUser?.name || '조직장'}
        workflowStage={workflowStage}
        canFinalize={Boolean(authUser?.uid && (resolveProjectRequestPayload(openRecord?.request)?.executiveApproverId || openRecord?.project.executiveApproverId) === authUser.uid)}
        acting={acting}
        contractDocumentDownloadURL={secureContractDocumentUrl}
        contractDocumentError={privateAttachmentError}
        onOpenChange={(open) => { if (!open) setOpenRecordId(null); }}
        onAgree={() => {
          setActionMode('agree');
          setReviewComment('');
          setProjectCode(openRecord?.project.projectCode || '');
        }}
        onApprove={() => {
          setActionMode('approve');
          setReviewComment('');
          setProjectCode('');
        }}
        onReject={() => {
          setActionMode('reject');
          setReviewComment(openRecord?.project.executiveReviewComment || '');
          setProjectCode('');
        }}
      />

      <AlertDialog open={!!actionMode} onOpenChange={(open) => {
        if (!open) {
          setActionMode(null);
          setReviewComment('');
          setProjectCode('');
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{getReviewDialogTitle(actionMode || 'approve')}</AlertDialogTitle>
            <AlertDialogDescription>
              {getProjectRequestReviewDescription(actionMode || 'approve', openRecord?.request)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            {actionMode === 'agree' ? (
              <label className="block text-[12px] font-medium text-slate-700">
                프로젝트 코드
                <Input
                  value={projectCode}
                  onChange={(event) => setProjectCode(event.target.value)}
                  placeholder="예: PRJ-2026-001"
                  className="mt-2 h-10 rounded-none"
                  aria-label="프로젝트 코드"
                />
              </label>
            ) : null}
            <p className="text-[12px] font-medium text-slate-700">
              {actionMode === 'agree' ? '합의 메모' : actionMode === 'approve' ? '승인 메모' : '반려 사유'}
            </p>
            <Textarea
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
              placeholder={actionMode === 'agree' ? '합의 근거를 남길 수 있습니다.' : actionMode === 'approve' ? '승인 판단 근거를 남길 수 있습니다.' : 'PM이 수정하거나 폐기 판단을 이해할 수 있도록 사유를 남겨 주세요.'}
              className="min-h-[120px]"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>취소</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => {
              event.preventDefault();
              void handleConfirmAction();
            }} disabled={acting || (actionMode === 'agree' ? !projectCode.trim() : actionMode === 'reject' ? !reviewComment.trim() : false)}>
              {acting ? '저장 중...' : actionMode === 'agree' ? '합의 저장' : actionMode === 'approve' ? '승인 저장' : '반려 저장'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
