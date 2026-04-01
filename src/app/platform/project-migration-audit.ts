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
  match: ProjectMigrationProjectMatch | null;
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
  match: ProjectMigrationCurrentMatch | null;
}

const CLIENT_ALIASES: Array<[RegExp, string]> = [
  [/한국국제협력단/gi, 'koica'],
  [/경기주택도시공사/gi, 'gh'],
];

const MATCH_STOPWORDS = new Set([
  '사업',
  '프로그램',
  '운영',
  '지원',
  '용역',
  '계약',
  '수행계획서',
]);

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
    .replace(/([0-9])([가-힣a-z])/gi, '$1 $2')
    .replace(/([가-힣a-z])([0-9])/gi, '$1 $2')
    .replace(/([a-z])([가-힣])/gi, '$1 $2')
    .replace(/([가-힣])([a-z])/gi, '$1 $2')
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

  return tokenized
    .filter((token) => !MATCH_STOPWORDS.has(token))
    .filter((token) => !/^\d+기$/.test(token))
    .filter((token) => !/^\d{1,2}$/.test(token))
    .filter((token) => !/^[기차회]$/.test(token))
    .filter((token, index) => tokenized.indexOf(token) === index)
    .join(' ');
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
    score += 88;
    reasons.push('현재 프로젝트명 일치');
  } else if (businessNameLoose) {
    score += 48;
    reasons.push('현재 프로젝트명 유사');
  }

  if (contractNameExact) {
    score += 160;
    reasons.push('계약명 일치');
  } else if (contractNameLoose) {
    score += 104;
    reasons.push('계약명 유사');
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
  if (!exact && score < 45) return null;

  return {
    project,
    score,
    exact,
    reasons,
  };
}

function buildManualProjectMatch(
  candidate: ProjectMigrationCandidate,
  projects: Project[],
): ProjectMigrationProjectMatch | null {
  if (!candidate.manualProjectId) return null;

  const project = projects.find((item) => item.id === candidate.manualProjectId);
  if (!project) return null;

  return scoreProjectMatch(candidate, project) ?? {
    project,
    score: 1000,
    exact: true,
    reasons: ['수동 연결'],
  };
}

function compareProjectMatches(left: ProjectMigrationProjectMatch, right: ProjectMigrationProjectMatch): number {
  if (left.exact !== right.exact) return left.exact ? -1 : 1;
  if (left.score !== right.score) return right.score - left.score;

  const leftLabel = left.project.officialContractName || left.project.name || '';
  const rightLabel = right.project.officialContractName || right.project.name || '';
  return leftLabel.localeCompare(rightLabel, 'ko');
}

export function buildProjectMigrationAuditRows(
  candidates: ProjectMigrationCandidate[],
  projects: Project[],
): ProjectMigrationAuditRow[] {
  const rows: ProjectMigrationAuditRow[] = candidates.map((candidate) => ({
    candidate,
    status: 'MISSING',
    match: null,
  }));

  const candidateEdges = candidates.flatMap((candidate, candidateIndex) => {
    const manualMatch = buildManualProjectMatch(candidate, projects);
    if (manualMatch) {
      return [{
        candidateIndex,
        match: manualMatch,
        manual: true,
      }];
    }

    return projects
      .map((project) => {
        const match = scoreProjectMatch(candidate, project);
        if (!match) return null;
        return {
          candidateIndex,
          match,
          manual: false,
        };
      })
      .filter((edge): edge is { candidateIndex: number; match: ProjectMigrationProjectMatch; manual: boolean } => !!edge);
  });

  candidateEdges.sort((left, right) => {
    if (left.manual !== right.manual) return left.manual ? -1 : 1;
    const matchCompare = compareProjectMatches(left.match, right.match);
    if (matchCompare !== 0) return matchCompare;
    return left.candidateIndex - right.candidateIndex;
  });

  const assignedCandidates = new Set<number>();
  const assignedProjects = new Set<string>();

  for (const edge of candidateEdges) {
    if (assignedCandidates.has(edge.candidateIndex)) continue;
    if (assignedProjects.has(edge.match.project.id)) continue;

    rows[edge.candidateIndex] = {
      candidate: rows[edge.candidateIndex].candidate,
      status: edge.match.exact ? 'REGISTERED' : 'CANDIDATE',
      match: edge.match,
    };
    assignedCandidates.add(edge.candidateIndex);
    assignedProjects.add(edge.match.project.id);
  }

  return rows;
}

export function buildProjectMigrationCurrentRows(
  rows: ProjectMigrationAuditRow[],
  projects: Project[],
): ProjectMigrationCurrentRow[] {
  const matchByProjectId = new Map<string, ProjectMigrationCurrentMatch>();

  rows.forEach((row) => {
    if (!row.match) return;
    matchByProjectId.set(row.match.project.id, {
      candidate: row.candidate,
      score: row.match.score,
      exact: row.match.exact,
      reasons: row.match.reasons,
      sourceStatus: row.status,
    });
  });

  return projects.map((project) => {
    const match = matchByProjectId.get(project.id) ?? null;
    return {
      project,
      status: match ? (match.exact ? 'REGISTERED' : 'CANDIDATE') : 'MISSING',
      match,
    };
  });
}
