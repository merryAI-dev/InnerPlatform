import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { useAppStore } from '../../data/store';
import type {
  ProjectExecutiveReviewStatus,
  ProjectRequest,
} from '../../data/types';
import { getOrgCollectionPath, getOrgDocumentPath } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';
import {
  type MigrationAuditConsoleStatus,
  buildMigrationAuditConsoleRecords,
  collectMigrationAuditCicOptions,
  filterMigrationAuditConsoleRecords,
  findMigrationAuditRecord,
  summarizeMigrationAuditConsole,
} from '../../platform/project-migration-console';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { MigrationAuditControlBar } from './migration-audit/MigrationAuditControlBar';
import { MigrationAuditQueueRail } from './migration-audit/MigrationAuditQueueRail';
import { MigrationAuditDetailPanel } from './migration-audit/MigrationAuditDetailPanel';
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

function getReviewDialogTitle(mode: ReviewActionMode): string {
  if (mode === 'approve') return '이 프로젝트를 승인할까요?';
  if (mode === 'reject') return '수정 요청 후 반려할까요?';
  return '이 프로젝트를 중복·폐기할까요?';
}

function getReviewDialogDescription(mode: ReviewActionMode): string {
  if (mode === 'approve') return 'PM이 올린 원문을 기준으로 이 프로젝트를 우리 시스템 등록 대상으로 확정합니다.';
  if (mode === 'reject') return '수정이 필요한 이유를 남기고 PM이 다시 보완하도록 돌려보냅니다.';
  return '중복 또는 폐기 대상으로 정리하고, 왜 그렇게 판단했는지 메모를 남깁니다.';
}

function toExecutiveStatus(mode: ReviewActionMode): ProjectExecutiveReviewStatus {
  if (mode === 'approve') return 'APPROVED';
  if (mode === 'reject') return 'REVISION_REJECTED';
  return 'DUPLICATE_DISCARDED';
}

export function ProjectMigrationAuditPage() {
  const { projects, currentUser, updateProject } = useAppStore();
  const { db, isOnline, orgId } = useFirebase();

  const [requests, setRequests] = useState<ProjectRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [cicFilter, setCicFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MigrationAuditConsoleStatus>('ALL');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ReviewActionMode | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (!db || !isOnline) {
      setRequests([]);
      setLoadingRequests(false);
      return undefined;
    }

    setLoadingRequests(true);
    const requestQuery = query(
      collection(db, getOrgCollectionPath(orgId, 'projectRequests')),
      orderBy('requestedAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      requestQuery,
      (snapshot) => {
        const next = snapshot.docs.map((docSnap) => docSnap.data() as ProjectRequest);
        setRequests(next);
        setLoadingRequests(false);
      },
      (error) => {
        console.error('[ProjectMigrationAuditPage] project request listen error:', error);
        setRequests([]);
        setLoadingRequests(false);
      },
    );

    return () => unsubscribe();
  }, [db, isOnline, orgId]);

  const records = useMemo(
    () => buildMigrationAuditConsoleRecords(projects, requests),
    [projects, requests],
  );

  const filteredRecords = useMemo(
    () => filterMigrationAuditConsoleRecords(records, {
      cic: cicFilter,
      status: statusFilter,
    }),
    [cicFilter, records, statusFilter],
  );

  const summary = useMemo(
    () => summarizeMigrationAuditConsole(filteredRecords),
    [filteredRecords],
  );

  const cicOptions = useMemo(
    () => collectMigrationAuditCicOptions(records),
    [records],
  );

  const activeRecord = useMemo(
    () => findMigrationAuditRecord(filteredRecords, selectedRecordId),
    [filteredRecords, selectedRecordId],
  );

  useEffect(() => {
    if (!activeRecord) {
      setSelectedRecordId(null);
      return;
    }
    setSelectedRecordId(activeRecord.id);
  }, [activeRecord]);

  async function handleConfirmAction() {
    if (!activeRecord || !actionMode) return;

    const nextExecutiveStatus = toExecutiveStatus(actionMode);
    const now = new Date().toISOString();
    const trimmedComment = reviewComment.trim();
    const reviewerName = currentUser?.name || currentUser?.email || '관리자';
    const reviewerId = currentUser?.uid || '';

    setActing(true);
    try {
      await updateProject(activeRecord.project.id, {
        executiveReviewStatus: nextExecutiveStatus,
        executiveReviewedAt: now,
        executiveReviewedById: reviewerId,
        executiveReviewedByName: reviewerName,
        executiveReviewComment: trimmedComment,
        updatedAt: now,
      });

      if (db && activeRecord.request) {
        await setDoc(
          doc(db, getOrgDocumentPath(orgId, 'projectRequests', activeRecord.request.id)),
          {
            status: actionMode === 'approve' ? 'APPROVED' : 'REJECTED',
            reviewOutcome: nextExecutiveStatus === 'APPROVED' ? 'APPROVED' : nextExecutiveStatus,
            reviewedBy: reviewerId,
            reviewedByName: reviewerName,
            reviewedAt: now,
            reviewComment: trimmedComment || null,
            rejectedReason: actionMode === 'approve' ? null : trimmedComment || null,
            updatedAt: now,
          },
          { merge: true },
        );
      }

      toast.success(
        actionMode === 'approve'
          ? '프로젝트를 승인했습니다.'
          : actionMode === 'reject'
            ? '수정 요청 후 반려로 처리했습니다.'
            : '중복·폐기로 처리했습니다.',
        {
          description: activeRecord.title,
        },
      );
      setActionMode(null);
      setReviewComment('');
    } catch (error) {
      toast.error('임원 결정 저장 실패', {
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
      });
    } finally {
      setActing(false);
    }
  }

  const pageDescription = 'PM이 포털에서 등록한 프로젝트를 CIC와 상태 기준으로 좁힌 뒤, 우측에서 원문·예산·등록 인력을 그대로 읽고 임원 승인만 내리는 콘솔입니다.';

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardCheck}
        iconGradient="linear-gradient(135deg, #0f766e 0%, #0ea5e9 100%)"
        title="PM 등록 프로젝트 심사"
        description={pageDescription}
        badge="Executive Review"
      />

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
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
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
        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div data-testid="migration-review-queue">
            <MigrationAuditQueueRail
              records={filteredRecords}
              selectedId={activeRecord?.id || null}
              onSelect={setSelectedRecordId}
            />
          </div>
          <div data-testid="migration-review-dossier">
            <MigrationAuditDetailPanel
              record={activeRecord}
              acting={acting}
              onApprove={() => {
                setActionMode('approve');
                setReviewComment(activeRecord?.project.executiveReviewComment || '');
              }}
              onReject={() => {
                setActionMode('reject');
                setReviewComment(activeRecord?.project.executiveReviewComment || '');
              }}
              onDiscard={() => {
                setActionMode('discard');
                setReviewComment(activeRecord?.project.executiveReviewComment || '');
              }}
            />
          </div>
        </div>
      )}

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
              {getReviewDialogDescription(actionMode || 'approve')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <p className="text-[12px] font-medium text-slate-700">검토 메모</p>
            <Textarea
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
              placeholder={actionMode === 'approve' ? '승인 판단 근거를 남길 수 있습니다.' : 'PM이 수정하거나 폐기 판단을 이해할 수 있도록 메모를 남겨 주세요.'}
              className="min-h-[120px]"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting}>취소</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => {
              event.preventDefault();
              void handleConfirmAction();
            }} disabled={acting}>
              {acting ? '저장 중...' : actionMode === 'approve' ? '승인 저장' : actionMode === 'reject' ? '반려 저장' : '폐기 저장'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
