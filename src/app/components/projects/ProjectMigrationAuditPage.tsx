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
import { downloadProjectRequestAttachmentViaBff } from '../../lib/project-request-attachment-client';
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

type ReviewActionMode = 'approve' | 'reject' | 'discard';
type ProjectRequestCollectionName = 'project_requests' | 'projectRequests';
type ProjectRequestWithSource = ProjectRequest & {
  __collectionName?: ProjectRequestCollectionName;
};

const PROJECT_REQUEST_COLLECTIONS: ProjectRequestCollectionName[] = ['project_requests', 'projectRequests'];

function getReviewDialogTitle(mode: ReviewActionMode): string {
  if (mode === 'approve') return '이 프로젝트를 승인할까요?';
  if (mode === 'reject') return '수정 요청 후 반려할까요?';
  return '이 프로젝트를 중복·폐기할까요?';
}

function getReviewDialogDescription(mode: ReviewActionMode): string {
  if (mode === 'approve') return 'PM이 올린 원문을 기준으로 이 프로젝트를 등록 대상으로 확정합니다.';
  if (mode === 'reject') return '수정이 필요한 이유를 반드시 남기고 PM이 다시 보완하도록 돌려보냅니다.';
  return '중복 또는 폐기 대상으로 정리하고, 왜 그렇게 판단했는지 사유를 반드시 남깁니다.';
}

function getProjectRequestReviewDescription(mode: ReviewActionMode, request: ProjectRequest | null | undefined): string {
  const isChangeRequest = resolveProjectRequestKind(request) === 'CHANGE';
  if (!isChangeRequest) return getReviewDialogDescription(mode);
  if (mode === 'approve') return 'PM이 제출한 수정 중 값을 프로젝트 원장에 반영하고 변경 요청을 승인 완료로 닫습니다.';
  if (mode === 'reject') return '프로젝트 원장은 유지하고, 수정이 필요한 이유를 남겨 PM에게 돌려보냅니다.';
  return '프로젝트 원장은 유지하고, 중복 또는 폐기된 수정 요청으로 정리합니다.';
}

function toExecutiveStatus(mode: ReviewActionMode): ProjectExecutiveReviewStatus {
  if (mode === 'approve') return 'APPROVED';
  if (mode === 'reject') return 'REVISION_REJECTED';
  return 'DUPLICATE_DISCARDED';
}

type ProjectMigrationAuditPageProps = {
  embedded?: boolean;
  reviewScope?: 'all' | 'pending';
};

export function ProjectMigrationAuditPage({
  embedded = false,
  reviewScope = 'all',
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
          record.status === 'PENDING'
        ))
      : records,
    [records, reviewScope],
  );

  const reviewerDepartment = String(authUser?.department || '').trim();
  const inboxRecords = useMemo(
    () => inboxScope === 'MINE' && reviewerDepartment
      ? scopedRecords.filter((record) => isSameMigrationAuditCic(record.cic, reviewerDepartment))
      : scopedRecords,
    [inboxScope, reviewerDepartment, scopedRecords],
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
  const pendingContractDocument = openRecord?.request?.status === 'PENDING'
    ? resolveProjectRequestPayload(openRecord.request)?.contractDocument
    : null;
  const pendingContractPath = String(pendingContractDocument?.path || '').trim();
  const pendingContractDownloadUrl = String(pendingContractDocument?.downloadURL || '').trim();
  const pendingRequestId = String(openRecord?.request?.id || '').trim();
  const secureContractDocumentKey = pendingRequestId && pendingContractPath
    ? `${pendingRequestId}:${pendingContractPath}`
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
      || !pendingRequestId
      || !pendingContractPath
      || pendingContractDownloadUrl
    ) return undefined;

    let disposed = false;
    let objectUrl = '';
    void downloadProjectRequestAttachmentViaBff({
      tenantId: orgId,
      actor: {
        uid: authUser.uid,
        email: authUser.email,
        role: authUser.role,
        idToken: authUser.idToken,
      },
      requestId: pendingRequestId,
      documentKind: 'contract',
    }).then(({ blob }) => {
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
    pendingContractDownloadUrl,
    pendingContractPath,
    pendingRequestId,
    secureContractDocumentKey,
  ]);

  async function handleConfirmAction() {
    if (!openRecord || !actionMode) return;

    const nextExecutiveStatus = toExecutiveStatus(actionMode);
    const trimmedComment = reviewComment.trim();
    const reviewerName = currentUser?.name || authUser?.name || currentUser?.email || authUser?.email || '관리자';
    if (nextExecutiveStatus !== 'APPROVED' && !trimmedComment) {
      toast.error(actionMode === 'reject' ? '반려 사유를 입력해 주세요.' : '폐기 사유를 입력해 주세요.');
      return;
    }
    if (!isPlatformApiEnabled() || !authUser?.uid) {
      toast.error('CIC 대표 검토 API가 연결되어 있지 않아 저장하지 않았습니다.');
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
        },
      });
      if (response.slackDelivered === false && response.slackReason) {
        console.warn('[ProjectMigrationAuditPage] executive review slack not delivered:', response.slackReason);
      }

      toast.success(
        actionMode === 'approve'
          ? '프로젝트를 승인했습니다.'
          : actionMode === 'reject'
            ? '수정 요청 후 반려로 처리했습니다.'
            : '중복·폐기로 처리했습니다.',
        {
          description: openRecord.title,
        },
      );
      setActionMode(null);
      setReviewComment('');
    } catch (error) {
      toast.error('CIC 대표 검토 결정 저장 실패', {
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
      });
    } finally {
      setActing(false);
    }
  }

  const pageDescription = '내게 배정된 프로젝트 등록 요청을 먼저 확인하고, 문서형 팝업에서 기안·조직장 결재선과 등록 내용을 검토합니다.';

  return (
    <div className="space-y-6">
      {!embedded ? (
        <PageHeader
          icon={ClipboardCheck}
          iconGradient="linear-gradient(135deg, #0f766e 0%, #0ea5e9 100%)"
          title="PM 등록 프로젝트 검토"
          description={pageDescription}
          badge="대표 검토"
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
        acting={acting}
        contractDocumentDownloadURL={secureContractDocumentUrl}
        contractDocumentError={privateAttachmentError}
        onOpenChange={(open) => { if (!open) setOpenRecordId(null); }}
        onApprove={() => {
          setActionMode('approve');
          setReviewComment(openRecord?.project.executiveReviewComment || '');
        }}
        onReject={() => {
          setActionMode('reject');
          setReviewComment(openRecord?.project.executiveReviewComment || '');
        }}
      />

      <AlertDialog open={!!actionMode} onOpenChange={(open) => {
        if (!open) {
          setActionMode(null);
          setReviewComment('');
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
            <p className="text-[12px] font-medium text-slate-700">
              {actionMode === 'approve' ? '승인 메모' : actionMode === 'reject' ? '반려 사유' : '폐기 사유'}
            </p>
            <Textarea
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
              placeholder={actionMode === 'approve' ? '승인 판단 근거를 남길 수 있습니다.' : 'PM이 수정하거나 폐기 판단을 이해할 수 있도록 사유를 남겨 주세요.'}
              className="min-h-[120px]"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>취소</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => {
              event.preventDefault();
              void handleConfirmAction();
            }} disabled={acting || (actionMode !== 'approve' && !reviewComment.trim())}>
              {acting ? '저장 중...' : actionMode === 'approve' ? '승인 저장' : actionMode === 'reject' ? '반려 저장' : '폐기 저장'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
