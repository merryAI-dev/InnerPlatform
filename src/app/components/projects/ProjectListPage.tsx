import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Plus, Search, ArrowUpDown, Sparkles, CheckCircle2, ArrowRight,
  FolderKanban, RotateCcw, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { useAppStore } from '../../data/store';
import {
  PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS, PROJECT_TYPE_SHORT_LABELS,
  SETTLEMENT_TYPE_SHORT, ACCOUNT_TYPE_LABELS,
  type ProjectStatus, type ProjectType, type Project,
} from '../../data/types';
import { PageHeader } from '../layout/PageHeader';
import { useAuth } from '../../data/auth-store';
import { canShowAdminNavItem } from '../../platform/admin-nav';
import { resolveApiErrorMessage } from '../../platform/api-error-message';

const statusColor: Record<string, string> = {
  CONTRACT_PENDING: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  COMPLETED: 'bg-green-100 text-green-800',
  COMPLETED_PENDING_PAYMENT: 'bg-teal-100 text-teal-800',
};

function fmtFull(n: number) {
  return n.toLocaleString('ko-KR');
}

function fmtPercent(n: number) {
  if (n === 0) return '-';
  return (n * 100).toFixed(2) + '%';
}

type SortKey = 'name' | 'contractAmount' | 'profitRate' | 'budgetCurrentYear' | 'status';
type SortDir = 'asc' | 'desc';

export function ProjectListPage() {
  const { allProjects, restoreProject } = useAppStore();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('contractAmount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [activeTab, setActiveTab] = useState<string>('confirmed');

  const activeProjects = useMemo(
    () => allProjects.filter((project) => !project.trashedAt),
    [allProjects],
  );
  const trashedProjects = useMemo(
    () => allProjects.filter((project) => !!project.trashedAt),
    [allProjects],
  );
  const confirmedProjects = useMemo(
    () => activeProjects.filter((project) => project.phase === 'CONFIRMED'),
    [activeProjects],
  );
  const prospectProjects = useMemo(
    () => activeProjects.filter((project) => project.phase === 'PROSPECT'),
    [activeProjects],
  );
  const baseProjects = activeTab === 'trash'
    ? trashedProjects
    : activeTab === 'confirmed'
      ? confirmedProjects
      : prospectProjects;

  const departments = useMemo(() => {
    const depts = new Set(baseProjects.map((project) => project.department).filter(Boolean));
    return Array.from(depts).sort();
  }, [baseProjects]);
  const canCreateProject = canShowAdminNavItem(user?.role, '/projects/new');
  const hasActiveFilters = !!search || statusFilter !== 'ALL' || typeFilter !== 'ALL' || deptFilter !== 'ALL';

  const filtered = useMemo(() => {
    let result = baseProjects.filter(p => {
      if (search) {
        const q = search.toLowerCase();
        const matches = p.name.toLowerCase().includes(q)
          || p.clientOrg?.toLowerCase().includes(q)
          || p.department?.toLowerCase().includes(q)
          || p.managerName?.toLowerCase().includes(q)
          || p.groupwareName?.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && p.type !== typeFilter) return false;
      if (deptFilter !== 'ALL' && p.department !== deptFilter) return false;
      return true;
    });

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'contractAmount': cmp = a.contractAmount - b.contractAmount; break;
        case 'profitRate': cmp = a.profitRate - b.profitRate; break;
        case 'budgetCurrentYear': cmp = a.budgetCurrentYear - b.budgetCurrentYear; break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [baseProjects, search, statusFilter, typeFilter, deptFilter, sortKey, sortDir]);

  const totals = useMemo(() => ({
    totalContract: filtered.reduce((s, p) => s + p.contractAmount, 0),
    totalBudget2026: filtered.reduce((s, p) => s + p.budgetCurrentYear, 0),
    totalTaxInvoice: filtered.reduce((s, p) => s + p.taxInvoiceAmount, 0),
    totalProfit: filtered.filter(p => p.profitAmount > 0).reduce((s, p) => s + p.profitAmount, 0),
  }), [filtered]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleRestore = async (project: Project) => {
    try {
      await restoreProject(project.id);
      toast.success(`휴지통에서 복구됨: ${project.name}`);
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, '프로젝트 복구에 실패했습니다.'));
    }
  };

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('ALL');
    setTypeFilter('ALL');
    setDeptFilter('ALL');
  };

  const renderEmptyState = () => {
    if (hasActiveFilters) {
      return (
        <Card data-testid="projects-empty-state" className="border-slate-200/80 bg-slate-50/80">
          <CardContent className="flex min-h-[260px] items-center justify-center p-6">
            <div className="max-w-md text-center">
              <p className="text-[18px] font-semibold text-slate-900">검색 조건에 맞는 사업이 없습니다</p>
              <p className="mt-2 text-[13px] leading-6 text-slate-600">
                필터를 초기화하고 전체 포트폴리오를 다시 보거나, 필요한 경우 새 사업을 바로 등록할 수 있습니다.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" onClick={resetFilters}>필터 초기화</Button>
                {canCreateProject && (
                  <Button variant="outline" size="sm" onClick={() => navigate('/projects/new?phase=CONFIRMED')}>
                    새 사업 등록
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    const stateByTab = activeTab === 'prospect'
      ? {
        eyebrow: 'Pipeline Start',
        title: '첫 예정 사업을 등록해보세요',
        description: '입찰 단계부터 기본 정보를 쌓아두면 선정 직후 확정 전환과 정산 준비가 훨씬 빨라집니다.',
        primaryLabel: canCreateProject ? '예정 사업 등록' : null,
        primaryAction: () => navigate('/projects/new?phase=PROSPECT'),
        secondaryLabel: canCreateProject ? '확정 사업 보기' : null,
        secondaryAction: () => setActiveTab('confirmed'),
      }
      : activeTab === 'trash'
        ? {
          eyebrow: 'Clean Slate',
          title: '휴지통이 비어 있습니다',
          description: '삭제된 프로젝트가 생기면 이 탭에서 복구할 수 있습니다. 지금은 활성 포트폴리오만 관리 중입니다.',
          primaryLabel: '확정 사업 보기',
          primaryAction: () => setActiveTab('confirmed'),
          secondaryLabel: canCreateProject ? '예정 사업 보기' : null,
          secondaryAction: () => setActiveTab('prospect'),
        }
        : {
          eyebrow: 'Portfolio Start',
          title: '확정 사업 포트폴리오를 시작하세요',
          description: '외부 고객에게 실제로 제공되는 사업 운영은 여기서 시작됩니다. 첫 확정 사업을 등록하거나 예정 사업을 확정으로 전환하세요.',
          primaryLabel: canCreateProject ? '확정 사업 등록' : null,
          primaryAction: () => navigate('/projects/new?phase=CONFIRMED'),
          secondaryLabel: '입찰/예정 보기',
          secondaryAction: () => setActiveTab('prospect'),
        };

    return (
      <Card data-testid="projects-empty-state" className="border-indigo-200/70 bg-gradient-to-br from-indigo-50 via-white to-teal-50/70">
        <CardContent className="p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-indigo-700">{stateByTab.eyebrow}</p>
              <div className="space-y-2">
                <h2 className="text-[22px] font-extrabold tracking-[-0.03em] text-slate-900">{stateByTab.title}</h2>
                <p className="text-[13px] leading-6 text-slate-600">{stateByTab.description}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              {stateByTab.primaryLabel && (
                <Button size="sm" onClick={stateByTab.primaryAction}>
                  {stateByTab.primaryLabel}
                </Button>
              )}
              {stateByTab.secondaryLabel && stateByTab.secondaryAction && (
                <Button variant="outline" size="sm" onClick={stateByTab.secondaryAction}>
                  {stateByTab.secondaryLabel}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderProjectTable = (list: Project[]) => (
    <Card>
      <CardContent className="pt-0 pb-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[60px]">담당조직</TableHead>
                <TableHead className="min-w-[70px]">등록명</TableHead>
                <TableHead className="min-w-[50px]">통장</TableHead>
                <TableHead className="min-w-[200px] cursor-pointer" onClick={() => handleSort('name')}>
                  <span className="flex items-center gap-1">
                    사업명 <ArrowUpDown className="w-3 h-3" />
                  </span>
                </TableHead>
                <TableHead className="min-w-[80px]">발주기관</TableHead>
                <TableHead className="min-w-[80px]">사업유형</TableHead>
                <TableHead className="min-w-[55px]">정산</TableHead>
                <TableHead className="min-w-[70px]">팀(팀장)</TableHead>
                <TableHead className="min-w-[70px]">담당자</TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('status')}>
                  <span className="flex items-center gap-1">
                    상태 <ArrowUpDown className="w-3 h-3" />
                  </span>
                </TableHead>
                <TableHead className="min-w-[90px]">계약기간</TableHead>
                <TableHead className="min-w-[80px]">입금계획</TableHead>
                <TableHead className="text-right min-w-[100px] cursor-pointer" onClick={() => handleSort('contractAmount')}>
                  <span className="flex items-center justify-end gap-1">
                    총 사업비 <ArrowUpDown className="w-3 h-3" />
                  </span>
                </TableHead>
                <TableHead className="text-right min-w-[100px] cursor-pointer" onClick={() => handleSort('budgetCurrentYear')}>
                  <span className="flex items-center justify-end gap-1">
                    2026년 예산 <ArrowUpDown className="w-3 h-3" />
                  </span>
                </TableHead>
                <TableHead className="text-right min-w-[80px]">세금계산서</TableHead>
                <TableHead className="text-right min-w-[60px] cursor-pointer" onClick={() => handleSort('profitRate')}>
                  <span className="flex items-center justify-end gap-1">
                    수익률 <ArrowUpDown className="w-3 h-3" />
                  </span>
                </TableHead>
                <TableHead className="text-right min-w-[80px]">수익금액</TableHead>
                <TableHead className="min-w-[35px] text-center">정산</TableHead>
                {activeTab === 'trash' && (
                  <>
                    <TableHead className="min-w-[90px]">삭제일</TableHead>
                    <TableHead className="min-w-[90px] text-center">액션</TableHead>
                  </>
                )}
                {activeTab === 'prospect' && (
                  <TableHead className="min-w-[60px] text-center">액션</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map(p => (
                <TableRow
                  key={p.id}
                  data-testid={activeTab === 'trash' ? `project-trash-row-${p.id}` : `project-list-row-${p.id}`}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => navigate(`/projects/${p.id}`)}
                >
                  <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {p.department || '-'}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground max-w-[80px] truncate">
                    {p.groupwareName || '-'}
                  </TableCell>
                  <TableCell className="text-[11px]">
                    <span className={`inline-flex rounded px-1 py-0 text-[10px] ${
                      p.accountType === 'DEDICATED'
                        ? 'bg-blue-50 text-blue-700'
                        : p.accountType === 'OPERATING'
                          ? 'bg-slate-100 text-slate-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}>
                      {ACCOUNT_TYPE_LABELS[p.accountType]}
                    </span>
                  </TableCell>
                  <TableCell style={{ fontWeight: 500 }} className="max-w-[220px] truncate text-sm">
                    {p.name}
                  </TableCell>
                  <TableCell className="text-[11px] whitespace-nowrap">{p.clientOrg || '-'}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {PROJECT_TYPE_SHORT_LABELS[p.type]}
                  </TableCell>
                  <TableCell className="text-[11px] whitespace-nowrap">
                    {SETTLEMENT_TYPE_SHORT[p.settlementType]}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground max-w-[80px] truncate">
                    {p.teamName || '-'}
                  </TableCell>
                  <TableCell className="text-[11px] whitespace-nowrap">
                    {p.managerName || '-'}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] whitespace-nowrap ${statusColor[p.status]}`}>
                      {PROJECT_STATUS_LABELS[p.status]}
                    </span>
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {p.contractStart ? `${p.contractStart.replace(/-/g, '.')}` : '-'}
                    {p.contractEnd ? ` ~ ${p.contractEnd.replace(/-/g, '.')}` : ''}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground max-w-[80px] truncate">
                    {p.paymentPlanDesc || '-'}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap">
                    {p.contractAmount > 0 ? fmtFull(p.contractAmount) : '-'}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap">
                    {p.budgetCurrentYear > 0 ? fmtFull(p.budgetCurrentYear) : '-'}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap">
                    {p.taxInvoiceAmount > 0 ? fmtFull(p.taxInvoiceAmount) : '-'}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap">
                    {p.profitRate > 0 ? (
                      <span className={p.profitRate >= 0.1 ? 'text-emerald-700' : p.profitRate >= 0.05 ? 'text-amber-700' : 'text-red-600'}>
                        {fmtPercent(p.profitRate)}
                      </span>
                    ) : '-'}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap">
                    {p.profitAmount > 0 ? fmtFull(p.profitAmount) : '-'}
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {p.isSettled ? (
                      <span className="text-green-600">O</span>
                    ) : (
                      <span className="text-muted-foreground">X</span>
                    )}
                  </TableCell>
                  {activeTab === 'trash' && (
                    <>
                      <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {p.trashedAt ? p.trashedAt.slice(0, 10).replace(/-/g, '.') : '-'}
                      </TableCell>
                      <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] gap-0.5 px-1.5"
                          onClick={() => void handleRestore(p)}
                        >
                          복구 <RotateCcw className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </>
                  )}
                  {activeTab === 'prospect' && (
                    <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] gap-0.5 px-1.5"
                        onClick={() => navigate(`/projects/${p.id}/edit?phase=CONFIRMED`)}
                      >
                        확정 <ArrowRight className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}

              {/* Totals Row */}
              {list.length > 0 && activeTab !== 'trash' && (
                <TableRow className="bg-muted/50 border-t-2">
                  <TableCell colSpan={12} className="text-right text-sm" style={{ fontWeight: 600 }}>
                    합계
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap" style={{ fontWeight: 600 }}>
                    {fmtFull(totals.totalContract)}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap" style={{ fontWeight: 600 }}>
                    {fmtFull(totals.totalBudget2026)}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap" style={{ fontWeight: 600 }}>
                    {fmtFull(totals.totalTaxInvoice)}
                  </TableCell>
                  <TableCell className="text-right text-sm" style={{ fontWeight: 600 }}>
                    -
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap" style={{ fontWeight: 600 }}>
                    {fmtFull(totals.totalProfit)}
                  </TableCell>
                  <TableCell />
                  {activeTab === 'prospect' && <TableCell />}
                </TableRow>
              )}

              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={activeTab === 'trash' ? 20 : activeTab === 'prospect' ? 19 : 18} className="text-center py-12 text-muted-foreground">
                    {search || statusFilter !== 'ALL' || typeFilter !== 'ALL' || deptFilter !== 'ALL'
                      ? '검색 조건에 맞는 사업이 없습니다'
                      : activeTab === 'trash'
                        ? '휴지통이 비어 있습니다.'
                        : activeTab === 'prospect'
                          ? (canCreateProject ? '예정 사업이 없습니다. 새 사업을 등록해보세요.' : '예정 사업이 없습니다.')
                          : '확정 사업이 없습니다.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        icon={FolderKanban}
        iconGradient="linear-gradient(135deg, #6366f1, #818cf8)"
        title="사업 통합 관리"
        description={`활성 ${activeProjects.length}개 사업 · 확정 ${confirmedProjects.length} / 예정 ${prospectProjects.length} / 휴지통 ${trashedProjects.length}`}
        actions={
          canCreateProject ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/projects/new?phase=PROSPECT')}
                className="gap-1.5 h-8 text-[11px]"
              >
                <Sparkles className="w-3.5 h-3.5" />
                예정 등록
              </Button>
              <Button
                size="sm"
                onClick={() => navigate('/projects/new?phase=CONFIRMED')}
                className="gap-1.5 h-8 text-[11px]"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #6366f1)' }}
              >
                <Plus className="w-3.5 h-3.5" />
                확정 등록
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="confirmed" className="gap-1.5" data-testid="projects-tab-confirmed">
            <CheckCircle2 className="w-3.5 h-3.5" />
            확정 사업
            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
              {confirmedProjects.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="prospect" className="gap-1.5" data-testid="projects-tab-prospect">
            <Sparkles className="w-3.5 h-3.5" />
            입찰/예정
            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
              {prospectProjects.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="trash" className="gap-1.5" data-testid="projects-tab-trash">
            <Trash2 className="w-3.5 h-3.5" />
            휴지통
            <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
              {trashedProjects.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* Filters */}
        <Card className="mt-3">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="사업명, 발주기관, 담당자 검색..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">전체 상태</SelectItem>
                  {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map(k => (
                    <SelectItem key={k} value={k}>{PROJECT_STATUS_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">전체 유형</SelectItem>
                  {(Object.keys(PROJECT_TYPE_LABELS) as ProjectType[]).map(k => (
                    <SelectItem key={k} value={k}>{PROJECT_TYPE_SHORT_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">전체 조직</SelectItem>
                  {departments.map(d => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">
                {filtered.length}개 사업
              </span>
            </div>
          </CardContent>
        </Card>

        <TabsContent value="confirmed" className="mt-0">
          {activeTab === 'confirmed' && (filtered.length === 0 ? renderEmptyState() : renderProjectTable(filtered))}
        </TabsContent>
        <TabsContent value="prospect" className="mt-0">
          {activeTab === 'prospect' && (
            <>
              {filtered.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
                  <p className="text-xs text-amber-800">
                    <span style={{ fontWeight: 600 }}>입찰/예정 사업:</span> 사업 선정 후 1주일 이내에 기본 정보를 입력하세요.
                    정보가 충분히 입력되면 <Badge variant="outline" className="text-[10px] py-0 px-1 mx-0.5">확정</Badge> 버튼으로
                    확정 사업으로 전환할 수 있습니다.
                  </p>
                </div>
              )}
              {filtered.length === 0 ? renderEmptyState() : renderProjectTable(filtered)}
            </>
          )}
        </TabsContent>
        <TabsContent value="trash" className="mt-0">
          {activeTab === 'trash' && (
            <>
              {filtered.length > 0 && (
                <div className="bg-muted/40 border rounded-lg p-3 mb-3">
                  <p className="text-xs text-muted-foreground">
                    삭제된 프로젝트는 휴지통에 보관되며 복구할 수 있습니다. 복구하면 기존 프로젝트 상세/원장 연결은 그대로 유지됩니다.
                  </p>
                </div>
              )}
              {filtered.length === 0 ? renderEmptyState() : renderProjectTable(filtered)}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
