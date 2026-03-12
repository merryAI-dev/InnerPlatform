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
import { toast } from 'sonner';

const STATUS_BADGES: Record<ProjectRequest['status'], string> = {
  PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  APPROVED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  REJECTED: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

function makeSlug(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

export function ProjectRequestApprovalPage() {
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
      const list = snap.docs.map((d) => d.data() as ProjectRequest);
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
      // eslint-disable-next-line no-console
      console.log('[ProjectRequest] processed', req.id, confirmState.mode);
    } catch (err) {
      console.error('[ProjectRequest] action failed:', err);
      const role = user?.role || 'unknown';
      const message = err instanceof Error ? err.message : String(err || 'unknown');
      // eslint-disable-next-line no-console
      console.log('[ProjectRequest] debug', { role, orgId, requestId: req.id });
      // keep dialog open for retry
      toast.error(`승인 처리 실패 (${role}): ${message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">요청을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardCheck}
        iconGradient="linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)"
        title="사업 등록 승인"
        description="포털에서 접수된 사업 등록 요청을 승인/반려합니다."
        badge={`${requests.filter((r) => r.status === 'PENDING').length}건 대기`}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[13px]">요청 목록</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            {requests.map((req) => (
              <div key={req.id} className="p-3 rounded-lg border border-border/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px]" style={{ fontWeight: 700 }}>{req.payload.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {PROJECT_TYPE_LABELS[req.payload.type]} · {req.payload.clientOrg || '-'}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      요청자 {req.requestedByName || '-'} · {req.requestedAt?.slice(0, 10) || '-'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge className={`text-[9px] h-4 px-1.5 border-0 ${STATUS_BADGES[req.status]}`}>
                      {req.status === 'PENDING' ? '대기' : req.status === 'APPROVED' ? '승인' : '반려'}
                    </Badge>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    계약기간 {req.payload.contractStart || '-'} ~ {req.payload.contractEnd || '-'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    계약금액 {req.payload.contractAmount ? req.payload.contractAmount.toLocaleString('ko-KR') : '-'}원
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    상태 {PROJECT_STATUS_LABELS['CONTRACT_PENDING']}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="min-w-[80px]">담당조직</span>
                    <span className="text-foreground/80">{req.payload.department || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="min-w-[80px]">담당자</span>
                    <span className="text-foreground/80">{req.payload.managerName || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="min-w-[80px]">팀명</span>
                    <span className="text-foreground/80">{req.payload.teamName || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="min-w-[80px]">팀원</span>
                    <span className="text-foreground/80">{req.payload.teamMembers || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="min-w-[80px]">참여조건</span>
                    <span className="text-foreground/80">{req.payload.participantCondition || '-'}</span>
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
                    <span className="min-w-[80px]">설명</span>
                    <span className="text-foreground/80">{req.payload.description || '-'}</span>
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
                      <CheckCircle2 className="w-3 h-3 mr-1" /> 승인
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => openReject(req)}
                      disabled={!canApprove}
                    >
                      <XCircle className="w-3 h-3 mr-1" /> 반려
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

      <AlertDialog open={confirmState.open} onOpenChange={(open) => setConfirmState((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmState.mode === 'approve' ? '사업 등록 요청을 승인할까요?' : '사업 등록 요청을 반려할까요?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmState.request?.payload.name || ''} 요청을 {confirmState.mode === 'approve' ? '승인' : '반려'}합니다.
              승인 시 신규 프로젝트가 생성됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmState.mode === 'reject' && (
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
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
    </div>
  );
}
