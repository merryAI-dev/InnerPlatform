import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  Plus, Search, FileText, Wallet, Send,
  CheckCircle2, XCircle, Edit3, Trash2,
  Copy, MoreHorizontal, CircleDollarSign, Receipt,
  X, CalendarDays, Table2, ArrowRight, Loader2, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { Textarea } from '../ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '../ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { PageHeader } from '../layout/PageHeader';
import { usePortalStore } from '../../data/portal-store';
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
import {
  BUDGET_CODE_BOOK,
  EXPENSE_STATUS_LABELS, EXPENSE_STATUS_COLORS,
  EVIDENCE_STATUS_LABELS, EVIDENCE_STATUS_COLORS,
  fmtKRW, fmtShort,
  type ExpenseSet, type ExpenseSetStatus, type ExpenseItem,
} from '../../data/budget-data';

// ═══════════════════════════════════════════════════════════════
// PortalExpenses — 사업비 입력/관리 (주간 단위 + 대량 입력)
// ═══════════════════════════════════════════════════════════════

// 주간 기간 생성 헬퍼
function getWeekOptions() {
  const weeks: { value: string; label: string }[] = [];
  const today = new Date();
  const year = today.getFullYear();
  // 현재 달 전후 4개월 커버
  for (let m = -2; m <= 3; m++) {
    const d = new Date(year, today.getMonth() + m, 1);
    const month = d.getMonth();
    const y = d.getFullYear();
    // 각 월의 주차 (1~5주)
    for (let w = 1; w <= 5; w++) {
      const startDay = (w - 1) * 7 + 1;
      const endDay = Math.min(w * 7, new Date(y, month + 1, 0).getDate());
      if (startDay > new Date(y, month + 1, 0).getDate()) break;
      const mm = String(month + 1).padStart(2, '0');
      weeks.push({
        value: `${y}-${mm}-W${w}`,
        label: `${y}년 ${month + 1}월 ${w}주차 (${mm}/${String(startDay).padStart(2, '0')}~${mm}/${String(endDay).padStart(2, '0')})`,
      });
    }
  }
  return weeks;
}

// 빈 행 생성
function emptyRow(setId: string): ExpenseItem {
  return {
    id: `ei-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    setId,
    date: new Date().toISOString().slice(0, 10),
    budgetCode: '',
    subCode: '',
    vendor: '',
    description: '',
    amountNet: 0,
    vat: 0,
    amountGross: 0,
    paymentMethod: 'BANK_TRANSFER',
    evidenceStatus: 'MISSING',
    evidenceFiles: [],
    note: '',
  };
}

export function PortalExpenses() {
  const navigate = useNavigate();
  const {
    isLoading,
    portalUser, myProject, expenseSets,
    addExpenseSet, addExpenseItem, updateExpenseItem, deleteExpenseItem,
    changeExpenseStatus, duplicateExpenseSet,
  } = usePortalStore();

  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState<ExpenseSetStatus | 'ALL'>('ALL');
  const [selectedSet, setSelectedSet] = useState<ExpenseSet | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPeriod, setNewPeriod] = useState('');

  const [submitConfirm, setSubmitConfirm] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    setId: string;
    itemId: string;
    vendor: string;
    amountGross: number;
  } | null>(null);

  // 대량 입력 모드
  const [bulkRows, setBulkRows] = useState<ExpenseItem[]>([]);
  const [showBulkMode, setShowBulkMode] = useState(false);

  const weekOptions = useMemo(() => getWeekOptions(), []);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">사업비 데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!myProject || !portalUser) {
    return (
      <div className="text-center py-16">
        <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
        <p className="text-[14px] text-muted-foreground">사업이 선택되지 않았습니다.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/portal/project-settings')}>
          사업 선택하기
        </Button>
      </div>
    );
  }

  const mySets = expenseSets.filter(s => s.projectId === myProject.id);
  const filteredSets = mySets.filter(s => {
    if (filterStatus !== 'ALL' && s.status !== filterStatus) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      if (!s.title.toLowerCase().includes(q) && !s.period.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const currentSet = selectedSet ? mySets.find(s => s.id === selectedSet.id) || null : null;
  const submitSet = submitConfirm ? mySets.find((s) => s.id === submitConfirm) || null : null;

  const kpi = useMemo(() => ({
    total: mySets.length,
    draft: mySets.filter(s => s.status === 'DRAFT').length,
    submitted: mySets.filter(s => s.status === 'SUBMITTED').length,
    approved: mySets.filter(s => s.status === 'APPROVED').length,
    rejected: mySets.filter(s => s.status === 'REJECTED').length,
    totalAmount: mySets.reduce((sum, s) => sum + s.totalGross, 0),
  }), [mySets]);

  // 새 세트 (주간 기반)
  const handleCreate = () => {
    if (!newTitle) return;
    const weekLabel = weekOptions.find(w => w.value === newPeriod)?.label || newPeriod;
    const newSet: ExpenseSet = {
      id: `es-${Date.now()}`,
      projectId: myProject.id,
      ledgerId: '',
      title: newTitle,
      createdBy: portalUser.id,
      createdByName: portalUser.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'DRAFT',
      period: newPeriod || weekLabel,
      items: [],
      totalNet: 0,
      totalVat: 0,
      totalGross: 0,
    };
    addExpenseSet(newSet);
    setShowCreateDialog(false);
    setNewTitle('');
    setNewPeriod('');
    setSelectedSet(newSet);
  };

  // 자동 제목 생성
  const autoTitle = (period: string) => {
    const w = weekOptions.find(o => o.value === period);
    if (w) return `${w.label} 사업비 정산`;
    return period ? `${period} 사업비 정산` : '';
  };

  // ── 대량 입력 ──
  const startBulkInput = () => {
    setBulkRows(Array.from({ length: 5 }, () => emptyRow(currentSet?.id || '')));
    setShowBulkMode(true);
  };

  const updateBulkRow = (index: number, field: keyof ExpenseItem, value: any) => {
    setBulkRows(prev => {
      const next = [...prev];
      const row = { ...next[index] };
      (row as any)[field] = value;
      // VAT 자동 계산
      if (field === 'amountNet') {
        const net = Number(value) || 0;
        row.vat = Math.round(net * 0.1);
        row.amountGross = net + row.vat;
      }
      next[index] = row;
      return next;
    });
  };

  const addBulkRow = () => {
    setBulkRows(prev => [...prev, emptyRow(currentSet?.id || '')]);
  };

  const removeBulkRow = (index: number) => {
    setBulkRows(prev => prev.filter((_, i) => i !== index));
  };

  const saveBulkItems = () => {
    if (!currentSet) return;
    const validRows = bulkRows.filter(r => r.date && r.vendor && r.amountNet > 0);
    validRows.forEach(row => {
      addExpenseItem(currentSet.id, { ...row, setId: currentSet.id });
    });
    setShowBulkMode(false);
    setBulkRows([]);
  };

  const bulkTotal = useMemo(() => {
    const valid = bulkRows.filter(r => r.amountNet > 0);
    return {
      count: valid.length,
      net: valid.reduce((s, r) => s + (Number(r.amountNet) || 0), 0),
      vat: valid.reduce((s, r) => s + (Number(r.vat) || 0), 0),
      gross: valid.reduce((s, r) => s + (Number(r.amountGross) || 0), 0),
    };
  }, [bulkRows]);

  const isEditable = currentSet && (currentSet.status === 'DRAFT' || currentSet.status === 'REJECTED');

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Wallet}
        iconGradient="linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)"
        title="사업비 입력"
        description={`${myProject.name}의 사업비를 주간 단위로 관리합니다`}
        badge={`${kpi.total}건`}
        actions={
          <Button size="sm" className="h-8 text-[12px] gap-1.5" onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-3.5 h-3.5" /> 새 정산 세트
          </Button>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: '작성중', count: kpi.draft, color: '#64748b', icon: Edit3 },
          { label: '제출완료', count: kpi.submitted, color: '#3b82f6', icon: Send },
          { label: '승인', count: kpi.approved, color: '#059669', icon: CheckCircle2 },
          { label: '반려', count: kpi.rejected, color: '#e11d48', icon: XCircle },
          { label: '합계', count: null, amount: fmtShort(kpi.totalAmount), color: '#4f46e5', icon: CircleDollarSign },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-3 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${k.color}15` }}>
                <k.icon className="w-3.5 h-3.5" style={{ color: k.color }} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">{k.label}</p>
                <p className="text-[15px]" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {k.count !== null ? k.count : k.amount}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="세트명/기간 검색..." className="h-8 pl-8 text-[12px]" />
          </div>
          <Select value={filterStatus} onValueChange={v => setFilterStatus(v as any)}>
            <SelectTrigger className="h-8 w-[120px] text-[12px]"><SelectValue placeholder="상태" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체</SelectItem>
              <SelectItem value="DRAFT">작성중</SelectItem>
              <SelectItem value="SUBMITTED">제출완료</SelectItem>
              <SelectItem value="APPROVED">승인</SelectItem>
              <SelectItem value="REJECTED">반려</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Main */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* 세트 리스트 */}
        <div className={currentSet ? 'lg:w-[340px] shrink-0' : 'w-full'}>
          {filteredSets.length === 0 ? (
            <Card className="p-8 text-center">
              <Receipt className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-[13px] text-muted-foreground">사업비 세트가 없습니다</p>
              <Button size="sm" className="mt-3 gap-1.5" onClick={() => setShowCreateDialog(true)}>
                <Plus className="w-3.5 h-3.5" /> 첫 세트 만들기
              </Button>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredSets.map(s => (
                <Card
                  key={s.id}
                  className={`cursor-pointer transition-all hover:shadow-sm ${s.id === currentSet?.id ? 'ring-2 ring-teal-500/40 shadow-sm' : ''}`}
                  onClick={() => setSelectedSet(s)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[12px] truncate" style={{ fontWeight: 600 }}>{s.title}</span>
                          <Badge className={`text-[9px] h-4 px-1.5 shrink-0 ${EXPENSE_STATUS_COLORS[s.status]}`}>
                            {EXPENSE_STATUS_LABELS[s.status]}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-0.5">
                            <CalendarDays className="w-3 h-3" /> {s.period}
                          </span>
                          <span>{s.items.length}건</span>
                          <span className="ml-auto" style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#4f46e5' }}>
                            {fmtKRW(s.totalGross)}원
                          </span>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={e => e.stopPropagation()}>
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="text-[12px]">
                          <DropdownMenuItem onClick={e => { e.stopPropagation(); duplicateExpenseSet(s.id); }}>
                            <Copy className="w-3.5 h-3.5 mr-2" /> 복제
                          </DropdownMenuItem>
                          {s.status === 'DRAFT' && s.items.length > 0 && (
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); setSubmitConfirm(s.id); }}>
                              <Send className="w-3.5 h-3.5 mr-2" /> 제출하기
                            </DropdownMenuItem>
                          )}
                          {s.status === 'REJECTED' && (
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); changeExpenseStatus(s.id, 'DRAFT'); }}>
                              <Edit3 className="w-3.5 h-3.5 mr-2" /> 재작성
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {s.status === 'REJECTED' && s.rejectedReason && (
                      <div className="mt-2 p-2 rounded-md bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/40 text-[10px] text-rose-700 dark:text-rose-300">
                        <XCircle className="w-3 h-3 inline mr-1" />
                        {s.rejectedReason}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* 선택 세트 상세 */}
        {currentSet && (
          <div className="flex-1 min-w-0">
            <Card className="overflow-hidden">
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-2 p-4 border-b border-border/50">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[14px]" style={{ fontWeight: 700 }}>{currentSet.title}</h3>
                    <Badge className={`text-[9px] h-4 px-1.5 ${EXPENSE_STATUS_COLORS[currentSet.status]}`}>
                      {EXPENSE_STATUS_LABELS[currentSet.status]}
                    </Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                    <CalendarDays className="w-3 h-3" /> {currentSet.period} · {currentSet.items.length}건
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {isEditable && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={startBulkInput}>
                        <Table2 className="w-3 h-3" /> 대량 입력
                      </Button>
                    </>
                  )}
                  {currentSet.status === 'DRAFT' && currentSet.items.length > 0 && (
                    <Button size="sm" className="h-7 text-[11px] gap-1" onClick={() => setSubmitConfirm(currentSet.id)}>
                      <Send className="w-3 h-3" /> 제출
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSelectedSet(null)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* 반려 */}
              {currentSet.status === 'REJECTED' && currentSet.rejectedReason && (
                <div className="px-4 py-2.5 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200/60 dark:border-rose-800/40 text-[11px] text-rose-700 dark:text-rose-300">
                  <XCircle className="w-3.5 h-3.5 inline mr-1" />
                  <strong>반려:</strong> {currentSet.rejectedReason}
                </div>
              )}

              {/* 합계 */}
              <div className="px-4 py-2.5 bg-muted/30 border-b border-border/50 flex flex-wrap items-center gap-4 text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                <span className="text-muted-foreground">공급가액 <strong className="text-foreground">{fmtKRW(currentSet.totalNet)}</strong></span>
                <span className="text-muted-foreground">부가세 <strong className="text-foreground">{fmtKRW(currentSet.totalVat)}</strong></span>
                <span className="ml-auto" style={{ fontWeight: 700, color: '#4f46e5' }}>합계 {fmtKRW(currentSet.totalGross)}원</span>
              </div>

              {/* 항목 테이블 */}
              <div className="overflow-x-auto">
                {currentSet.items.length === 0 ? (
                  <div className="p-8 text-center">
                    <FileText className="w-7 h-7 mx-auto text-muted-foreground/30 mb-2" />
                    <p className="text-[12px] text-muted-foreground mb-3">지출 내역이 없습니다</p>
                    {isEditable && (
                      <Button size="sm" className="gap-1.5" onClick={startBulkInput}>
                        <Table2 className="w-3.5 h-3.5" /> 대량 입력으로 시작
                      </Button>
                    )}
                  </div>
                ) : (
                  <table className="w-full text-[11px] min-w-[600px]">
                    <thead>
                      <tr className="bg-slate-50/60 dark:bg-slate-800/30 border-b border-border">
                        <th className="px-3 py-2 text-left" style={{ fontWeight: 600 }}>일자</th>
                        <th className="px-3 py-2 text-left" style={{ fontWeight: 600 }}>세목</th>
                        <th className="px-3 py-2 text-left" style={{ fontWeight: 600 }}>거래처</th>
                        <th className="px-3 py-2 text-left hidden md:table-cell" style={{ fontWeight: 600 }}>내용</th>
                        <th className="px-3 py-2 text-right" style={{ fontWeight: 600 }}>공급가액</th>
                        <th className="px-3 py-2 text-right" style={{ fontWeight: 600 }}>VAT</th>
                        <th className="px-3 py-2 text-right" style={{ fontWeight: 600 }}>합계</th>
                        <th className="px-3 py-2 text-center" style={{ fontWeight: 600 }}>증빙</th>
                        {isEditable && <th className="px-3 py-2 w-12" />}
                      </tr>
                    </thead>
                    <tbody>
                      {currentSet.items.map(item => (
                        <tr key={item.id} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-3 py-2">{item.date}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.subCode || item.budgetCode}</td>
                          <td className="px-3 py-2" style={{ fontWeight: 500 }}>{item.vendor}</td>
                          <td className="px-3 py-2 max-w-[120px] truncate hidden md:table-cell">{item.description}</td>
                          <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKRW(item.amountNet)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKRW(item.vat)}</td>
                          <td className="px-3 py-2 text-right" style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtKRW(item.amountGross)}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge className={`text-[8px] h-3.5 px-1 ${EVIDENCE_STATUS_COLORS[item.evidenceStatus]}`}>
                              {EVIDENCE_STATUS_LABELS[item.evidenceStatus]}
                            </Badge>
                          </td>
                          {isEditable && (
                            <td className="px-3 py-2">
                              <button
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-rose-600"
                                onClick={() => setDeleteConfirm({
                                  setId: currentSet.id,
                                  itemId: item.id,
                                  vendor: item.vendor,
                                  amountGross: item.amountGross,
                                })}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* 새 세트 다이얼로그 (주간) */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-[14px]">새 정산 세트 (주간)</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-[12px]">정산 기간 (주차)</Label>
              <Select value={newPeriod} onValueChange={v => { setNewPeriod(v); if (!newTitle) setNewTitle(autoTitle(v)); }}>
                <SelectTrigger className="h-9 text-[12px] mt-1"><SelectValue placeholder="주차 선택" /></SelectTrigger>
                <SelectContent>
                  {weekOptions.map(w => (
                    <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[12px]">제목</Label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="자동 생성됨" className="h-9 text-[12px] mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(false)}>취소</Button>
            <Button size="sm" onClick={handleCreate} disabled={!newTitle}>생성</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 대량 입력 다이얼로그 ── */}
      <Dialog open={showBulkMode} onOpenChange={setShowBulkMode}>
        <DialogContent className="max-w-[95vw] lg:max-w-[900px]">
          <DialogHeader>
            <DialogTitle className="text-[14px] flex items-center gap-2">
              <Table2 className="w-4 h-4 text-teal-500" />
              대량 입력 — {currentSet?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-[11px] min-w-[750px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-border">
                  <th className="px-2 py-2 text-left w-8">#</th>
                  <th className="px-2 py-2 text-left" style={{ fontWeight: 600, minWidth: 100 }}>일자</th>
                  <th className="px-2 py-2 text-left" style={{ fontWeight: 600, minWidth: 100 }}>세목</th>
                  <th className="px-2 py-2 text-left" style={{ fontWeight: 600, minWidth: 100 }}>거래처</th>
                  <th className="px-2 py-2 text-left" style={{ fontWeight: 600, minWidth: 100 }}>내용</th>
                  <th className="px-2 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>공급가액</th>
                  <th className="px-2 py-2 text-right" style={{ fontWeight: 600, minWidth: 70 }}>VAT</th>
                  <th className="px-2 py-2 text-right" style={{ fontWeight: 600, minWidth: 90 }}>합계</th>
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((row, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="px-2 py-1 text-muted-foreground text-[10px]">{i + 1}</td>
                    <td className="px-1 py-1">
                      <Input type="date" value={row.date} onChange={e => updateBulkRow(i, 'date', e.target.value)} className="h-7 text-[11px] border-border/50" />
                    </td>
                    <td className="px-1 py-1">
                      <Select value={row.subCode} onValueChange={v => updateBulkRow(i, 'subCode', v)}>
                        <SelectTrigger className="h-7 text-[10px] border-border/50"><SelectValue placeholder="세목" /></SelectTrigger>
                        <SelectContent>
                          {BUDGET_CODE_BOOK.flatMap(c => c.subCodes.map(sc => (
                            <SelectItem key={sc} value={sc}>{sc}</SelectItem>
                          )))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1">
                      <Input value={row.vendor} onChange={e => updateBulkRow(i, 'vendor', e.target.value)} placeholder="거래처" className="h-7 text-[11px] border-border/50" />
                    </td>
                    <td className="px-1 py-1">
                      <Input value={row.description} onChange={e => updateBulkRow(i, 'description', e.target.value)} placeholder="내용" className="h-7 text-[11px] border-border/50" />
                    </td>
                    <td className="px-1 py-1">
                      <Input type="number" value={row.amountNet || ''} onChange={e => updateBulkRow(i, 'amountNet', Number(e.target.value) || 0)} className="h-7 text-[11px] text-right border-border/50" />
                    </td>
                    <td className="px-1 py-1">
                      <Input type="number" value={row.vat || ''} onChange={e => {
                        const vat = Number(e.target.value) || 0;
                        setBulkRows(prev => {
                          const next = [...prev];
                          next[i] = { ...next[i], vat, amountGross: (Number(next[i].amountNet) || 0) + vat };
                          return next;
                        });
                      }} className="h-7 text-[11px] text-right border-border/50 text-muted-foreground" />
                    </td>
                    <td className="px-2 py-1 text-right" style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: row.amountGross > 0 ? '#4f46e5' : undefined }}>
                      {row.amountGross > 0 ? fmtKRW(row.amountGross) : '—'}
                    </td>
                    <td className="px-1 py-1">
                      <button onClick={() => removeBulkRow(i)} className="p-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/20 text-muted-foreground hover:text-rose-600">
                        <X className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 대량 입력 풋터 */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/50">
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={addBulkRow}>
              <Plus className="w-3 h-3" /> 행 추가
            </Button>
            <div className="flex items-center gap-4 text-[10px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <span className="text-muted-foreground">유효 {bulkTotal.count}건</span>
              <span>공급가액 <strong>{fmtKRW(bulkTotal.net)}</strong></span>
              <span>VAT <strong>{fmtKRW(bulkTotal.vat)}</strong></span>
              <span style={{ fontWeight: 700, color: '#4f46e5' }}>합계 {fmtKRW(bulkTotal.gross)}원</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowBulkMode(false)}>취소</Button>
            <Button size="sm" onClick={saveBulkItems} disabled={bulkTotal.count === 0} className="gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> {bulkTotal.count}건 저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 제출 확인 */}
      <AlertDialog open={!!submitConfirm} onOpenChange={(open) => { if (!open) setSubmitConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>사업비 세트를 제출하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              제출 후에는 관리자 승인 전까지 수정할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {submitSet && (
            <div className="text-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">세트명</span>
                <span className="truncate max-w-[220px]" style={{ fontWeight: 700 }}>{submitSet.title}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">항목 수</span>
                <span style={{ fontWeight: 700 }}>{submitSet.items.length}건</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">합계</span>
                <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#4f46e5' }}>
                  {fmtKRW(submitSet.totalGross)}원
                </span>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (!submitSet) return;
                changeExpenseStatus(submitSet.id, 'SUBMITTED');
                toast.success('제출했습니다.');
                setSubmitConfirm(null);
              }}
            >
              제출
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 삭제 확인 */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>지출 항목을 삭제하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              삭제 후에는 복구할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteConfirm && (
            <div className="text-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">거래처</span>
                <span className="truncate max-w-[220px]" style={{ fontWeight: 700 }}>{deleteConfirm.vendor || '-'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">금액</span>
                <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#e11d48' }}>
                  {fmtKRW(deleteConfirm.amountGross)}원
                </span>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
              onClick={(e) => {
                e.preventDefault();
                if (!deleteConfirm) return;
                deleteExpenseItem(deleteConfirm.setId, deleteConfirm.itemId);
                toast.success('삭제했습니다.');
                setDeleteConfirm(null);
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
