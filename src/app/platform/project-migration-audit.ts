import type { Project } from '../data/types';
import type { ProjectMigrationCandidate } from '../data/project-migration-candidates';

export type ProjectMigrationStatus = 'REGISTERED' | 'CANDIDATE' | 'MISSING';

export interface ProjectMigrationProjectMatch {
  project: Project;
  score: number;
  exact: boolean;
  reasons: string[];
}

export interface ProjectMigrationAuditRow {
  candidate: ProjectMigrationCandidate;
  status: ProjectMigrationStatus;
  matches: ProjectMigrationProjectMatch[];
}

export interface ProjectMigrationCurrentMatch {
  candidate: ProjectMigrationCandidate;
  score: number;
  exact: boolean;
  reasons: string[];
  sourceStatus: ProjectMigrationStatus;
}

export interface ProjectMigrationCurrentRow {
  project: Project;
  status: ProjectMigrationStatus;
  matches: ProjectMigrationCurrentMatch[];
}

const CLIENT_ALIASES: Array<[RegExp, string]> = [
  [/한국국제협력단/gi, 'koica'],
  [/경기주택도시공사/gi, 'gh'],
];

const GROUPWARE_PLACEHOLDER_PATTERNS = [
  /등록\s*전/i,
  /미등록/i,
  /계약\s*전/i,
  /협약\/?계약전/i,
];

function applyAliases(value: string): string {
  return CLIENT_ALIASES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function normalizeLooseText(value: unknown): string {
  const normalized = String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(\d{4})년/g, '$1')
    .replace(/[\[\](){}]/g, ' ')
    .trim();

  const tokenized = applyAliases(normalized)
    .replace(/&/g, ' ')
    .replace(/[^0-9a-z가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  return tokenized.filter((token, index) => tokenized.indexOf(token) === index).join(' ');
}

function normalizeCompactText(value: unknown): string {
  return normalizeLooseText(value).replace(/\s+/g, '');
}

function isMeaningfulGroupwareName(value: unknown): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  return !GROUPWARE_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

function isExactTextMatch(left: unknown, right: unknown): boolean {
  const a = normalizeCompactText(left);
  const b = normalizeCompactText(right);
  return !!a && !!b && a === b;
}

function isLooseTextMatch(left: unknown, right: unknown): boolean {
  const looseLeft = normalizeLooseText(left);
  const looseRight = normalizeLooseText(right);
  const leftTokens = looseLeft.split(' ').filter(Boolean);
  const rightTokens = looseRight.split(' ').filter(Boolean);
  if (!leftTokens.length || !rightTokens.length) return false;

  const rightTokenSet = new Set(rightTokens);
  const commonTokenCount = leftTokens.filter((token) => rightTokenSet.has(token)).length;
  const shorterTokenCount = Math.min(leftTokens.length, rightTokens.length);
  if (commonTokenCount >= Math.max(2, Math.ceil(shorterTokenCount * 0.6))) return true;

  const a = normalizeCompactText(left);
  const b = normalizeCompactText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 6 || b.length < 6) return false;
  return a.includes(b) || b.includes(a);
}

function normalizeAccountLabel(value: string): string {
  if (value === 'DEDICATED') return '전용통장';
  if (value === 'OPERATING') return '운영통장';
  if (value.includes('전용')) return '전용통장';
  if (value.includes('운영')) return '운영통장';
  return '';
}

function scoreProjectMatch(candidate: ProjectMigrationCandidate, project: Project): ProjectMigrationProjectMatch | null {
  let score = 0;
  const reasons: string[] = [];

  const businessNameExact = isExactTextMatch(candidate.businessName, project.name);
  const businessNameLoose = isLooseTextMatch(candidate.businessName, project.name);
  const contractNameExact = isExactTextMatch(candidate.businessName, project.officialContractName);
  const contractNameLoose = isLooseTextMatch(candidate.businessName, project.officialContractName);
  const clientExact = isExactTextMatch(candidate.clientOrg, project.clientOrg);
  const clientLoose = isLooseTextMatch(candidate.clientOrg, project.clientOrg);
  const departmentExact = isExactTextMatch(candidate.department, project.department);
  const accountExact = normalizeAccountLabel(candidate.accountLabel) !== ''
    && normalizeAccountLabel(candidate.accountLabel) === normalizeAccountLabel(project.accountType);

  const meaningfulGroupwareCandidate = isMeaningfulGroupwareName(candidate.groupwareProjectName);
  const groupwareExact = meaningfulGroupwareCandidate && isExactTextMatch(candidate.groupwareProjectName, project.groupwareName);
  const groupwareLoose = meaningfulGroupwareCandidate && isLooseTextMatch(candidate.groupwareProjectName, project.groupwareName);

  if (businessNameExact) {
    score += 120;
    reasons.push('사업명 일치');
  } else if (businessNameLoose) {
    score += 72;
    reasons.push('사업명 유사');
  }

  if (contractNameExact) {
    score += 100;
    reasons.push('계약서 사업명 일치');
  } else if (contractNameLoose) {
    score += 60;
    reasons.push('계약서 사업명 유사');
  }

  if (groupwareExact) {
    score += 110;
    reasons.push('그룹웨어 등록명 일치');
  } else if (groupwareLoose) {
    score += 58;
    reasons.push('그룹웨어 등록명 유사');
  }

  if (clientExact) {
    score += 26;
    reasons.push('발주기관 일치');
  } else if (clientLoose) {
    score += 14;
    reasons.push('발주기관 유사');
  }

  if (departmentExact) {
    score += 10;
    reasons.push('담당조직 일치');
  }

  if (accountExact) {
    score += 8;
    reasons.push('통장 유형 일치');
  }

  if (score <= 0) return null;

  const exact = businessNameExact || contractNameExact || (groupwareExact && (clientExact || !candidate.clientOrg.trim()));
  if (!exact && score < 70) return null;

  return {
    project,
    score,
    exact,
    reasons,
  };
}

export function buildProjectMigrationAuditRows(
  candidates: ProjectMigrationCandidate[],
  projects: Project[],
): ProjectMigrationAuditRow[] {
  return candidates.map((candidate) => {
    const matches = projects
      .map((project) => scoreProjectMatch(candidate, project))
      .filter((match): match is ProjectMigrationProjectMatch => !!match)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);

    const status: ProjectMigrationStatus = matches.some((match) => match.exact)
      ? 'REGISTERED'
      : matches.length > 0
        ? 'CANDIDATE'
        : 'MISSING';

    return {
      candidate,
      status,
      matches,
    };
  });
}

export function buildProjectMigrationCurrentRows(
  rows: ProjectMigrationAuditRow[],
  projects: Project[],
): ProjectMigrationCurrentRow[] {
  return projects.map((project) => {
    const matches = rows
      .flatMap((row) => row.matches
        .filter((match) => match.project.id === project.id)
        .map((match) => ({
          candidate: row.candidate,
          score: match.score,
          exact: match.exact,
          reasons: match.reasons,
          sourceStatus: row.status,
        })))
      .sort((left, right) => right.score - left.score)
      .slice(0, 5);

    const status: ProjectMigrationStatus = matches.some((match) => match.exact)
      ? 'REGISTERED'
      : matches.length > 0
        ? 'CANDIDATE'
        : 'MISSING';

    return {
      project,
      status,
      matches,
    };
  });
}
