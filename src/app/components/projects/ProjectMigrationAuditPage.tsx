import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowRight,
  FolderSearch,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDocs, onSnapshot, writeBatch } from 'firebase/firestore';
import { toast } from 'sonner';
import {
  normalizeProjectMigrationCandidate,
  type ProjectMigrationCandidate,
} from '../../data/project-migration-candidates';
import type { Project } from '../../data/types';
import { useAppStore } from '../../data/store';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Progress } from '../ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import { Button } from '../ui/button';
import {
  buildProjectMigrationAuditRows,
  buildProjectMigrationCurrentRows,
  type ProjectMigrationProjectMatch,
  type ProjectMigrationStatus,
} from '../../platform/project-migration-audit';
import { APPROVED_PROJECT_DASHBOARD_SCOPE, buildApprovedProjectDashboardSyncPlan } from '../../platform/project-dashboard-scope';
import { getOrgCollectionPath } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';

const STATUS_META: Record<ProjectMigrationStatus, { label: string; className: string }> = {
  REGISTERED: {
    label: '등록됨',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  CANDIDATE: {
    label: '후보 있음',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  },
  MISSING: {
    label: '미등록',
    className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  },
};

const STATUS_ORDER: Record<ProjectMigrationStatus, number> = {
  MISSING: 0,
  CANDIDATE: 1,
  REGISTERED: 2,
};

function normalizeFilterText(value: string): string {
  return value.trim().toLowerCase();
}

function formatRatio(value: number | null): string {
  if (value == null) return '기준 없음';
  return `${value.toFixed(1)}%`;
}

const PROJECT_DASHBOARD_SYNC_BATCH_LIMIT = 400;

async function syncApprovedProjectDashboardScope(
  db: Firestore,
  orgId: string,
): Promise<{ upserted: number; deleted: number }> {
  const collectionPath = getOrgCollectionPath(orgId, 'projectDashboardProjects');
  const ref = collection(db, collectionPath);
  const snapshot = await getDocs(ref);
  const plan = buildApprovedProjectDashboardSyncPlan(
    orgId,
    snapshot.docs.map((docSnap) => docSnap.id),
  );
  const operations = [
    ...plan.candidates.map((candidate) => ({ type: 'set' as const, id: candidate.id, candidate })),
    ...plan.deleteIds.map((id) => ({ type: 'delete' as const, id })),
  ];

  for (let index = 0; index < operations.length; index += PROJECT_DASHBOARD_SYNC_BATCH_LIMIT) {
    const batch = writeBatch(db);
    const chunk = operations.slice(index, index + PROJECT_DASHBOARD_SYNC_BATCH_LIMIT);

    for (const operation of chunk) {
      const ref = doc(db, collectionPath, operation.id);
      if (operation.type === 'set') {
        batch.set(ref, operation.candidate, { merge: false });
        continue;
      }
      batch.delete(ref);
    }

    await batch.commit();
  }

  return {
    upserted: plan.candidates.length,
    deleted: plan.deleteIds.length,
  };
}

function StatusBadge({ status }: { status: ProjectMigrationStatus }) {
  const meta = STATUS_META[status];
  return <Badge className={`border-0 ${meta.className}`}>{meta.label}</Badge>;
}

function MatchProjectCard({
  match,
  onOpenProject,
}: {
  match: ProjectMigrationProjectMatch;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-left text-[12px]"
          onClick={() => onOpenProject(match.project.id)}
        >
          {match.project.name}
        </Button>
        <Badge variant="outline" className="text-[10px]">
          {match.score}점
        </Badge>
        {match.exact ? (
          <Badge className="border-0 bg-emerald-100 text-[10px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            exact
          </Badge>
        ) : null}
      </div>
      <div className="mt-1 space-y-1 text-[11px] text-muted-foreground">
        <p>계약명: {match.project.officialContractName || '-'}</p>
        <p>{match.project.clientOrg || '발주기관 없음'} · {match.project.department || '담당조직 없음'} · {match.project.managerName || '담당자 없음'}</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {match.reasons.map((reason) => (
          <Badge key={`${match.project.id}-${reason}`} variant="outline" className="text-[10px]">
            {reason}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function CurrentProjectMatchCell({
  matches,
  onOpenProject,
}: {
  matches: ProjectMigrationProjectMatch[];
  onOpenProject: (projectId: string) => void;
}) {
  if (matches.length === 0) {
    return <span className="text-[11px] text-muted-foreground">현재 등록 프로젝트 매칭 없음</span>;
  }
  return (
    <div className="space-y-2">
      {matches.map((match) => (
        <MatchProjectCard key={match.project.id} match={match} onOpenProject={onOpenProject} />
      ))}
    </div>
  );
}

function CurrentOnlyProjectCell({
  project,
  onOpenProject,
}: {
  project: Project;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-left text-[12px]"
          onClick={() => onOpenProject(project.id)}
        >
          {project.name}
        </Button>
      </div>
      <div className="mt-1 space-y-1 text-[11px] text-muted-foreground">
        <p>계약명: {project.officialContractName || '-'}</p>
        <p>{project.clientOrg || '발주기관 없음'} · {project.department || '담당조직 없음'} · {project.managerName || '담당자 없음'}</p>
      </div>
    </div>
  );
}

type UnifiedAuditTableRow =
  | {
    key: string;
    kind: 'source';
    status: ProjectMigrationStatus;
    sourceName: string;
    matches: ProjectMigrationProjectMatch[];
  }
  | {
    key: string;
    kind: 'current-only';
    status: 'MISSING';
    project: Project;
  };

export function ProjectMigrationAuditPage() {
  const { projects } = useAppStore();
  const { db, isOnline, orgId } = useFirebase();
  const navigate = useNavigate();
  const [sourceProjects, setSourceProjects] = useState<ProjectMigrationCandidate[]>([]);
  const [isSourceLoading, setIsSourceLoading] = useState(true);
  const [isSyncingScope, setIsSyncingScope] = useState(false);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ProjectMigrationStatus>('ALL');

  useEffect(() => {
    if (!db || !isOnline) {
      setSourceProjects([]);
      setIsSourceLoading(false);
      return undefined;
    }

    setIsSourceLoading(true);
    const ref = collection(db, getOrgCollectionPath(orgId, 'projectDashboardProjects'));
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const next = snapshot.docs
          .map((docSnap) => normalizeProjectMigrationCandidate(docSnap.id, docSnap.data() as Record<string, unknown>))
          .sort((left, right) => {
            const departmentCompare = left.department.localeCompare(right.department, 'ko');
            if (departmentCompare !== 0) return departmentCompare;
            return left.businessName.localeCompare(right.businessName, 'ko');
          });
        setSourceProjects(next);
        setIsSourceLoading(false);
      },
      (error) => {
        console.error('[ProjectMigrationAuditPage] project dashboard listen error:', error);
        setSourceProjects([]);
        setIsSourceLoading(false);
      },
    );

    return () => unsubscribe();
  }, [db, isOnline, orgId]);

  const rows = useMemo(
    () => buildProjectMigrationAuditRows(sourceProjects, projects),
    [projects, sourceProjects],
  );

  const currentRows = useMemo(() => {
    const next = buildProjectMigrationCurrentRows(rows, projects);
    return next.sort((left, right) => {
      const statusCompare = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
      if (statusCompare !== 0) return statusCompare;
      return left.project.name.localeCompare(right.project.name, 'ko');
    });
  }, [projects, rows]);

  const departments = useMemo(() => {
    const values = new Set<string>();
    sourceProjects.forEach((item) => {
      if (item.department) values.add(item.department);
    });
    projects.forEach((project) => {
      if (project.department) values.add(project.department);
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right, 'ko'));
  }, [projects, sourceProjects]);

  const filteredRows = useMemo(() => {
    const query = normalizeFilterText(search);
    return rows.filter((row) => {
      if (departmentFilter !== 'ALL') {
        const matchedDepartment = row.matches.some((match) => match.project.department === departmentFilter);
        if (row.candidate.department !== departmentFilter && !matchedDepartment) return false;
      }
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;
      if (!query) return true;

      const haystack = [
        row.candidate.department,
        row.candidate.coreMembers,
        row.candidate.groupwareProjectName,
        row.candidate.businessName,
        row.candidate.clientOrg,
        ...row.matches.map((match) => [
          match.project.name,
          match.project.officialContractName,
          match.project.groupwareName,
          match.project.clientOrg,
          match.project.department,
          match.project.managerName,
        ].join(' ')),
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [departmentFilter, rows, search, statusFilter]);

  const filteredCurrentOnlyRows = useMemo(() => {
    const query = normalizeFilterText(search);
    return currentRows.filter((row) => {
      if (row.matches.length > 0) return false;
      if (departmentFilter !== 'ALL' && row.project.department !== departmentFilter) return false;
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;
      if (!query) return true;

      const haystack = [
        row.project.department,
        row.project.managerName,
        row.project.groupwareName,
        row.project.name,
        row.project.officialContractName,
        row.project.clientOrg,
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [currentRows, departmentFilter, search, statusFilter]);

  const unifiedRows = useMemo<UnifiedAuditTableRow[]>(() => ([
    ...filteredRows.map((row) => ({
      key: row.candidate.id,
      kind: 'source' as const,
      status: row.status,
      sourceName: row.candidate.businessName,
      matches: row.matches,
    })),
    ...filteredCurrentOnlyRows.map((row) => ({
      key: `current-${row.project.id}`,
      kind: 'current-only' as const,
      status: 'MISSING' as const,
      project: row.project,
    })),
  ]), [filteredCurrentOnlyRows, filteredRows]);

  const sourceSummary = useMemo(() => ({
    total: rows.length,
    registered: rows.filter((row) => row.status === 'REGISTERED').length,
    candidate: rows.filter((row) => row.status === 'CANDIDATE').length,
    missing: rows.filter((row) => row.status === 'MISSING').length,
  }), [rows]);

  const currentSummary = useMemo(() => ({
    total: currentRows.length,
    registered: currentRows.filter((row) => row.status === 'REGISTERED').length,
    candidate: currentRows.filter((row) => row.status === 'CANDIDATE').length,
    missing: currentRows.filter((row) => row.status === 'MISSING').length,
  }), [currentRows]);

  const completionRatio = sourceSummary.total > 0
    ? (sourceSummary.registered / sourceSummary.total) * 100
    : null;

  async function handleSyncApprovedScope() {
    if (!db || !isOnline) {
      toast.error('Firebase 연결 후 다시 시도해 주세요.');
      return;
    }

    setIsSyncingScope(true);
    try {
      const result = await syncApprovedProjectDashboardScope(db, orgId);
      toast.success(`비교 기준 25건 반영 완료`, {
        description: `source ${result.upserted}건 저장, 기존 범위 밖 ${result.deleted}건 정리`,
      });
    } catch (error) {
      console.error('[ProjectMigrationAuditPage] project dashboard sync error:', error);
      toast.error('비교 기준 25건 적재 실패', {
        description: error instanceof Error ? error.message : 'Firestore 쓰기 권한을 확인해 주세요.',
      });
    } finally {
      setIsSyncingScope(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FolderSearch}
        iconGradient="linear-gradient(135deg, #0f766e 0%, #0ea5e9 100%)"
        title="프로젝트 마이그레이션 등록 현황"
        description={`승인된 비교 기준 ${sourceSummary.total}건과 현재 admin 등록 ${currentSummary.total}건을 Firestore에서 계약명 우선으로 대조합니다. 완료율 ${formatRatio(completionRatio)}, 검토 ${sourceSummary.candidate}, 미등록 ${sourceSummary.missing}`}
        badge="Firestore"
      />

      <Card className="border-amber-200/70 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20">
        <CardContent className="flex flex-col gap-4 p-4 text-[12px] text-amber-900 dark:text-amber-200 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">원본 대조 기준을 명시적으로 분리한 임시 점검 화면입니다.</p>
              <p>왼쪽 기준은 Firestore `orgs/{orgId}/project_dashboard_projects`에 적재된 승인된 25개 비교기준 목록이고, 오른쪽 기준은 `orgs/{orgId}/projects`입니다. 두 컬렉션은 역할이 다르며 운영 프로젝트와 섞이지 않습니다.</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 lg:items-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 border-amber-300 bg-white/80 text-amber-900 hover:bg-white dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-100"
              disabled={!db || !isOnline || isSyncingScope}
              onClick={() => { void handleSyncApprovedScope(); }}
            >
              {isSyncingScope ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              비교 기준 {APPROVED_PROJECT_DASHBOARD_SCOPE.length}개 적재
            </Button>
            <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80">source 컬렉션만 갱신하며 `projects`는 변경하지 않습니다.</p>
          </div>
        </CardContent>
      </Card>

      {!db || !isOnline ? (
        <Card>
          <CardContent className="p-4 text-[12px] text-muted-foreground">
            Firebase 연결이 없어서 원본/현재 프로젝트 컬렉션을 읽지 못했습니다. Firestore 연결 후 다시 확인해 주세요.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">원본 대시보드 대상</p>
            <p className="mt-2 text-2xl font-semibold">{sourceSummary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">현재 admin 등록</p>
            <p className="mt-2 text-2xl font-semibold">{currentSummary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">등록됨</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-600">{sourceSummary.registered}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">후보 있음</p>
            <p className="mt-2 text-2xl font-semibold text-amber-600">{sourceSummary.candidate}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">미등록</p>
            <p className="mt-2 text-2xl font-semibold text-rose-600">{sourceSummary.missing}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] text-muted-foreground">이관 완료율</p>
                <p className="mt-2 text-2xl font-semibold">{formatRatio(completionRatio)}</p>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {sourceSummary.total > 0 ? `${sourceSummary.registered}/${sourceSummary.total}` : '0/0'}
              </span>
            </div>
            <Progress value={completionRatio ?? 0} className="h-2" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="사업명, 계약명, 발주기관으로 검색"
                className="pl-9"
              />
            </div>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-full lg:w-[220px]">
                <SelectValue placeholder="담당조직" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 담당조직</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department} value={department}>{department}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'ALL' | ProjectMigrationStatus)}>
              <SelectTrigger className="w-full lg:w-[180px]">
                <SelectValue placeholder="상태" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 상태</SelectItem>
                <SelectItem value="REGISTERED">등록됨</SelectItem>
                <SelectItem value="CANDIDATE">후보 있음</SelectItem>
                <SelectItem value="MISSING">미등록</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">통합 대조표</h2>
            <p className="text-[12px] text-muted-foreground">원본 25건을 기준으로 현재 admin 프로젝트를 계약명 우선, 프로젝트명 보조로 붙였습니다. 원본과 연결되지 않은 현재 프로젝트도 같은 표 하단에 함께 표시합니다.</p>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[92px]">상태</TableHead>
                  <TableHead className="min-w-[180px]">원본 사업명</TableHead>
                  <TableHead className="min-w-[360px]">현재 admin 프로젝트 / 계약명</TableHead>
                  <TableHead className="min-w-[220px]">비고</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unifiedRows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="text-[12px] font-medium">
                      {row.kind === 'source' ? row.sourceName : <span className="text-muted-foreground">원본 대시보드 범위 없음</span>}
                    </TableCell>
                    <TableCell>
                      {row.kind === 'source'
                        ? <CurrentProjectMatchCell matches={row.matches} onOpenProject={(projectId) => navigate(`/projects/${projectId}`)} />
                        : <CurrentOnlyProjectCell project={row.project} onOpenProject={(projectId) => navigate(`/projects/${projectId}`)} />}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {row.kind === 'source'
                        ? row.matches.length > 0
                          ? '상단 카드의 점수와 매칭 근거를 확인하세요.'
                          : '현재 admin에 연결된 프로젝트가 없습니다.'
                        : '현재 admin에는 있으나 승인된 25개 원본 범위와 연결되지 않은 프로젝트입니다.'}
                    </TableCell>
                  </TableRow>
                ))}
                {unifiedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-[12px] text-muted-foreground">
                      {isSourceLoading ? '원본 대시보드 프로젝트를 불러오는 중입니다…' : `Firestore \`project_dashboard_projects\` 컬렉션이 비어 있습니다. 상단에서 승인된 비교 기준 ${APPROVED_PROJECT_DASHBOARD_SCOPE.length}개를 적재해 주세요.`}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <FolderSearch className="h-4 w-4" />
        <span>등록된 프로젝트를 열어 상세 확인이 필요하면 현재 사업명을 누르세요.</span>
        <ArrowRight className="h-3.5 w-3.5" />
        <span>미등록 또는 후보 있음 위주로 보면 이관 누락을 빠르게 확인할 수 있습니다.</span>
      </div>
    </div>
  );
}
