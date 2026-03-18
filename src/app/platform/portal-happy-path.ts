import { normalizeProjectIds } from '../data/project-assignment';
import type { Ledger, Project, UserRole } from '../data/types';

type PortalLikeUser = {
  role?: string;
  projectId?: string;
  projectIds?: string[];
};

type AuthLikeUser = {
  role?: UserRole | string;
  email?: string;
};

export type PortalHappyPathStepStatus = 'complete' | 'required' | 'optional';

export interface PortalHappyPathStep {
  key: 'auth' | 'assignment' | 'project' | 'drive_root' | 'ledger' | 'evidence';
  label: string;
  status: PortalHappyPathStepStatus;
  detail: string;
}

export interface PortalHappyPathState {
  status: 'blocked' | 'setup_required' | 'ready';
  canOpenWeeklyExpenses: boolean;
  canUseEvidenceWorkflow: boolean;
  selectedProjectId: string;
  selectedProjectName: string;
  missingKeys: PortalHappyPathStep['key'][];
  steps: PortalHappyPathStep[];
}

interface ResolvePortalHappyPathInput {
  authUser?: AuthLikeUser | null;
  portalUser?: PortalLikeUser | null;
  project?: Pick<Project, 'id' | 'name' | 'evidenceDriveRootFolderId' | 'evidenceDriveRootFolderName'> | null;
  ledgers?: Array<Pick<Ledger, 'projectId'>>;
}

export function resolvePortalHappyPath(input: ResolvePortalHappyPathInput): PortalHappyPathState {
  const authRole = String(input.authUser?.role || '').trim().toLowerCase();
  const isPortalCapable = ['pm', 'viewer', 'admin', 'tenant_admin'].includes(authRole);
  const assignedProjectIds = normalizeProjectIds([
    ...(Array.isArray(input.portalUser?.projectIds) ? input.portalUser?.projectIds : []),
    input.portalUser?.projectId,
  ]);
  const selectedProjectId = String(input.project?.id || input.portalUser?.projectId || assignedProjectIds[0] || '').trim();
  const selectedProjectName = String(input.project?.name || '').trim();
  const hasDriveRoot = Boolean(input.project?.evidenceDriveRootFolderId);
  const hasLedger = Boolean(
    selectedProjectId
      && Array.isArray(input.ledgers)
      && input.ledgers.some((ledger) => String(ledger.projectId || '').trim() === selectedProjectId),
  );

  const steps: PortalHappyPathStep[] = [
    {
      key: 'auth',
      label: '회사 계정 로그인',
      status: isPortalCapable ? 'complete' : 'required',
      detail: isPortalCapable
        ? '포털 접근 권한이 확인되었습니다.'
        : '포털에 들어갈 수 있는 권한이 아직 확인되지 않았습니다.',
    },
    {
      key: 'assignment',
      label: '내 사업 선택',
      status: assignedProjectIds.length > 0 ? 'complete' : 'required',
      detail: assignedProjectIds.length > 0
        ? `${assignedProjectIds.length}개 사업이 연결되어 있습니다.`
        : '최소 1개 사업을 선택해야 포털 입력을 시작할 수 있습니다.',
    },
    {
      key: 'project',
      label: '주사업 확정',
      status: selectedProjectId ? 'complete' : 'required',
      detail: selectedProjectId
        ? `${selectedProjectName || selectedProjectId} 기준으로 포털이 열립니다.`
        : '현재 기준이 되는 주사업이 아직 없습니다.',
    },
    {
      key: 'drive_root',
      label: '사업 기본 폴더 준비',
      status: !selectedProjectId ? 'optional' : hasDriveRoot ? 'complete' : 'required',
      detail: !selectedProjectId
        ? '주사업이 정해지면 Shared Drive 기본 폴더를 연결할 수 있습니다.'
        : hasDriveRoot
          ? `${input.project?.evidenceDriveRootFolderName || '기본 폴더'}가 연결되어 있습니다.`
          : '증빙 폴더 자동 생성을 위해 사업 기본 폴더를 먼저 준비해야 합니다.',
    },
    {
      key: 'ledger',
      label: '기본 원장 준비',
      status: !selectedProjectId ? 'optional' : hasLedger ? 'complete' : 'optional',
      detail: !selectedProjectId
        ? '주사업이 정해지면 원장 준비 상태를 확인할 수 있습니다.'
        : hasLedger
          ? '기본 원장이 이미 준비되어 있습니다.'
          : '원장은 첫 거래 저장 시 자동 생성됩니다.',
    },
    {
      key: 'evidence',
      label: '증빙 Workflow 사용',
      status: selectedProjectId && hasDriveRoot ? 'complete' : selectedProjectId ? 'required' : 'optional',
      detail: selectedProjectId && hasDriveRoot
        ? '주간 시트에서 행 저장 후 생성/업로드/동기화를 바로 사용할 수 있습니다.'
        : selectedProjectId
          ? '기본 폴더가 연결되면 행별 증빙 폴더와 업로드를 바로 사용할 수 있습니다.'
          : '사업 선택과 기본 폴더 준비 후 증빙 Workflow를 사용할 수 있습니다.',
    },
  ];

  const missingKeys = steps
    .filter((step) => step.status === 'required')
    .map((step) => step.key);
  const canOpenWeeklyExpenses = isPortalCapable && Boolean(selectedProjectId);
  const canUseEvidenceWorkflow = canOpenWeeklyExpenses && hasDriveRoot;

  return {
    status: !isPortalCapable
      ? 'blocked'
      : missingKeys.length > 0
        ? 'setup_required'
        : 'ready',
    canOpenWeeklyExpenses,
    canUseEvidenceWorkflow,
    selectedProjectId,
    selectedProjectName,
    missingKeys,
    steps,
  };
}
