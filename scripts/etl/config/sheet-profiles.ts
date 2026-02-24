/**
 * 시트별 사전 힌트 — LLM 매핑을 보조하는 수동 오버라이드
 * 자동 매핑이 어려운 시트에 대해 목표 컬렉션과 핵심 컬럼을 명시
 */

export interface SheetProfile {
  /** 시트명 패턴 (부분 매치) */
  namePattern: string;
  /** 매핑 대상 Firestore 컬렉션 */
  targetCollection: string;
  /** 스킵 여부 (가이드/참고 시트) */
  skip?: boolean;
  /** 추가 컨텍스트 — LLM에 전달 */
  hint?: string;
  /** 강제 헤더 행 수 (자동감지 오버라이드). 1-indexed, 첫 N행을 헤더로 사용 */
  headerRowCount?: number;
  /** 헤더 시작 행 (1-indexed). headerRowCount와 함께 사용하면 headerStartRow ~ headerStartRow+headerRowCount-1 까지 사용 */
  headerStartRow?: number;
  /** 강제 데이터 시작 행 (1-indexed) */
  dataStartRow?: number;
}

export const SHEET_PROFILES: SheetProfile[] = [
  // ── 통합 대시보드 ──
  { namePattern: '대시보드 작성 가이드', targetCollection: '', skip: true },
  { namePattern: '사업확보 현황판', targetCollection: 'projects', hint: 'phase=PROSPECT. 사업명(E열), 발주기관(D열), 유형(I열), 확보여부(J열) 중심 매핑', headerRowCount: 2, dataStartRow: 3 },
  { namePattern: '확정사업 관리', targetCollection: 'projects', hint: 'phase=CONFIRMED. 사업명, 발주기관, 사업유형, 사내기업팀, 메인 담당자', headerStartRow: 5, headerRowCount: 1, dataStartRow: 6 },
  { namePattern: '외주파트너 전략관리', targetCollection: '', skip: true, hint: '외주 관리용 — 별도 컬렉션 미정' },
  { namePattern: '투자KPI', targetCollection: '', skip: true },
  // WIP 시트 — 데이터 미완성으로 스킵
  { namePattern: '서류인력 확정 프로토콜', targetCollection: '', skip: true, hint: 'WIP 프로토콜 시트' },
  { namePattern: '100-1.참여율(전체)', targetCollection: '', skip: true, hint: '전체 서류 참여율 — WIP, 작성중 상태' },
  { namePattern: '25년매출_캐쉬플로우', targetCollection: '', skip: true, hint: '25년 매출 분석 — 헤더에 데이터 혼재, 자동매핑 불가' },
  { namePattern: '그룹(센터)별 사업현황', targetCollection: '', skip: true, hint: '빈 시트/대시보드 — 데이터 없음' },
  { namePattern: '참여자별 사업현황', targetCollection: '', skip: true, hint: '작업중 시트 — 데이터 미완성' },
  { namePattern: 'AC별키워드', targetCollection: '', skip: true },
  { namePattern: '사업 KPI 관리', targetCollection: '', skip: true },
  { namePattern: '자동화중', targetCollection: '', skip: true },
  { namePattern: '구성원 주요일정', targetCollection: '', skip: true },
  { namePattern: '사업중간현황', targetCollection: '', skip: true },
  { namePattern: '사업주요일정', targetCollection: '', skip: true },
  { namePattern: '투자back', targetCollection: '', skip: true },
  { namePattern: '최종육성팀', targetCollection: '', skip: true },
  { namePattern: '100-2.참여율(e-나라)', targetCollection: 'participationEntries', hint: 'e-나라도움 참여율 교차검증 데이터' },
  { namePattern: '100-3.참여율(KOICA)', targetCollection: 'participationEntries', hint: 'KOICA 참여율' },
  { namePattern: '100-4.참여율(기타', targetCollection: 'participationEntries', hint: '기타 시스템 참여율' },
  { namePattern: '외부 심사위원', targetCollection: '', skip: true },
  { namePattern: '전문가 인력비', targetCollection: '', skip: true },
  { namePattern: '참고사업유형', targetCollection: '', skip: true },
  { namePattern: '재직자명단', targetCollection: 'members', hint: '소속(중분류), 소속(소분류), 성명, 별명, 직급, 직책', headerRowCount: 1, dataStartRow: 2 },
  // ── 행사일정 ──
  { namePattern: '행사일정', targetCollection: '', skip: true },

  // ── 사업비 관리 시트 ──
  { namePattern: 'FAQ', targetCollection: '', skip: true },
  { namePattern: '안내사항기본정보', targetCollection: '', skip: true },
  { namePattern: '예산총괄시트', targetCollection: 'projects', hint: '프로젝트 예산 비목/세목 breakdown. 예산총괄 → Project.budgetBreakdown embed', headerRowCount: 3, dataStartRow: 4 },
  { namePattern: '비목별 증빙자료', targetCollection: '', skip: true, hint: '증빙 가이드 참고용' },
  { namePattern: 'cashflow(사용내역 연동)', targetCollection: 'cashflowWeekSheets', hint: '주차별 입출금. 행=항목, 열=주차(68열). 병합셀 63개', headerRowCount: 6, dataStartRow: 7 },
  { namePattern: 'cashflow(e나라도움', targetCollection: 'cashflowWeekSheets', hint: 'e나라도움 전용 cashflow', headerRowCount: 6, dataStartRow: 7 },
  { namePattern: '사용내역', targetCollection: 'transactions', hint: '통장내역 기반 사용내역. 병합셀 17개. 3행 헤더', headerRowCount: 3, dataStartRow: 4 },
  { namePattern: '통장내역', targetCollection: 'transactions', hint: '은행 통장 raw 데이터', headerStartRow: 8, headerRowCount: 1, dataStartRow: 9 },
  { namePattern: '인력투입률', targetCollection: 'participationEntries', hint: '월별 투입 O/X 표시. 이름, 직무, 참여율, 총참여기간', headerStartRow: 3, headerRowCount: 2, dataStartRow: 5 },
  { namePattern: '정산보완요청', targetCollection: '', skip: true, hint: '정산 보완 — 별도 구현 예정' },
  { namePattern: '원천세 계산기', targetCollection: '', skip: true },
  { namePattern: '해외출장', targetCollection: 'transactions', hint: '해외출장 비용 별도관리시트 — 사용내역과 동일 구조', headerRowCount: 3, dataStartRow: 4 },
  { namePattern: '그룹예산', targetCollection: 'projects', hint: '그룹 사업(현대차 등) 예산. 비목/세목 동일 구조', headerRowCount: 3, dataStartRow: 4 },
  { namePattern: '그룹cashflow', targetCollection: 'cashflowWeekSheets', hint: '그룹 사업 cashflow', headerRowCount: 4, dataStartRow: 5 },
  { namePattern: '그룹지출대장', targetCollection: 'transactions', hint: '그룹 사업 지출내역', headerRowCount: 3, dataStartRow: 4 },
  { namePattern: '그룹통장내역', targetCollection: '', skip: true, hint: '빈 시트' },
  { namePattern: '그룹최종정산', targetCollection: '', skip: true, hint: '빈 시트' },
];

/**
 * 시트명으로 프로필 조회 (부분 매치)
 * 더 구체적인 패턴이 먼저 매치되도록 긴 패턴 우선
 */
export function findSheetProfile(sheetName: string): SheetProfile | undefined {
  // Sort by pattern length descending so more specific patterns match first
  const sorted = [...SHEET_PROFILES].sort((a, b) => b.namePattern.length - a.namePattern.length);
  return sorted.find(p => sheetName.includes(p.namePattern));
}
