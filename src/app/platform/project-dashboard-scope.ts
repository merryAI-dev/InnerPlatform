import type { ProjectMigrationCandidate } from '../data/project-migration-candidates';

export const APPROVED_PROJECT_DASHBOARD_SCOPE = [
  '2026 다자간협력사업 (뷰티풀 커넥트)',
  '현대 모비스 CSV OI 컨설팅',
  '2026년 제주더큰내일센터 탐나는인재 창업트랙 운영',
  '2026년 우수기술 사업화지원 기술사업화 역량강화 프로그램',
  '풀무원 사내벤처 컨설팅',
  'KOICA 플랫폼 ESG 이니셔티브 (IBS) 2 (w.유한킴벌리)',
  'KOICA 포용적 비즈니스 프로그램(IBS) 4 (w.아모레퍼시픽)',
  '2026 농식품 기술창업 액셀러레이터 육성지원',
  '2026 에코스타트업',
  '한콘진 2026년 액셀러레이터연계지원사업',
  'GS칼텍스 다문화 육성 사업 (CSR) [가칭]',
  '2026 FIN:NECT 이노베이션 스쿨, 데모데이, 성과공유회',
  '2026년 해양수산 액셀러레이터 운영 프로그램 수행계획서',
  '2026년 중장년 창업컨설팅 지원사업',
  'GH 창업특화주택(특화형 매입임대주택) 운영 사업',
  '메리히어',
  '립스(LIPS) 프로그램',
  'KOICA 이노포트 사업 (2023~2025)',
  '2023-2026 창업투자 전문기관을 통한 혁신적기술프로그램(CTS)참여기업 역량 강화 용역',
  '2025~2026 CTS Seed 0 ODA 혁신기술 시장조사 및 창업 초기기업 액셀러레이팅 운영 용역',
  'Climate-tech Startup Acceleration and Investment Mobilization in Viet Nam',
  '2023-2027 네팔 귀환노동자 재정착 사업',
  'AVPN',
  '해외 수출바우처',
  '2026년 중소기업 혁신 바우처',
] as const;

export function normalizeApprovedProjectName(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildApprovedProjectDashboardId(index: number): string {
  return `approved-${String(index + 1).padStart(2, '0')}`;
}

export function buildApprovedProjectDashboardCandidates(
  orgId: string,
  now: string = new Date().toISOString(),
): ProjectMigrationCandidate[] {
  return APPROVED_PROJECT_DASHBOARD_SCOPE.map((businessName, index) => ({
    id: buildApprovedProjectDashboardId(index),
    department: '',
    coreMembers: '',
    groupwareProjectName: '',
    accountLabel: '',
    businessName,
    clientOrg: '',
    tenantId: orgId,
    sourceRow: index + 1,
    createdAt: now,
    updatedAt: now,
  }));
}

export interface ApprovedProjectDashboardSyncPlan {
  candidates: ProjectMigrationCandidate[];
  keepIds: string[];
  deleteIds: string[];
}

export function buildApprovedProjectDashboardSyncPlan(
  orgId: string,
  existingIds: string[],
  now: string = new Date().toISOString(),
): ApprovedProjectDashboardSyncPlan {
  const candidates = buildApprovedProjectDashboardCandidates(orgId, now);
  const keepIds = candidates.map((candidate) => candidate.id);
  const keepIdSet = new Set(keepIds);

  return {
    candidates,
    keepIds,
    deleteIds: existingIds.filter((id) => !keepIdSet.has(id)).sort(),
  };
}
