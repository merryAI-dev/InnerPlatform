import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { FolderSearch, Loader2 } from 'lucide-react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { normalizeProjectMigrationCandidate } from '../../data/project-migration-candidates';
import { useAppStore } from '../../data/store';
import { type Project, type ProjectStatus } from '../../data/types';
import { getOrgCollectionPath } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';
import {
  buildProjectMigrationAuditRows,
  buildProjectMigrationCurrentRows,
  type ProjectMigrationCurrentRow,
  type ProjectMigrationStatus,
} from '../../platform/project-migration-audit';
import {
  buildMigrationAuditConsoleRecords,
  buildMigrationAuditCicSelectionOptions,
  collectMigrationAuditCicOptions,
  filterMigrationAuditConsoleRecords,
  findMigrationAuditRecord,
  findProposalProjectsForMigrationAuditRecord,
  groupMigrationAuditConsoleRecords,
  normalizeCicLabel,
  summarizeMigrationAuditConsole,
} from '../../platform/project-migration-console';
import { resolveProjectCic } from '../../platform/project-cic';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { MigrationAuditControlBar } from './migration-audit/MigrationAuditControlBar';
import { MigrationAuditQueueRail } from './migration-audit/MigrationAuditQueueRail';
import { MigrationAuditDetailPanel } from './migration-audit/MigrationAuditDetailPanel';

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
  const { projects, currentUser, updateProject, trashProject } = useAppStore();
  const { db, isOnline, orgId } = useFirebase();
  const navigate = useNavigate();

  const [sourceProjects, setSourceProjects] = useState<ReturnType<typeof normalizeProjectMigrationCandidate>[]>([]);
  const [isSourceLoading, setIsSourceLoading] = useState(true);

  const [cicFilter, setCicFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ProjectMigrationStatus>('ALL');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [selectedCic, setSelectedCic] = useState('미지정');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedProjectStatus, setSelectedProjectStatus] = useState<ProjectStatus>('CONTRACT_PENDING');
  const [selectedProposalId, setSelectedProposalId] = useState('');
  const [proposalDraftName, setProposalDraftName] = useState('');
  const [proposalDraftOfficialContractName, setProposalDraftOfficialContractName] = useState('');
  const [proposalDraftClientOrg, setProposalDraftClientOrg] = useState('');
  const [linking, setLinking] = useState(false);
  const [savingProposal, setSavingProposal] = useState(false);
  const [trashingProjectId, setTrashingProjectId] = useState<string | null>(null);

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
        query: '',
      }),
    [cicFilter, records, statusFilter],
  );

  const filteredCurrentRows = useMemo(
    () => filterCurrentOnlyRows(currentRows, cicFilter, statusFilter, ''),
    [cicFilter, currentRows, statusFilter],
  );

  const sections = useMemo(
    () => groupMigrationAuditConsoleRecords(filteredRecords),
    [filteredRecords],
  );

  const summary = useMemo(
    () => summarizeMigrationAuditConsole(filteredRecords, filteredCurrentRows.length),
    [filteredCurrentRows.length, filteredRecords],
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

  const proposalProjects = useMemo(
    () => findProposalProjectsForMigrationAuditRecord(activeRecord, projects),
    [activeRecord, projects],
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
  }, [activeRecord?.id]);

  useEffect(() => {
    if (proposalProjects.length === 0) {
      setSelectedProposalId('');
      setProposalDraftName('');
      setProposalDraftOfficialContractName('');
      setProposalDraftClientOrg('');
      return;
    }

    const target = proposalProjects.find((project) => project.id === selectedProposalId) || proposalProjects[0];
    setSelectedProposalId(target.id);
    setProposalDraftName(target.name || '');
    setProposalDraftOfficialContractName(target.officialContractName || target.name || '');
    setProposalDraftClientOrg(target.clientOrg || '');
    setSelectedProjectId(target.id);
    setSelectedProjectStatus(target.status || 'CONTRACT_PENDING');
  }, [proposalProjects, selectedProposalId]);

  const selectedProposalProject = useMemo(
    () => proposalProjects.find((project) => project.id === selectedProposalId) || null,
    [proposalProjects, selectedProposalId],
  );

  const selectedTargetProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

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
      const projectPatch: Partial<Project> = {
        status: selectedProjectStatus,
        cic: selectedCic !== '미지정' ? selectedCic : undefined,
        department: selectedCic !== '미지정' ? selectedCic : project.department,
        teamName: selectedCic !== '미지정' ? selectedCic : project.teamName,
        updatedAt: new Date().toISOString(),
      };
      await updateProject(project.id, {
        ...projectPatch,
      });
      await persistCandidateLink({
        ...project,
        ...projectPatch,
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

  async function handleSaveProposalProject() {
    if (!selectedProposalProject) {
      toast.error('수정할 등록 제안 프로젝트를 먼저 선택해 주세요.');
      return;
    }
    const nextName = proposalDraftName.trim();
    const nextOfficialName = proposalDraftOfficialContractName.trim() || nextName;
    if (!nextName) {
      toast.error('프로젝트명을 입력해 주세요.');
      return;
    }

    setSavingProposal(true);
    try {
      await updateProject(selectedProposalProject.id, {
        name: nextName,
        shortName: nextName,
        officialContractName: nextOfficialName,
        clientOrg: proposalDraftClientOrg.trim(),
        department: selectedCic !== '미지정' ? selectedCic : undefined,
        teamName: selectedCic !== '미지정' ? selectedCic : undefined,
        cic: selectedCic !== '미지정' ? selectedCic : undefined,
        updatedAt: new Date().toISOString(),
      });
      toast.success('등록 제안 프로젝트를 수정했습니다.', {
        description: `${nextOfficialName} · ${selectedCic}`,
      });
    } catch (error) {
      toast.error('등록 제안 프로젝트 수정 실패', {
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
      });
    } finally {
      setSavingProposal(false);
    }
  }

  async function handleTrashProjectTarget(project: Project, reason: string) {
    setTrashingProjectId(project.id);
    try {
      await trashProject(project.id, reason);
      if (selectedProjectId === project.id) {
        setSelectedProjectId('');
      }
      if (selectedProposalId === project.id) {
        setSelectedProposalId('');
      }
      toast.success('프로젝트를 폐기했습니다.', {
        description: `${project.officialContractName || project.name} · 휴지통 이동`,
      });
    } catch (error) {
      toast.error('프로젝트 폐기 실패', {
        description: error instanceof Error ? error.message : '다시 시도해 주세요.',
      });
    } finally {
      setTrashingProjectId(null);
    }
  }

  const pageDescription = `PM이 등록한 프로젝트 원문을 CIC 단위로 검색하고, 우측 심사 패널에서 예산·인력까지 확인한 뒤 임원 결정만 내리면 됩니다.`;

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
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        summary={summary}
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
          <div data-testid="migration-review-queue">
            <MigrationAuditQueueRail
              sections={sections}
              currentOnlyRows={filteredCurrentRows}
              selectedId={activeRecord?.id || null}
              onSelect={setSelectedRecordId}
              onOpenCurrentOnlyProject={(projectId) => navigate(`/projects/${projectId}`)}
            />
          </div>
          <div data-testid="migration-review-dossier">
            <MigrationAuditDetailPanel
              record={activeRecord}
              cicOptions={cicSelectionOptions}
              selectedCic={selectedCic}
              onSelectedCicChange={setSelectedCic}
              proposalProjects={proposalProjects}
              selectedProjectId={selectedProjectId}
              selectedTargetProject={selectedTargetProject}
              onApplyMatch={() => { void handleApplyMatch(); }}
              selectedProposalId={selectedProposalId}
              proposalDraftName={proposalDraftName}
              onProposalDraftNameChange={setProposalDraftName}
              proposalDraftOfficialContractName={proposalDraftOfficialContractName}
              onProposalDraftOfficialContractNameChange={setProposalDraftOfficialContractName}
              proposalDraftClientOrg={proposalDraftClientOrg}
              onProposalDraftClientOrgChange={setProposalDraftClientOrg}
              onSaveProposal={() => { void handleSaveProposalProject(); }}
              onTrashProposal={() => {
                if (!selectedProposalProject) return;
                void handleTrashProjectTarget(selectedProposalProject, '이관 등록 제안 폐기');
              }}
              linking={linking}
              savingProposal={savingProposal}
              trashingProjectId={trashingProjectId}
              onTrashDuplicate={(project) => {
                void handleTrashProjectTarget(project, '이관 중복 프로젝트 폐기');
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
