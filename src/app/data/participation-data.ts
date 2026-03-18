import type { ParticipationEntry, CrossVerifyRule, CrossVerifyGroup, SettlementSystemCode } from './types';
import { SETTLEMENT_SYSTEM_SHORT } from './types';

// ═══════════════════════════════════════════════════════════════
// MYSC 2025-2026 KOICA 사업 통합관리 — 참여율 마스터시트 데이터
// 실제 사업 포트폴리오 스프레드시트 기반
// ═══════════════════════════════════════════════════════════════
// NOTE: 이 파일은 Firestore 시딩용 원본 데이터입니다.
// 운영 시 데이터는 Firestore에서 실시간으로 읽어옵니다.
// 하드코딩 데이터 직접 수정 금지 — Firestore를 통해 관리하세요.
// ═══════════════════════════════════════════════════════════════

// ── 프로젝트 정의 (13개 사업) ──

export type ProjectPhaseStatus = '계약전' | '계약완료' | '계약완료(변경진행중)';

export interface ParticipationProject {
  id: string;
  name: string;
  shortName: string;
  clientOrg: string;
  settlement: SettlementSystemCode;
  settlementNote: string;            // e나라도움, 회계사정산, 민간사업
  phase: ProjectPhaseStatus;
  periodDesc: string;                // e.g. "2월-11월, 10개월"
}

export const PART_PROJECTS: ParticipationProject[] = [
  { id: 'eco26', name: '2026 에코스타트업', shortName: '에코스타트업', clientOrg: '기후에너지환경부/한국환경산업기술원', settlement: 'E_NARA_DOUM', settlementNote: 'e나라도움', phase: '계약전', periodDesc: '2월-11월, 10개월' },
  { id: 'agri26', name: '2026 농식품AC', shortName: '농식품AC', clientOrg: '농림식품부/한국농업기술진흥원', settlement: 'ACCOUNTANT', settlementNote: '회계사정산', phase: '계약완료', periodDesc: '3월-10월, 8개월' },
  { id: 'art26', name: '2026 예술기업 지원 사업 AC', shortName: '예술기업AC', clientOrg: '문체부/예술경영지원센터', settlement: 'E_NARA_DOUM', settlementNote: 'e나라도움', phase: '계약전', periodDesc: '3월-11월' },
  { id: 'lips', name: 'LIPS', shortName: 'LIPS', clientOrg: '중소벤처기업부/소상공인진흥원', settlement: 'E_NARA_DOUM', settlementNote: 'e나라도움', phase: '계약전', periodDesc: '1월-12월' },
  { id: 'cts1', name: 'CTS 참여기업 역량강화 (2023~2026)', shortName: 'CTS(~26)', clientOrg: 'KOICA', settlement: 'ACCOUNTANT', settlementNote: '회계사정산', phase: '계약완료', periodDesc: '1월-5월' },
  { id: 'yk_ibs', name: 'YK IBS 동남아 기후환경 ESG투자', shortName: 'YK IBS', clientOrg: 'KOICA', settlement: 'ACCOUNTANT', settlementNote: '회계사정산', phase: '계약완료', periodDesc: '연중' },
  { id: 'jlin_ibs', name: 'JLIN IBS 혼합금융 동남아 임팩트', shortName: 'JLIN IBS', clientOrg: 'KOICA', settlement: 'ACCOUNTANT', settlementNote: '회계사정산', phase: '계약완료', periodDesc: '연중' },
  { id: 'seed0', name: 'CTS Seed 0 ODA 혁신기술 액셀러레이팅', shortName: 'Seed 0', clientOrg: 'KOICA', settlement: 'ACCOUNTANT', settlementNote: '회계사정산', phase: '계약완료', periodDesc: '1월-12월' },
  { id: 'ap_ibs', name: 'AP IBS 인도네시아·인도 임팩트 펀드', shortName: 'AP IBS', clientOrg: 'KOICA', settlement: 'ACCOUNTANT', settlementNote: '회계사정산', phase: '계약완료', periodDesc: '1월-12월' },
  { id: 'cts2', name: 'CTS 참여기업 역량강화 (2025~2028)', shortName: 'CTS(25~28)', clientOrg: 'KOICA', settlement: 'ACCOUNTANT', settlementNote: '회계사정산', phase: '계약완료(변경진행중)', periodDesc: '1월-12월' },
  { id: 'nepal', name: '네팔 귀환노동자 창업 역량강화', shortName: '네팔', clientOrg: 'KOICA', settlement: 'ACCOUNTANT', settlementNote: '회계사정산', phase: '계약완료', periodDesc: '1월-12월' },
  { id: 'venture', name: '벤처리움', shortName: '벤처리움', clientOrg: '한국통신사연합회', settlement: 'PRIVATE', settlementNote: '민간사업', phase: '계약완료', periodDesc: '단기' },
];

// ── 직원 데이터 (본명 + 별명) ──

export interface MyscEmployee {
  id: string;
  realName: string;
  nickname: string;
}

export const EMPLOYEES: MyscEmployee[] = [
  { id: 'e01', realName: '김정태', nickname: '에이블' },
  { id: 'e02', realName: '이예지', nickname: '메씨리' },
  { id: 'e03', realName: '김세은', nickname: '람쥐' },
  { id: 'e04', realName: '유자인', nickname: '유자' },
  { id: 'e05', realName: '나미소', nickname: '쏘' },
  { id: 'e06', realName: '박정호', nickname: '스템' },
  { id: 'e07', realName: '김원희', nickname: '청' },
  { id: 'e08', realName: '김선미', nickname: '해니' },
  { id: 'e09', realName: '이정선', nickname: '보노' },
  { id: 'e10', realName: '고인효', nickname: '베리' },
  { id: 'e11', realName: '하윤지', nickname: '하모니' },
  { id: 'e12', realName: '송영일', nickname: '우슬' },
  { id: 'e13', realName: '김영우', nickname: '앵커' },
  { id: 'e14', realName: '정지윤', nickname: '유니' },
  { id: 'e15', realName: '강신일', nickname: '봄날' },
  { id: 'e16', realName: '장란영', nickname: '바닐라' },
  { id: 'e17', realName: '김다은', nickname: '데이나' },
  { id: 'e18', realName: '이지현A', nickname: '리사' },
  { id: 'e19', realName: '윤지수', nickname: '이나' },
  { id: 'e20', realName: '백지연', nickname: '제리' },
  { id: 'e21', realName: '송성미', nickname: '도담' },
  { id: 'e22', realName: '해민영', nickname: '썬' },
  { id: 'e23', realName: '한형규', nickname: '데일리' },
  { id: 'e24', realName: '송지효', nickname: '송죠' },
  { id: 'e25', realName: '장은희', nickname: '나무' },
  { id: 'e26', realName: '김빛고을', nickname: '브이' },
  { id: 'e27', realName: '이승연', nickname: '뽀승' },
  { id: 'e28', realName: '변준재', nickname: '제이' },
  { id: 'e29', realName: '하누리', nickname: '주디' },
  { id: 'e30', realName: '최종옥', nickname: '가드너' },
  { id: 'e31', realName: '김현지', nickname: '데이지' },
  { id: 'e32', realName: '민가람', nickname: '담마' },
  { id: 'e33', realName: '곽민주', nickname: '노아' },
  { id: 'e34', realName: '심지혜', nickname: '쿠키' },
  { id: 'e35', realName: '권혁준', nickname: '준' },
  { id: 'e36', realName: '김혜원', nickname: '모토' },
  { id: 'e37', realName: '최지윤', nickname: '써니' },
  { id: 'e38', realName: '김민주B', nickname: '만두' },
  { id: 'e39', realName: '최유진', nickname: '고야' },
  { id: 'e40', realName: '서민종', nickname: '파커' },
  { id: 'e41', realName: '김혜령', nickname: '테일러' },
  { id: 'e42', realName: '김신영', nickname: '가든' },
  { id: 'e43', realName: '김준성', nickname: '더준' },
  { id: 'e44', realName: '신예진', nickname: '진신' },
  { id: 'e45', realName: '정지연', nickname: '모모' },
  { id: 'e46', realName: '강신혁', nickname: '강케이' },
  { id: 'e47', realName: '이준철', nickname: '철쭉' },
  { id: 'e48', realName: '임성준', nickname: '에단' },
  { id: 'e49', realName: '이한선', nickname: '안소니' },
  { id: 'e50', realName: '이지현B', nickname: '올리브' },
  { id: 'e51', realName: '박진영', nickname: '그린' },
  { id: 'e52', realName: '이현송', nickname: '하모' },
  { id: 'e53', realName: '김민선', nickname: '포비' },
  { id: 'e54', realName: '권상준', nickname: '런던' },
  { id: 'e55', realName: '최상배', nickname: '루크' },
  { id: 'e56', realName: '임종수', nickname: '스티븐' },
  { id: 'e57', realName: '박연주', nickname: '연두' },
  { id: 'e58', realName: '하송희', nickname: '솔' },
  { id: 'e59', realName: '현우정', nickname: '로에' },
  { id: 'e60', realName: '이동완', nickname: '허브' },
  { id: 'e61', realName: '김예빈', nickname: '하얀' },
  { id: 'e62', realName: '백민혁', nickname: '혜윰' },
  { id: 'e63', realName: '강민경', nickname: '마고' },
  { id: 'e64', realName: '강현주', nickname: '헤일리' },
  { id: 'e65', realName: '변민욱', nickname: '보람' },
  { id: 'e66', realName: '강혜진', nickname: '트루' },
  { id: 'e67', realName: '권혜연', nickname: '호두' },
  { id: 'e68', realName: '양인영', nickname: '엠마' },
  { id: 'e69', realName: '조이수', nickname: '수' },
  { id: 'e70', realName: '박준형', nickname: '안톤' },
  { id: 'e71', realName: '전우철', nickname: '프코' },
  { id: 'e72', realName: '김민주C', nickname: '코지' },
  { id: 'e73', realName: '조아름', nickname: '다온' },
  { id: 'e74', realName: '백수미', nickname: '포용' },
  { id: 'e75', realName: '정재우', nickname: '피터' },
  { id: 'e76', realName: '현빈우', nickname: '에리얼' },
  { id: 'e77', realName: '고혜림', nickname: '멜론' },
  { id: 'e78', realName: '이시은', nickname: '싱아' },
  { id: 'e79', realName: '한연지', nickname: '태중' },
  { id: 'e80', realName: '김혜린', nickname: '니아' },
  { id: 'e81', realName: '방예원', nickname: '숲' },
  { id: 'e82', realName: '이지영', nickname: '' },
  { id: 'e83', realName: '노성진', nickname: '' },
  { id: 'e84', realName: '김민주', nickname: '' },  // 벤처리움 김민주(별도)
];

const empMap = new Map(EMPLOYEES.map(e => [e.realName, e]));
function eid(name: string) { return empMap.get(name)?.id ?? name; }
function enick(name: string) { return empMap.get(name)?.nickname ?? ''; }

// ── 사업별 참여자 데이터 (스프레드시트 원본) ──

interface RawAssignment {
  realName: string;
  rate: number;
  period: string;  // e.g. "2~11월", "1~12월", "1월~5월"
}

const PROJECT_ASSIGNMENTS: Record<string, RawAssignment[]> = {
  // ── 에코스타트업 (e나라도움) ──
  eco26: [
    { realName: '김정태', rate: 10, period: '2~11월' },
    { realName: '김세은', rate: 70, period: '2~11월' },
    { realName: '유자인', rate: 50, period: '2~11월' },
    { realName: '나미소', rate: 50, period: '2~11월' },
    { realName: '박정호', rate: 25, period: '2~11월' },
    { realName: '이정선', rate: 65, period: '2~11월' },
    { realName: '김영우', rate: 20, period: '2~11월' },
    { realName: '송성미', rate: 100, period: '2~11월' },
    { realName: '해민영', rate: 30, period: '2~11월' },
    { realName: '하누리', rate: 100, period: '2~11월' },
    { realName: '최유진', rate: 65, period: '2~11월' },
    { realName: '서민종', rate: 50, period: '2~11월' },
    { realName: '정지연', rate: 40, period: '2~11월' },
    { realName: '강신혁', rate: 60, period: '2~11월' },
    { realName: '임종수', rate: 10, period: '2~11월' },
    { realName: '하송희', rate: 70, period: '2~11월' },
    { realName: '현우정', rate: 70, period: '2~11월' },
    { realName: '강현주', rate: 40, period: '2~11월' },
    { realName: '변민욱', rate: 30, period: '2~11월' },
    { realName: '강혜진', rate: 70, period: '2~11월' },
    { realName: '정재우', rate: 50, period: '2~11월' },
    { realName: '김혜린', rate: 60, period: '2~11월' },
  ],

  // ── 농식품AC (회계사정산) ──
  agri26: [
    { realName: '김정태', rate: 10, period: '3~10월' },
    { realName: '이예지', rate: 10, period: '3~10월' },
    { realName: '김세은', rate: 10, period: '3~10월' },
    { realName: '유자인', rate: 10, period: '3~10월' },
    { realName: '박정호', rate: 10, period: '3~10월' },
    { realName: '김선미', rate: 30, period: '3~10월' },
    { realName: '이정선', rate: 35, period: '3~10월' },
    { realName: '김영우', rate: 30, period: '3~10월' },
    { realName: '강신일', rate: 10, period: '3~10월' },
    { realName: '이지현A', rate: 30, period: '3~10월' },
    { realName: '하누리', rate: 20, period: '3~10월' },
    { realName: '강신혁', rate: 30, period: '3~10월' },
    { realName: '하송희', rate: 20, period: '3~10월' },
    { realName: '김예빈', rate: 30, period: '3~10월' },
    { realName: '김혜린', rate: 30, period: '3~10월' },
  ],

  // ── 예술기업 지원 사업 AC (e나라도움) ──
  art26: [
    { realName: '박정호', rate: 30, period: '3~11월' },
    { realName: '김영우', rate: 20, period: '3~11월' },
    { realName: '김다은', rate: 10, period: '3~11월' },
    { realName: '윤지수', rate: 30, period: '3~11월' },
    { realName: '백지연', rate: 20, period: '3~11월' },
    { realName: '이승연', rate: 40, period: '3~11월' },
    { realName: '최유진', rate: 100, period: '3~11월' },
    { realName: '백민혁', rate: 20, period: '3~11월' },
    { realName: '김혜린', rate: 20, period: '3~11월' },
  ],

  // ── LIPS (e나라도움) ──
  lips: [
    { realName: '변준재', rate: 5, period: '1~12월' },
    { realName: '강신혁', rate: 100, period: '1~12월' },
    { realName: '김준성', rate: 100, period: '1~12월' },
    { realName: '이한선', rate: 5, period: '1~12월' },
    { realName: '신예진', rate: 5, period: '1~12월' },
  ],

  // ── CTS (2023~2026) (KOICA 회계사정산) ──
  cts1: [
    { realName: '김정태', rate: 10, period: '1~5월' },
    { realName: '박정호', rate: 15, period: '1~5월' },
    { realName: '김원희', rate: 90, period: '1~5월' },
    { realName: '고인효', rate: 30, period: '1~5월' },
    { realName: '하윤지', rate: 20, period: '1~5월' },
    { realName: '김영우', rate: 80, period: '1~5월' },
    { realName: '김다은', rate: 20, period: '1~5월' },
    { realName: '김현지', rate: 30, period: '1~5월' },
    { realName: '민가람', rate: 50, period: '1~5월' },
    { realName: '김혜령', rate: 20, period: '1~5월' },
    { realName: '최지윤', rate: 80, period: '1~5월' },
    { realName: '이준철', rate: 80, period: '1~5월' },
    { realName: '임종수', rate: 90, period: '1~5월' },
    { realName: '강민경', rate: 90, period: '1~5월' },
  ],

  // ── YK IBS ESG (KOICA 회계사정산) ──
  yk_ibs: [
    { realName: '김정태', rate: 30, period: '연중' },
    { realName: '이예지', rate: 25, period: '연중' },
    { realName: '박정호', rate: 30, period: '연중' },
    { realName: '김선미', rate: 30, period: '연중' },
    { realName: '고인효', rate: 20, period: '연중' },
    { realName: '김다은', rate: 30, period: '연중' },
    { realName: '윤지수', rate: 50, period: '연중' },
    { realName: '김혜령', rate: 20, period: '연중' },
  ],

  // ── JLIN IBS 혼합금융 (KOICA 회계사정산) ──
  jlin_ibs: [
    { realName: '김정태', rate: 10, period: '연중' },
    { realName: '이예지', rate: 20, period: '연중' },
    { realName: '박정호', rate: 10, period: '연중' },
    { realName: '고인효', rate: 35, period: '연중' },
    { realName: '김다은', rate: 30, period: '연중' },
    { realName: '김현지', rate: 40, period: '연중' },
    { realName: '김민주B', rate: 80, period: '연중' },
    { realName: '김혜령', rate: 40, period: '연중' },
    { realName: '신예진', rate: 50, period: '연중' },
    { realName: '고혜림', rate: 10, period: '연중' },
  ],

  // ── CTS Seed 0 (KOICA 회계사정산) ──
  seed0: [
    { realName: '김선미', rate: 70, period: '1~8월' },
    { realName: '강신일', rate: 70, period: '1~10월' },
    { realName: '이지현A', rate: 75, period: '1~10월' },
    { realName: '최종옥', rate: 75, period: '1~10월' },
    { realName: '김신영', rate: 70, period: '1~10월' },
    { realName: '김준성', rate: 75, period: '1~10월' },
    { realName: '변민욱', rate: 70, period: '1~8월' },
    { realName: '박연주', rate: 55, period: '1~12월' },
    { realName: '강혜진', rate: 20, period: '1~12월' },
    { realName: '조아름', rate: 10, period: '1~12월' },
  ],

  // ── AP IBS (KOICA 회계사정산) ──
  ap_ibs: [
    { realName: '김정태', rate: 10, period: '1~12월' },
    { realName: '박정호', rate: 20, period: '1~12월' },
    { realName: '이정선', rate: 25, period: '1~12월' },
    { realName: '윤지수', rate: 30, period: '1~12월' },
    { realName: '최유진', rate: 35, period: '1~12월' },
    { realName: '정지연', rate: 25, period: '1~12월' },
    { realName: '이승연', rate: 35, period: '1~12월' },
  ],

  // ── CTS (2025~2028) (KOICA 회계사정산) ──
  cts2: [
    { realName: '김정태', rate: 20, period: '1~12월' },
    { realName: '노성진', rate: 80, period: '1~12월' },
    { realName: '김원희', rate: 80, period: '1월' },
    { realName: '고인효', rate: 5, period: '6~12월' },
    { realName: '김현지', rate: 30, period: '2~12월' },
    { realName: '최지윤', rate: 20, period: '2~5월' },
    { realName: '최지윤', rate: 80, period: '6~12월' },  // 기간별 변경
    { realName: '이현송', rate: 80, period: '1~12월' },
    { realName: '최상배', rate: 80, period: '1~12월' },
    { realName: '임종수', rate: 90, period: '6~12월' },
    { realName: '김예빈', rate: 80, period: '1~12월' },
    { realName: '강민경', rate: 10, period: '2~5월' },
    { realName: '강민경', rate: 15, period: '6~12월' },  // 기간별 변경
    { realName: '양인영', rate: 90, period: '1~12월' },
    { realName: '이시은', rate: 90, period: '1~12월' },
  ],

  // ── 네팔 귀환노동자 (KOICA 회계사정산) ──
  nepal: [
    { realName: '장은희', rate: 34, period: '1~12월' },
    { realName: '변준재', rate: 20, period: '1~12월' },
  ],

  // ── 벤처리움 (민간사업) ──
  venture: [
    { realName: '강신일', rate: 10, period: '12월' },
    { realName: '권혁준', rate: 50, period: '12월' },
    { realName: '김민주', rate: 100, period: '12월' },
    { realName: '전우철', rate: 100, period: '12월' },
    { realName: '변준재', rate: 10, period: '4월' },
    { realName: '김원희', rate: 5, period: '3월' },
    { realName: '정지연', rate: 5, period: '3월' },
    { realName: '이정선', rate: 10, period: '12월' },
  ],
};

// ── 교차검증 규칙 ──

export const CROSS_VERIFY_RULES: CrossVerifyRule[] = [
  // e나라도움 ↔ R&D 시스템 (가장 강력)
  { systemA: 'E_NARA_DOUM', systemB: 'IRIS', risk: 'HIGH', description: '국고보조금 ↔ R&D 교차검증 (SFDS 실시간 감시)' },
  { systemA: 'E_NARA_DOUM', systemB: 'RCMS', risk: 'HIGH', description: '국고보조금 ↔ 실시간연구비 교차검증 (SFDS)' },
  { systemA: 'E_NARA_DOUM', systemB: 'EZBARO', risk: 'HIGH', description: '국고보조금 ↔ 이지바로 교차검증' },
  // R&D 간
  { systemA: 'IRIS', systemB: 'RCMS', risk: 'HIGH', description: 'R&D 시스템 간 통합 교차검증' },
  { systemA: 'IRIS', systemB: 'EZBARO', risk: 'HIGH', description: 'R&D 시스템 간 교차검증' },
  { systemA: 'RCMS', systemB: 'EZBARO', risk: 'HIGH', description: 'R&D 시스템 간 교차검증' },
  // e나라도움 ↔ 기타
  { systemA: 'E_NARA_DOUM', systemB: 'E_HIJO', risk: 'MEDIUM', description: '국비 ↔ 지방비 매칭사업 교차검증' },
  { systemA: 'E_NARA_DOUM', systemB: 'EDUFINE', risk: 'MEDIUM', description: '국고보조금 ↔ 교육재정 교차검증' },
  { systemA: 'E_NARA_DOUM', systemB: 'HAPPYEUM', risk: 'MEDIUM', description: '국고보조금 ↔ 사회보장 교차검증' },
  { systemA: 'E_NARA_DOUM', systemB: 'AGRIX', risk: 'MEDIUM', description: '국고보조금 ↔ 농림사업 교차검증' },
  // 회계사정산 ↔ e나라도움: 시스템 간 직접 연동은 아니지만 동일기관이면 위험
  { systemA: 'E_NARA_DOUM', systemB: 'ACCOUNTANT', risk: 'LOW', description: '시스템 정산 ↔ 회계사정산 간 직접 교차검증 가능성 낮음 (단, 동일기관 주의)' },
  // 기타
  { systemA: 'RCMS', systemB: 'AGRIX', risk: 'MEDIUM', description: '환경AC ↔ 농식품AC 대면심사 시 참여율 확인 가능' },
];

export function getCrossVerifyRisk(a: SettlementSystemCode, b: SettlementSystemCode): CrossVerifyRule | null {
  if (a === b && a !== 'NONE' && a !== 'PRIVATE') {
    return {
      systemA: a, systemB: b, risk: 'HIGH',
      description: '동일 정산 시스템 내 — 반드시 합산 100% 이내',
    };
  }
  if (a === 'NONE' || b === 'NONE' || a === 'PRIVATE' || b === 'PRIVATE') return null;
  return CROSS_VERIFY_RULES.find(
    r => (r.systemA === a && r.systemB === b) || (r.systemA === b && r.systemB === a)
  ) || null;
}

// ── ParticipationEntry 생성 ──

let entryCounter = 0;
function makeEntries(): ParticipationEntry[] {
  const entries: ParticipationEntry[] = [];

  for (const proj of PART_PROJECTS) {
    const assignments = PROJECT_ASSIGNMENTS[proj.id] || [];
    for (const a of assignments) {
      entryCounter++;
      const empId = eid(a.realName);
      const nick = enick(a.realName);
      entries.push({
        id: `pe${String(entryCounter).padStart(4, '0')}`,
        memberId: empId,
        memberName: nick ? `${a.realName}(${nick})` : a.realName,
        projectId: proj.id,
        projectName: proj.shortName,
        rate: a.rate,
        settlementSystem: proj.settlement,
        clientOrg: proj.clientOrg,
        periodStart: a.period,
        periodEnd: '',
        isDocumentOnly: false,
        note: proj.settlementNote,
        updatedAt: '2026-02-13T09:00:00Z',
      });
    }
  }

  return entries;
}

export const PARTICIPATION_ENTRIES: ParticipationEntry[] = makeEntries();

// ── 멤버별 요약 통계 ──

export interface MemberParticipationSummary {
  memberId: string;
  memberName: string;
  realName: string;
  nickname: string;
  entries: ParticipationEntry[];
  totalRate: number;
  projectCount: number;
  // 정산유형별 합산
  eNaraRate: number;       // e나라도움 합산
  accountantRate: number;  // 회계사정산 합산
  privateRate: number;     // 민간 합산
  // 발주기관별 합산
  orgRates: Record<string, number>;
  // 리스크
  riskLevel: 'SAFE' | 'WARNING' | 'DANGER';
  riskDetails: string[];
  maxVerifiableRate: number;  // 교차검증 가능한 최대 합산
}

export const PARTICIPATION_RISK_RULESET = {
  version: '2026-02-24-rules-v1',
  warningRate: 80,
  limitRate: 100,
  koicaOrgKeywords: ['KOICA', '한국국제협력단'],
} as const;

export interface ParticipationRiskReportRow {
  memberId: string;
  name: string;
  totalRate: number;
  eNaraRate: number;
  accountantRate: number;
  privateRate: number;
  projectCount: number;
  riskLevel: MemberParticipationSummary['riskLevel'];
  risk: string;
  riskDetails: string[];
}

export interface ParticipationRiskReport {
  generatedAt: string;
  rulesetVersion: string;
  thresholds: {
    warningRate: number;
    limitRate: number;
  };
  totalMembers: number;
  rows: ParticipationRiskReportRow[];
}

function orgKey(clientOrg: string): string {
  const raw = (clientOrg || '').split('/')[0]?.trim() || '';
  if (/koica|한국국제협력단/i.test(raw)) return 'KOICA';
  return raw;
}

function isKoicaOrg(org: string): boolean {
  const key = org.toLowerCase();
  return PARTICIPATION_RISK_RULESET.koicaOrgKeywords.some((kw) => key.includes(kw.toLowerCase()));
}

function parseMemberDisplayName(value: string): { realName: string; nickname: string } {
  const text = (value || '').trim();
  const m = text.match(/^(.+?)\((.+)\)$/);
  if (!m) return { realName: text, nickname: '' };
  return {
    realName: m[1].trim(),
    nickname: m[2].trim(),
  };
}

export function computeMemberSummaries(entries: ParticipationEntry[]): MemberParticipationSummary[] {
  // Group by member
  const memberMap = new Map<string, ParticipationEntry[]>();
  entries.forEach(e => {
    const list = memberMap.get(e.memberId) || [];
    list.push(e);
    memberMap.set(e.memberId, list);
  });

  const summaries: MemberParticipationSummary[] = [];

  memberMap.forEach((memberEntries, memberId) => {
    const first = memberEntries[0];
    const emp = EMPLOYEES.find(e => e.id === memberId);
    const parsedName = parseMemberDisplayName(first.memberName);
    const realName = parsedName.realName || emp?.realName || first.memberName;
    const nickname = parsedName.nickname || emp?.nickname || '';

    // 동일 이름 다중 기간 합산 (같은 사업에 기간별로 다른 참여율인 경우 최대값 사용)
    // → CTS(25~28)의 강민경 10%+15%, 최지윤 20%+80% 같은 경우는 기간이 다르므로 합산
    const projectRateMap = new Map<string, number>();
    memberEntries.forEach(e => {
      const key = e.projectId;
      projectRateMap.set(key, (projectRateMap.get(key) || 0) + e.rate);
    });

    const totalRate = Array.from(projectRateMap.values()).reduce((s, r) => s + r, 0);
    const projectCount = projectRateMap.size;

    // 정산유형별 합산
    let eNaraRate = 0;
    let accountantRate = 0;
    let privateRate = 0;

    // 발주기관별 합산
    const orgRates: Record<string, number> = {};

    memberEntries.forEach(e => {
      if (e.settlementSystem === 'E_NARA_DOUM') eNaraRate += e.rate;
      else if (e.settlementSystem === 'ACCOUNTANT') accountantRate += e.rate;
      else if (e.settlementSystem === 'PRIVATE') privateRate += e.rate;

      const org = orgKey(e.clientOrg);  // "KOICA", "기후에너지환경부" 등
      orgRates[org] = (orgRates[org] || 0) + e.rate;
    });

    // 리스크 분석 (규칙 기반 / deterministic)
    const riskDetails: string[] = [];
    let maxVerifiableRate = 0;
    let dangerByENara = false;
    let dangerByKoica = false;

    // 1) e나라도움 시스템 내 합산
    if (eNaraRate > 0) {
      if (eNaraRate > maxVerifiableRate) maxVerifiableRate = eNaraRate;
      if (eNaraRate > PARTICIPATION_RISK_RULESET.limitRate) {
        dangerByENara = true;
        riskDetails.push(`e나라도움 시스템 합산 ${eNaraRate}% → 100% 초과! 즉시 환수 위험`);
      } else if (eNaraRate >= PARTICIPATION_RISK_RULESET.limitRate) {
        riskDetails.push(`e나라도움 시스템 합산 ${eNaraRate}% (경고 수준, 추가 배정 주의)`);
      } else if (eNaraRate > PARTICIPATION_RISK_RULESET.warningRate) {
        riskDetails.push(`e나라도움 시스템 합산 ${eNaraRate}% (경고 수준, 추가 배정 주의)`);
      }
    }

    // 2) 동일 발주기관 합산 (KOICA 계열은 위험)
    Object.entries(orgRates).forEach(([org, rate]) => {
      if (rate > maxVerifiableRate) maxVerifiableRate = rate;
      if (rate <= PARTICIPATION_RISK_RULESET.warningRate) return;

      const entriesInOrg = memberEntries.filter(e => orgKey(e.clientOrg) === org);
      const hasVerifiableSettlement = entriesInOrg.some(
        e => e.settlementSystem === 'E_NARA_DOUM' || e.settlementSystem === 'ACCOUNTANT',
      );
      const koicaSensitive = isKoicaOrg(org);

      if (koicaSensitive && hasVerifiableSettlement && rate > PARTICIPATION_RISK_RULESET.limitRate) {
        dangerByKoica = true;
        riskDetails.push(`${org} 발주 사업 합산 ${rate}% → 동일 기관 100% 초과`);
      } else if (hasVerifiableSettlement && rate <= PARTICIPATION_RISK_RULESET.limitRate) {
        const hasENara = entriesInOrg.some(e => e.settlementSystem === 'E_NARA_DOUM');
        if (hasENara) {
          riskDetails.push(`${org} 발주 e나라도움 사업 합산 ${rate}% (경고 수준)`);
        }
      }
    });

    // 3) e나라도움 + 회계사정산 교차 (잠재적)
    if (eNaraRate > 0 && accountantRate > 0) {
      const crossRate = eNaraRate + accountantRate;
      if (crossRate > maxVerifiableRate) maxVerifiableRate = crossRate;
      if (crossRate > PARTICIPATION_RISK_RULESET.limitRate) {
        riskDetails.push(`e나라도움(${eNaraRate}%) + 회계사정산(${accountantRate}%) = ${crossRate}% (교차 잠재 위험)`);
      }
    }

    // 4) 전체 합산 경고
    if (totalRate > 100 && riskDetails.length === 0) {
      riskDetails.push(`전체 합산 ${totalRate}% (교차검증 대상 외 사업 포함)`);
    }

    const riskLevel: MemberParticipationSummary['riskLevel'] =
      (dangerByENara || dangerByKoica) ? 'DANGER'
        : riskDetails.length > 0 ? 'WARNING'
          : 'SAFE';

    summaries.push({
      memberId, memberName: first.memberName,
      realName, nickname,
      entries: memberEntries,
      totalRate, projectCount,
      eNaraRate, accountantRate, privateRate,
      orgRates, riskLevel, riskDetails, maxVerifiableRate,
    });
  });

  // Sort: DANGER first, then WARNING, then SAFE, then by totalRate desc
  return summaries.sort((a, b) => {
    const ro = { DANGER: 0, WARNING: 1, SAFE: 2 };
    if (ro[a.riskLevel] !== ro[b.riskLevel]) return ro[a.riskLevel] - ro[b.riskLevel];
    return b.totalRate - a.totalRate;
  });
}

export function buildParticipationRiskReport(entries: ParticipationEntry[]): ParticipationRiskReport {
  const rows: ParticipationRiskReportRow[] = computeMemberSummaries(entries).map((member) => ({
    memberId: member.memberId,
    name: member.nickname ? `${member.realName}(${member.nickname})` : member.realName,
    totalRate: member.totalRate,
    eNaraRate: member.eNaraRate,
    accountantRate: member.accountantRate,
    privateRate: member.privateRate,
    projectCount: member.projectCount,
    riskLevel: member.riskLevel,
    risk: member.riskDetails[0] || '리스크 없음',
    riskDetails: member.riskDetails,
  }));

  return {
    generatedAt: new Date().toISOString(),
    rulesetVersion: PARTICIPATION_RISK_RULESET.version,
    thresholds: {
      warningRate: PARTICIPATION_RISK_RULESET.warningRate,
      limitRate: PARTICIPATION_RISK_RULESET.limitRate,
    },
    totalMembers: rows.length,
    rows,
  };
}

// ── 교차검증 그룹 계산 ──

export function computeCrossVerifyGroups(entries: ParticipationEntry[]): CrossVerifyGroup[] {
  const memberMap = new Map<string, ParticipationEntry[]>();
  entries.forEach(e => {
    const list = memberMap.get(e.memberId) || [];
    list.push(e);
    memberMap.set(e.memberId, list);
  });

  const groups: CrossVerifyGroup[] = [];
  memberMap.forEach((memberEntries, memberId) => {
    const memberName = memberEntries[0]?.memberName || '';

    // 동일 시스템 그룹
    const systemMap = new Map<SettlementSystemCode, ParticipationEntry[]>();
    memberEntries.forEach(e => {
      if (e.settlementSystem === 'NONE' || e.settlementSystem === 'PRIVATE') return;
      const list = systemMap.get(e.settlementSystem) || [];
      list.push(e);
      systemMap.set(e.settlementSystem, list);
    });
    systemMap.forEach((sysEntries, sysCode) => {
      const totalRate = sysEntries.reduce((s, e) => s + e.rate, 0);
      groups.push({
        memberId, memberName,
        groupKey: `sys:${sysCode}`,
        groupLabel: `${SETTLEMENT_SYSTEM_SHORT[sysCode]} 정산`,
        entries: sysEntries, totalRate,
        risk: totalRate > 100 ? 'HIGH' : totalRate > 80 ? 'MEDIUM' : 'LOW',
        isOverLimit: totalRate > 100,
      });
    });

    // 동일 발주기관 (2건 이상)
    const orgMap = new Map<string, ParticipationEntry[]>();
    memberEntries.forEach(e => {
      if (e.settlementSystem === 'PRIVATE') return;
      const org = e.clientOrg.split('/')[0];
      const list = orgMap.get(org) || [];
      list.push(e);
      orgMap.set(org, list);
    });
    orgMap.forEach((orgEntries, orgName) => {
      if (orgEntries.length < 2) return;
      const totalRate = orgEntries.reduce((s, e) => s + e.rate, 0);
      groups.push({
        memberId, memberName,
        groupKey: `org:${orgName}`,
        groupLabel: `${orgName} (동일기관)`,
        entries: orgEntries, totalRate,
        risk: totalRate > 100 ? 'HIGH' : totalRate > 80 ? 'MEDIUM' : 'LOW',
        isOverLimit: totalRate > 100,
      });
    });
  });

  return groups;
}

// ── 사업별 매핑 헬퍼 ──

export const PROJECT_SETTLEMENT_MAP: Record<string, {
  system: SettlementSystemCode;
  clientOrg: string;
  projectName: string;
}> = Object.fromEntries(
  PART_PROJECTS.map(p => [p.id, { system: p.settlement, clientOrg: p.clientOrg, projectName: p.shortName }])
);
