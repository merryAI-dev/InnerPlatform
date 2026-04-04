import { normalizeSpace, parseCsv, stableHash } from './csv-utils';

export type QaFeedbackType = '기능 오류' | '사용성 개선' | '디자인 개선' | '아이디어' | '미분류';
export type QaFeedbackPriority = '높음' | '중간' | '낮음' | '미분류';
export type QaFeedbackStatusGroup = 'active' | 'completed' | 'rejected' | 'policy' | 'unknown';
export type QaProjectType = '사업관리플랫폼' | '기업육성플랫폼' | '공통' | '미분류';

export interface QaFeedbackEntry {
  id: string;
  feedback: string;
  details: string;
  combinedText: string;
  type: QaFeedbackType;
  priority: QaFeedbackPriority;
  submitterTag: string;
  submittedAtRaw: string;
  status: string;
  statusGroup: QaFeedbackStatusGroup;
  imageRef: string;
  projectType: QaProjectType;
  featureTags: string[];
  keywords: string[];
}

export interface QaFeedbackMemory {
  generatedAt: string;
  sourceLabel: string;
  totalEntries: number;
  counts: {
    byType: Record<string, number>;
    byPriority: Record<string, number>;
    byStatus: Record<string, number>;
    byProjectType: Record<string, number>;
    byStatusGroup: Record<QaFeedbackStatusGroup, number>;
  };
  topFeatureAreas: Array<{ tag: string; label: string; count: number }>;
  entries: QaFeedbackEntry[];
}

export interface QaPhasePreflightMatch {
  entry: QaFeedbackEntry;
  score: number;
  matchedTags: string[];
  matchedKeywords: string[];
  reasons: string[];
}

export interface QaPhasePreflightReport {
  query: string;
  projectType: QaProjectType | '전체';
  totalEntriesScanned: number;
  matchedCount: number;
  topMatches: QaPhasePreflightMatch[];
  topFeatureAreas: Array<{ tag: string; label: string; count: number }>;
  checklist: string[];
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'task',
  'phase',
  'pm',
  'work',
  '작업',
  '단계',
  '개선',
  '수정',
  '대응',
  '기능',
  '오류',
  '사용성',
  '디자인',
  '화면',
  '페이지',
  '메뉴',
  '버튼',
  '탭',
  '기준',
  '먼저',
  '진행',
  '회귀',
  '잡는다',
  '관리',
  '플랫폼',
  '사업',
]);

const FEATURE_AREA_DEFINITIONS = [
  {
    tag: 'weekly_expense',
    label: '사업비 입력(주간)',
    aliases: ['사업비 입력', '사업비관리', '사용내역', '정산대장', '주간 사업비', '정산 시트'],
  },
  {
    tag: 'budget_structure',
    label: '예산/비목/세목',
    aliases: ['예산', '비목', '세목', '세세목', '예산총괄', '예산 편집'],
  },
  {
    tag: 'cashflow',
    label: '캐시플로',
    aliases: ['캐시플로', 'cashflow', '프로젝션', '월 저장'],
  },
  {
    tag: 'bank_statement',
    label: '통장내역',
    aliases: ['통장내역', '법인 통장', '입출금', '거래내역'],
  },
  {
    tag: 'evidence',
    label: '증빙/드라이브',
    aliases: ['증빙', '증빙자료', '증빙 서류', '드라이브', '구글 드라이브', '폴더', '동기화'],
  },
  {
    tag: 'project_register',
    label: '프로젝트 등록/개설',
    aliases: ['프로젝트 등록', '사업 등록', '프로젝트 개설', '등록 제안', '제출', '등록할 수 있는 탭'],
  },
  {
    tag: 'contract_upload',
    label: '계약서/PDF 업로드',
    aliases: ['계약서', 'pdf', '업로드 오류', '파일 업로드', '첨부'],
  },
  {
    tag: 'project_settings',
    label: '프로젝트 설정/재무정보',
    aliases: ['프로젝트명', '재무정보', '정산유형', '정산기준', '통장유형', '설정'],
  },
  {
    tag: 'participation',
    label: '참여인력/인력투입률',
    aliases: ['참여 인력', '참여인력', '인력투입률', '참여율', '인력 현황'],
  },
  {
    tag: 'assignment',
    label: '사업 배정/권한',
    aliases: ['사업 배정', '주사업', '권한', '승인', '회원가입', '계정'],
  },
  {
    tag: 'governance',
    label: '가버넌스/정책',
    aliases: ['정책', '개인정보', '동의', '가버넌스', '민감한 데이터'],
  },
  {
    tag: 'ui_scale',
    label: '표/스크롤/대량편집',
    aliases: ['스크롤', '붙여넣기', '복붙', '드래그', '표', '셀', '일괄', '대량'],
  },
];

const FEATURE_AREA_LABELS = Object.fromEntries(
  FEATURE_AREA_DEFINITIONS.map((definition) => [definition.tag, definition.label]),
) as Record<string, string>;

function asProjectType(value: string): QaProjectType {
  if (value === '사업관리플랫폼' || value === '기업육성플랫폼') return value;
  if (value === '공통') return value;
  return '미분류';
}

function asFeedbackType(value: string): QaFeedbackType {
  if (value === '기능 오류' || value === '사용성 개선' || value === '디자인 개선' || value === '아이디어') {
    return value;
  }
  return '미분류';
}

function asPriority(value: string): QaFeedbackPriority {
  if (value === '높음' || value === '중간' || value === '낮음') return value;
  return '미분류';
}

function toStatusGroup(status: string): QaFeedbackStatusGroup {
  const normalized = normalizeSpace(status);
  if (!normalized) return 'unknown';
  if (normalized === '완료') return 'completed';
  if (normalized === '반려') return 'rejected';
  if (normalized.includes('가버넌스')) return 'policy';
  if (normalized === '검토중' || normalized === '새 항목') return 'active';
  return 'unknown';
}

function normalizeText(value: string): string {
  return normalizeSpace(value)
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n');
}

function searchableText(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      searchableText(value)
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !STOPWORDS.has(token)),
    ),
  );
}

function sanitizeSubmitter(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  const [local] = normalized.split('@');
  return local || normalized;
}

function detectFeatureTags(text: string): string[] {
  const normalized = searchableText(text);
  return FEATURE_AREA_DEFINITIONS.filter((definition) =>
    definition.aliases.some((alias) => normalized.includes(searchableText(alias))),
  ).map((definition) => definition.tag);
}

function buildEntry(raw: Record<string, string>): QaFeedbackEntry | null {
  const feedback = normalizeText(raw['피드백'] || '');
  const details = normalizeText(raw['세부정보'] || '');
  const combinedText = normalizeText([feedback, details].filter(Boolean).join('\n'));
  if (!combinedText) return null;

  const submitterTag = sanitizeSubmitter(raw['제출한 사람'] || '');
  const submittedAtRaw = normalizeText(raw['제출한 날짜'] || '');
  const status = normalizeText(raw['상태'] || '');
  const projectType = asProjectType(normalizeText(raw['프로젝트 유형'] || '') || '미분류');
  const featureTags = detectFeatureTags(combinedText);
  const keywords = tokenize(combinedText);

  return {
    id: stableHash(
      [feedback, details, raw['제출한 날짜'] || '', raw['제출한 사람'] || ''].join('|'),
    ),
    feedback,
    details,
    combinedText,
    type: asFeedbackType(normalizeText(raw['유형'] || '')),
    priority: asPriority(normalizeText(raw['중요도'] || '')),
    submitterTag,
    submittedAtRaw,
    status,
    statusGroup: toStatusGroup(status),
    imageRef: normalizeText(raw['참고 이미지'] || ''),
    projectType,
    featureTags,
    keywords,
  };
}

function countBy<T extends string>(items: readonly T[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
}

function importanceWeight(priority: QaFeedbackPriority): number {
  switch (priority) {
    case '높음':
      return 5;
    case '중간':
      return 3;
    case '낮음':
      return 1;
    default:
      return 0;
  }
}

function statusWeight(statusGroup: QaFeedbackStatusGroup): number {
  switch (statusGroup) {
    case 'active':
      return 4;
    case 'policy':
      return 3;
    case 'completed':
      return 1;
    case 'unknown':
      return 1;
    case 'rejected':
      return 0;
    default:
      return 0;
  }
}

export function buildQaFeedbackMemoryFromCsv(csvText: string, sourceLabel: string): QaFeedbackMemory {
  const rows = parseCsv(csvText.replace(/^\uFEFF/, ''));
  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map((header) => normalizeText(header));
  const entries = dataRows
    .map((row) => {
      const record = Object.fromEntries(headers.map((header, index) => [header, row[index] || '']));
      return buildEntry(record);
    })
    .filter((entry): entry is QaFeedbackEntry => Boolean(entry));

  const topFeatureAreas = Object.entries(
    entries.reduce<Record<string, number>>((acc, entry) => {
      entry.featureTags.forEach((tag) => {
        acc[tag] = (acc[tag] || 0) + 1;
      });
      return acc;
    }, {}),
  )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en'))
    .slice(0, 12)
    .map(([tag, count]) => ({
      tag,
      label: FEATURE_AREA_LABELS[tag] || tag,
      count,
    }));

  return {
    generatedAt: new Date().toISOString(),
    sourceLabel,
    totalEntries: entries.length,
    counts: {
      byType: countBy(entries.map((entry) => entry.type)),
      byPriority: countBy(entries.map((entry) => entry.priority)),
      byStatus: countBy(entries.map((entry) => entry.status || '미분류')),
      byProjectType: countBy(entries.map((entry) => entry.projectType)),
      byStatusGroup: {
        active: entries.filter((entry) => entry.statusGroup === 'active').length,
        completed: entries.filter((entry) => entry.statusGroup === 'completed').length,
        rejected: entries.filter((entry) => entry.statusGroup === 'rejected').length,
        policy: entries.filter((entry) => entry.statusGroup === 'policy').length,
        unknown: entries.filter((entry) => entry.statusGroup === 'unknown').length,
      },
    },
    topFeatureAreas,
    entries,
  };
}

function intersect(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function scoreEntryForQuery(
  entry: QaFeedbackEntry,
  queryKeywords: string[],
  queryTags: string[],
  projectType: QaProjectType | '전체',
): QaPhasePreflightMatch | null {
  const matchedKeywords = intersect(entry.keywords, queryKeywords);
  const matchedTags = intersect(entry.featureTags, queryTags);

  let score = 0;
  if (matchedTags.length === 0 && matchedKeywords.length === 0) return null;

  score += matchedTags.length * 8;
  score += matchedKeywords.length * 3;
  score += importanceWeight(entry.priority);
  score += statusWeight(entry.statusGroup);
  if (projectType !== '전체' && entry.projectType === projectType) score += 4;

  const reasons = [
    matchedTags.length > 0 ? `feature:${matchedTags.join(', ')}` : '',
    matchedKeywords.length > 0 ? `keywords:${matchedKeywords.join(', ')}` : '',
    entry.priority !== '미분류' ? `priority:${entry.priority}` : '',
    entry.status ? `status:${entry.status}` : '',
  ].filter(Boolean);

  return {
    entry,
    score,
    matchedTags,
    matchedKeywords,
    reasons,
  };
}

export function buildQaPhasePreflightReport(
  memory: QaFeedbackMemory,
  query: string,
  options?: {
    projectType?: QaProjectType | '전체';
    maxMatches?: number;
  },
): QaPhasePreflightReport {
  const projectType = options?.projectType || '전체';
  const maxMatches = options?.maxMatches || 10;
  const queryKeywords = tokenize(query);
  const queryTags = detectFeatureTags(query);

  const filteredEntries = memory.entries.filter((entry) => (
    projectType === '전체'
      ? true
      : entry.projectType === projectType || entry.projectType === '미분류'
  ));

  let matches = filteredEntries
    .map((entry) => scoreEntryForQuery(entry, queryKeywords, queryTags, projectType))
    .filter((match): match is QaPhasePreflightMatch => Boolean(match));

  if (matches.length === 0) {
    matches = filteredEntries
      .slice()
      .sort((left, right) => (
        importanceWeight(right.priority) - importanceWeight(left.priority)
        || statusWeight(right.statusGroup) - statusWeight(left.statusGroup)
        || right.submittedAtRaw.localeCompare(left.submittedAtRaw, 'ko')
      ))
      .slice(0, maxMatches)
      .map((entry) => ({
        entry,
        score: importanceWeight(entry.priority) + statusWeight(entry.statusGroup),
        matchedTags: [],
        matchedKeywords: [],
        reasons: ['fallback:keyword match 없음, 중요도/상태 기준으로 제시'],
      }));
  } else {
    matches = matches
      .sort((left, right) => (
        right.score - left.score
        || right.entry.submittedAtRaw.localeCompare(left.entry.submittedAtRaw, 'ko')
      ))
      .slice(0, maxMatches);
  }

  const topFeatureAreas = Object.entries(
    matches.reduce<Record<string, number>>((acc, match) => {
      match.entry.featureTags.forEach((tag) => {
        acc[tag] = (acc[tag] || 0) + 1;
      });
      return acc;
    }, {}),
  )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en'))
    .slice(0, 8)
    .map(([tag, count]) => ({
      tag,
      label: FEATURE_AREA_LABELS[tag] || tag,
      count,
    }));

  const checklist = [
    '작업 시작 전에 top match의 재현 조건과 저장/동기화 경로를 먼저 확인할 것',
    '완료 이슈도 회귀 후보로 간주하고 같은 feature area는 regression check에 포함할 것',
    '가버넌스/정책 상태 이슈는 코드 수정만으로 닫지 말고 정책 의사결정이 필요한지 분리할 것',
  ];

  return {
    query,
    projectType,
    totalEntriesScanned: filteredEntries.length,
    matchedCount: matches.length,
    topMatches: matches,
    topFeatureAreas,
    checklist,
  };
}

export function renderQaFeedbackMemoryMarkdown(memory: QaFeedbackMemory): string {
  const lines = [
    '# QA Feedback Memory',
    '',
    `- generatedAt: ${memory.generatedAt}`,
    `- source: ${memory.sourceLabel}`,
    `- totalEntries: ${memory.totalEntries}`,
    '',
    '## Counts',
    `- type: ${Object.entries(memory.counts.byType).map(([key, count]) => `${key}=${count}`).join(', ')}`,
    `- priority: ${Object.entries(memory.counts.byPriority).map(([key, count]) => `${key}=${count}`).join(', ')}`,
    `- statusGroup: ${Object.entries(memory.counts.byStatusGroup).map(([key, count]) => `${key}=${count}`).join(', ')}`,
    `- projectType: ${Object.entries(memory.counts.byProjectType).map(([key, count]) => `${key}=${count}`).join(', ')}`,
    '',
    '## Top Feature Areas',
    ...memory.topFeatureAreas.map((area) => `- ${area.label} (${area.tag}): ${area.count}`),
    '',
    '## High Priority Active or Policy Items',
    ...memory.entries
      .filter((entry) => entry.priority === '높음' && (entry.statusGroup === 'active' || entry.statusGroup === 'policy'))
      .slice(0, 20)
      .map(
        (entry) =>
          `- [${entry.projectType}] ${entry.feedback.replace(/\n+/g, ' / ')} | ${entry.status || '상태 미분류'} | tags=${entry.featureTags.join(', ') || 'none'}`,
      ),
    '',
    '## Recent Representative Entries',
    ...memory.entries.slice(0, 20).map(
      (entry) =>
        `- [${entry.projectType}] ${entry.type}/${entry.priority}/${entry.status || '미분류'}: ${entry.feedback.replace(/\n+/g, ' / ')}`,
    ),
  ];

  return lines.join('\n');
}

export function renderQaPhasePreflightMarkdown(report: QaPhasePreflightReport): string {
  const lines = [
    '# Phase Preflight',
    '',
    `- query: ${report.query}`,
    `- projectType: ${report.projectType}`,
    `- scannedEntries: ${report.totalEntriesScanned}`,
    `- matchedEntries: ${report.matchedCount}`,
    '',
    '## Top Feature Areas',
    ...(report.topFeatureAreas.length > 0
      ? report.topFeatureAreas.map((area) => `- ${area.label} (${area.tag}): ${area.count}`)
      : ['- none']),
    '',
    '## Relevant QA Matches',
    ...report.topMatches.map(
      (match, index) =>
        `${index + 1}. [${match.entry.projectType}] ${match.entry.type}/${match.entry.priority}/${match.entry.status || '미분류'} | score=${match.score}\n   ${match.entry.feedback.replace(/\n+/g, ' / ')}\n   reasons: ${match.reasons.join(' | ')}`,
    ),
    '',
    '## Checklist',
    ...report.checklist.map((item) => `- ${item}`),
  ];

  return lines.join('\n');
}
