import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ListChecks, FileText, ArrowRightLeft, ArrowRight, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { PageHeader } from '../layout/PageHeader';
import { usePortalStore } from '../../data/portal-store';
import {
  EXPENSE_STATUS_COLORS,
  EXPENSE_STATUS_LABELS,
  fmtKRW,
  type ExpenseSet,
  type ExpenseSetStatus,
} from '../../data/budget-data';
import {
  STATE_LABELS,
  type ChangeRequest,
  type ChangeRequestState,
} from '../../data/personnel-change-data';
import { computeChangeRequestStateCounts, computeExpenseSetStatusCounts } from '../../data/submissions.helpers';

const CHANGE_STATE_COLORS: Record<ChangeRequestState, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  SUBMITTED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
  APPROVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
  REJECTED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400',
  REVISION_REQUESTED: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-400',
};

function toDate(value?: string) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleDateString('ko-KR');
  } catch {
    return value.slice(0, 10);
  }
}

export function PortalSubmissions() {
  const navigate = useNavigate();
  const { portalUser, myProject, expenseSets, changeRequests } = usePortalStore();
  const [expenseStatus, setExpenseStatus] = useState<ExpenseSetStatus | 'ALL'>('ALL');
  const [changeState, setChangeState] = useState<ChangeRequestState | 'ALL'>('ALL');
  const [query, setQuery] = useState('');

  if (!portalUser || !myProject) return null;

  const myExpenseSets = useMemo(() => {
    return expenseSets
      .filter((s) => s.projectId === myProject.id)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }, [expenseSets, myProject.id]);

  const myChangeRequests = useMemo(() => {
    return changeRequests
      .filter((r) => r.projectId === myProject.id)
      .sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));
  }, [changeRequests, myProject.id]);

  const expenseCounts = useMemo(() => computeExpenseSetStatusCounts(myExpenseSets), [myExpenseSets]);
  const changeCounts = useMemo(() => computeChangeRequestStateCounts(myChangeRequests), [myChangeRequests]);

  const filteredExpenseSets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return myExpenseSets.filter((s) => {
      if (expenseStatus !== 'ALL' && s.status !== expenseStatus) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.period.toLowerCase().includes(q) ||
        (s.rejectedReason || '').toLowerCase().includes(q)
      );
    });
  }, [myExpenseSets, expenseStatus, query]);

  const filteredChangeRequests = useMemo(() => {
    const q = query.trim().toLowerCase();
    return myChangeRequests.filter((r) => {
      if (changeState !== 'ALL' && r.state !== changeState) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.reviewComment || '').toLowerCase().includes(q)
      );
    });
  }, [myChangeRequests, changeState, query]);

  const Summary = ({ label, value, className }: { label: string; value: number; className: string }) => (
    <div className="text-center p-2.5 rounded-lg bg-muted/30">
      <p className={`text-[16px] ${className}`} style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
      <p className="text-[9px] text-muted-foreground">{label}</p>
    </div>
  );

  const ExpenseRow = ({ item }: { item: ExpenseSet }) => (
    <button
      onClick={() => navigate(`/portal/expenses?set=${encodeURIComponent(item.id)}`)}
      className="w-full text-left flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-500/10 shrink-0">
        <FileText className="w-4 h-4 text-indigo-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[12px] truncate" style={{ fontWeight: 700 }}>{item.title}</p>
          <Badge className={`text-[9px] h-4 px-1.5 ${EXPENSE_STATUS_COLORS[item.status]}`}>
            {EXPENSE_STATUS_LABELS[item.status]}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {item.period} · 합계 {fmtKRW(item.totalGross)}원 · 업데이트 {toDate(item.updatedAt)}
        </p>
        {item.status === 'REJECTED' && item.rejectedReason && (
          <p className="text-[10px] mt-1 text-rose-700 dark:text-rose-300">
            반려 사유: {item.rejectedReason}
          </p>
        )}
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
    </button>
  );

  const ChangeRow = ({ item }: { item: ChangeRequest }) => (
    <button
      onClick={() => navigate(`/portal/change-requests?req=${encodeURIComponent(item.id)}`)}
      className="w-full text-left flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors"
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-violet-500/10 shrink-0">
        <ArrowRightLeft className="w-4 h-4 text-violet-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[12px] truncate" style={{ fontWeight: 700 }}>{item.title}</p>
          <Badge className={`text-[9px] h-4 px-1.5 ${CHANGE_STATE_COLORS[item.state]}`}>
            {STATE_LABELS[item.state]}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          신청일 {toDate(item.requestedAt)} · 변경 {item.changes.length}건
        </p>
        {(item.state === 'REJECTED' || item.state === 'REVISION_REQUESTED') && item.reviewComment && (
          <p className="text-[10px] mt-1 text-rose-700 dark:text-rose-300">
            처리 코멘트: {item.reviewComment}
          </p>
        )}
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
    </button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        icon={ListChecks}
        iconGradient="linear-gradient(135deg, #0d9488 0%, #059669 100%)"
        title="내 제출 현황"
        description="제출한 건의 승인 상태와 반려 사유를 빠르게 확인합니다"
      />

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="제목/기간/사유 검색..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="expenses">
        <TabsList>
          <TabsTrigger value="expenses" className="gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            사업비 ({myExpenseSets.length})
          </TabsTrigger>
          <TabsTrigger value="changes" className="gap-1.5">
            <ArrowRightLeft className="w-3.5 h-3.5" />
            인력변경 ({myChangeRequests.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="expenses" className="mt-3 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px]">사업비 상태 요약</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-4 gap-2">
                <Summary label="작성중" value={expenseCounts.DRAFT} className="text-slate-600" />
                <Summary label="제출" value={expenseCounts.SUBMITTED} className="text-blue-600" />
                <Summary label="승인" value={expenseCounts.APPROVED} className="text-emerald-700" />
                <Summary label="반려" value={expenseCounts.REJECTED} className="text-rose-700" />
              </div>

              <div className="flex items-center gap-2 mt-3">
                <span className="text-[11px] text-muted-foreground">필터</span>
                <select
                  value={expenseStatus}
                  onChange={(e) => setExpenseStatus(e.target.value as any)}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-[11px]"
                >
                  <option value="ALL">전체</option>
                  <option value="DRAFT">작성중</option>
                  <option value="SUBMITTED">제출</option>
                  <option value="APPROVED">승인</option>
                  <option value="REJECTED">반려</option>
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-8 text-[11px]"
                  onClick={() => navigate('/portal/expenses')}
                >
                  사업비 입력으로
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {filteredExpenseSets.length === 0 && (
              <p className="text-[12px] text-muted-foreground text-center py-10">
                조건에 맞는 사업비가 없습니다
              </p>
            )}
            {filteredExpenseSets.map((s) => (
              <ExpenseRow key={s.id} item={s} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="changes" className="mt-3 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px]">인력변경 상태 요약</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-5 gap-2">
                <Summary label="작성중" value={changeCounts.DRAFT} className="text-slate-600" />
                <Summary label="제출" value={changeCounts.SUBMITTED} className="text-blue-600" />
                <Summary label="승인" value={changeCounts.APPROVED} className="text-emerald-700" />
                <Summary label="반려" value={changeCounts.REJECTED} className="text-rose-700" />
                <Summary label="수정요청" value={changeCounts.REVISION_REQUESTED} className="text-orange-700" />
              </div>

              <div className="flex items-center gap-2 mt-3">
                <span className="text-[11px] text-muted-foreground">필터</span>
                <select
                  value={changeState}
                  onChange={(e) => setChangeState(e.target.value as any)}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-[11px]"
                >
                  <option value="ALL">전체</option>
                  <option value="DRAFT">작성중</option>
                  <option value="SUBMITTED">제출</option>
                  <option value="APPROVED">승인</option>
                  <option value="REJECTED">반려</option>
                  <option value="REVISION_REQUESTED">수정요청</option>
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-8 text-[11px]"
                  onClick={() => navigate('/portal/change-requests')}
                >
                  인력변경 신청으로
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            {filteredChangeRequests.length === 0 && (
              <p className="text-[12px] text-muted-foreground text-center py-10">
                조건에 맞는 인력변경 신청이 없습니다
              </p>
            )}
            {filteredChangeRequests.map((r) => (
              <ChangeRow key={r.id} item={r} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

