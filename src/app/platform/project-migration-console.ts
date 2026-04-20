import type { ProjectMigrationCandidate } from '../data/project-migration-candidates';
import type { Project } from '../data/types';
import { getProjectRegistrationCicOptions, resolveProjectCic } from './project-cic';
import type {
  ProjectMigrationAuditRow,
  ProjectMigrationCurrentRow,
  ProjectMigrationProjectMatch,
  ProjectMigrationStatus,
} from './project-migration-audit';

export interface MigrationAuditConsoleRecord {
  id: string;
  candidate: ProjectMigrationCandidate;
  status: ProjectMigrationStatus;
  cic: string;
  sourceName: string;
  sourceDepartment: string;
  sourceClientOrg: string;
  match: ProjectMigrationProjectMatch | null;
  matchLabel: string;
  nextActionLabel: string;
}

export interface MigrationAuditConsoleSections {
  missing: MigrationAuditConsoleRecord[];
  candidate: MigrationAuditConsoleRecord[];
  registered: MigrationAuditConsoleRecord[];
}

export interface MigrationAuditConsoleSummary {
  total: number;
  missing: number;
  candidate: number;
  registered: number;
  unassignedCic: number;
  completionRatio: number | null;
}

export interface MigrationAuditOperatorSummary {
  headline: string;
  caption: string;
}

export interface MigrationAuditActionState {
  tone: 'danger' | 'warning' | 'success';
  label: string;
  helper: string;
}

export interface MigrationAuditDenseRow {
  id: string;
  kind: 'source' | 'current-only';
  status: ProjectMigrationStatus;
  cic: string;
  sourceName: string;
  projectLabel: string;
  candidateCount: number;
  lastActionLabel: string;
  recordId?: string;
  projectId?: string;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeQuery(value: string): string {
  return normalizeText(value).toLowerCase();
}

function similarityIncludes(source: string, target: string): boolean {
  const left = normalizeQuery(source).replace(/\s+/g, '');
  const right = normalizeQuery(target).replace(/\s+/g, '');
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

export function normalizeCicLabel(value: unknown): string {
  const normalized = normalizeText(value);
  return normalized || '미지정';
}

function getMatchLabel(match: ProjectMigrationProjectMatch | null): string {
  if (!match) return '연결 필요';
  return normalizeText(match.project.officialContractName) || normalizeText(match.project.name) || '이름 없음';
}

function getNextActionLabel(status: ProjectMigrationStatus, match: ProjectMigrationProjectMatch | null): string {
  if (status === 'REGISTERED') return '완료';
  if (!match) return '새 프로젝트 등록 또는 기존 프로젝트 연결';
  if (match.exact) return '완료';
  return '후보 검토 후 연결';
}

export function buildMigrationAuditConsoleRecords(
  rows: ProjectMigrationAuditRow[],
): MigrationAuditConsoleRecord[] {
  return rows.map((row) => ({
    id: row.candidate.id,
    candidate: row.candidate,
    status: row.status,
    cic: normalizeCicLabel(resolveProjectCic(row.candidate)),
    sourceName: row.candidate.businessName,
    sourceDepartment: row.candidate.department,
    sourceClientOrg: row.candidate.clientOrg,
    match: row.match,
    matchLabel: getMatchLabel(row.match),
    nextActionLabel: getNextActionLabel(row.status, row.match),
  }));
}

export function filterMigrationAuditConsoleRecords(
  records: MigrationAuditConsoleRecord[],
  options: {
    cic: string;
    status: 'ALL' | ProjectMigrationStatus;
    query: string;
  },
): MigrationAuditConsoleRecord[] {
  const query = normalizeQuery(options.query);
  return records.filter((record) => {
    if (options.cic !== 'ALL' && record.cic !== options.cic) return false;
    if (options.status !== 'ALL' && record.status !== options.status) return false;
    if (!query) return true;

    const haystack = [
      record.sourceName,
      record.sourceDepartment,
      record.sourceClientOrg,
      record.cic,
      record.matchLabel,
      record.match?.project.managerName,
      record.match?.project.department,
    ].map(normalizeText).join(' ').toLowerCase();

    return haystack.includes(query);
  });
}

function sortRecords(records: MigrationAuditConsoleRecord[]): MigrationAuditConsoleRecord[] {
  return [...records].sort((left, right) => {
    const cicCompare = left.cic.localeCompare(right.cic, 'ko');
    if (cicCompare !== 0) return cicCompare;
    return left.sourceName.localeCompare(right.sourceName, 'ko');
  });
}

export function groupMigrationAuditConsoleRecords(
  records: MigrationAuditConsoleRecord[],
): MigrationAuditConsoleSections {
  return {
    missing: sortRecords(records.filter((record) => record.status === 'MISSING')),
    candidate: sortRecords(records.filter((record) => record.status === 'CANDIDATE')),
    registered: sortRecords(records.filter((record) => record.status === 'REGISTERED')),
  };
}

export function summarizeMigrationAuditConsole(
  records: MigrationAuditConsoleRecord[],
  currentOnlyMissingCount = 0,
): MigrationAuditConsoleSummary {
  const total = records.length + currentOnlyMissingCount;
  const missing = records.filter((record) => record.status === 'MISSING').length + currentOnlyMissingCount;
  const candidate = records.filter((record) => record.status === 'CANDIDATE').length;
  const registered = records.filter((record) => record.status === 'REGISTERED').length;
  const unassignedCic = records.filter((record) => record.cic === '미지정').length;
  return {
    total,
    missing,
    candidate,
    registered,
    unassignedCic,
    completionRatio: total > 0 ? (registered / total) * 100 : null,
  };
}

export function buildMigrationAuditOperatorSummary(
  summary: MigrationAuditConsoleSummary,
): MigrationAuditOperatorSummary {
  const actionableCount = summary.missing + summary.candidate;
  if (actionableCount > 0) {
    const parts: string[] = [];
    if (summary.missing > 0) parts.push(`미등록 ${summary.missing}건`);
    if (summary.candidate > 0) parts.push(`후보 검토 ${summary.candidate}건`);
    return {
      headline: `지금 먼저 처리할 ${actionableCount}건`,
      caption: parts.join(' · '),
    };
  }

  return {
    headline: '지금 처리할 항목은 없습니다',
    caption: `완료 ${summary.registered}건 · 등록 조직 미지정 ${summary.unassignedCic}건`,
  };
}

export function describeMigrationAuditActionState(
  record: MigrationAuditConsoleRecord,
): MigrationAuditActionState {
  if (record.status === 'MISSING') {
    return {
      tone: 'danger',
      label: '연결 필요',
      helper: 'PM이 올린 사업은 있지만 우리 시스템 프로젝트와 아직 내부 연결이 없습니다.',
    };
  }
  if (record.status === 'CANDIDATE') {
    return {
      tone: 'warning',
      label: '후보 검토 필요',
      helper: '추천 후보를 확인하고 사람이 최종 연결을 확정해야 합니다.',
    };
  }
  return {
    tone: 'success',
    label: '연결 완료',
    helper: '필요하면 등록 조직이나 연결 프로젝트만 조정하면 됩니다.',
  };
}

export function collectMigrationAuditCicOptions(
  records: MigrationAuditConsoleRecord[],
  currentRows: ProjectMigrationCurrentRow[],
): string[] {
  const values = new Set<string>();
  getProjectRegistrationCicOptions().forEach((cic) => values.add(cic));
  records.forEach((record) => values.add(record.cic));
  currentRows.forEach((row) => values.add(normalizeCicLabel(resolveProjectCic(row.project))));
  return Array.from(values).sort((left, right) => left.localeCompare(right, 'ko'));
}

export function buildMigrationAuditCicSelectionOptions(cicOptions: string[]): string[] {
  return Array.from(new Set([...cicOptions, '미지정']))
    .sort((left, right) => {
      if (left === '미지정') return 1;
      if (right === '미지정') return -1;
      return left.localeCompare(right, 'ko');
    });
}

export function findMigrationAuditRecord(
  records: MigrationAuditConsoleRecord[],
  recordId: string | null | undefined,
): MigrationAuditConsoleRecord | null {
  if (!recordId) return records[0] || null;
  return records.find((record) => record.id === recordId) || records[0] || null;
}

export function suggestProjectsForMigrationAuditRecord(
  record: MigrationAuditConsoleRecord | null,
  projects: Project[],
  limit = 5,
): Project[] {
  if (!record) return [];

  const normalizedSource = normalizeQuery(record.sourceName);
  return [...projects]
    .sort((left, right) => {
      const leftSameCic = normalizeCicLabel(resolveProjectCic(left)) === record.cic;
      const rightSameCic = normalizeCicLabel(resolveProjectCic(right)) === record.cic;
      if (leftSameCic !== rightSameCic) return leftSameCic ? -1 : 1;

      const leftScore = Number(
        normalizeQuery(left.name).includes(normalizedSource)
        || normalizeQuery(left.officialContractName || '').includes(normalizedSource),
      );
      const rightScore = Number(
        normalizeQuery(right.name).includes(normalizedSource)
        || normalizeQuery(right.officialContractName || '').includes(normalizedSource),
      );
      if (leftScore !== rightScore) return rightScore - leftScore;

      return (normalizeText(left.officialContractName) || normalizeText(left.name))
        .localeCompare(normalizeText(right.officialContractName) || normalizeText(right.name), 'ko');
    })
    .slice(0, limit);
}

export function findProposalProjectsForMigrationAuditRecord(
  record: MigrationAuditConsoleRecord | null,
  projects: Project[],
  limit = 5,
): Project[] {
  if (!record) return [];

  return projects
    .filter((project) => (
      project.registrationSource === 'pm_portal'
      && project.status === 'CONTRACT_PENDING'
      && !project.trashedAt
    ))
    .filter((project) => (
      similarityIncludes(record.sourceName, project.officialContractName || project.name)
      || normalizeCicLabel(resolveProjectCic(project)) === record.cic
    ))
    .sort((left, right) => {
      const leftNameMatch = Number(similarityIncludes(record.sourceName, left.officialContractName || left.name));
      const rightNameMatch = Number(similarityIncludes(record.sourceName, right.officialContractName || right.name));
      if (leftNameMatch !== rightNameMatch) return rightNameMatch - leftNameMatch;

      const leftSameOrg = Number(normalizeText(left.clientOrg) === normalizeText(record.sourceClientOrg));
      const rightSameOrg = Number(normalizeText(right.clientOrg) === normalizeText(record.sourceClientOrg));
      if (leftSameOrg !== rightSameOrg) return rightSameOrg - leftSameOrg;

      return normalizeText(left.officialContractName || left.name)
        .localeCompare(normalizeText(right.officialContractName || right.name), 'ko');
    })
    .slice(0, limit);
}

export function findDuplicateProjectsForMigrationAuditRecord(
  record: MigrationAuditConsoleRecord | null,
  projects: Project[],
  limit = 6,
): Project[] {
  if (!record) return [];

  return projects
    .filter((project) => !project.trashedAt)
    .filter((project) => (
      similarityIncludes(record.sourceName, project.officialContractName || project.name)
      || (
        normalizeText(record.sourceClientOrg)
        && normalizeText(project.clientOrg) === normalizeText(record.sourceClientOrg)
        && normalizeCicLabel(resolveProjectCic(project)) === record.cic
      )
    ))
    .sort((left, right) => {
      const leftContractMatch = Number(similarityIncludes(record.sourceName, left.officialContractName || left.name));
      const rightContractMatch = Number(similarityIncludes(record.sourceName, right.officialContractName || right.name));
      if (leftContractMatch !== rightContractMatch) return rightContractMatch - leftContractMatch;

      const leftIsDraft = Number(left.registrationSource === 'pm_portal' && left.status === 'CONTRACT_PENDING');
      const rightIsDraft = Number(right.registrationSource === 'pm_portal' && right.status === 'CONTRACT_PENDING');
      if (leftIsDraft !== rightIsDraft) return leftIsDraft - rightIsDraft;

      return normalizeText(left.officialContractName || left.name)
        .localeCompare(normalizeText(right.officialContractName || right.name), 'ko');
    })
    .slice(0, limit);
}

export function buildMigrationAuditDenseRows(
  records: MigrationAuditConsoleRecord[],
  currentRows: ProjectMigrationCurrentRow[],
): MigrationAuditDenseRow[] {
  const sourceRows = records.map((record) => ({
    id: record.id,
    kind: 'source' as const,
    status: record.status,
    cic: record.cic,
    sourceName: record.sourceName,
    projectLabel: record.matchLabel,
    candidateCount: record.status === 'CANDIDATE' ? 1 : 0,
    lastActionLabel: record.nextActionLabel,
    recordId: record.id,
    projectId: record.match?.project.id,
  }));

  const currentOnlyRows = currentRows
    .filter((row) => row.match == null)
    .map((row) => ({
      id: `current-${row.project.id}`,
      kind: 'current-only' as const,
      status: 'MISSING' as const,
      cic: normalizeCicLabel(resolveProjectCic(row.project)),
      sourceName: normalizeText(row.project.officialContractName) || normalizeText(row.project.name) || '이름 없음',
      projectLabel: normalizeText(row.project.officialContractName) || normalizeText(row.project.name) || '이름 없음',
      candidateCount: 0,
      lastActionLabel: '이관 범위 밖 프로젝트 확인',
      projectId: row.project.id,
    }));

  return [...sourceRows, ...currentOnlyRows];
}
