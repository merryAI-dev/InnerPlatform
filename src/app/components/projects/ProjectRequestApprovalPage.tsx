import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Loader2, XCircle } from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { useFirebase } from '../../lib/firebase-context';
import { useAuth } from '../../data/auth-store';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
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
import {
  ACCOUNT_TYPE_LABELS,
  BASIS_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  SETTLEMENT_TYPE_LABELS,
  type ProjectRequest,
} from '../../data/types';
import { getOrgCollectionPath, getOrgDocumentPath } from '../../lib/firebase';
import { formatProjectTeamMembersSummary } from '../../platform/project-team-members';
import { formatStoredProjectAmount } from '../../platform/project-contract-amount';

const STATUS_BADGES: Record<ProjectRequest['status'], string> = {
  PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  APPROVED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  REJECTED: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

interface ProjectRequestApprovalSectionProps {
  compact?: boolean;
}

function useProjectRequests() {
  const { db, orgId, isOnline } = useFirebase();
  const { user } = useAuth();
  const [requests, setRequests] = useState<ProjectRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    mode: 'approve' | 'reject';
    request: ProjectRequest | null;
  }>({ open: false, mode: 'approve', request: null });
  const [rejectReason, setRejectReason] = useState('');
  const [saving, setSaving] = useState(false);

  const canApprove = useMemo(() => {
    const role = user?.role;
    return role === 'admin' || role === 'tenant_admin' || role === 'finance';
  }, [user?.role]);

  useEffect(() => {
    if (!db || !isOnline) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, getOrgCollectionPath(orgId, 'projectRequests')),
      orderBy('requestedAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((requestDoc) => requestDoc.data() as ProjectRequest);
      setRequests(list);
      setLoading(false);
    }, (err) => {
      console.error('[ProjectRequest] listen error:', err);
      setRequests([]);
      setLoading(false);
    });
    return () => unsub();
  }, [db, isOnline, orgId]);

  const openApprove = (request: ProjectRequest) => {
    setConfirmState({ open: true, mode: 'approve', request });
    setRejectReason('');
  };

  const openReject = (request: ProjectRequest) => {
    setConfirmState({ open: true, mode: 'reject', request });
    setRejectReason('');
  };

  const handleConfirm = async () => {
    if (!confirmState.request || !db) return;
    if (!canApprove) {
      console.warn('[ProjectRequest] approve blocked: insufficient role');
      return;
    }
    const req = confirmState.request;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (confirmState.mode === 'approve') {
        await setDoc(
          doc(db, getOrgDocumentPath(orgId, 'projectRequests', req.id)),
          {
            status: 'APPROVED',
            reviewedBy: user?.uid || '',
            reviewedByName: user?.name || '',
            reviewedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
      } else {
        await setDoc(
          doc(db, getOrgDocumentPath(orgId, 'projectRequests', req.id)),
          {
            status: 'REJECTED',
            reviewedBy: user?.uid || '',
            reviewedByName: user?.name || '',
            reviewedAt: now,
            rejectedReason: rejectReason.trim(),
            updatedAt: now,
          },
          { merge: true },
        );
      }
      setConfirmState({ open: false, mode: 'approve', request: null });
      setRejectReason('');
    } catch (err) {
      console.error('[ProjectRequest] action failed:', err);
      const role = user?.role || 'unknown';
      const message = err instanceof Error ? err.message : String(err || 'unknown');
      toast.error(`승인 처리 실패 (${role}): ${message}`);
    } finally {
      setSaving(false);
    }
  };

  return {
    requests,
    loading,
    confirmState,
    rejectReason,
    saving,
    canApprove,
    openApprove,
    openReject,
    setRejectReason,
    setConfirmState,
    handleConfirm,
  };
}

function ProjectRequestApprovalDialog({
  confirmState,
  rejectReason,
  saving,
  setRejectReason,
  setConfirmState,
  handleConfirm,
}: ReturnType<typeof useProjectRequests>) {
  return (
    <AlertDialog open={confirmState.open} onOpenChange={(open) => setConfirmState((prev) => ({ ...prev, open }))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirmState.mode === 'approve' ? '사업 등록 요청을 승인할까요?' : '사업 등록 요청을 반려할까요?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmState.request?.payload.name || ''} 요청을 {confirmState.mode === 'approve' ? '승인' : '반려'}합니다.
            승인 시 등록 요청 상태만 갱신되고, 실제 프로젝트 생성은 후속 워크플로에서 이어집니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {confirmState.mode === 'reject' && (
          <Textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="반려 사유를 입력하세요 (선택)"
            className="min-h-[90px]"
          />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={saving}>
            {saving ? '처리 중...' : '확인'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ProjectRequestApprovalSection({ compact = false }: ProjectRequestApprovalSectionProps) {
  const state = useProjectRequests();
  const { requests, loading, canApprove, openApprove, openReject } = state;
  const pendingCount = requests.filter((request) => request.status === 'PENDING').length;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-teal-600" />
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">사업 등록 요청</h2>
          <p className="text-[11px] text-slate-500">포털에서 제출된 등록 제안을 같은 승인 큐에서 처리합니다</p>
        </div>
        <Badge className="ml-auto bg-teal-100 text-teal-800">{pendingCount}건 대기</Badge>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex min-h-[180px] flex-col items-center justify-center gap-2 p-6 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-[12px] text-muted-foreground">사업 등록 요청을 불러오는 중입니다.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-200/80 shadow-sm">
          {!compact && (
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px]">등록 요청 목록</CardTitle>
            </CardHeader>
          )}
          <CardContent className={compact ? 'p-4' : 'pt-0'}>
            <div className="space-y-3">
              {requests.map((req) => (
                <div key={req.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-slate-900">{req.payload.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {PROJECT_TYPE_LABELS[req.payload.type]} · {req.payload.clientOrg || '-'}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        요청자 {req.requestedByName || '-'} · {req.requestedAt?.slice(0, 10) || '-'}
                      </p>
                    </div>
                    <Badge className={`text-[9px] h-4 px-1.5 border-0 ${STATUS_BADGES[req.status]}`}>
                      {req.status === 'PENDING' ? '대기' : req.status === 'APPROVED' ? '승인' : '반려'}
                    </Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                    <span>계약기간 {req.payload.contractStart || '-'} ~ {req.payload.contractEnd || '-'}</span>
                    <span>계약금액 {formatStoredProjectAmount(req.payload.contractAmount, req.payload.financialInputFlags?.contractAmount)}</span>
                    <span>상태 {PROJECT_STATUS_LABELS.CONTRACT_PENDING}</span>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 text-[10px] text-muted-foreground md:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">공식계약명</span>
                      <span className="text-foreground/80">{req.payload.officialContractName || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">등록명</span>
                      <span className="text-foreground/80">{req.payload.name || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">담당조직</span>
                      <span className="text-foreground/80">{req.payload.department || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">담당자</span>
                      <span className="text-foreground/80">{req.payload.managerName || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">팀원</span>
                      <span className="whitespace-pre-line text-foreground/80">
                        {formatProjectTeamMembersSummary(req.payload.teamMembersDetailed, req.payload.teamMembers, '\n')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">계약대상</span>
                      <span className="text-foreground/80">{req.payload.clientOrg || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">참여조건</span>
                      <span className="text-foreground/80">{req.payload.participantCondition || '-'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">매출부가세</span>
                      <span className="text-foreground/80">
                        {formatStoredProjectAmount(req.payload.salesVatAmount, req.payload.financialInputFlags?.salesVatAmount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">총수익</span>
                      <span className="text-foreground/80">
                        {formatStoredProjectAmount(req.payload.totalRevenueAmount, req.payload.financialInputFlags?.totalRevenueAmount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">지원금</span>
                      <span className="text-foreground/80">
                        {formatStoredProjectAmount(req.payload.supportAmount, req.payload.financialInputFlags?.supportAmount)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">정산유형</span>
                      <span className="text-foreground/80">
                        {req.payload.settlementType ? SETTLEMENT_TYPE_LABELS[req.payload.settlementType] : '-'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">기준</span>
                      <span className="text-foreground/80">
                        {req.payload.basis ? BASIS_LABELS[req.payload.basis] : '-'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[80px]">계좌유형</span>
                      <span className="text-foreground/80">
                        {req.payload.accountType ? ACCOUNT_TYPE_LABELS[req.payload.accountType] : '-'}
                      </span>
                    </div>
                    <div className="flex items-start gap-2 md:col-span-2">
                      <span className="min-w-[80px]">목적</span>
                      <span className="text-foreground/80">{req.payload.projectPurpose || '-'}</span>
                    </div>
                    <div className="flex items-start gap-2 md:col-span-2">
                      <span className="min-w-[80px]">주요내용</span>
                      <span className="text-foreground/80">{req.payload.description || '-'}</span>
                    </div>
                    <div className="flex items-start gap-2 md:col-span-2">
                      <span className="min-w-[80px]">수령/정산</span>
                      <span className="text-foreground/80">{req.payload.settlementGuide || '-'}</span>
                    </div>
                    <div className="flex items-start gap-2 md:col-span-2">
                      <span className="min-w-[80px]">첨부</span>
                      {req.payload.contractDocument?.downloadURL ? (
                        <a
                          href={req.payload.contractDocument.downloadURL}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground/80 underline underline-offset-2"
                        >
                          {req.payload.contractDocument.name}
                        </a>
                      ) : (
                        <span className="text-foreground/80">-</span>
                      )}
                    </div>
                    <div className="flex items-start gap-2 md:col-span-2">
                      <span className="min-w-[80px]">비고</span>
                      <span className="text-foreground/80">{req.payload.note || '-'}</span>
                    </div>
                  </div>

                  {req.status === 'REJECTED' && req.rejectedReason && (
                    <div className="mt-2 text-[10px] text-rose-600">
                      반려 사유: {req.rejectedReason}
                    </div>
                  )}

                  {req.status === 'PENDING' && (
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => openApprove(req)}
                        disabled={!canApprove}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        승인
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => openReject(req)}
                        disabled={!canApprove}
                      >
                        <XCircle className="mr-1 h-3 w-3" />
                        반려
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              {requests.length === 0 && (
                <div className="py-8 text-center text-[12px] text-muted-foreground">
                  접수된 사업 등록 요청이 없습니다.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <ProjectRequestApprovalDialog {...state} />
    </section>
  );
}

export function ProjectRequestApprovalPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardCheck}
        iconGradient="linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)"
        title="사업 등록 승인"
        description="포털에서 접수된 사업 등록 요청을 승인/반려합니다."
        badge="승인 큐"
      />
      <ProjectRequestApprovalSection compact />
    </div>
  );
}

export default ProjectRequestApprovalPage;
