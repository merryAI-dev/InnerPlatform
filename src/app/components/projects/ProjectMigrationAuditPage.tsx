import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FolderSearch, Loader2 } from 'lucide-react';
import type { Firestore } from 'firebase/firestore';
import { collection, doc, getDocs, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { toast } from 'sonner';
import { normalizeProjectMigrationCandidate } from '../../data/project-migration-candidates';
import { useAppStore } from '../../data/store';
import { type Project, type ProjectStatus } from '../../data/types';
import { getOrgCollectionPath } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';
import { APPROVED_PROJECT_DASHBOARD_SCOPE, buildApprovedProjectDashboardSyncPlan } from '../../platform/project-dashboard-scope';
import {
  buildProjectMigrationAuditRows,
  buildProjectMigrationCurrentRows,
  type ProjectMigrationCurrentRow,
  type ProjectMigrationStatus,
} from '../../platform/project-migration-audit';
import {
  buildMigrationAuditConsoleRecords,
  buildMigrationAuditCicSelectionOptions,
  buildMigrationAuditDenseRows,
  collectMigrationAuditCicOptions,
  filterMigrationAuditConsoleRecords,
  findMigrationAuditRecord,
  groupMigrationAuditConsoleRecords,
  normalizeCicLabel,
  suggestProjectsForMigrationAuditRecord,
  summarizeMigrationAuditConsole,
} from '../../platform/project-migration-console';
import { resolveProjectCic } from '../../platform/project-cic';
import { buildQuickMigrationProject } from '../../platform/project-migration-quick-create';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { MigrationAuditControlBar } from './migration-audit/MigrationAuditControlBar';
import { MigrationAuditQueueRail } from './migration-audit/MigrationAuditQueueRail';
import { MigrationAuditDetailPanel } from './migration-audit/MigrationAuditDetailPanel';
import { MigrationAuditDenseTable } from './migration-audit/MigrationAuditDenseTable';

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
      const targetRef = doc(db, collectionPath, operation.id);
      if (operation.type === 'set') {
        batch.set(targetRef, operation.candidate, { merge: false });
      } else {
        batch.delete(targetRef);
      }
    }
    await batch.commit();
  }

  return {
    upserted: plan.candidates.length,
    deleted: plan.deleteIds.length,
  };
}

function formatRatio(value: number | null): string {
  if (value == null) return '기준 없음';
  return `${value.toFixed(1)}%`;
}

function filterCurrentOnlyRows(
  rows: ProjectMigrationCurrentRow[],
  cicFilter: string,
  statusFilter: 'ALL' | ProjectMigrationStatus,
  query: string,
): ProjectMigrationCurrentRow[] {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  return rows.filter((row) => {
    if (row.match) return false;
    if (statusFilter !== 'ALL' && statusFilter !== 'MISSING') return false;
    const projectCic = normalizeCicLabel(resolveProjectCic(row.project));
    if (cicFilter !== 'ALL' && projectCic !== cicFilter) return false;
    if (!normalizedQuery) return true;
    const haystack = [
      row.project.name,
      row.project.officialContractName,
      row.project.clientOrg,
      row.project.department,
      projectCic,
    ].join(' ').toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function ProjectMigrationAuditPage() {
  const { projects, currentUser, addProject, updateProject } = useAppStore();
  const { db, isOnline, orgId } = useFirebase();
  const navigate = useNavigate();

  const [sourceProjects, setSourceProjects] = useState<ReturnType<typeof normalizeProjectMigrationCandidate>[]>([]);
  const [isSourceLoading, setIsSourceLoading] = useState(true);
  const [isSyncingScope, setIsSyncingScope] = useState(false);

  const [search, setSearch] = useState('');
  const [cicFilter, setCicFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ProjectMigrationStatus>('ALL');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [selectedCic, setSelectedCic] = useState('미지정');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedProjectStatus, setSelectedProjectStatus] = useState<ProjectStatus>('CONTRACT_PENDING');
  const [quickCreateName, setQuickCreateName] = useState('');
  const [linking, setLinking] = useState(false);
  const [creating, setCreating] = useState(false);

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
          .sort((left, right) => left.businessName.localeCompare(right.businessName, 'ko'));
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

  const currentRows = useMemo(
    () => buildProjectMigrationCurrentRows(rows, projects),
    [projects, rows],
  );

  const records = useMemo(
    () => buildMigrationAuditConsoleRecords(rows),
    [rows],
  );

  const filteredRecords = useMemo(
    () => filterMigrationAuditConsoleRecords(records, {
      cic: cicFilter,
      status: statusFilter,
      query: search,
    }),
    [cicFilter, records, search, statusFilter],
  );

  const filteredCurrentRows = useMemo(
    () => filterCurrentOnlyRows(currentRows, cicFilter, statusFilter, search),
    [cicFilter, currentRows, search, statusFilter],
  );

  const sections = useMemo(
    () => groupMigrationAuditConsoleRecords(filteredRecords),
    [filteredRecords],
  );

  const summary = useMemo(
    () => summarizeMigrationAuditConsole(filteredRecords),
    [filteredRecords],
  );

  const cicOptions = useMemo(
    () => collectMigrationAuditCicOptions(records, currentRows),
    [currentRows, records],
  );

  const cicSelectionOptions = useMemo(
    () => buildMigrationAuditCicSelectionOptions(cicOptions),
    [cicOptions],
  );

  const activeRecord = useMemo(
    () => findMigrationAuditRecord(filteredRecords, selectedRecordId),
    [filteredRecords, selectedRecordId],
  );

  const suggestedProjects = useMemo(
    () => suggestProjectsForMigrationAuditRecord(activeRecord, projects.filter((project) => !project.trashedAt)),
    [activeRecord, projects],
  );

  const denseRows = useMemo(
    () => buildMigrationAuditDenseRows(filteredRecords, filteredCurrentRows),
    [filteredCurrentRows, filteredRecords],
  );

  useEffect(() => {
    if (!activeRecord) return;
    setSelectedRecordId(activeRecord.id);
  }, [activeRecord]);

  useEffect(() => {
    if (!activeRecord) return;
    setSelectedCic(activeRecord.cic);
    setSelectedProjectId(activeRecord.match?.project.id || '');
    setSelectedProjectStatus(activeRecord.match?.project.status || 'CONTRACT_PENDING');
    setQuickCreateName(activeRecord.sourceName);
  }, [activeRecord?.id]);

  async function handleSyncApprovedScope() {
    if (!db || !isOnline) {
      toast.error('Firebase 연결 후 다시 시도해 주세요.');
      return;
    }
    setIsSyncingScope(true);
    try {
      const result = await syncApprovedProjectDashboardScope(db, orgId);
      toast.success(`비교 기준 ${APPROVED_PROJECT_DASHBOARD_SCOPE.length}건 반영 완료`, {
        description: `source ${result.upserted}건 저장, 기존 범위 밖 ${result.deleted}건 정리`,
      });
    } catch (error) {
      console.error('[ProjectMigrationAuditPage] project dashboard sync error:', error);
      toast.error('비교 기준 적재 실패', {
        description: error instanceof Error ? error.message : 'Firestore 쓰기 권한을 확인해 주세요.',
      });
    } finally {
      setIsSyncingScope(false);
    }
  }

  async function persistCandidateLink(project: Project) {
    if (!db || !isOnline || !activeRecord) {
      throw new Error('Firebase 연결 후 다시 시도해 주세요.');
    }
    const now = new Date().toISOString();
    await setDoc(
      doc(db, getOrgCollectionPath(orgId, 'projectDashboardProjects'), activeRecord.candidate.id),
      {
        cic: selectedCic !== '미지정' ? selectedCic : '',
        manualProjectId: project.id,
        manualProjectName: project.officialContractName || project.name,
        migrationUpdatedAt: now,
        migrationUpdatedBy: currentUser.name || currentUser.email || currentUser.uid,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  async function handleApplyMatch() {
    if (!activeRecord || !selectedProjectId) {
      toast.error('연결할 프로젝트를 먼저 선택해 주세요.');
      return;
    }
    const project = projects.find((item) => item.id === selectedProjectId);
    if (!project) {
      toast.error('선택한 프로젝트를 찾지 못했습니다.');
      return;
    }
    setLinking(true);
    try {
      await updateProject(project.id, {
        officialContractName: activeRecord.sourceName,
        status: selectedProjectStatus,
        cic: selectedCic !== '미지정' ? selectedCic : undefined,
        updatedAt: new Date().toISOString(),
      });
      await persistCandidateLink({
        ...project,
        officialContractName: activeRecord.sourceName,
        status: selectedProjectStatus,
        cic: selectedCic !== '미지정' ? selectedCic : undefined,
      });
      toast.success('이관 연결을 반영했습니다.', {
        description: `${activeRecord.sourceName} → ${project.officialContractName || project.name}`,
      });
    } catch (error) {
      toast.error('이관 연결 반영 실패', {
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
      });
    } finally {
      setLinking(false);
    }
  }

  async function handleQuickCreate() {
    if (!activeRecord) {
      toast.error('선택된 row가 없습니다.');
      return;
    }
    if (!quickCreateName.trim()) {
      toast.error('프로젝트명을 입력해 주세요.');
      return;
    }
    if (selectedCic === '미지정') {
      toast.error('새 프로젝트를 만들기 전에 등록 조직을 선택해 주세요.');
      return;
    }

    setCreating(true);
    try {
      const project = buildQuickMigrationProject({
        orgId,
        candidate: activeRecord.candidate,
        name: quickCreateName,
        cic: selectedCic,
        actor: {
          uid: currentUser.uid,
          name: currentUser.name || currentUser.email || '운영자',
        },
      });
      await addProject(project);
      await persistCandidateLink(project);
      setSelectedProjectId(project.id);
      setSelectedProjectStatus(project.status);
      toast.success('새 프로젝트를 등록하고 즉시 연결했습니다.', {
        description: `${project.name} · ${selectedCic}`,
      });
    } catch (error) {
      toast.error('새 프로젝트 등록 실패', {
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
      });
    } finally {
      setCreating(false);
    }
  }

  const pageDescription = `이관 대상 ${records.length}건을 CIC와 queue 기준으로 운영합니다. 완료율 ${formatRatio(summary.completionRatio)}, 미등록 ${summary.missing}, 후보 있음 ${summary.candidate}`;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FolderSearch}
        iconGradient="linear-gradient(135deg, #0f766e 0%, #0ea5e9 100%)"
        title="프로젝트 마이그레이션 운영 콘솔"
        description={pageDescription}
        badge="Firestore"
      />

      {!db || !isOnline ? (
        <Card>
          <CardContent className="p-4 text-[12px] text-muted-foreground">
            Firebase 연결이 없어서 원본/현재 프로젝트 컬렉션을 읽지 못했습니다. Firestore 연결 후 다시 확인해 주세요.
          </CardContent>
        </Card>
      ) : null}

      <MigrationAuditControlBar
        cicOptions={cicOptions}
        cicFilter={cicFilter}
        onCicFilterChange={setCicFilter}
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        summary={summary}
        syncDisabled={!db || !isOnline}
        syncPending={isSyncingScope}
        onSync={() => { void handleSyncApprovedScope(); }}
        onStartQuickCreate={() => {
          const target = activeRecord
            ?? sections.missing[0]
            ?? sections.candidate[0]
            ?? filteredRecords[0]
            ?? null;
          if (!target) return;
          setSelectedRecordId(target.id);
          setQuickCreateName(target.sourceName);
        }}
      />

      {isSourceLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            원본 대시보드 프로젝트를 불러오는 중입니다…
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <MigrationAuditQueueRail
            sections={sections}
            selectedId={activeRecord?.id || null}
            onSelect={setSelectedRecordId}
          />
          <MigrationAuditDetailPanel
            record={activeRecord}
            cicOptions={cicSelectionOptions}
            selectedCic={selectedCic}
            onSelectedCicChange={setSelectedCic}
            suggestedProjects={suggestedProjects}
            selectedProjectId={selectedProjectId}
            onSelectedProjectIdChange={setSelectedProjectId}
            selectedProjectStatus={selectedProjectStatus}
            onSelectedProjectStatusChange={setSelectedProjectStatus}
            onApplyMatch={() => { void handleApplyMatch(); }}
            quickCreateName={quickCreateName}
            onQuickCreateNameChange={setQuickCreateName}
            onQuickCreate={() => { void handleQuickCreate(); }}
            linking={linking}
            creating={creating}
          />
        </div>
      )}

      <MigrationAuditDenseTable
        rows={denseRows}
        selectedRecordId={activeRecord?.id || null}
        onSelectRecord={setSelectedRecordId}
        onOpenProject={(projectId) => navigate(`/projects/${projectId}`)}
      />
    </div>
  );
}
