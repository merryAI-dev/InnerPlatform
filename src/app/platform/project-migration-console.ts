import type {
  Project,
  ProjectExecutiveReviewStatus,
  ProjectRequest,
} from '../data/types';
import { resolveProjectRequestPayload } from './project-change-request';

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
    const projectId = request.targetProjectId || request.approvedProjectId;
    if (projectId) {
      const previous = map.get(projectId);
      if (!previous || String(request.requestedAt || '').localeCompare(String(previous.requestedAt || '')) > 0) {
        map.set(projectId, request);
      }
    }
  });
  return map;
}

export function deriveMigrationAuditStatus(
  project: Project,
  request?: ProjectRequest | null,
): MigrationAuditConsoleStatus {
  if (
    project.executiveReviewStatus === 'REVISION_REJECTED'
    || project.executiveReviewStatus === 'DUPLICATE_DISCARDED'
  ) {
    return project.executiveReviewStatus;
  }
  if (request?.status === 'PENDING') return 'PENDING';
  if (project.executiveReviewStatus) return project.executiveReviewStatus;
  if (request?.status === 'REJECTED') return 'REVISION_REJECTED';
  if (request?.status === 'APPROVED') return 'APPROVED';
  return project.registrationSource === 'pm_portal' ? 'PENDING' : 'APPROVED';
}

export function getMigrationAuditStatusLabel(status: MigrationAuditConsoleStatus): string {
  if (status === 'APPROVED') return '승인 완료';
  if (status === 'REVISION_REJECTED') return '수정 요청 후 반려';
  if (status === 'DUPLICATE_DISCARDED') return '중복·폐기';
  return '검토 대기';
}

export function isMigrationAuditPmRegistration(record: MigrationAuditConsoleRecord): boolean {
  return !!record.request || record.project.registrationSource === 'pm_portal';
}

function collectSearchValues(value: unknown, output: string[]) {
  if (value == null) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    if (text) output.push(text);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSearchValues(item, output));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) => collectSearchValues(item, output));
  }
}

function buildMigrationAuditSearchText(record: MigrationAuditConsoleRecord): string {
  const requestPayload = resolveProjectRequestPayload(record.request);
  const values: string[] = [
    record.title,
    record.clientOrg,
    record.managerName,
    record.cic,
    record.project.name,
    record.project.officialContractName,
    record.project.clientOrg,
    record.project.managerName,
    record.project.registeredByName,
    record.request?.requestedByName,
    record.request?.requestedByEmail,
    requestPayload?.name,
    requestPayload?.officialContractName,
    requestPayload?.clientOrg,
    requestPayload?.managerName,
    requestPayload?.teamName,
  ].map((value) => normalizeText(value)).filter(Boolean);

  collectSearchValues(requestPayload, values);
  return values.join(' ').toLowerCase();
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
        status: deriveMigrationAuditStatus(project, request),
        cic: normalizeCicLabel(project.cic || project.department),
        title: normalizeText(project.officialContractName || project.name) || '이름 없음',
        clientOrg: normalizeText(project.clientOrg),
        managerName: normalizeText(project.registeredByName || project.managerName),
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
    searchQuery?: string;
  },
): MigrationAuditConsoleRecord[] {
  const normalizedQuery = normalizeText(options.searchQuery).toLowerCase();
  return records.filter((record) => {
    if (options.cic !== 'ALL' && record.cic !== options.cic) return false;
    if (options.status !== 'ALL' && record.status !== options.status) return false;
    if (normalizedQuery && !buildMigrationAuditSearchText(record).includes(normalizedQuery)) return false;
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
      helper: 'CIC 대표 검토가 끝났고 이 프로젝트 등록 요청은 확정되었습니다. 필요하면 다시 반려 또는 중복·폐기로 조정할 수 있습니다.',
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
    helper: 'PM이 입력한 원문과 계약/재무·팀/인력을 확인한 뒤 CIC 대표 검토 결정이 필요합니다.',
  };
}
