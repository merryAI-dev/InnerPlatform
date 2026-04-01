import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  AlertTriangle,
  ArrowRight,
  FolderSearch,
  Link2,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDocs, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { toast } from 'sonner';
import {
  normalizeProjectMigrationCandidate,
  type ProjectMigrationCandidate,
} from '../../data/project-migration-candidates';
import {
  PROJECT_STATUS_LABELS,
  type Project,
  type ProjectStatus,
} from '../../data/types';
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
    label: '완료',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  CANDIDATE: {
    label: '확인 필요',
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

type StatusSortMode = 'STATUS_ASC' | 'STATUS_DESC';

function normalizeFilterText(value: string): string {
  return value.trim().toLowerCase();
}

function formatRatio(value: number | null): string {
  if (value == null) return '기준 없음';
  return `${value.toFixed(1)}%`;
}

function compareStatuses(
  left: ProjectMigrationStatus,
  right: ProjectMigrationStatus,
  mode: StatusSortMode,
): number {
  const delta = STATUS_ORDER[left] - STATUS_ORDER[right];
  return mode === 'STATUS_DESC' ? -delta : delta;
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

function getCandidateNextAction(match: ProjectMigrationProjectMatch | null): string {
  if (!match) return '플랫폼에 신규 등록이 필요합니다.';
  if (match.exact) return '완료';
  if (match.reasons.some((reason) => reason.includes('계약명'))) {
    return '계약명만 확인하면 연결 여부를 확정할 수 있습니다.';
  }
  return '플랫폼 프로젝트와 같은 건인지 확인해 주세요.';
}

function getSourceRowNextAction(
  status: ProjectMigrationStatus,
  match: ProjectMigrationProjectMatch | null,
): string {
  if (status === 'REGISTERED') return '완료';
  if (status === 'CANDIDATE') return getCandidateNextAction(match);
  return '플랫폼에 신규 등록이 필요합니다.';
}

function getCurrentOnlyNextAction(): string {
  return '이관 범위 밖 프로젝트인지 확인해 주세요.';
}

function MatchProjectCard({
  match,
  onOpenProject,
}: {
  match: ProjectMigrationProjectMatch;
  onOpenProject: (projectId: string) => void;
}) {
  const primaryLabel = match.project.officialContractName || match.project.name || '이름 없음';

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-left text-[12px]"
          onClick={() => onOpenProject(match.project.id)}
        >
          {primaryLabel}
        </Button>
        <Badge variant="outline" className="text-[10px]">
          {PROJECT_STATUS_LABELS[match.project.status]}
        </Badge>
      </div>
      <div className="mt-1 space-y-1 text-[11px] text-muted-foreground">
        <p>{match.project.department || '담당조직 없음'} · {match.project.managerName || '담당자 없음'}</p>
      </div>
    </div>
  );
}

function CurrentProjectMatchCell({
  match,
  onOpenProject,
}: {
  match: ProjectMigrationProjectMatch | null;
  onOpenProject: (projectId: string) => void;
}) {
  if (!match) {
    return <span className="text-[11px] text-muted-foreground">플랫폼 프로젝트 매칭 없음</span>;
  }
  return (
    <MatchProjectCard match={match} onOpenProject={onOpenProject} />
  );
}

function CurrentOnlyProjectCell({
  project,
  onOpenProject,
}: {
  project: Project;
  onOpenProject: (projectId: string) => void;
}) {
  const primaryLabel = project.officialContractName || project.name || '이름 없음';

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-left text-[12px]"
          onClick={() => onOpenProject(project.id)}
        >
          {primaryLabel}
        </Button>
        <Badge variant="outline" className="text-[10px]">
          {PROJECT_STATUS_LABELS[project.status]}
        </Badge>
      </div>
      <div className="mt-1 space-y-1 text-[11px] text-muted-foreground">
        <p>{project.department || '담당조직 없음'} · {project.managerName || '담당자 없음'}</p>
      </div>
    </div>
  );
}

const EMPTY_PROJECT_VALUE = '__UNASSIGNED__';

function formatProjectLabel(project: Project): string {
  return project.officialContractName || project.name || '이름 없음';
}

function SourceRowActionCell({
  candidate,
  match,
  projects,
  projectUsageById,
  disabled,
  onApply,
}: {
  candidate: ProjectMigrationCandidate;
  match: ProjectMigrationProjectMatch | null;
  projects: Project[];
  projectUsageById: Map<string, string>;
  disabled: boolean;
  onApply: (input: {
    candidate: ProjectMigrationCandidate;
    projectId: string;
    projectStatus: ProjectStatus;
  }) => Promise<void>;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState(match?.project.id ?? '');
  const [selectedProjectStatus, setSelectedProjectStatus] = useState<ProjectStatus>(match?.project.status ?? 'CONTRACT_PENDING');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelectedProjectId(match?.project.id ?? '');
    setSelectedProjectStatus(match?.project.status ?? 'CONTRACT_PENDING');
  }, [candidate.id, match?.project.id, match?.project.status]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const projectOptions = useMemo(() => (
    [...projects].sort((left, right) => {
      const leftPinned = left.id === match?.project.id;
      const rightPinned = right.id === match?.project.id;
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;

      const leftAssigned = projectUsageById.has(left.id);
      const rightAssigned = projectUsageById.has(right.id);
      if (leftAssigned !== rightAssigned) return leftAssigned ? 1 : -1;

      return formatProjectLabel(left).localeCompare(formatProjectLabel(right), 'ko');
    })
  ), [match?.project.id, projectUsageById, projects]);

  async function handleApply() {
    if (!selectedProjectId) {
      toast.error('연결할 플랫폼 프로젝트를 먼저 선택해 주세요.');
      return;
    }

    setSaving(true);
    try {
      await onApply({
        candidate,
        projectId: selectedProjectId,
        projectStatus: selectedProjectStatus,
      });
    } finally {
      setSaving(false);
    }
  }

  const assignedSourceName = selectedProjectId ? projectUsageById.get(selectedProjectId) : undefined;
  const selectedProjectLabel = selectedProject ? formatProjectLabel(selectedProject) : '';

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">{getSourceRowNextAction(match?.exact ? 'REGISTERED' : match ? 'CANDIDATE' : 'MISSING', match)}</p>
      <div className="grid gap-2">
        <Select
          value={selectedProjectId || EMPTY_PROJECT_VALUE}
          onValueChange={(value) => {
            const nextProjectId = value === EMPTY_PROJECT_VALUE ? '' : value;
            setSelectedProjectId(nextProjectId);
            const project = projects.find((item) => item.id === nextProjectId);
            if (project) setSelectedProjectStatus(project.status);
          }}
        >
          <SelectTrigger className="w-full text-[11px]" disabled={disabled || saving}>
            <SelectValue placeholder="플랫폼 프로젝트 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EMPTY_PROJECT_VALUE}>플랫폼 프로젝트 선택</SelectItem>
            {projectOptions.map((project) => {
              const linkedSource = projectUsageById.get(project.id);
              const suffix = linkedSource && linkedSource !== candidate.businessName
                ? ` · 현재 연결: ${linkedSource}`
                : linkedSource
                  ? ' · 현재 행과 연결됨'
                  : ' · 미연결';
              return (
                <SelectItem key={project.id} value={project.id}>
                  {formatProjectLabel(project)}{suffix}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Select
          value={selectedProjectStatus}
          onValueChange={(value) => setSelectedProjectStatus(value as ProjectStatus)}
          disabled={!selectedProjectId || disabled || saving}
        >
          <SelectTrigger className="w-full text-[11px]">
            <SelectValue placeholder="프로젝트 상태" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          disabled={!selectedProjectId || disabled || saving}
          onClick={() => { void handleApply(); }}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          연결 내용 반영
        </Button>
      </div>

      {selectedProjectLabel ? (
        <p className="text-[10px] text-muted-foreground">
          선택한 프로젝트에 계약명과 상태를 반영합니다.
          {assignedSourceName && assignedSourceName !== candidate.businessName ? ` 기존 연결 ${assignedSourceName}은 이 행 기준으로 다시 계산됩니다.` : ''}
        </p>
      ) : null}
      {candidate.migrationUpdatedAt ? (
        <p className="text-[10px] text-muted-foreground">
          마지막 연결: {candidate.migrationUpdatedBy || '사용자'} · {candidate.migrationUpdatedAt}
        </p>
      ) : null}
    </div>
  );
}

type UnifiedAuditTableRow =
  | {
    key: string;
    kind: 'source';
    candidate: ProjectMigrationCandidate;
    status: ProjectMigrationStatus;
    sourceName: string;
    match: ProjectMigrationProjectMatch | null;
  }
  | {
    key: string;
    kind: 'current-only';
    status: 'MISSING';
    project: Project;
  };

export function ProjectMigrationAuditPage() {
  const { projects, currentUser, updateProject } = useAppStore();
  const { db, isOnline, orgId } = useFirebase();
  const navigate = useNavigate();
  const [sourceProjects, setSourceProjects] = useState<ProjectMigrationCandidate[]>([]);
  const [isSourceLoading, setIsSourceLoading] = useState(true);
  const [isSyncingScope, setIsSyncingScope] = useState(false);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ProjectMigrationStatus>('ALL');
  const [statusSortMode, setStatusSortMode] = useState<StatusSortMode>('STATUS_ASC');

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
      const statusCompare = compareStatuses(left.status, right.status, statusSortMode);
      if (statusCompare !== 0) return statusCompare;
      return left.project.name.localeCompare(right.project.name, 'ko');
    });
  }, [projects, rows, statusSortMode]);

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
        const matchedDepartment = row.match?.project.department === departmentFilter;
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
        row.match ? [
          row.match.project.name,
          row.match.project.officialContractName,
          row.match.project.groupwareName,
          row.match.project.clientOrg,
          row.match.project.department,
          row.match.project.managerName,
        ].join(' ') : '',
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [departmentFilter, rows, search, statusFilter]);

  const filteredCurrentOnlyRows = useMemo(() => {
    const query = normalizeFilterText(search);
    return currentRows.filter((row) => {
      if (row.match) return false;
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

  const unifiedRows = useMemo<UnifiedAuditTableRow[]>(() => (
    [
      ...filteredRows.map((row) => ({
        key: row.candidate.id,
        kind: 'source' as const,
        candidate: row.candidate,
        status: row.status,
        sourceName: row.candidate.businessName,
        match: row.match,
      })),
      ...filteredCurrentOnlyRows.map((row) => ({
        key: `current-${row.project.id}`,
        kind: 'current-only' as const,
        status: 'MISSING' as const,
        project: row.project,
      })),
    ].sort((left, right) => {
      const statusCompare = compareStatuses(left.status, right.status, statusSortMode);
      if (statusCompare !== 0) return statusCompare;
      if (left.kind !== right.kind) return left.kind === 'source' ? -1 : 1;

      const leftName = left.kind === 'source'
        ? left.sourceName
        : left.project.officialContractName || left.project.name || '';
      const rightName = right.kind === 'source'
        ? right.sourceName
        : right.project.officialContractName || right.project.name || '';

      return leftName.localeCompare(rightName, 'ko');
    })
  ), [filteredCurrentOnlyRows, filteredRows, statusSortMode]);

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

  const projectUsageById = useMemo(() => {
    const next = new Map<string, string>();
    rows.forEach((row) => {
      if (row.match) next.set(row.match.project.id, row.candidate.businessName);
    });
    return next;
  }, [rows]);

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

  async function handleApplyManualLink(input: {
    candidate: ProjectMigrationCandidate;
    projectId: string;
    projectStatus: ProjectStatus;
  }) {
    if (!db || !isOnline) {
      toast.error('Firebase 연결 후 다시 시도해 주세요.');
      return;
    }

    const project = projects.find((item) => item.id === input.projectId);
    if (!project) {
      toast.error('선택한 플랫폼 프로젝트를 찾지 못했습니다.');
      return;
    }

    const now = new Date().toISOString();
    const nextContractName = input.candidate.businessName.trim();
    const nextProjectLabel = nextContractName || formatProjectLabel(project);

    await updateProject(project.id, {
      officialContractName: nextContractName,
      status: input.projectStatus,
      updatedAt: now,
    });

    await setDoc(
      doc(db, getOrgCollectionPath(orgId, 'projectDashboardProjects'), input.candidate.id),
      {
        manualProjectId: project.id,
        manualProjectName: nextProjectLabel,
        migrationUpdatedAt: now,
        migrationUpdatedBy: currentUser.name || currentUser.email || currentUser.uid,
        updatedAt: now,
      },
      { merge: true },
    );

    toast.success('이관 연결을 반영했습니다.', {
      description: `${input.candidate.businessName} → ${nextProjectLabel}`,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FolderSearch}
        iconGradient="linear-gradient(135deg, #0f766e 0%, #0ea5e9 100%)"
        title="프로젝트 마이그레이션 등록 현황"
        description={`사업대시보드 기준 ${sourceSummary.total}건과 현재 플랫폼 등록 ${currentSummary.total}건을 비교해 마이그레이션 진행 상태를 확인합니다. 완료율 ${formatRatio(completionRatio)}, 확인 필요 ${sourceSummary.candidate}, 미등록 ${sourceSummary.missing}`}
        badge="Firestore"
      />

      <Card className="border-amber-200/70 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20">
        <CardContent className="flex flex-col gap-4 p-4 text-[12px] text-amber-900 dark:text-amber-200 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">사업대시보드의 기준 25건과 현재 플랫폼 프로젝트를 나란히 비교하는 임시 점검 화면입니다.</p>
              <p>이관 대상 25건을 빠르게 확인하는 용도이며, 완료보다 미등록과 확인 필요 항목이 먼저 보이도록 정렬됩니다.</p>
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
              기준 {APPROVED_PROJECT_DASHBOARD_SCOPE.length}개 다시 적재
            </Button>
            <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80">비교 기준만 갱신하며 현재 플랫폼 프로젝트는 변경하지 않습니다.</p>
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
            <p className="text-[11px] text-muted-foreground">현재 플랫폼 등록</p>
            <p className="mt-2 text-2xl font-semibold">{currentSummary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">완료</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-600">{sourceSummary.registered}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] text-muted-foreground">확인 필요</p>
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
                placeholder="사업대시보드 프로젝트명, 플랫폼 계약명으로 검색"
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
                <SelectItem value="REGISTERED">완료</SelectItem>
                <SelectItem value="CANDIDATE">확인 필요</SelectItem>
                <SelectItem value="MISSING">미등록</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusSortMode} onValueChange={(value) => setStatusSortMode(value as StatusSortMode)}>
              <SelectTrigger className="w-full lg:w-[180px]">
                <SelectValue placeholder="정렬" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STATUS_ASC">미등록 우선</SelectItem>
                <SelectItem value="STATUS_DESC">완료 우선</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">통합 대조표</h2>
            <p className="text-[12px] text-muted-foreground">이관 대상 25건을 기준으로 플랫폼 프로젝트를 계약명 우선으로 붙였습니다. 필요하면 아래에서 미아 프로젝트를 직접 연결하고 상태를 반영할 수 있습니다.</p>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[92px]">상태</TableHead>
                  <TableHead className="min-w-[180px]">이관 대상 프로젝트(사업대시보드 기준)</TableHead>
                  <TableHead className="min-w-[360px]">플랫폼 상의 프로젝트</TableHead>
                  <TableHead className="min-w-[280px]">매칭/업데이트</TableHead>
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
                        ? <CurrentProjectMatchCell match={row.match} onOpenProject={(projectId) => navigate(`/projects/${projectId}`)} />
                        : <CurrentOnlyProjectCell project={row.project} onOpenProject={(projectId) => navigate(`/projects/${projectId}`)} />}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {row.kind === 'source'
                        ? (
                          <SourceRowActionCell
                            candidate={row.candidate}
                            match={row.match}
                            projects={projects}
                            projectUsageById={projectUsageById}
                            disabled={!db || !isOnline}
                            onApply={handleApplyManualLink}
                          />
                        )
                        : getCurrentOnlyNextAction()}
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
        <span>플랫폼 프로젝트를 열어 확인이 필요하면 현재 사업명을 누르세요.</span>
        <ArrowRight className="h-3.5 w-3.5" />
        <span>미등록과 확인 필요 항목부터 정리하면 이관 누락을 빠르게 줄일 수 있습니다.</span>
      </div>
    </div>
  );
}
