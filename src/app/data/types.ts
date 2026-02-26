// ═══════════════════════════════════════════════════════════════
// MYSC 사업관리 통합 플랫폼 — TypeScript Type Definitions
// Firestore 스키마와 1:1 매핑
// ═══════════════════════════════════════════════════════════════

// ── Enums ──

export type UserRole = 'admin' | 'tenant_admin' | 'finance' | 'pm' | 'viewer' | 'auditor' | 'support' | 'security';

export type ProjectStatus = 'CONTRACT_PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'COMPLETED_PENDING_PAYMENT';
export type ProjectType = 'DEV_COOPERATION' | 'CONSULTING' | 'SPACE_BIZ' | 'IMPACT_INVEST' | 'EDUCATION' | 'AC_GENERAL' | 'OTHER';
export type ProjectPhase = 'PROSPECT' | 'CONFIRMED';  // 입찰예정 / 확정

export type SettlementType = 'TYPE1' | 'TYPE2' | 'TYPE4';
export type Basis = 'SUPPLY_AMOUNT' | 'SUPPLY_PRICE'; // 공급가액 / 공급대가

export type AccountType = 'DEDICATED' | 'OPERATING' | 'NONE'; // 전용통장 / 운영통장 / 없음

export type TransactionState = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export type Direction = 'IN' | 'OUT';
export type PaymentMethod = 'TRANSFER' | 'CORP_CARD_1' | 'CORP_CARD_2' | 'OTHER';

export type EvidenceStatus = 'MISSING' | 'PARTIAL' | 'COMPLETE';

export type CashflowCategory =
  | 'CONTRACT_PAYMENT'    // 계약금
  | 'INTERIM_PAYMENT'     // 중도금
  | 'FINAL_PAYMENT'       // 잔금
  | 'LABOR_COST'          // 인건비
  | 'OUTSOURCING'         // 외주비
  | 'EQUIPMENT'           // 장비구입비
  | 'TRAVEL'              // 출장비
  | 'SUPPLIES'            // 소모품비
  | 'COMMUNICATION'       // 통신비
  | 'RENT'                // 임차료
  | 'UTILITY'             // 공과금
  | 'TAX_PAYMENT'         // 세금납부
  | 'VAT_REFUND'          // 부가세환급
  | 'INSURANCE'           // 보험료
  | 'MISC_INCOME'         // 기타수입
  | 'MISC_EXPENSE';       // 기타지출

export const CASHFLOW_CATEGORY_LABELS: Record<CashflowCategory, string> = {
  CONTRACT_PAYMENT: '계약금',
  INTERIM_PAYMENT: '중도금',
  FINAL_PAYMENT: '잔금',
  LABOR_COST: '인건비',
  OUTSOURCING: '외주비',
  EQUIPMENT: '장비구입비',
  TRAVEL: '출장비',
  SUPPLIES: '소모품비',
  COMMUNICATION: '통신비',
  RENT: '임차료',
  UTILITY: '공과금',
  TAX_PAYMENT: '세금납부',
  VAT_REFUND: '부가세환급',
  INSURANCE: '보험료',
  MISC_INCOME: '기타수입',
  MISC_EXPENSE: '기타지출',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  CONTRACT_PENDING: '계약전',
  IN_PROGRESS: '사업진행중',
  COMPLETED: '사업종료',
  COMPLETED_PENDING_PAYMENT: '종료(잔금대기)',
};

export const PROJECT_PHASE_LABELS: Record<ProjectPhase, string> = {
  PROSPECT: '입찰/예정',
  CONFIRMED: '확정',
};

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  DEV_COOPERATION: 'D-1. 개발협력(KOICA)',
  CONSULTING: 'C-1. 컨설팅',
  SPACE_BIZ: 'S-1. 공간사업',
  IMPACT_INVEST: 'I-투자/임팩트',
  EDUCATION: 'E-1. 교육사업 (워크숍 등)',
  AC_GENERAL: 'A-1. AC(일반)',
  OTHER: 'Z-1. 기타사업',
};

export const PROJECT_TYPE_SHORT_LABELS: Record<ProjectType, string> = {
  DEV_COOPERATION: '개발협력',
  CONSULTING: '컨설팅',
  SPACE_BIZ: '공간사업',
  IMPACT_INVEST: '투자/임팩트',
  EDUCATION: '교육사업',
  AC_GENERAL: 'AC(일반)',
  OTHER: '기타',
};

export const SETTLEMENT_TYPE_LABELS: Record<SettlementType, string> = {
  TYPE1: 'Type1. 세금계산서발행+공급가액',
  TYPE2: 'Type2. 세금계산서발행+공급대가',
  TYPE4: 'Type4. 세금계산서미발행+공급대가',
};

export const SETTLEMENT_TYPE_SHORT: Record<SettlementType, string> = {
  TYPE1: 'Type1',
  TYPE2: 'Type2',
  TYPE4: 'Type4',
};

export const BASIS_LABELS: Record<Basis, string> = {
  SUPPLY_AMOUNT: '공급가액 기준',
  SUPPLY_PRICE: '공급대가 기준',
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  DEDICATED: '전용통장',
  OPERATING: '운영통장',
  NONE: '-',
};

export const DIRECTION_LABELS: Record<Direction, string> = {
  IN: '입금',
  OUT: '출금',
};

export const TX_STATE_LABELS: Record<TransactionState, string> = {
  DRAFT: '작성중',
  SUBMITTED: '제출완료',
  APPROVED: '승인',
  REJECTED: '반려',
};

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  MISSING: '미제출',
  PARTIAL: '일부제출',
  COMPLETE: '완료',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  TRANSFER: '계좌이체',
  CORP_CARD_1: '법인카드(뒷번호1)',
  CORP_CARD_2: '법인카드(뒷번호2)',
  OTHER: '기타',
};

// ── 참여율 관리 (Participation Rate) ──

export type SettlementSystemCode =
  | 'E_NARA_DOUM'   // e나라도움 (국고보조금통합관리시스템)
  | 'IRIS'           // 범부처통합연구지원시스템
  | 'RCMS'           // 실시간연구비통합관리시스템
  | 'EZBARO'         // 이지바로
  | 'E_HIJO'         // e호조 (지방재정관리시스템)
  | 'EDUFINE'        // 에듀파인 (교육청 예산)
  | 'HAPPYEUM'       // 행복이음/희망이음 (사회보장정보시스템)
  | 'AGRIX'          // 아그릭스 (농림사업정보시스템)
  | 'ACCOUNTANT'     // 회계사정산 (전문 회계법인 정산)
  | 'PRIVATE'        // 민간사업
  | 'NONE';          // 미정/없음

export const SETTLEMENT_SYSTEM_LABELS: Record<SettlementSystemCode, string> = {
  E_NARA_DOUM: 'e나라도움 (국고보조금통합관리)',
  IRIS: 'IRIS (범부처통합연구지원)',
  RCMS: 'RCMS (실시간연구비)',
  EZBARO: '이지바로 (EZBaro)',
  E_HIJO: 'e호조 (지방재정)',
  EDUFINE: '에듀파인 (교육재정)',
  HAPPYEUM: '행복이음 (사회보장)',
  AGRIX: '아그릭스 (농림사업)',
  ACCOUNTANT: '회계사정산',
  PRIVATE: '민간사업',
  NONE: '미정',
};

export const SETTLEMENT_SYSTEM_SHORT: Record<SettlementSystemCode, string> = {
  E_NARA_DOUM: 'e나라도움',
  IRIS: 'IRIS',
  RCMS: 'RCMS',
  EZBARO: '이지바로',
  E_HIJO: 'e호조',
  EDUFINE: '에듀파인',
  HAPPYEUM: '행복이음',
  AGRIX: '아그릭스',
  ACCOUNTANT: '회계사정산',
  PRIVATE: '민간',
  NONE: '미정',
};

export type CrossVerifyRisk = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface CrossVerifyRule {
  systemA: SettlementSystemCode;
  systemB: SettlementSystemCode;
  risk: CrossVerifyRisk;
  description: string;
}

/**
 * 참여율 항목: 한 직원이 한 프로젝트에 배정된 참여율
 */
export interface ParticipationEntry {
  id: string;
  memberId: string;
  memberName: string;
  projectId: string;
  projectName: string;
  rate: number;                          // 0~100 (%)
  settlementSystem: SettlementSystemCode;
  clientOrg: string;                     // 발주기관
  periodStart: string;                   // YYYY-MM
  periodEnd: string;                     // YYYY-MM
  isDocumentOnly: boolean;               // 서류상 인력 여부
  note: string;
  updatedAt: string;
}

/**
 * 교차검증 그룹: 동일 시스템 / 동일 기관 내 합산 결과
 */
export interface CrossVerifyGroup {
  memberId: string;
  memberName: string;
  groupKey: string;           // e.g. "E_NARA_DOUM" or "KOICA"
  groupLabel: string;
  entries: ParticipationEntry[];
  totalRate: number;
  risk: CrossVerifyRisk;
  isOverLimit: boolean;       // totalRate > 100
}

// ── Interfaces ──

export interface OrgMember {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
  members: OrgMember[];
}

export interface LedgerTemplate {
  id: string;
  orgId: string;
  name: string;
  version: number;
  cashflowEnums: CashflowCategory[];
  evidenceRules: string[];         // 필수 증빙 체크리스트 항목명
  approvalThreshold: number;       // 이 금액 이상이면 승인 필요
  defaultBasis: Basis;
  allowedSettlementTypes: SettlementType[];
  createdAt: string;
}

export interface Project {
  id: string;
  version?: number;
  slug: string;        // URL-safe unique key
  orgId: string;
  name: string;
  status: ProjectStatus;
  type: ProjectType;
  phase: ProjectPhase;
  contractAmount: number;        // 총 사업비 금액(매출부가세 포함)
  contractStart: string;
  contractEnd: string;
  settlementType: SettlementType;
  basis: Basis;
  accountType: AccountType;      // 전용통장/운영통장
  // 입금계획
  paymentPlan: {
    contract: number;    // 계약금
    interim: number;     // 중도금
    final: number;       // 잔금
  };
  paymentPlanDesc: string;       // 입금계획 텍스트 (e.g. "선금80%, 잔금20%")
  // MYSC-specific fields
  clientOrg: string;             // 발주기관(계약기관)
  groupwareName: string;         // 그룹웨어 프로젝트등록명
  participantCondition: string;  // 참여기업 조건
  contractType: string;          // 계약서 유형 (계약서(날인), 기타 등)
  // 팀/담당자
  department: string;            // 담당조직
  teamName: string;              // 사내기업팀 (팀장)
  managerId: string;             // PM uid
  managerName: string;           // 메인 담당자
  settlementSupportId?: string;
  settlementSupportName?: string;
  // 재무
  budgetCurrentYear: number;     // 2026년 총사업비(매출부가세 포함)
  taxInvoiceAmount: number;      // 2025년 세금계산서 금액
  profitRate: number;            // 수익률 (소수점, e.g. 0.5918)
  profitAmount: number;          // 수익금액
  isSettled: boolean;            // 사업정산 여부
  finalPaymentNote: string;      // 잔금입금여부/메모
  // 대시보드 가이드 체크리스트
  confirmerName: string;         // 확인자 닉네임 (센터장/그룹장)
  lastCheckedAt: string;         // 마지막 확인 일시
  cashflowDiffNote: string;      // 입출금합계 차이 사유
  // 메타
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Ledger {
  id: string;
  version?: number;
  projectId: string;
  templateId: string;
  name: string;
  basis: Basis;
  settlementType: SettlementType;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionAmounts {
  bankAmount: number;      // 은행 기준 금액
  depositAmount: number;   // 입금액 (IN 방향)
  expenseAmount: number;   // 출금액 (OUT 방향)
  vatIn: number;           // 매입세액
  vatOut: number;          // 매출세액
  vatRefund: number;       // 부가세환급
  balanceAfter: number;    // 거래 후 잔액
}

export interface Transaction {
  id: string;
  version?: number;
  ledgerId: string;
  projectId: string;
  state: TransactionState;
  dateTime: string;        // ISO 날짜
  weekCode: string;        // e.g. "2026-W07"
  direction: Direction;
  method: PaymentMethod;
  cashflowCategory: CashflowCategory;
  cashflowLabel: string;   // 표시용 라벨
  budgetCategory?: string; // 비목/세목
  counterparty: string;    // 거래처
  memo: string;
  amounts: TransactionAmounts;
  // 증빙
  evidenceRequired: string[];
  evidenceStatus: EvidenceStatus;
  evidenceMissing: string[];
  attachmentsCount: number;
  // 승인
  submittedBy?: string;
  submittedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedReason?: string;
  // 감사
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  // ── 정산 대장 확장 필드 (Settlement Ledger) ──
  author?: string;                 // 작성자
  budgetSubCategory?: string;      // 세목
  budgetSubSubCategory?: string;   // 세세목
  // 증빙 추적 (사업팀)
  evidenceRequiredDesc?: string;   // 필수증빙자료 리스트 (텍스트)
  evidenceCompletedDesc?: string;  // 구비 완료된 증빙자료 리스트
  evidencePendingDesc?: string;    // 준비필요자료
  // 정산지원 담당자
  evidenceDriveLink?: string;      // 증빙자료 드라이브 링크
  supportPendingDocs?: string;     // 도담/써니 준비 필요자료
  // 도담 (정부 보고)
  eNaraRegistered?: string;        // e나라 등록
  eNaraExecuted?: string;          // e나라 집행
  vatSettlementDone?: boolean;     // 부가세 지결 완료여부
  settlementComplete?: boolean;    // 최종완료
  settlementNote?: string;         // 비고
  // 감사 로그 (회계부정 방지)
  editHistory?: Array<{
    field: string;
    before: unknown;
    after: unknown;
    editedBy: string;
    editedAt: string;
  }>;
}

export interface Evidence {
  id: string;
  version?: number;
  transactionId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  category: string;        // 증빙 유형 (세금계산서, 영수증, 계약서 등)
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  rejectedReason?: string;
}

export interface Comment {
  id: string;
  version?: number;
  transactionId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

// ── Company Board (전사 게시판) ──

export type BoardChannel = 'general' | 'qna' | 'ideas' | 'help' | 'training';

export const BOARD_CHANNEL_LABELS: Record<BoardChannel, string> = {
  general: '일반',
  qna: '질문',
  ideas: '아이디어',
  help: '도움요청',
  training: '교육',
};

export interface BoardPost {
  id: string;
  tenantId?: string;
  channel: BoardChannel;
  title: string;
  body: string;
  tags: string[];
  createdBy: string;
  createdByName: string;
  createdByRole?: string;
  createdByAvatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  commentCount: number;
  upvoteCount: number;
  downvoteCount: number;
  voteScore: number;
  deletedAt?: string | null;
}

export interface BoardComment {
  id: string;
  tenantId?: string;
  postId: string;
  parentId?: string | null;
  body: string;
  createdBy: string;
  createdByName: string;
  createdByAvatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface BoardVote {
  id: string;
  tenantId?: string;
  postId: string;
  voterId: string;
  value: -1 | 1;
  createdAt: string;
  updatedAt: string;
}

// ── Payroll (인건비 공지/확인) ──

export type PayrollPaidStatus = 'UNKNOWN' | 'AUTO_MATCHED' | 'CONFIRMED' | 'MISSING';

export interface PayrollSchedule {
  /** doc id = projectId */
  id: string;
  tenantId?: string;
  projectId: string;
  /** 1..31 (없는 날짜면 월 말일로 clamp) */
  dayOfMonth: number;
  timezone: string; // e.g. "Asia/Seoul"
  noticeLeadBusinessDays: number; // default 3
  active: boolean;
  updatedAt: string;
  updatedBy: string;
  updatedByName?: string;
  createdAt?: string;
  createdBy?: string;
}

export interface PayrollRun {
  /** doc id = `${projectId}-${yearMonth}` */
  id: string;
  tenantId?: string;
  projectId: string;
  yearMonth: string; // "2026-02"
  plannedPayDate: string; // "YYYY-MM-DD"
  noticeDate: string; // "YYYY-MM-DD"
  noticeLeadBusinessDays: number;
  acknowledged: boolean;
  acknowledgedAt?: string;
  acknowledgedByUid?: string;
  acknowledgedByName?: string;
  paidStatus: PayrollPaidStatus;
  matchedTxIds?: string[];
  confirmedAt?: string;
  confirmedByUid?: string;
  confirmedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export type MonthlyCloseStatus = 'OPEN' | 'DONE';

export interface MonthlyClose {
  /** doc id = `${projectId}-${yearMonth}` */
  id: string;
  tenantId?: string;
  projectId: string;
  yearMonth: string; // "2026-02"
  status: MonthlyCloseStatus;
  doneAt?: string;
  doneByUid?: string;
  doneByName?: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
  acknowledgedByUid?: string;
  acknowledgedByName?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Cashflow Weekly Sheet (주간 캐시플로 시트) ──

export type CashflowSheetLineId =
  // IN
  | 'MYSC_PREPAY_IN'        // MYSC 선입금(필요 시 - 금액)
  | 'SALES_IN'              // 매출액(입금)
  | 'SALES_VAT_IN'          // 매출부가세(입금)
  | 'TEAM_SUPPORT_IN'       // 팀지원금(입금)
  | 'BANK_INTEREST_IN'      // 은행이자(입금)
  // OUT
  | 'DIRECT_COST_OUT'       // 직접사업비(공급가액/공급대가)
  | 'INPUT_VAT_OUT'         // 매입부가세(출금)
  | 'MYSC_LABOR_OUT'        // MYSC 인건비
  | 'MYSC_PROFIT_OUT'       // MYSC 수익(간접비 등)
  | 'SALES_VAT_OUT'         // 매출부가세(출금)
  | 'TEAM_SUPPORT_OUT'      // 팀지원금(출금)
  | 'BANK_INTEREST_OUT';    // 은행이자(출금)

export const CASHFLOW_SHEET_LINE_LABELS: Record<CashflowSheetLineId, string> = {
  MYSC_PREPAY_IN: 'MYSC 선입금(잔금 등 입금 필요 시)',
  SALES_IN: '매출액(입금)',
  SALES_VAT_IN: '매출부가세(입금)',
  TEAM_SUPPORT_IN: '팀지원금(입금)',
  BANK_INTEREST_IN: '은행이자(입금)',
  DIRECT_COST_OUT: '직접사업비',
  INPUT_VAT_OUT: '매입부가세',
  MYSC_LABOR_OUT: 'MYSC 인건비',
  MYSC_PROFIT_OUT: 'MYSC 수익(간접비 등)',
  SALES_VAT_OUT: '매출부가세(출금)',
  TEAM_SUPPORT_OUT: '팀지원금(출금)',
  BANK_INTEREST_OUT: '은행이자(출금)',
};

export interface CashflowWeekSheet {
  /** doc id = `${projectId}-${yearMonth}-w${weekNo}` */
  id: string;
  tenantId?: string;
  projectId: string;
  yearMonth: string; // "2026-01"
  weekNo: number; // 1..5 (nth Monday in month)
  weekStart: string; // "YYYY-MM-DD" (Monday)
  weekEnd: string; // "YYYY-MM-DD" (Sunday)
  projection: Partial<Record<CashflowSheetLineId, number>>;
  actual: Partial<Record<CashflowSheetLineId, number>>;
  pmSubmitted: boolean;
  pmSubmittedAt?: string;
  pmSubmittedByUid?: string;
  pmSubmittedByName?: string;
  adminClosed: boolean;
  adminClosedAt?: string;
  adminClosedByUid?: string;
  adminClosedByName?: string;
  createdAt: string;
  updatedAt: string;
  updatedByUid?: string;
  updatedByName?: string;
  // ── 편차 확인 티켓 (Admin ↔ PM) ──
  varianceFlag?: VarianceFlag;
  // 편차 확인 영구 이력 — 모든 플래그/답변/해결 기록 (삭제 불가)
  varianceHistory?: VarianceFlagEvent[];
}

// 편차 확인 티켓 — 현재 상태
export type VarianceFlagStatus = 'OPEN' | 'REPLIED' | 'RESOLVED';

export interface VarianceFlag {
  status: VarianceFlagStatus;
  reason: string;                // Admin이 작성한 확인 사유
  flaggedBy: string;             // Admin 이름
  flaggedByUid?: string;
  flaggedAt: string;             // ISO
  pmReply?: string;              // PM 답변
  pmRepliedBy?: string;
  pmRepliedByUid?: string;
  pmRepliedAt?: string;
  resolvedBy?: string;
  resolvedByUid?: string;
  resolvedAt?: string;
}

// 편차 확인 영구 이력 — 한 번 기록되면 삭제/수정 불가
export interface VarianceFlagEvent {
  id: string;
  action: 'FLAG' | 'REPLY' | 'RESOLVE';
  actor: string;                 // 이름
  actorUid?: string;
  content: string;               // 사유 / 답변 / 해결 코멘트
  timestamp: string;             // ISO
}

export interface AuditLog {
  id: string;
  tenantId?: string;
  entityType:
    | 'project'
    | 'ledger'
    | 'transaction'
    | 'evidence'
    | 'comment'
    | 'part_entry'
    | 'part_project'
    | 'employee'
    | 'member'
    | 'system';
  entityId: string;
  action: string;
  userId: string;
  userName: string;
  userRole?: string;
  requestId?: string;
  details: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ── Rollup (집계) ──

export interface CategoryRollup {
  category: CashflowCategory;
  label: string;
  inAmount: number;
  outAmount: number;
  netAmount: number;
  count: number;
}

export interface MonthlyRollup {
  month: string;           // "2026-01"
  totalIn: number;
  totalOut: number;
  totalNet: number;
  totalCount: number;
  byCategory: CategoryRollup[];
}

// ── 경력 프로필 (Career Profile) ──

export type DegreeType = '학사' | '석사' | '박사' | '전문학사' | '수료' | '기타';

export interface EducationEntry {
  id: string;
  school: string;       // 학교명
  major: string;        // 전공
  degree: DegreeType;
  startDate: string;    // YYYY-MM
  endDate: string;      // YYYY-MM or '재학중'
}

export interface WorkHistoryEntry {
  id: string;
  company: string;      // 기업명
  title: string;        // 최종직위
  description: string;  // 담당업무/주요프로젝트
  startDate: string;    // YYYY-MM
  endDate: string;      // YYYY-MM or '현재'
}

export interface CertificationEntry {
  id: string;
  name: string;         // 자격증명
  issuedAt: string;     // YYYY-MM-DD
  issuer: string;       // 발행기관
}

/**
 * 개인 경력 프로필 (Firestore: orgs/{orgId}/careerProfiles/{uid})
 * 참여경력(ParticipationEntry)과 사내교육(TrainingEnrollment)은 별도 컬렉션에서 join
 */
export interface CareerProfile {
  uid: string;
  orgId: string;
  nameKo: string;           // 국문 성명
  nameEn?: string;          // 영문 성명
  nameHanja?: string;       // 한자 성명
  birthDate?: string;       // YYYY-MM-DD
  phone?: string;           // 핸드폰
  officePhone?: string;     // 직장 전화
  department?: string;      // 부서
  title?: string;           // 직책
  joinedAt?: string;        // 입사일 YYYY-MM-DD
  bio?: string;             // 간단 소개
  education: EducationEntry[];
  workHistory: WorkHistoryEntry[];
  certifications: CertificationEntry[];
  updatedAt: string;
}

// ── 사내 강의 (Internal Training) ──

export type TrainingCategory = 'technical' | 'compliance' | 'soft-skills' | 'management' | 'language' | 'other';
export type TrainingStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'COMPLETED';
export type EnrollmentStatus = 'ENROLLED' | 'COMPLETED' | 'DROPPED';

export const TRAINING_CATEGORY_LABELS: Record<TrainingCategory, string> = {
  technical: '직무/기술',
  compliance: '컴플라이언스',
  'soft-skills': '소프트스킬',
  management: '사업관리',
  language: '어학',
  other: '기타',
};

export const TRAINING_STATUS_LABELS: Record<TrainingStatus, string> = {
  DRAFT: '준비중',
  OPEN: '모집중',
  CLOSED: '모집마감',
  COMPLETED: '종료',
};

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  ENROLLED: '수강중',
  COMPLETED: '이수완료',
  DROPPED: '수강취소',
};

/**
 * 사내 강의 (Firestore: orgs/{orgId}/trainingCourses/{courseId})
 */
export interface TrainingCourse {
  id: string;
  orgId: string;
  title: string;
  description: string;
  category: TrainingCategory;
  durationHours: number;      // 수강 시간 (h)
  instructor: string;         // 강사명
  instructorId?: string;      // 내부 강사 uid
  startDate: string;          // YYYY-MM-DD
  endDate: string;            // YYYY-MM-DD
  maxParticipants: number;
  isRequired: boolean;        // 필수 교육 여부
  status: TrainingStatus;
  createdBy: string;          // admin uid
  createdAt: string;
  updatedAt: string;
}

/**
 * 수강 신청/이수 (Firestore: orgs/{orgId}/trainingEnrollments/{id})
 */
export interface TrainingEnrollment {
  id: string;
  courseId: string;
  courseTitle: string;        // denormalized
  memberId: string;
  memberName: string;         // denormalized
  enrolledAt: string;
  status: EnrollmentStatus;
  completedAt?: string;
  certificate?: string;       // 수료증 Storage URL
  notes?: string;
}

// ── 사업비 가이드 Q&A 챗봇 ──

export type GuideStatus = 'CALIBRATING' | 'READY';

export interface GuideMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface GuideDocument {
  id: string;
  tenantId?: string;
  title: string;
  content: string;                    // 원문 전체 텍스트
  sourceType: 'pdf' | 'text' | 'markdown';
  sourceFileName?: string;
  charCount: number;
  status: GuideStatus;
  calibrationMessages: GuideMessage[];  // 캘리브레이션 대화 기록
  calibrationSummary?: string;          // finalize 시 생성된 요약
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface GuideQA {
  id: string;
  tenantId?: string;
  guideId: string;
  question: string;
  answer: string;
  askedBy: string;
  askedByName: string;
  askedByRole: string;
  tokensUsed?: number;
  modelUsed?: string;
  createdAt: string;
}

// ── Filter ──

export interface TransactionFilter {
  dateFrom?: string;
  dateTo?: string;
  direction?: Direction | 'ALL';
  cashflowCategory?: CashflowCategory | 'ALL';
  state?: TransactionState | 'ALL';
  method?: PaymentMethod | 'ALL';
  searchText?: string;
}
