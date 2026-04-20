import type {
  Project,
  ProjectExecutiveReviewStatus,
  ProjectRequest,
} from '../data/types';

export type MigrationAuditConsoleStatus = ProjectExecutiveReviewStatus;

export interface MigrationAuditConsoleRecord {
  id: string;
  project: Project;
  request: ProjectRequest | null;
  status: MigrationAuditConsoleStatus;
  cic: string;
  title: string;
  clientOrg: string;
  managerName: string;
  requestedAt: string;
}

export interface MigrationAuditConsoleSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  discarded: number;
}

export interface MigrationAuditActionState {
  tone: 'warning' | 'success' | 'danger' | 'neutral';
  label: string;
  helper: string;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function normalizeCicLabel(value: unknown): string {
  const normalized = normalizeText(value);
  return normalized || '미지정';
}

function deriveProjectRequestMap(requests: ProjectRequest[]): Map<string, ProjectRequest> {
  const map = new Map<string, ProjectRequest>();
  requests.forEach((request) => {
    if (request.approvedProjectId) {
      map.set(request.approvedProjectId, request);
    }
  });
  return map;
}

export function deriveMigrationAuditStatus(project: Project): MigrationAuditConsoleStatus {
  if (project.registrationSource !== 'pm_portal') return 'APPROVED';
  return project.executiveReviewStatus || 'PENDING';
}

export function getMigrationAuditStatusLabel(status: MigrationAuditConsoleStatus): string {
  if (status === 'APPROVED') return '승인 완료';
  if (status === 'REVISION_REJECTED') return '수정 요청 후 반려';
  if (status === 'DUPLICATE_DISCARDED') return '중복·폐기';
  return '검토 대기';
}

export function buildMigrationAuditConsoleRecords(
  projects: Project[],
  requests: ProjectRequest[],
): MigrationAuditConsoleRecord[];
export function buildMigrationAuditConsoleRecords(
  projects: Project[],
  requests: Array<ProjectRequest>,
): MigrationAuditConsoleRecord[] {
  const requestMap = deriveProjectRequestMap(requests);

  return projects
    .filter((project) => !project.trashedAt)
    .map((project) => {
      const request = requestMap.get(project.id) || null;
      return {
        id: project.id,
        project,
        request,
        status: deriveMigrationAuditStatus(project),
        cic: normalizeCicLabel(project.cic || project.department),
        title: normalizeText(project.officialContractName || project.name) || '이름 없음',
        clientOrg: normalizeText(project.clientOrg),
        managerName: normalizeText(project.managerName),
        requestedAt: normalizeText(request?.requestedAt || project.createdAt),
      };
    })
    .sort((left, right) => String(right.requestedAt).localeCompare(String(left.requestedAt)));
}

export function filterMigrationAuditConsoleRecords(
  records: MigrationAuditConsoleRecord[],
  options: {
    cic: string;
    status: 'ALL' | MigrationAuditConsoleStatus;
  },
): MigrationAuditConsoleRecord[] {
  return records.filter((record) => {
    if (options.cic !== 'ALL' && record.cic !== options.cic) return false;
    if (options.status !== 'ALL' && record.status !== options.status) return false;
    return true;
  });
}

export function summarizeMigrationAuditConsole(
  records: MigrationAuditConsoleRecord[],
): MigrationAuditConsoleSummary {
  return {
    total: records.length,
    pending: records.filter((record) => record.status === 'PENDING').length,
    approved: records.filter((record) => record.status === 'APPROVED').length,
    rejected: records.filter((record) => record.status === 'REVISION_REJECTED').length,
    discarded: records.filter((record) => record.status === 'DUPLICATE_DISCARDED').length,
  };
}

export function collectMigrationAuditCicOptions(records: MigrationAuditConsoleRecord[]): string[] {
  return Array.from(new Set(records.map((record) => record.cic)))
    .sort((left, right) => left.localeCompare(right, 'ko'));
}

export function findMigrationAuditRecord(
  records: MigrationAuditConsoleRecord[],
  recordId: string | null | undefined,
): MigrationAuditConsoleRecord | null {
  if (!recordId) return records[0] || null;
  return records.find((record) => record.id === recordId) || records[0] || null;
}

export function describeMigrationAuditActionState(
  record: MigrationAuditConsoleRecord,
): MigrationAuditActionState {
  if (record.status === 'APPROVED') {
    return {
      tone: 'success',
      label: '승인 완료',
      helper: 'CIC 대표 리뷰가 끝났고 이 등록 제안은 우리 시스템 기준으로 확정되었습니다. 필요하면 다시 반려 또는 중복·폐기로 조정할 수 있습니다.',
    };
  }
  if (record.status === 'REVISION_REJECTED') {
    return {
      tone: 'danger',
      label: '수정 요청 후 반려',
      helper: 'PM이 수정 보완 후 다시 올려야 하는 상태입니다.',
    };
  }
  if (record.status === 'DUPLICATE_DISCARDED') {
    return {
      tone: 'neutral',
      label: '중복·폐기',
      helper: '중복 등록 또는 폐기 대상으로 정리된 제안입니다.',
    };
  }
  return {
    tone: 'warning',
    label: '검토 대기',
    helper: 'PM이 입력한 원문과 예산·인력을 확인한 뒤 CIC 대표 리뷰 결정이 필요합니다.',
  };
}
