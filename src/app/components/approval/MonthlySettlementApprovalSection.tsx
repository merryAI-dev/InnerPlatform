import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, Eye, Loader2, RefreshCw, WalletCards, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../../data/store';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import {
  fetchPendingCashflowMonthCloseRequestsViaBff,
  reviewCashflowMonthCloseRequestViaBff,
  type CashflowMonthCloseRequest,
} from '../../lib/platform-bff-client';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Textarea } from '../ui/textarea';

type ReviewAction = { request: CashflowMonthCloseRequest; decision: 'APPROVE' | 'REJECT' } | null;

export function MonthlySettlementApprovalSection({
  onPendingCountChange,
}: {
  onPendingCountChange?: (count: number) => void;
}) {
  const navigate = useNavigate();
  const { projects } = useAppStore();
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const [requests, setRequests] = useState<CashflowMonthCloseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [action, setAction] = useState<ReviewAction>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const load = useCallback(async () => {
    if (!user?.uid || !user.idToken) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const items = await fetchPendingCashflowMonthCloseRequestsViaBff({
        tenantId: orgId,
        actor: user,
      });
      setRequests(items);
      onPendingCountChange?.(items.length);
    } catch (loadError) {
      setError(resolveApiErrorMessage(loadError, '월 결산 승인 요청을 불러오지 못했습니다.'));
      setRequests([]);
      onPendingCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange, orgId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitReview() {
    if (!action || !user?.idToken) return;
    if (action.decision === 'REJECT' && !reason.trim()) return;
    setBusy(true);
    try {
      const expectedRevision = action.request.status === 'APPROVING'
        ? Math.max(0, action.request.revision - 1)
        : action.request.revision;
      await reviewCashflowMonthCloseRequestViaBff({
        tenantId: orgId,
        actor: user,
        projectId: action.request.projectId,
        requestId: action.request.requestId,
        payload: {
          decision: action.decision,
          expectedRevision,
          reason: reason.trim() || undefined,
        },
        idempotencyKey: `cashflow-month-close-review:${action.request.requestId}:${expectedRevision}:${action.decision}`,
      });
      toast.success(action.decision === 'APPROVE' ? '월 결산을 승인했습니다.' : '월 결산을 반려했습니다.');
      setAction(null);
      setReason('');
      await load();
    } catch (reviewError) {
      toast.error(resolveApiErrorMessage(reviewError, '월 결산 검토를 완료하지 못했습니다.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <WalletCards className="h-4 w-4 text-[#001e46]" />
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">월 결산 승인 대기</h2>
            <p className="text-[11px] text-slate-500">내가 지정 조직장인 요청만 표시합니다</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-[11px]" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          새로고침
        </Button>
      </div>

      {error ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center justify-between gap-3 p-4 text-[12px] text-red-700">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>다시 시도</Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card className="border-slate-200 bg-white">
          <CardContent className="flex min-h-[120px] items-center justify-center gap-2 p-6 text-[12px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 월 결산 요청을 불러오고 있습니다.
          </CardContent>
        </Card>
      ) : requests.length === 0 ? (
        <Card className="border-dashed border-slate-200 bg-slate-50">
          <CardContent className="flex min-h-[140px] flex-col items-center justify-center gap-2 p-6 text-center">
            <WalletCards className="h-5 w-5 text-slate-400" />
            <p className="text-[14px] font-semibold text-slate-900">월 결산 승인 대기 항목이 없습니다</p>
            <p className="text-[12px] text-slate-600">지정된 프로젝트의 결산 요청이 들어오면 여기에 표시됩니다.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => (
            <Card key={request.requestId} className="border-slate-200 bg-white shadow-sm">
              <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border border-slate-300 bg-white text-[#001e46]">
                      {request.status === 'APPROVING' ? '승인 처리 재개 필요' : '승인 대기'}
                    </Badge>
                    <span className="text-[14px] font-semibold text-slate-900">
                      {projectNames.get(request.projectId) || request.projectId}
                    </span>
                  </div>
                  <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-[11px] text-slate-600 sm:grid-cols-3">
                    <span>결산월 <strong className="text-slate-900">{request.yearMonth}</strong></span>
                    <span>요청자 <strong className="text-slate-900">{request.requestedByUid}</strong></span>
                    <span>요청일 <strong className="text-slate-900">{new Date(request.requestedAt).toLocaleDateString('ko-KR')}</strong></span>
                  </div>
                  <p className="text-[12px] leading-5 text-slate-600">승인하면 JVM의 최신 revision·시트 고정본 검증을 다시 통과한 뒤 월이 잠깁니다.</p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 lg:w-[132px]">
                  <Button size="sm" className="gap-1 bg-[#001e46] hover:bg-[#001735]" onClick={() => { setAction({ request, decision: 'APPROVE' }); setReason(''); }}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> {request.status === 'APPROVING' ? '처리 재개' : '승인'}
                  </Button>
                  {request.status === 'PENDING' ? (
                    <Button size="sm" variant="outline" className="gap-1 border-slate-300 text-red-700" onClick={() => { setAction({ request, decision: 'REJECT' }); setReason(''); }}>
                      <XCircle className="h-3.5 w-3.5" /> 반려
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => navigate(`/cashflow/projects/${request.projectId}?ym=${encodeURIComponent(request.yearMonth)}`)}>
                    <Eye className="h-3.5 w-3.5" /> 원본 보기
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(action)} onOpenChange={(open) => { if (!open && !busy) setAction(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[14px]">{action?.decision === 'APPROVE' ? '월 결산 승인' : '월 결산 반려'}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="min-h-[88px] text-[12px]"
            placeholder={action?.decision === 'APPROVE' ? '승인 코멘트 (선택)' : '반려 사유 (필수)'}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setAction(null)}>취소</Button>
            <Button
              size="sm"
              disabled={busy || (action?.decision === 'REJECT' && !reason.trim())}
              className={action?.decision === 'APPROVE' ? 'bg-[#001e46] hover:bg-[#001735]' : 'bg-red-700 hover:bg-red-800'}
              onClick={() => void submitReview()}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              {action?.decision === 'APPROVE' ? '승인' : '반려'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
