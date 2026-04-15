import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Search, ArrowUpDown, Sparkles, CheckCircle2, ArrowRight,
  FolderKanban, RotateCcw, Trash2, FileText, Clock, AlertTriangle,
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
  SETTLEMENT_TYPE_SHORT,
  type ProjectStatus, type ProjectType, type Project,
} from '../../data/types';
import { PageHeader } from '../layout/PageHeader';
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

type SortKey = 'name' | 'contractAmount' | 'status';
type SortDir = 'asc' | 'desc';

export function ProjectListPage() {
  const { allProjects, restoreProject, ledgers, transactions } = useAppStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('contractAmount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [activeTab, setActiveTab] = useState<string>('confirmed');
  const [monitoringPreset, setMonitoringPreset] = useState<'all' | 'no-ledger' | 'pending-approval' | 'missing-evidence'>('all');

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
  const tabProjects = activeTab === 'trash'
    ? trashedProjects
    : activeTab === 'confirmed'
      ? confirmedProjects
      : prospectProjects;

  const projectTransactions = useMemo(() => {
    const map = new Map<string, typeof transactions>();
    transactions.forEach((transaction) => {
      const list = map.get(transaction.projectId) || [];
      list.push(transaction);
      map.set(transaction.projectId, list);
    });
    return map;
  }, [transactions]);

  const monitoringCounts = useMemo(() => {
    const noLedger = activeProjects.filter((project) => project.phase === 'CONFIRMED' && !ledgers.some((ledger) => ledger.projectId === project.id)).length;
    const pendingApproval = activeProjects.filter((project) => (projectTransactions.get(project.id) || []).some((transaction) => transaction.state === 'SUBMITTED')).length;
    const missingEvidence = activeProjects.filter((project) => (projectTransactions.get(project.id) || []).some((transaction) => transaction.evidenceStatus !== 'COMPLETE' && transaction.state !== 'REJECTED')).length;
    return { noLedger, pendingApproval, missingEvidence };
  }, [activeProjects, ledgers, projectTransactions]);

  const monitoringProjects = useMemo(() => {
    if (monitoringPreset === 'all') return tabProjects;
    if (monitoringPreset === 'no-ledger') {
      return tabProjects.filter((project) => project.phase === 'CONFIRMED' && !ledgers.some((ledger) => ledger.projectId === project.id));
    }
    if (monitoringPreset === 'pending-approval') {
      return tabProjects.filter((project) => (projectTransactions.get(project.id) || []).some((transaction) => transaction.state === 'SUBMITTED'));
    }
    return tabProjects.filter((project) => (projectTransactions.get(project.id) || []).some((transaction) => transaction.evidenceStatus !== 'COMPLETE' && transaction.state !== 'REJECTED'));
  }, [ledgers, monitoringPreset, projectTransactions, tabProjects]);

  const departments = useMemo(() => {
    const depts = new Set(monitoringProjects.map((project) => project.department).filter(Boolean));
    return Array.from(depts).sort();
  }, [monitoringProjects]);
  const hasActiveFilters = !!search || statusFilter !== 'ALL' || typeFilter !== 'ALL' || deptFilter !== 'ALL';

  const filtered = useMemo(() => {
    let result = monitoringProjects.filter(p => {
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
        case 'status': cmp = a.status.localeCompare(b.status); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [monitoringProjects, search, statusFilter, typeFilter, deptFilter, sortKey, sortDir]);

  const handleMonitoringPreset = (preset: 'all' | 'no-ledger' | 'pending-approval' | 'missing-evidence') => {
    setMonitoringPreset(preset);
    if (preset !== 'all' && activeTab === 'trash') {
      setActiveTab('confirmed');
    }
  };

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
    const stateByTab = hasActiveFilters
      ? {
        title: '검색 조건에 맞는 사업이 없습니다',
        description: '필터를 초기화하고 전체 포트폴리오를 다시 확인해 주세요.',
      }
      : activeTab === 'prospect'
        ? {
          title: '입찰/예정 사업이 없습니다',
          description: '등록 제안은 포털에서 접수되고, 여기서는 예정 사업을 검토하고 확정으로 전환합니다.',
        }
        : activeTab === 'trash'
          ? {
            title: '휴지통이 비어 있습니다',
            description: '삭제된 프로젝트가 생기면 이 탭에서 복구할 수 있습니다.',
          }
          : {
            title: '확정 사업이 없습니다',
            description: '프로젝트가 생성되면 이 탭에서 운영 현황과 원장을 바로 확인할 수 있습니다.',
          };

    return (
      <Card data-testid="projects-empty-state" className="border-slate-200/80 bg-slate-50/70">
        <CardContent className="flex min-h-[220px] items-center justify-center p-6">
          <div className="max-w-md text-center">
            <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-slate-900">{stateByTab.title}</h2>
            <p className="mt-2 text-[13px] leading-6 text-slate-600">{stateByTab.description}</p>
            {hasActiveFilters && (
              <div className="mt-4">
                <Button size="sm" onClick={resetFilters}>필터 초기화</Button>
              </div>
            )}
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
                <TableHead className="min-w-[90px]">담당조직</TableHead>
                <TableHead className="min-w-[200px] cursor-pointer" onClick={() => handleSort('name')}>
                  <span className="flex items-center gap-1">
                    사업명 <ArrowUpDown className="w-3 h-3" />
                  </span>
                </TableHead>
                <TableHead className="min-w-[120px]">발주기관</TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('status')}>
                  <span className="flex items-center gap-1">
                    상태 <ArrowUpDown className="w-3 h-3" />
                  </span>
                </TableHead>
                <TableHead className="min-w-[90px]">계약기간</TableHead>
                <TableHead className="min-w-[80px]">담당자</TableHead>
                <TableHead className="text-right min-w-[100px] cursor-pointer" onClick={() => handleSort('contractAmount')}>
                  <span className="flex items-center justify-end gap-1">
                    총 사업비 <ArrowUpDown className="w-3 h-3" />
                  </span>
                </TableHead>
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
                  <TableCell style={{ fontWeight: 500 }} className="max-w-[220px] truncate text-sm">
                    {p.name}
                  </TableCell>
                  <TableCell className="text-[11px] whitespace-nowrap">{p.clientOrg || '-'}</TableCell>
                  <TableCell className="text-[11px] whitespace-nowrap">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] whitespace-nowrap ${statusColor[p.status]}`}>
                      {PROJECT_STATUS_LABELS[p.status]}
                    </span>
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {p.contractStart ? `${p.contractStart.replace(/-/g, '.')}` : '-'}
                    {p.contractEnd ? ` ~ ${p.contractEnd.replace(/-/g, '.')}` : ''}
                  </TableCell>
                  <TableCell className="text-[11px] whitespace-nowrap">
                    {p.managerName || '-'}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap">
                    {p.contractAmount > 0 ? fmtFull(p.contractAmount) : '-'}
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

              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={activeTab === 'trash' ? 10 : activeTab === 'prospect' ? 9 : 8} className="text-center py-12 text-muted-foreground">
                    {search || statusFilter !== 'ALL' || typeFilter !== 'ALL' || deptFilter !== 'ALL'
                      ? '검색 조건에 맞는 사업이 없습니다'
                      : activeTab === 'trash'
                        ? '휴지통이 비어 있습니다.'
                        : activeTab === 'prospect'
                          ? '예정 사업이 없습니다.'
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
      />

      <Card className="border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-teal-50/70">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2" data-testid="project-monitoring-presets">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">모니터링 프리셋</span>
            <Button
              variant={monitoringPreset === 'all' ? 'default' : 'outline'}
              size="sm"
              className="h-8 gap-1.5 text-[11px]"
              onClick={() => handleMonitoringPreset('all')}
            >
              <FolderKanban className="h-3.5 w-3.5" />
              전체
            </Button>
            <Button
              variant={monitoringPreset === 'no-ledger' ? 'default' : 'outline'}
              size="sm"
              className="h-8 gap-1.5 text-[11px]"
              onClick={() => handleMonitoringPreset('no-ledger')}
              data-testid="project-monitoring-preset-no-ledger"
            >
              <FileText className="h-3.5 w-3.5" />
              원장 없음
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {monitoringCounts.noLedger}
              </Badge>
            </Button>
            <Button
              variant={monitoringPreset === 'pending-approval' ? 'default' : 'outline'}
              size="sm"
              className="h-8 gap-1.5 text-[11px]"
              onClick={() => handleMonitoringPreset('pending-approval')}
              data-testid="project-monitoring-preset-pending-approval"
            >
              <Clock className="h-3.5 w-3.5" />
              승인 대기
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {monitoringCounts.pendingApproval}
              </Badge>
            </Button>
            <Button
              variant={monitoringPreset === 'missing-evidence' ? 'default' : 'outline'}
              size="sm"
              className="h-8 gap-1.5 text-[11px]"
              onClick={() => handleMonitoringPreset('missing-evidence')}
              data-testid="project-monitoring-preset-missing-evidence"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              증빙 미제출
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {monitoringCounts.missingEvidence}
              </Badge>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          if (value === 'trash') {
            setMonitoringPreset('all');
          }
        }}
      >
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
          {activeTab === 'prospect' && (filtered.length === 0 ? renderEmptyState() : renderProjectTable(filtered))}
        </TabsContent>
        <TabsContent value="trash" className="mt-0">
          {activeTab === 'trash' && (filtered.length === 0 ? renderEmptyState() : renderProjectTable(filtered))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
