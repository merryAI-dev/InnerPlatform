import { Fragment, useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Search, ArrowUpDown, ArrowRight,
  FolderKanban, RotateCcw, ChevronDown, ChevronUp,
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
  PROJECT_STATUS_LABELS,
  SETTLEMENT_TYPE_LABELS, normalizeSettlementType,
  type ProjectStatus, type SettlementType, type Project,
} from '../../data/types';
import { PageHeader } from '../layout/PageHeader';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import { groupProjectListItems, matchesProjectListFilters } from '../../platform/project-list-view';
import { canAccessAdminPath } from '../../platform/admin-nav';
import { usePendingProjectChangeRequests } from './usePendingProjectChangeRequests';
import { normalizeProjectDepartment } from '../../platform/project-cic';

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
  const { allProjects, restoreProject, currentUser } = useAppStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [settlementFilter, setSettlementFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [sortKey, setSortKey] = useState<SortKey>('contractAmount');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [activeTab, setActiveTab] = useState<string>('contract-pending');
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const pendingProjectChangeMap = usePendingProjectChangeRequests();

  const {
    active: activeProjects,
    contractPending: contractPendingProjects,
    inProgress: inProgressProjects,
    completed: completedProjects,
    trashed: trashedProjects,
  } = useMemo(() => groupProjectListItems(allProjects), [allProjects]);
  const tabProjects = activeTab === 'trash'
    ? trashedProjects
    : activeTab === 'completed'
      ? completedProjects
      : activeTab === 'in-progress'
        ? inProgressProjects
        : contractPendingProjects;

  const departments = useMemo(() => {
    const depts = new Set(tabProjects.map((project) => normalizeProjectDepartment(project.department)).filter(Boolean));
    return Array.from(depts).sort();
  }, [tabProjects]);
  const hasActiveFilters = !!search || statusFilter !== 'ALL' || settlementFilter !== 'ALL' || deptFilter !== 'ALL';

  const filtered = useMemo(() => {
    const result = tabProjects.filter((project) => matchesProjectListFilters(project, {
      search,
      status: statusFilter,
      settlementType: settlementFilter,
      department: deptFilter,
    }));

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
  }, [tabProjects, search, statusFilter, settlementFilter, deptFilter, sortKey, sortDir]);

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
    setSettlementFilter('ALL');
    setDeptFilter('ALL');
  };

  const renderEmptyState = () => {
    const stateByTab = hasActiveFilters
      ? {
        title: '검색 조건에 맞는 프로젝트가 없습니다',
        description: '필터를 초기화하고 전체 포트폴리오를 다시 확인해 주세요.',
      }
      : activeTab === 'contract-pending'
        ? {
          title: '계약 전 프로젝트가 없습니다',
          description: '등록 요청은 실무자 포털에서 접수되고, 여기서는 계약 전 상태의 프로젝트를 확인합니다.',
        }
        : activeTab === 'in-progress'
          ? {
            title: '진행 중인 프로젝트가 없습니다',
            description: '계약이 완료되어 운영을 시작한 프로젝트가 이 탭에 표시됩니다.',
          }
          : activeTab === 'completed'
            ? {
              title: '종료된 프로젝트가 없습니다',
              description: '완료되었거나 잔금 입금을 기다리는 프로젝트가 이 탭에 표시됩니다.',
            }
            : activeTab === 'trash'
          ? {
            title: '휴지통이 비어 있습니다',
            description: '삭제된 프로젝트가 생기면 이 탭에서 복구할 수 있습니다.',
          }
          : {
            title: '프로젝트가 없습니다',
            description: '프로젝트 상태를 다시 확인해 주세요.',
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
                <TableHead className="min-w-[90px]">담당조직(CIC)</TableHead>
                <TableHead className="min-w-[200px] cursor-pointer" onClick={() => handleSort('name')}>
                  <span className="flex items-center gap-1">
                    프로젝트명 <ArrowUpDown className="w-3 h-3" />
                  </span>
                </TableHead>
                <TableHead className="min-w-[120px]">계약 대상</TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('status')}>
                  <span className="flex items-center gap-1">
                    상태 <ArrowUpDown className="w-3 h-3" />
                  </span>
                </TableHead>
                <TableHead className="min-w-[90px]">계약 기간</TableHead>
                <TableHead className="min-w-[80px]">사업 담당자</TableHead>
                <TableHead className="text-right min-w-[100px] cursor-pointer" onClick={() => handleSort('contractAmount')}>
                  <span className="flex items-center justify-end gap-1">
                    계약금액 <ArrowUpDown className="w-3 h-3" />
                  </span>
                </TableHead>
                <TableHead className="min-w-[150px] text-center">정산 유형</TableHead>
                {activeTab === 'trash' && (
                  <>
                    <TableHead className="min-w-[90px]">삭제일</TableHead>
                    <TableHead className="min-w-[90px] text-center">액션</TableHead>
                  </>
                )}
                {activeTab === 'contract-pending' && (
                  <TableHead className="min-w-[60px] text-center">액션</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map(p => (
                <Fragment key={p.id}>
                <TableRow
                  key={p.id}
                  data-testid={activeTab === 'trash' ? `project-trash-row-${p.id}` : `project-list-row-${p.id}`}
                  className={`cursor-pointer hover:bg-accent/50 ${expandedProjectId === p.id ? 'bg-slate-50' : ''}`}
                  aria-expanded={expandedProjectId === p.id}
                  tabIndex={0}
                  onClick={() => setExpandedProjectId((current) => current === p.id ? null : p.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setExpandedProjectId((current) => current === p.id ? null : p.id);
                    }
                  }}
                >
                  <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {normalizeProjectDepartment(p.department) || '-'}
                  </TableCell>
                  <TableCell style={{ fontWeight: 500 }} className="max-w-[220px] truncate text-sm">
                    <span className="inline-flex max-w-full items-center gap-1.5">
                      {expandedProjectId === p.id ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                      <span className="truncate">{p.name}</span>
                      {pendingProjectChangeMap.has(p.id) ? (
                        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                          수정 검토 중
                        </span>
                      ) : null}
                    </span>
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
                    {p.registeredByName || p.managerName || '-'}
                  </TableCell>
                  <TableCell className="text-right text-sm whitespace-nowrap">
                    {p.contractAmount > 0 ? fmtFull(p.contractAmount) : '-'}
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    <span
                      className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700"
                    >
                      {SETTLEMENT_TYPE_LABELS[normalizeSettlementType(p.settlementType)]}
                    </span>
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
                  {activeTab === 'contract-pending' && (
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
                {expandedProjectId === p.id ? (
                  <TableRow key={`${p.id}-details`} className="bg-slate-50/80 hover:bg-slate-50/80">
                    <TableCell colSpan={activeTab === 'trash' ? 10 : activeTab === 'contract-pending' ? 9 : 8} className="px-4 py-3">
                      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-xs md:grid-cols-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">프로젝트 목적</p>
                          <p className="mt-1 whitespace-pre-line leading-5 text-slate-700">{p.projectPurpose || '등록된 목적이 없습니다.'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">주요 내용</p>
                          <p className="mt-1 whitespace-pre-line leading-5 text-slate-700">{p.description || '등록된 주요 내용이 없습니다.'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">기본 정보</p>
                          <dl className="mt-1 space-y-1 text-slate-700">
                            <div className="flex justify-between gap-3"><dt className="text-slate-500">공식 계약명</dt><dd className="text-right">{p.officialContractName || '-'}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-slate-500">프로젝트 유형</dt><dd className="text-right">{p.type || '-'}</dd></div>
                            <div className="flex justify-between gap-3"><dt className="text-slate-500">담당조직(CIC)</dt><dd className="text-right">{normalizeProjectDepartment(p.department) || '-'}</dd></div>
                          </dl>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
                </Fragment>
              ))}

              {list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={activeTab === 'trash' ? 10 : activeTab === 'contract-pending' ? 9 : 8} className="text-center py-12 text-muted-foreground">
                    {search || statusFilter !== 'ALL' || settlementFilter !== 'ALL' || deptFilter !== 'ALL'
                      ? '검색 조건에 맞는 프로젝트가 없습니다'
                      : activeTab === 'trash'
                        ? '휴지통이 비어 있습니다.'
                        : activeTab === 'contract-pending'
                          ? '계약 전 프로젝트가 없습니다.'
                          : '등록 프로젝트가 없습니다.'}
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
        iconGradient="linear-gradient(135deg, #0891b2, #22d3ee)"
        title="프로젝트 통합 관리"
        description={`활성 ${activeProjects.length}개 프로젝트 · 계약 전 ${contractPendingProjects.length} / 진행 ${inProgressProjects.length} / 종료 ${completedProjects.length}`}
        actions={(canAccessAdminPath(currentUser?.role, '/projects/new') || canAccessAdminPath(currentUser?.role, '/approvals')) ? (
          <>
            {canAccessAdminPath(currentUser?.role, '/approvals') ? (
              <Button variant="outline" size="sm" onClick={() => navigate('/approvals')}>
                승인 대기 확인
              </Button>
            ) : null}
            {canAccessAdminPath(currentUser?.role, '/projects/new') ? (
              <Button size="sm" onClick={() => navigate('/projects/new')}>
                프로젝트 등록
              </Button>
            ) : null}
          </>
        ) : null}
      />

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
      >
        <TabsList
          aria-label="프로젝트 진행 단계"
          className="grid w-full grid-cols-3 overflow-hidden rounded-lg border border-slate-300 bg-[#0f2747] p-0 shadow-sm"
        >
          <TabsTrigger
            value="contract-pending"
            className="relative gap-1.5 rounded-none border-r border-white/15 px-2 py-2.5 text-slate-200 data-[state=active]:bg-[#1976d2] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_-3px_0_#ffffff] sm:gap-2 sm:px-4"
            data-testid="projects-tab-contract-pending"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px] font-semibold">1</span>
            <span className="font-semibold">계약 전</span>
            <Badge variant="secondary" className="ml-0.5 border-white/20 bg-white/10 px-1.5 py-0 text-[10px] text-current sm:ml-1">
              {contractPendingProjects.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="in-progress"
            className="relative gap-1.5 rounded-none border-r border-white/15 px-2 py-2.5 text-slate-200 data-[state=active]:bg-[#1976d2] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_-3px_0_#ffffff] sm:gap-2 sm:px-4"
            data-testid="projects-tab-in-progress"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px] font-semibold">2</span>
            <span className="font-semibold">진행</span>
            <Badge variant="secondary" className="ml-0.5 border-white/20 bg-white/10 px-1.5 py-0 text-[10px] text-current sm:ml-1">
              {inProgressProjects.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="completed"
            className="relative gap-1.5 rounded-none px-2 py-2.5 text-slate-200 data-[state=active]:bg-[#1976d2] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_-3px_0_#ffffff] sm:gap-2 sm:px-4"
            data-testid="projects-tab-completed"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[10px] font-semibold">3</span>
            <span className="font-semibold">종료</span>
            <Badge variant="secondary" className="ml-0.5 border-white/20 bg-white/10 px-1.5 py-0 text-[10px] text-current sm:ml-1">
              {completedProjects.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* Filters */}
        <Card className="mt-0 rounded-t-none border-t-0 shadow-sm">
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="프로젝트명, 계약명, 계약대상, 담당조직, 운영진 검색"
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
              <Select value={settlementFilter} onValueChange={setSettlementFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">전체 정산 유형</SelectItem>
                  {(Object.keys(SETTLEMENT_TYPE_LABELS) as SettlementType[]).map(k => (
                    <SelectItem key={k} value={k}>{SETTLEMENT_TYPE_LABELS[k]}</SelectItem>
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
                {filtered.length}개 프로젝트
              </span>
            </div>
          </CardContent>
        </Card>

        <TabsContent value="contract-pending" className="mt-0">
          {activeTab === 'contract-pending' && (filtered.length === 0 ? renderEmptyState() : renderProjectTable(filtered))}
        </TabsContent>
        <TabsContent value="in-progress" className="mt-0">
          {activeTab === 'in-progress' && (filtered.length === 0 ? renderEmptyState() : renderProjectTable(filtered))}
        </TabsContent>
        <TabsContent value="completed" className="mt-0">
          {activeTab === 'completed' && (filtered.length === 0 ? renderEmptyState() : renderProjectTable(filtered))}
        </TabsContent>
        <TabsContent value="trash" className="mt-0">
          {activeTab === 'trash' && (filtered.length === 0 ? renderEmptyState() : renderProjectTable(filtered))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
