import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  ClipboardCheck, Clock, CheckCircle2, XCircle,
  Wallet, ArrowRightLeft, FileText, Users,
  ArrowRight, AlertTriangle, Eye, Filter,
  Send, RotateCw, Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { PageHeader } from '../layout/PageHeader';
import {
  EXPENSE_SETS, EXPENSE_STATUS_LABELS, EXPENSE_STATUS_COLORS,
  fmtKRW, fmtShort,
  type ExpenseSet, type ExpenseSetStatus,
} from '../../data/budget-data';
import {
  CHANGE_REQUESTS, STATE_LABELS,
  type ChangeRequest, type ChangeRequestState,
} from '../../data/personnel-change-data';
import { PROJECTS } from '../../data/mock-data';
import { toast } from 'sonner';

// ═══════════════════════════════════════════════════════════════
// AdminApprovalPage — 관리자 승인 대기열
// 사업비 세트 + 인력변경 요청 통합 승인 관리
// ═══════════════════════════════════════════════════════════════

const priorityLabels: Record<string, string> = {
  HIGH: '긴급', MEDIUM: '보통', LOW: '낮음',
};
const priorityColors: Record<string, string> = {
  HIGH: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  MEDIUM: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  LOW: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
};

const stateColors: Record<ChangeRequestState, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  SUBMITTED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
  APPROVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
  REJECTED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400',
  REVISION_REQUESTED: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-400',
};

export function AdminApprovalPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('expenses');
  const [expenseSets, setExpenseSets] = useState<ExpenseSet[]>(EXPENSE_SETS);
  const [changeReqs, setChangeReqs] = useState<ChangeRequest[]>(CHANGE_REQUESTS);

  // 승인/반려 다이얼로그
  const [actionDialog, setActionDialog] = useState<{
    type: 'expense' | 'change';
    id: string;
    action: 'APPROVED' | 'REJECTED';
  } | null>(null);
  const [actionComment, setActionComment] = useState('');

  const projectMap = useMemo(() => {
    const m = new Map<string, string>();
    PROJECTS.forEach(p => m.set(p.id, p.name));
    return m;
  }, []);

  // Pending items
  const pendingExpenses = expenseSets.filter(s => s.status === 'SUBMITTED');
  const pendingChanges = changeReqs.filter(r => r.state === 'SUBMITTED');
  const totalPending = pendingExpenses.length + pendingChanges.length;

  // Recent approvals
  const recentApproved = [
    ...expenseSets.filter(s => s.status === 'APPROVED').map(s => ({ type: 'expense' as const, id: s.id, title: s.title, at: s.approvedAt || s.updatedAt })),
    ...changeReqs.filter(r => r.state === 'APPROVED').map(r => ({ type: 'change' as const, id: r.id, title: r.title, at: r.reviewedAt || r.requestedAt })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 5);

  const handleAction = () => {
    if (!actionDialog) return;
    const { type, id, action } = actionDialog;

    if (type === 'expense') {
      setExpenseSets(prev => prev.map(s => {
        if (s.id !== id) return s;
        return {
          ...s,
          status: action as ExpenseSetStatus,
          updatedAt: new Date().toISOString(),
          ...(action === 'APPROVED' ? { approvedBy: 'admin', approvedAt: new Date().toISOString() } : {}),
          ...(action === 'REJECTED' ? { rejectedReason: actionComment } : {}),
        };
      }));
      toast.success(action === 'APPROVED' ? '사업비 세트가 승인되었습니다' : '사업비 세트가 반려되었습니다');
    } else {
      setChangeReqs(prev => prev.map(r => {
        if (r.id !== id) return r;
        return {
          ...r,
          state: action as ChangeRequestState,
          reviewedBy: '관리자',
          reviewedAt: new Date().toISOString(),
          reviewComment: actionComment || undefined,
          timeline: [...r.timeline, {
            id: `tl-${Date.now()}`,
            action: action === 'APPROVED' ? '승인' : '반려',
            actor: '관리자',
            timestamp: new Date().toISOString(),
            comment: actionComment || undefined,
            type: action === 'APPROVED' ? 'APPROVE' as const : 'REJECT' as const,
          }],
        };
      }));
      toast.success(action === 'APPROVED' ? '인력변경 요청이 승인되었습니다' : '인력변경 요청이 반려되었습니다');
    }
    setActionDialog(null);
    setActionComment('');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardCheck}
        iconGradient="linear-gradient(135deg, #f59e0b 0%, #d97706 100%)"
        title="승인 대기열"
        description="사업비 세트·인력변경 요청을 검토하고 승인/반려합니다"
        badge={`대기 ${totalPending}건`}
      />

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: '승인 대기', value: totalPending, icon: Clock, gradient: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#d97706' },
          { label: '사업비 대기', value: pendingExpenses.length, icon: Wallet, gradient: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: '#4f46e5' },
          { label: '인력변경 대기', value: pendingChanges.length, icon: ArrowRightLeft, gradient: 'linear-gradient(135deg, #7c3aed, #a78bfa)', color: '#7c3aed' },
          { label: '최근 처리', value: recentApproved.length, icon: CheckCircle2, gradient: 'linear-gradient(135deg, #059669, #0d9488)', color: '#059669' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: k.gradient }}>
                <k.icon className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">{k.label}</p>
                <p className="text-[18px]" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: k.color }}>
                  {k.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 긴급 알림 */}
      {totalPending > 0 && (
        <Card className="border-amber-200/60 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/10">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <div>
              <p className="text-[12px]" style={{ fontWeight: 600 }}>
                승인 대기 중인 항목이 {totalPending}건 있습니다
              </p>
              <p className="text-[10px] text-muted-foreground">
                사업비 세트 {pendingExpenses.length}건 · 인력변경 {pendingChanges.length}건
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-9">
          <TabsTrigger value="expenses" className="text-[12px] gap-1.5">
            <Wallet className="w-3.5 h-3.5" />
            사업비 ({pendingExpenses.length})
          </TabsTrigger>
          <TabsTrigger value="changes" className="text-[12px] gap-1.5">
            <ArrowRightLeft className="w-3.5 h-3.5" />
            인력변경 ({pendingChanges.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="text-[12px] gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            처리 이력
          </TabsTrigger>
        </TabsList>

        {/* 사업비 세트 */}
        <TabsContent value="expenses" className="space-y-3 mt-3">
          {pendingExpenses.length === 0 ? (
            <Card className="p-8 text-center">
              <Wallet className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-[13px] text-muted-foreground">승인 대기 중인 사업비 세트가 없습니다</p>
            </Card>
          ) : (
            pendingExpenses.map(s => (
              <Card key={s.id} className="overflow-hidden hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Wallet className="w-4 h-4 text-indigo-500 shrink-0" />
                        <span className="text-[13px] truncate" style={{ fontWeight: 600 }}>{s.title}</span>
                        <Badge className={`text-[9px] h-4 px-1.5 ${EXPENSE_STATUS_COLORS[s.status]}`}>
                          {EXPENSE_STATUS_LABELS[s.status]}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {projectMap.get(s.projectId) || s.projectId}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                        <span>작성자: {s.createdByName}</span>
                        <span>기간: {s.period}</span>
                        <span>{s.items.length}건</span>
                        <span style={{ fontWeight: 600, color: '#4f46e5', fontVariantNumeric: 'tabular-nums' }}>
                          합계: {fmtKRW(s.totalGross)}원
                        </span>
                      </div>

                      {/* 항목 미리보기 */}
                      <div className="mt-2 space-y-1">
                        {s.items.slice(0, 3).map(item => (
                          <div key={item.id} className="flex items-center gap-2 text-[10px] p-1.5 rounded bg-muted/30">
                            <span className="text-muted-foreground">{item.date}</span>
                            <span style={{ fontWeight: 500 }}>{item.vendor}</span>
                            <span className="text-muted-foreground truncate flex-1">{item.description}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKRW(item.amountGross)}원</span>
                          </div>
                        ))}
                        {s.items.length > 3 && (
                          <p className="text-[9px] text-muted-foreground pl-1.5">외 {s.items.length - 3}건...</p>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        className="h-7 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => { setActionDialog({ type: 'expense', id: s.id, action: 'APPROVED' }); setActionComment(''); }}
                      >
                        <CheckCircle2 className="w-3 h-3" /> 승인
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] gap-1 text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/30"
                        onClick={() => { setActionDialog({ type: 'expense', id: s.id, action: 'REJECTED' }); setActionComment(''); }}
                      >
                        <XCircle className="w-3 h-3" /> 반려
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px] gap-1"
                        onClick={() => navigate('/expense-management')}
                      >
                        <Eye className="w-3 h-3" /> 상세
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* 인력변경 */}
        <TabsContent value="changes" className="space-y-3 mt-3">
          {pendingChanges.length === 0 ? (
            <Card className="p-8 text-center">
              <ArrowRightLeft className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-[13px] text-muted-foreground">승인 대기 중인 인력변경 요청이 없습니다</p>
            </Card>
          ) : (
            pendingChanges.map(r => (
              <Card key={r.id} className="overflow-hidden hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <ArrowRightLeft className="w-4 h-4 text-violet-500 shrink-0" />
                        <span className="text-[13px] truncate" style={{ fontWeight: 600 }}>{r.title}</span>
                        <Badge className={`text-[9px] h-4 px-1.5 ${stateColors[r.state]}`}>
                          {STATE_LABELS[r.state]}
                        </Badge>
                        <Badge className={`text-[9px] h-4 px-1.5 ${priorityColors[r.priority]}`}>
                          {priorityLabels[r.priority]}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{r.projectName}</p>
                      <div className="flex items-center gap-4 mt-1.5 text-[10px] text-muted-foreground">
                        <span>요청자: {r.requestedBy}</span>
                        <span>요청일: {new Date(r.requestedAt).toLocaleDateString('ko-KR')}</span>
                        <span>{r.changes.length}건 변경</span>
                      </div>

                      {/* 변경 내역 미리보기 */}
                      <div className="mt-2 space-y-1">
                        {r.changes.map((ch, i) => (
                          <div key={i} className="flex items-center gap-2 text-[10px] p-1.5 rounded bg-muted/30">
                            <Users className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span style={{ fontWeight: 500 }}>{ch.staffName}</span>
                            <Badge variant="outline" className="text-[8px] h-3.5 px-1">
                              {ch.changeType === 'ADD' ? '투입' : ch.changeType === 'REMOVE' ? '해제' :
                               ch.changeType === 'RATE_CHANGE' ? '투입율' : ch.changeType}
                            </Badge>
                            {ch.before?.rate !== undefined && ch.after?.rate !== undefined && (
                              <span className="text-muted-foreground">{ch.before.rate}% → {ch.after.rate}%</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        className="h-7 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => { setActionDialog({ type: 'change', id: r.id, action: 'APPROVED' }); setActionComment(''); }}
                      >
                        <CheckCircle2 className="w-3 h-3" /> 승인
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] gap-1 text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/30"
                        onClick={() => { setActionDialog({ type: 'change', id: r.id, action: 'REJECTED' }); setActionComment(''); }}
                      >
                        <XCircle className="w-3 h-3" /> 반려
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px] gap-1"
                        onClick={() => navigate('/personnel-changes')}
                      >
                        <Eye className="w-3 h-3" /> 상세
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* 처리 이력 */}
        <TabsContent value="history" className="mt-3">
          <Card>
            <CardContent className="p-4">
              <div className="space-y-2">
                {/* 승인된 사업비 */}
                {expenseSets.filter(s => s.status === 'APPROVED').slice(0, 5).map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="w-7 h-7 rounded-md bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center shrink-0">
                      <Wallet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] truncate" style={{ fontWeight: 500 }}>{s.title}</p>
                      <p className="text-[10px] text-muted-foreground">{projectMap.get(s.projectId)} · {s.createdByName}</p>
                    </div>
                    <Badge className="text-[9px] h-4 px-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                      <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> 승인
                    </Badge>
                    <span className="text-[10px] text-muted-foreground shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {fmtKRW(s.totalGross)}원
                    </span>
                  </div>
                ))}

                {/* 승인된 인력변경 */}
                {changeReqs.filter(r => r.state === 'APPROVED').slice(0, 5).map(r => (
                  <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="w-7 h-7 rounded-md bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center shrink-0">
                      <ArrowRightLeft className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] truncate" style={{ fontWeight: 500 }}>{r.title}</p>
                      <p className="text-[10px] text-muted-foreground">{r.projectShortName} · {r.requestedBy}</p>
                    </div>
                    <Badge className="text-[9px] h-4 px-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                      <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" /> 승인
                    </Badge>
                  </div>
                ))}

                {/* 반려된 항목 */}
                {[
                  ...expenseSets.filter(s => s.status === 'REJECTED').map(s => ({ type: 'expense', id: s.id, title: s.title, from: s.createdByName })),
                  ...changeReqs.filter(r => r.state === 'REJECTED').map(r => ({ type: 'change', id: r.id, title: r.title, from: r.requestedBy })),
                ].slice(0, 3).map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="w-7 h-7 rounded-md bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center shrink-0">
                      {item.type === 'expense' ? <Wallet className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" /> : <ArrowRightLeft className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] truncate" style={{ fontWeight: 500 }}>{item.title}</p>
                      <p className="text-[10px] text-muted-foreground">{item.from}</p>
                    </div>
                    <Badge className="text-[9px] h-4 px-1.5 bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400">
                      <XCircle className="w-2.5 h-2.5 mr-0.5" /> 반려
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 승인/반려 다이얼로그 */}
      <Dialog open={!!actionDialog} onOpenChange={open => !open && setActionDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[14px]">
              {actionDialog?.action === 'APPROVED' ? '승인 확인' : '반려'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            {actionDialog?.action === 'APPROVED' ? (
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40 text-[11px] text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 inline mr-1" />
                이 항목을 승인하시겠습니까?
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-800/40 text-[11px] text-rose-700 dark:text-rose-300">
                <XCircle className="w-4 h-4 inline mr-1" />
                반려 사유를 입력해 주세요.
              </div>
            )}
            <Textarea
              value={actionComment}
              onChange={e => setActionComment(e.target.value)}
              className="text-[12px] min-h-[80px]"
              placeholder={actionDialog?.action === 'APPROVED' ? '승인 코멘트 (선택)' : '반려 사유 (필수)'}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setActionDialog(null)}>취소</Button>
            <Button
              size="sm"
              onClick={handleAction}
              disabled={actionDialog?.action === 'REJECTED' && !actionComment.trim()}
              className={actionDialog?.action === 'APPROVED' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}
            >
              {actionDialog?.action === 'APPROVED' ? '승인' : '반려'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
