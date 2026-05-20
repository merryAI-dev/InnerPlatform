import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../../data/store';
import type { Project, ProjectPhase } from '../../data/types';
import {
  buildProjectEditorDraftFromProject,
  buildProjectEditorProjectPatch,
  createProjectEditorDraft,
  type ProjectEditorDraft,
} from '../../platform/project-editor';
import { resolveProjectCic } from '../../platform/project-cic';
import { ProjectEditorWizard } from './ProjectEditorWizard';

interface ProjectWizardProps {
  editProject?: Project;
  initialPhase?: ProjectPhase;
}

function slugify(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

function createProjectFromDraft(
  draft: ProjectEditorDraft,
  patch: Partial<Project>,
  now: string,
): Project {
  const id = `p${Date.now()}`;
  return {
    id,
    slug: slugify(draft.name) || id,
    orgId: 'mysc',
    name: draft.name,
    shortName: draft.name,
    officialContractName: draft.officialContractName,
    status: draft.status,
    type: draft.type,
    phase: draft.phase,
    contractAmount: draft.contractAmount,
    contractStart: draft.contractStart,
    contractEnd: draft.contractEnd,
    settlementType: draft.settlementType,
    basis: draft.basis,
    accountType: draft.accountType,
    fundInputMode: draft.fundInputMode,
    settlementSheetPolicy: draft.settlementSheetPolicy,
    paymentPlan: draft.paymentPlan,
    paymentPlanDesc: draft.paymentPlanDesc,
    clientOrg: draft.clientOrg,
    groupwareName: draft.groupwareName,
    participantCondition: draft.participantCondition,
    teamMembersDetailed: draft.teamMembersDetailed,
    contractType: draft.contractType,
    projectPurpose: draft.projectPurpose,
    totalRevenueAmount: draft.totalRevenueAmount,
    supportAmount: draft.supportAmount,
    salesVatAmount: draft.salesVatAmount,
    financialInputFlags: draft.financialInputFlags,
    settlementGuide: draft.settlementGuide,
    contractDocument: draft.contractDocument,
    contractAnalysis: null,
    department: draft.department,
    cic: resolveProjectCic({ department: draft.department }),
    teamName: draft.teamName,
    managerId: draft.managerId,
    managerName: draft.managerName,
    budgetCurrentYear: draft.budgetCurrentYear || draft.contractAmount,
    taxInvoiceAmount: draft.taxInvoiceAmount,
    profitRate: draft.profitRate,
    profitAmount: draft.profitAmount,
    isSettled: false,
    finalPaymentNote: draft.finalPaymentNote,
    confirmerName: '',
    lastCheckedAt: '',
    cashflowDiffNote: '',
    description: draft.description,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

export function ProjectWizard({ editProject, initialPhase = 'PROSPECT' }: ProjectWizardProps) {
  const navigate = useNavigate();
  const { addProject, updateProject, members, currentUser } = useAppStore();
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  const initialDraft = useMemo(
    () => (editProject
      ? buildProjectEditorDraftFromProject(editProject)
      : createProjectEditorDraft({
        phase: initialPhase,
        status: initialPhase === 'PROSPECT' ? 'CONTRACT_PENDING' : 'IN_PROGRESS',
      })),
    [editProject, initialPhase],
  );

  const handleSubmit = async (incomingDraft: ProjectEditorDraft, actionId: string) => {
    if (busyActionId) return;
    const now = new Date().toISOString();
    const draft = createProjectEditorDraft(incomingDraft);
    const actorId = currentUser?.uid || 'admin';
    const actorName = currentUser?.name || currentUser?.email || '관리자';

    setBusyActionId(actionId);
    try {
      const patch = buildProjectEditorProjectPatch(draft, {
        baseProject: editProject,
        mode: 'admin',
        actorId,
        actorName,
        now,
      });

      if (editProject) {
        await updateProject(editProject.id, {
          ...patch,
          cic: resolveProjectCic({ cic: editProject.cic, department: draft.department }),
        });
        toast.success('프로젝트 수정 내용이 저장되었습니다.');
        navigate(`/projects/${editProject.id}`);
      } else {
        const project = createProjectFromDraft(draft, patch, now);
        await addProject(project);
        toast.success(draft.phase === 'PROSPECT' ? '예정 프로젝트로 저장했습니다.' : '프로젝트를 등록했습니다.');
        navigate(`/projects/${project.id}`);
      }
    } catch (error) {
      console.error('[ProjectWizard] save failed:', error);
      toast.error(error instanceof Error ? error.message : '프로젝트 저장에 실패했습니다.');
    } finally {
      setBusyActionId(null);
    }
  };

  return (
    <ProjectEditorWizard
      mode="admin"
      title={editProject ? '프로젝트 수정' : '프로젝트 등록'}
      description="포털 등록/수정과 같은 5단계 입력 구조를 사용합니다."
      initialDraft={initialDraft}
      draftKey={`admin-${editProject?.id || 'new'}-${editProject?.updatedAt || initialPhase}`}
      members={members}
      actions={editProject ? [
        { id: 'save', label: '수정 저장', icon: Save },
      ] : [
        { id: 'save', label: '프로젝트 저장', icon: Save },
      ]}
      busyActionId={busyActionId}
      onCancel={() => navigate(editProject ? `/projects/${editProject.id}` : '/projects')}
      onSubmit={(draft, actionId) => void handleSubmit(draft, actionId)}
    />
  );
}
