import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, ArrowRight, FolderSearch, Search } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  normalizeProjectMigrationCandidate,
  type ProjectMigrationCandidate,
} from '../../data/project-migration-candidates';
import { ACCOUNT_TYPE_LABELS, PROJECT_PHASE_LABELS, PROJECT_STATUS_LABELS } from '../../data/types';
import { useAppStore } from '../../data/store';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { Button } from '../ui/button';
import {
  buildProjectMigrationAuditRows,
  type ProjectMigrationAuditRow,
  type ProjectMigrationStatus,
} from '../../platform/project-migration-audit';
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

function normalizeFilterText(value: string): string {
  return value.trim().toLowerCase();
}

function StatusBadge({ status }: { status: ProjectMigrationStatus }) {
  const meta = STATUS_META[status];
  return <Badge className={`border-0 ${meta.className}`}>{meta.label}</Badge>;
}

function MatchCell({
  row,
  onOpenProject,
}: {
  row: ProjectMigrationAuditRow;
  onOpenProject: (projectId: string) => void;
}) {
  if (row.matches.length === 0) {
    return <span className="text-[11px] text-muted-foreground">매칭 없음</span>;
  }

  return (
    <div className="space-y-2">
      {row.matches.map((match) => (
        <div key={match.project.id} className="rounded-lg border border-border/60 bg-muted/20 p-2">
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
            {match.exact && (
              <Badge className="border-0 bg-emerald-100 text-[10px] text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                exact
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>{match.project.groupwareName || '등록명 없음'}</span>
            <span>·</span>
            <span>{match.project.clientOrg || '발주기관 없음'}</span>
            <span>·</span>
            <span>{ACCOUNT_TYPE_LABELS[match.project.accountType]}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            <span>{PROJECT_PHASE_LABELS[match.project.phase]}</span>
            <span>·</span>
            <span>{PROJECT_STATUS_LABELS[match.project.status]}</span>
            <span>·</span>
            <span>{match.project.id}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {match.reasons.map((reason) => (
              <Badge key={`${match.project.id}-${reason}`} variant="outline" className="text-[10px]">
                {reason}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProjectMigrationAuditPage() {
  const { projects } = useAppStore();
  const { db, isOnline, orgId } = useFirebase();
  const navigate = useNavigate();
  const [candidates, setCandidates] = useState<ProjectMigrationCandidate[]>([]);
  const [isCandidatesLoading, setIsCandidatesLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ProjectMigrationStatus>('ALL');

  useEffect(() => {
    if (!db || !isOnline) {
      setCandidates([]);
      setIsCandidatesLoading(false);
      return undefined;
    }

    setIsCandidatesLoading(true);
    const ref = collection(db, getOrgCollectionPath(orgId, 'projectMigrationCandidates'));
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      const next = snapshot.docs
        .map((docSnap) => normalizeProjectMigrationCandidate(docSnap.id, docSnap.data() as Record<string, unknown>))
        .sort((left, right) => {
          const departmentCompare = left.department.localeCompare(right.department, 'ko');
          if (departmentCompare !== 0) return departmentCompare;
          return left.businessName.localeCompare(right.businessName, 'ko');
        });
      setCandidates(next);
      setIsCandidatesLoading(false);
    }, (error) => {
      console.error('[ProjectMigrationAuditPage] candidates listen error:', error);
      setCandidates([]);
      setIsCandidatesLoading(false);
    });

    return () => unsubscribe();
  }, [db, isOnline, orgId]);

  const rows = useMemo(
    () => buildProjectMigrationAuditRows(candidates, projects),
    [candidates, projects],
  );

  const departments = useMemo(
    () => Array.from(new Set(candidates.map((item) => item.department).filter(Boolean))).sort(),
    [candidates],
  );

  const filteredRows = useMemo(() => {
    const query = normalizeFilterText(search);
    return rows.filter((row) => {
      if (departmentFilter !== 'ALL' && row.candidate.department !== departmentFilter) return false;
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;
      if (!query) return true;

      const haystack = [
        row.candidate.department,
        row.candidate.coreMembers,
        row.candidate.groupwareProjectName,
        row.candidate.businessName,
        row.candidate.clientOrg,
        ...row.matches.map((match) => [match.project.name, match.project.groupwareName, match.project.clientOrg].join(' ')),
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [departmentFilter, rows, search, statusFilter]);

  const summary = useMemo(() => ({
    total: rows.length,
    registered: rows.filter((row) => row.status === 'REGISTERED').length,
    candidate: rows.filter((row) => row.status === 'CANDIDATE').length,
    missing: rows.filter((row) => row.status === 'MISSING').length,
  }), [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FolderSearch}
        iconGradient="linear-gradient(135deg, #0f766e 0%, #0ea5e9 100%)"
        title="프로젝트 마이그레이션 등록 현황"
        description={`전사 이관 대상 ${summary.total}건을 현재 admin 프로젝트와 읽기 전용으로 대조합니다. 등록=${summary.registered}, 후보=${summary.candidate}, 미등록=${summary.missing}`}
        badge="Firestore"
      />

      <Card className="border-amber-200/70 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20">
        <CardContent className="flex gap-3 p-4 text-[12px] text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">임시 이관 점검 화면입니다.</p>
            <p>이관 후보는 Firestore `orgs/{orgId}/project_migration_candidates` 컬렉션에서 읽습니다. 사업명, 그룹웨어 프로젝트등록명, 발주기관을 기준으로 기존 프로젝트를 대조하고 애매한 경우는 `후보 있음`으로 남깁니다.</p>
          </div>
        </CardContent>
      </Card>

      {!db || !isOnline ? (
        <Card>
          <CardContent className="p-4 text-[12px] text-muted-foreground">
            Firebase 연결이 없어서 이관 후보 컬렉션을 읽지 못했습니다. Firestore 연결 후 다시 확인해 주세요.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-[11px] text-muted-foreground">대상 건수</p><p className="mt-2 text-2xl font-semibold">{summary.total}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] text-muted-foreground">등록됨</p><p className="mt-2 text-2xl font-semibold text-emerald-600">{summary.registered}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] text-muted-foreground">후보 있음</p><p className="mt-2 text-2xl font-semibold text-amber-600">{summary.candidate}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-[11px] text-muted-foreground">미등록</p><p className="mt-2 text-2xl font-semibold text-rose-600">{summary.missing}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="사업명, 발주기관, 그룹웨어 등록명으로 검색"
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

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[92px]">상태</TableHead>
                  <TableHead className="min-w-[92px]">담당조직</TableHead>
                  <TableHead className="min-w-[180px]">사업명</TableHead>
                  <TableHead className="min-w-[120px]">발주기관</TableHead>
                  <TableHead className="min-w-[120px]">그룹웨어 등록명</TableHead>
                  <TableHead className="min-w-[100px]">핵심인력</TableHead>
                  <TableHead className="min-w-[70px]">통장</TableHead>
                  <TableHead className="min-w-[320px]">현재 프로젝트 매칭</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.candidate.id}>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="text-[12px]">{row.candidate.department || '-'}</TableCell>
                    <TableCell className="text-[12px] font-medium">{row.candidate.businessName}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{row.candidate.clientOrg || '-'}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{row.candidate.groupwareProjectName || '-'}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{row.candidate.coreMembers || '-'}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{row.candidate.accountLabel || '-'}</TableCell>
                    <TableCell>
                      <MatchCell row={row} onOpenProject={(projectId) => navigate(`/projects/${projectId}`)} />
                    </TableCell>
                  </TableRow>
                ))}
                {filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-[12px] text-muted-foreground">
                      {isCandidatesLoading ? '이관 후보를 불러오는 중입니다…' : 'Firestore에 등록된 이관 대상이 없습니다.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <FolderSearch className="h-4 w-4" />
            <span>등록된 프로젝트를 열어 상세 확인이 필요하면 오른쪽 매칭 카드의 사업명을 누르세요.</span>
            <ArrowRight className="h-3.5 w-3.5" />
            <span>미등록 또는 후보 있음 위주로 점검하면 됩니다.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
