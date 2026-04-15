import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Eye,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { ProjectRequestApprovalSection } from '../projects/ProjectRequestApprovalPage';
import { useAppStore } from '../../data/store';
import {
  EXPENSE_SETS,
  EXPENSE_STATUS_COLORS,
  EXPENSE_STATUS_LABELS,
  fmtKRW,
  type ExpenseSet,
  type ExpenseSetStatus,
} from '../../data/budget-data';
import {
  CHANGE_REQUESTS,
  STATE_LABELS,
  type ChangeRequest,
  type ChangeRequestState,
} from '../../data/personnel-change-data';

const priorityLabels: Record<string, string> = {
  HIGH: '긴급',
  MEDIUM: '보통',
  LOW: '낮음',
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

type ApprovalActionDialog =
  | {
      type: 'expense' | 'change';
      id: string;
      action: 'APPROVED' | 'REJECTED';
    }
  | null;

function SectionEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Wallet;
  title: string;
  description: string;
}) {
  return (
    <Card className="border-dashed border-slate-200/80 bg-slate-50/70">
      <CardContent className="flex min-h-[180px] flex-col items-center justify-center gap-2 p-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
          <Icon className="h-5 w-5 text-slate-400" />
        </div>
        <p className="text-[14px] font-semibold text-slate-900">{title}</p>
        <p className="max-w-md text-[12px] leading-6 text-slate-600">{description}</p>
      </CardContent>
    </Card>
  );
}

export function AdminApprovalPage() {
  const navigate = useNavigate();
  const { projects } = useAppStore();
  const [expenseSets, setExpenseSets] = useState<ExpenseSet[]>(EXPENSE_SETS);
  const [changeReqs, setChangeReqs] = useState<ChangeRequest[]>(CHANGE_REQUESTS);
  const [actionDialog, setActionDialog] = useState<ApprovalActionDialog>(null);
  const [actionComment, setActionComment] = useState('');

  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    projects.forEach((project) => map.set(project.id, project.name));
    return map;
  }, [projects]);

  const pendingExpenses = useMemo(
    () => expenseSets.filter((item) => item.status === 'SUBMITTED'),
    [expenseSets],
  );
  const pendingChanges = useMemo(
    () => changeReqs.filter((item) => item.state === 'SUBMITTED'),
    [changeReqs],
  );
  const totalPending = pendingExpenses.length + pendingChanges.length;

  const handleAction = () => {
    if (!actionDialog) return;

    const { action, id, type } = actionDialog;
    if (type === 'expense') {
      setExpenseSets((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          return {
            ...item,
            status: action as ExpenseSetStatus,
            updatedAt: new Date().toISOString(),
            ...(action === 'APPROVED'
              ? { approvedBy: 'admin', approvedAt: new Date().toISOString() }
              : { rejectedReason: actionComment }),
          };
        }),
      );
      toast.success(action === 'APPROVED' ? '사업비 세트가 승인되었습니다' : '사업비 세트가 반려되었습니다');
    } else {
      setChangeReqs((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          return {
            ...item,
            state: action as ChangeRequestState,
            reviewedBy: '관리자',
            reviewedAt: new Date().toISOString(),
            reviewComment: actionComment || undefined,
            timeline: [
              ...item.timeline,
              {
                id: `tl-${Date.now()}`,
                action: action === 'APPROVED' ? '승인' : '반려',
                actor: '관리자',
                timestamp: new Date().toISOString(),
                comment: actionComment || undefined,
                type: action === 'APPROVED' ? 'APPROVE' : 'REJECT',
              },
            ],
          };
        }),
      );
      toast.success(action === 'APPROVED' ? '인력변경 요청이 승인되었습니다' : '인력변경 요청이 반려되었습니다');
    }

    setActionDialog(null);
    setActionComment('');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={CheckCircle2}
        iconGradient="linear-gradient(135deg, #0f766e, #14b8a6)"
        title="승인 대기열"
        description="프로젝트 등록 승인부터 먼저 정리한 뒤 사업비 세트와 인력변경 요청을 처리합니다"
        badge={`대기 ${totalPending}건`}
      />

      <Card className="border-teal-200/80 bg-gradient-to-r from-teal-50 via-white to-slate-50">
        <CardContent className="flex flex-col gap-3 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.08em] text-teal-700" style={{ fontWeight: 700 }}>대표 검토</p>
            <h2 className="text-[22px] tracking-[-0.04em] text-slate-950" style={{ fontWeight: 800 }}>사업 등록 심사</h2>
            <p className="text-[12px] leading-6 text-slate-600">프로젝트 등록 승인부터 먼저 정리합니다. 계약 근거, 재무/정산, 검토 메모를 한 화면에서 보고 결정합니다.</p>
          </div>
          <Badge className="border-0 bg-teal-600 text-white">등록 승인 우선</Badge>
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-teal-50/70">
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="text-[12px] font-semibold text-slate-900">승인 대기 항목</p>
            <p className="text-[12px] leading-6 text-slate-600">
              처리 이력과 보조 KPI는 1차 surface에서 제외하고, 지금 승인해야 하는 항목만 먼저 노출합니다.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] text-slate-500">전체 대기</p>
              <p className="text-[18px] font-bold text-slate-900">{totalPending}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] text-slate-500">사업비</p>
              <p className="text-[18px] font-bold text-indigo-700">{pendingExpenses.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] text-slate-500">인력변경</p>
              <p className="text-[18px] font-bold text-teal-700">{pendingChanges.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {totalPending > 0 && (
        <Card className="border-amber-200/80 bg-amber-50/70">
          <CardContent className="flex items-start gap-3 p-4">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-white">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            </div>
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-slate-900">이번에 처리할 승인 항목이 남아 있습니다</p>
              <p className="text-[11px] leading-6 text-slate-600">
                사업비 세트 {pendingExpenses.length}건, 인력변경 요청 {pendingChanges.length}건을 같은 화면에서 바로 검토할 수 있습니다.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <ProjectRequestApprovalSection compact />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-indigo-600" />
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">사업비 승인 대기</h2>
            <p className="text-[11px] text-slate-500">제출된 사업비 세트만 노출합니다</p>
          </div>
        </div>

        {pendingExpenses.length === 0 ? (
          <SectionEmptyState
            icon={Wallet}
            title="사업비 승인 대기 항목이 없습니다"
            description="새로 제출된 사업비 세트가 생기면 이 영역에 바로 표시됩니다."
          />
        ) : (
          <div className="space-y-3">
            {pendingExpenses.map((item) => (
              <Card key={item.id} className="border-slate-200/80 shadow-sm">
                <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={`text-[10px] ${EXPENSE_STATUS_COLORS[item.status]}`}>
                        {EXPENSE_STATUS_LABELS[item.status]}
                      </Badge>
                      <span className="text-[14px] font-semibold text-slate-900">{item.title}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      <span>사업: {projectMap.get(item.projectId) || item.projectId}</span>
                      <span>작성자: {item.createdByName}</span>
                      <span>기간: {item.period}</span>
                      <span>합계: {fmtKRW(item.totalGross)}원</span>
                    </div>
                    <div className="space-y-1.5">
                      {item.items.slice(0, 3).map((expense) => (
                        <div key={expense.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
                          <span className="text-slate-500">{expense.date}</span>
                          <span className="font-medium text-slate-900">{expense.vendor}</span>
                          <span className="min-w-0 flex-1 truncate text-slate-500">{expense.description}</span>
                          <span className="font-medium text-slate-900">{fmtKRW(expense.amountGross)}원</span>
                        </div>
                      ))}
                      {item.items.length > 3 && (
                        <p className="text-[10px] text-slate-500">외 {item.items.length - 3}건이 더 있습니다.</p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 lg:w-[132px]">
                    <Button
                      size="sm"
                      className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => {
                        setActionDialog({ type: 'expense', id: item.id, action: 'APPROVED' });
                        setActionComment('');
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      승인
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 border-rose-200 text-rose-600 hover:bg-rose-50"
                      onClick={() => {
                        setActionDialog({ type: 'expense', id: item.id, action: 'REJECTED' });
                        setActionComment('');
                      }}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      반려
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      onClick={() => navigate(item.projectId ? `/projects/${item.projectId}` : '/projects')}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      원본 보기
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-4 w-4 text-teal-600" />
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">인력변경 승인 대기</h2>
            <p className="text-[11px] text-slate-500">제출 상태의 요청만 빠르게 검토합니다</p>
          </div>
        </div>

        {pendingChanges.length === 0 ? (
          <SectionEmptyState
            icon={ArrowRightLeft}
            title="인력변경 승인 대기 항목이 없습니다"
            description="신규 인력변경 요청이 들어오면 이 영역에 바로 표시됩니다."
          />
        ) : (
          <div className="space-y-3">
            {pendingChanges.map((item) => (
              <Card key={item.id} className="border-slate-200/80 shadow-sm">
                <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={`text-[10px] ${stateColors[item.state]}`}>{STATE_LABELS[item.state]}</Badge>
                      <Badge className={`text-[10px] ${priorityColors[item.priority]}`}>
                        {priorityLabels[item.priority]}
                      </Badge>
                      <span className="text-[14px] font-semibold text-slate-900">{item.title}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      <span>사업: {item.projectName}</span>
                      <span>요청자: {item.requestedBy}</span>
                      <span>요청일: {new Date(item.requestedAt).toLocaleDateString('ko-KR')}</span>
                      <span>변경: {item.changes.length}건</span>
                    </div>
                    <div className="space-y-1.5">
                      {item.changes.map((change, index) => (
                        <div key={`${item.id}-${index}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px]">
                          <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="font-medium text-slate-900">{change.staffName}</span>
                          <Badge variant="outline" className="h-5 px-1.5 text-[9px]">
                            {change.changeType === 'ADD'
                              ? '투입'
                              : change.changeType === 'REMOVE'
                                ? '해제'
                                : change.changeType === 'RATE_CHANGE'
                                  ? '투입율'
                                  : change.changeType}
                          </Badge>
                          {change.before?.rate !== undefined && change.after?.rate !== undefined && (
                            <span className="text-slate-500">
                              {change.before.rate}% → {change.after.rate}%
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 lg:w-[132px]">
                    <Button
                      size="sm"
                      className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => {
                        setActionDialog({ type: 'change', id: item.id, action: 'APPROVED' });
                        setActionComment('');
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      승인
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 border-rose-200 text-rose-600 hover:bg-rose-50"
                      onClick={() => {
                        setActionDialog({ type: 'change', id: item.id, action: 'REJECTED' });
                        setActionComment('');
                      }}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      반려
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      onClick={() => navigate(item.projectId ? `/projects/${item.projectId}` : '/personnel-changes')}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      원본 보기
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Dialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[14px]">
              {actionDialog?.action === 'APPROVED' ? '승인 확인' : '반려'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div
              className={`rounded-lg border px-3 py-3 text-[11px] ${
                actionDialog?.action === 'APPROVED'
                  ? 'border-emerald-200/60 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200/60 bg-rose-50 text-rose-700'
              }`}
            >
              <div className="flex items-center gap-1.5">
                {actionDialog?.action === 'APPROVED' ? (
                  <>
                    <Clock className="h-3.5 w-3.5" />
                    <span>이 항목을 승인하시겠습니까?</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>반려 사유를 입력해 주세요.</span>
                  </>
                )}
              </div>
            </div>

            <Textarea
              value={actionComment}
              onChange={(event) => setActionComment(event.target.value)}
              className="min-h-[88px] text-[12px]"
              placeholder={actionDialog?.action === 'APPROVED' ? '승인 코멘트 (선택)' : '반려 사유 (필수)'}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setActionDialog(null)}>
              취소
            </Button>
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
