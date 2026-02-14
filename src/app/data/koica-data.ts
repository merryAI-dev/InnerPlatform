// ═══════════════════════════════════════════════════════════════
// KOICA 사업 인력 배치 데이터 (2026년 ver.)
// 실제 MYSC 마스터시트 기반 — 전문가 등급별 자동 계산 지원
// ═══════════════════════════════════════════════════════════════

// ── Grade Types ──

export type CtsGrade = '책임연구원' | '연구원' | '연구보조원' | '보조원';
export type IbsGrade = '1' | '2' | '3' | '4' | '5' | '6';
export type NepalGrade = '4급';

export type ExpertGrade = CtsGrade | IbsGrade | NepalGrade | string;

// ── Settlement calculation type ──
export type CalcType =
  | 'FIXED_RATE'     // CTS 방식: 급수별 고정액 × 투입율 (정액정산)
  | 'ACTUAL_SALARY'  // 실급여 기반
  | 'DAY_RATE'       // 일당 기반 (네팔)
  | 'NO_COST';       // 인건비 없음 (YP 등)

// ── Staff Entry ──

export interface KoicaStaffEntry {
  id: string;
  name: string;
  grade: ExpertGrade;
  role?: string;            // 역할 (PL, 분야별전문가 등)
  unitCost: number;         // 단가 (월급) — 0이면 실급여
  rate: number;             // 투입율 (%)
  monthlyPay: number;       // 배정월급여 = unitCost × rate / 100
  months: number;           // 참여개월수
  total: number;            // 총계 = monthlyPay × months
  calcType: CalcType;
  // Nepal specific
  domesticDays?: number;    // 국내지급일수
  overseasDays?: number;    // 국외지급일수
  note?: string;
}

// ── Grade Config per Project ──

export interface GradeConfig {
  grade: ExpertGrade;
  label: string;
  unitCost: number;         // 0 = 실급여
  isActualSalary: boolean;
}

// ── Project Definition ──

export interface KoicaProject {
  id: string;
  name: string;
  shortName: string;
  period: string;           // e.g. "2023~2026"
  endDate: string;
  calcType: CalcType;
  calcNote: string;         // 정산 방식 설명
  gradeConfigs: GradeConfig[];
  currentStaff: KoicaStaffEntry[];    // 서류 투입 인력 (25년 12월 기준)
  changedStaff: KoicaStaffEntry[];    // 26년 변경 투입 인력
  currentLabel: string;
  changedLabel: string;
  projectTotal?: number;    // 인건비 총계 (있으면)
  notes: string[];
}

// ── Helper: auto-calculate ──

function calcEntry(
  id: string, name: string, grade: ExpertGrade,
  unitCost: number, rate: number, months: number,
  calcType: CalcType = 'FIXED_RATE',
  opts?: { role?: string; domesticDays?: number; overseasDays?: number; total?: number; note?: string }
): KoicaStaffEntry {
  const monthlyPay = calcType === 'FIXED_RATE' ? Math.round(unitCost * rate / 100) : 0;
  const total = opts?.total ?? (calcType === 'FIXED_RATE' ? monthlyPay * months : 0);
  return {
    id, name, grade, unitCost, rate, monthlyPay, months, total, calcType,
    role: opts?.role,
    domesticDays: opts?.domesticDays,
    overseasDays: opts?.overseasDays,
    note: opts?.note,
  };
}

// ═══════════════════════════════════════════════════════════════
// PROJECT DATA
// ═══════════════════════════════════════════════════════════════

export const KOICA_PROJECTS: KoicaProject[] = [
  // ── 1. CTS 2023~2026 ──
  {
    id: 'cts_2326',
    name: '2023~2026 창업·투자 전문기관을 통한 혁신적기술프로그램(CTS) 참여기업 역량강화',
    shortName: 'CTS 2023~2026',
    period: '2023~2026',
    endDate: '2026.05.31',
    calcType: 'FIXED_RATE',
    calcNote: 'CTS는 실인건비 기준 정산이 아니라 RFP에 기재된 급수별 고정액 기준으로 정액정산 (서류상 인건비보다 실인건비가 적어도 관계없음)',
    gradeConfigs: [
      { grade: '책임연구원', label: '책임연구원', unitCost: 6993408, isActualSalary: false },
      { grade: '연구보조원', label: '연구보조원', unitCost: 3584618, isActualSalary: false },
      { grade: '보조원', label: '보조원', unitCost: 2688554, isActualSalary: false },
    ],
    currentLabel: '서류 투입 인력 (25년 12월 기준)',
    changedLabel: '26년 변경 투입 인력',
    currentStaff: [
      calcEntry('cts26_c01', '김정태', '책임연구원', 6993408, 10, 9),
      calcEntry('cts26_c02', '박정호', '책임연구원', 6993408, 15, 9),
      calcEntry('cts26_c03', '민가람', '연구보조원', 3584618, 50, 12),
      calcEntry('cts26_c04', '김혜령', '연구보조원', 3584618, 20, 12),
      calcEntry('cts26_c05', '고인효', '연구보조원', 3584618, 30, 9),
      calcEntry('cts26_c06', '김다은', '연구보조원', 3584618, 30, 9),
      calcEntry('cts26_c07', '김현지', '연구보조원', 3584618, 30, 9),
      calcEntry('cts26_c08', '임종수', '연구보조원', 3584618, 90, 9),
      calcEntry('cts26_c09', '이현미', '연구보조원', 3584618, 90, 9),
      calcEntry('cts26_c10', '김원희', '연구보조원', 3584618, 90, 9),
      calcEntry('cts26_c11', '강민경', '연구보조원', 3584618, 95, 4),
      calcEntry('cts26_c12', '최지윤', '보조원', 2688554, 80, 12),
      calcEntry('cts26_c13', '김민주', '보조원', 2688554, 80, 1),
      calcEntry('cts26_c14', '김영우', '보조원', 2688554, 80, 9),
      calcEntry('cts26_c15', '이준철', '보조원', 2688554, 80, 9),
      calcEntry('cts26_c16', '하윤지', '연구보조원', 3584618, 20, 6),
    ],
    changedStaff: [
      calcEntry('cts26_n01', '김정태', '책임연구원', 6993408, 10, 5),
      calcEntry('cts26_n02', '박정호', '책임연구원', 6993408, 15, 5),
      calcEntry('cts26_n03', '민가람', '연구보조원', 3584618, 50, 5),
      calcEntry('cts26_n04', '김혜령', '연구보조원', 3584618, 20, 5),
      calcEntry('cts26_n05', '고인효', '연구보조원', 3584618, 30, 5),
      calcEntry('cts26_n06', '김다은', '연구보조원', 3584618, 20, 5, 'FIXED_RATE', { note: '투입율 30%→20% 변경' }),
      calcEntry('cts26_n07', '김현지', '연구보조원', 3584618, 30, 5),
      calcEntry('cts26_n08', '임종수', '연구보조원', 3584618, 90, 5),
      calcEntry('cts26_n09', '강민경', '연구보조원', 3584618, 90, 5, 'FIXED_RATE', { note: '이현미 대체' }),
      calcEntry('cts26_n10', '김원희', '연구보조원', 3584618, 90, 5),
      calcEntry('cts26_n11', '최지윤', '보조원', 2688554, 80, 5),
      calcEntry('cts26_n12', '김영우', '보조원', 2688554, 80, 5),
      calcEntry('cts26_n13', '이준철', '보조원', 2688554, 80, 5),
      calcEntry('cts26_n14', '하윤지', '연구보조원', 3584618, 20, 5),
    ],
    notes: [
      'CTS는 실인건비가 아닌 RFP 급수별 고정액 기준 정액정산',
      '2026.05.31 종료',
      '강민경이 이현미를 대체하여 투입',
      '김다은 투입율 30%→20%로 변경',
      '김민주 26년 변경 시 제외',
    ],
  },

  // ── 2. 네팔 귀환 노동자 사업 ──
  {
    id: 'nepal',
    name: '네팔 귀환 노동자 창업 역량강화 사업',
    shortName: '네팔',
    period: '2023~2028',
    endDate: '2028.06',
    calcType: 'DAY_RATE',
    calcNote: '국내/국외 지급일수 기반 정산 (일당 방식)',
    gradeConfigs: [
      { grade: '4급', label: '4급', unitCost: 0, isActualSalary: false },
    ],
    currentLabel: '서류 투입 인력 (25년 12월 기준)',
    changedLabel: '변경 투입 인력',
    currentStaff: [
      calcEntry('nepal_c01', '장은희', '4급', 0, 0, 0, 'DAY_RATE', {
        role: '창업기금(PL) - 주요', domesticDays: 319, overseasDays: 110, total: 98670000,
      }),
      calcEntry('nepal_c02', '변준재', '4급', 0, 0, 0, 'DAY_RATE', {
        role: '분야별전문가 - 일반', domesticDays: 168, overseasDays: 110, total: 63940000,
      }),
    ],
    changedStaff: [],
    notes: [
      '국내/국외 지급일수 기반 정산',
      '변경 투입 인력 없음 (현행 유지)',
    ],
  },

  // ── 3. YK IBS ──
  {
    id: 'yk_ibs',
    name: '동남아시아 기후환경 스타트업 ESG투자 사업',
    shortName: 'YK IBS',
    period: '2022.12~2027.12',
    endDate: '2027.12',
    calcType: 'FIXED_RATE',
    calcNote: '2급/3급은 고정 단가, 4급/5급은 실급여 기준',
    gradeConfigs: [
      { grade: '2', label: '2급', unitCost: 6600000, isActualSalary: false },
      { grade: '3', label: '3급', unitCost: 5280000, isActualSalary: false },
      { grade: '4', label: '4급', unitCost: 0, isActualSalary: true },
      { grade: '5', label: '5급', unitCost: 0, isActualSalary: true },
    ],
    currentLabel: '서류 투입 인력 (25년 12월 기준)',
    changedLabel: '변경 투입 인력',
    projectTotal: 136752000,
    currentStaff: [
      calcEntry('yk_c01', '박정호', '2', 6600000, 30, 12),
      calcEntry('yk_c02', '김정태', '2', 6600000, 30, 12),
      calcEntry('yk_c03', '이예지', '3', 5280000, 25, 12),
      calcEntry('yk_c04', '윤지수', '4', 0, 35, 12, 'ACTUAL_SALARY'),
      calcEntry('yk_c05', '고인효', '4', 0, 20, 12, 'ACTUAL_SALARY'),
      calcEntry('yk_c06', '김선미', '4', 0, 30, 12, 'ACTUAL_SALARY'),
      calcEntry('yk_c07', '김다은', '5', 0, 30, 12, 'ACTUAL_SALARY'),
      calcEntry('yk_c08', '김혜령', '5', 0, 20, 12, 'ACTUAL_SALARY'),
    ],
    changedStaff: [
      calcEntry('yk_n01', '윤지수', '4', 0, 50, 12, 'ACTUAL_SALARY', { note: '투입율 35%→50% 변경' }),
    ],
    notes: [
      '2급/3급: 고정 단가 기준 정산',
      '4급/5급: 실급여 기준 정산',
      '윤지수 투입율 35%→50% 변경',
    ],
  },

  // ── 4. JLIN IBS ──
  {
    id: 'jlin_ibs',
    name: '혼합금융 기반 동남아 임팩트 생태계 조성 및 스케일업 투자 사업',
    shortName: 'JLIN IBS',
    period: '2025.01~2029.12',
    endDate: '2029.12',
    calcType: 'FIXED_RATE',
    calcNote: '2급/3급은 고정 단가, 4급/5급은 실급여 기준',
    gradeConfigs: [
      { grade: '2', label: '2급', unitCost: 6820000, isActualSalary: false },
      { grade: '3', label: '3급', unitCost: 5280000, isActualSalary: false },
      { grade: '4', label: '4급', unitCost: 0, isActualSalary: true },
      { grade: '5', label: '5급', unitCost: 0, isActualSalary: true },
    ],
    currentLabel: '서류 투입 인력 (25년 12월 기준)',
    changedLabel: '변경 투입 인력',
    projectTotal: 135080000,
    currentStaff: [
      calcEntry('jlin_c01', '김정태', '2', 6820000, 10, 12),
      calcEntry('jlin_c02', '박정호', '2', 6820000, 10, 12),
      calcEntry('jlin_c03', '이예지', '3', 5280000, 20, 12),
      calcEntry('jlin_c04', '고인효', '4', 0, 35, 12, 'ACTUAL_SALARY'),
      calcEntry('jlin_c05', '김다은', '5', 0, 30, 12, 'ACTUAL_SALARY'),
      calcEntry('jlin_c06', '김혜령', '5', 0, 40, 12, 'ACTUAL_SALARY'),
      calcEntry('jlin_c07', '김현지', '5', 0, 40, 12, 'ACTUAL_SALARY'),
      calcEntry('jlin_c08', '신예진', '5', 0, 50, 12, 'ACTUAL_SALARY'),
      calcEntry('jlin_c09', '김민주(만두)', '5', 0, 80, 12, 'ACTUAL_SALARY'),
      calcEntry('jlin_c10', '이현미', '2', 0, 10, 12, 'ACTUAL_SALARY'),
    ],
    changedStaff: [
      calcEntry('jlin_n01', '고혜림', '2', 0, 10, 12, 'ACTUAL_SALARY', { note: '이현미 대체' }),
    ],
    notes: [
      '2급: 6,820,000원 고정 단가',
      '3급: 5,280,000원 고정 단가',
      '4급/5급: 실급여 기준',
      '고혜림이 이현미를 대체',
    ],
  },

  // ── 5. AP IBS ──
  {
    id: 'ap_ibs',
    name: '인도네시아 및 인도 임팩트 펀드 결성 및 소셜벤처 투자 사업',
    shortName: 'AP IBS',
    period: '2025.08~2029.12',
    endDate: '2029.12',
    calcType: 'FIXED_RATE',
    calcNote: '2급 고정 단가(6,820,000), 나머지는 실급여 기준',
    gradeConfigs: [
      { grade: '2', label: '2급', unitCost: 6820000, isActualSalary: false },
      { grade: '3', label: '3급', unitCost: 0, isActualSalary: true },
      { grade: '4', label: '4급', unitCost: 0, isActualSalary: true },
      { grade: '5', label: '5급', unitCost: 0, isActualSalary: true },
      { grade: '6', label: '6급', unitCost: 0, isActualSalary: true },
    ],
    currentLabel: '서류 투입 인력 (25년 12월 기준)',
    changedLabel: '변경 투입 인력 (26년 1월 기준)',
    projectTotal: 144192390,
    currentStaff: [
      calcEntry('ap_c01', '박정호', '2', 6820000, 20, 5),
      calcEntry('ap_c02', '김정태', '2', 6820000, 10, 5),
      calcEntry('ap_c03', '최유진', '3', 0, 35, 5, 'ACTUAL_SALARY'),
      calcEntry('ap_c04', '정지연', '2', 0, 25, 5, 'ACTUAL_SALARY'),
      calcEntry('ap_c05', '하윤지', '3', 0, 15, 5, 'ACTUAL_SALARY'),
      calcEntry('ap_c06', '이정선', '2', 0, 25, 5, 'ACTUAL_SALARY'),
      calcEntry('ap_c07', '이승연', '5', 0, 35, 5, 'ACTUAL_SALARY'),
      calcEntry('ap_c08', '박연주', '5', 0, 55, 5, 'ACTUAL_SALARY'),
      calcEntry('ap_c09', '윤지수', '4', 0, 30, 5, 'ACTUAL_SALARY'),
      calcEntry('ap_c10', '강현주', '5', 0, 55, 5, 'ACTUAL_SALARY'),
    ],
    changedStaff: [
      calcEntry('ap_n01', '박정호', '2', 0, 20, 12, 'ACTUAL_SALARY'),
      calcEntry('ap_n02', '김정태', '2', 0, 10, 12, 'ACTUAL_SALARY'),
      calcEntry('ap_n03', '최유진', '4', 0, 35, 12, 'ACTUAL_SALARY', { note: '등급 3→4 변경' }),
      calcEntry('ap_n04', '정지연', '2', 0, 25, 12, 'ACTUAL_SALARY'),
      calcEntry('ap_n05', '강혜진', '3', 0, 20, 12, 'ACTUAL_SALARY', { note: '하윤지 대체' }),
      calcEntry('ap_n06', '이정선', '2', 0, 25, 12, 'ACTUAL_SALARY'),
      calcEntry('ap_n07', '이승연', '5', 0, 35, 12, 'ACTUAL_SALARY'),
      calcEntry('ap_n08', '박연주', '6', 0, 55, 12, 'ACTUAL_SALARY', { note: '등급 5→6 변경' }),
      calcEntry('ap_n09', '윤지수', '4', 0, 30, 12, 'ACTUAL_SALARY'),
      calcEntry('ap_n10', '조아름', '5', 0, 10, 12, 'NO_COST', { note: '급여 없음 (급여x)' }),
    ],
    notes: [
      '2급: 6,820,000원 고정 단가 (현행)',
      '변경 후 대부분 실급여 기준으로 전환',
      '최유진 등급 3→4 변경',
      '박연주 등급 5→6 변경',
      '강혜진이 하윤지를 대체',
      '조아름: 급여 없음(급여x)',
    ],
  },

  // ── 6. Seed 0 ──
  {
    id: 'seed0',
    name: '2025-2026 CTS Seed 0 ODA 혁신기술 시장조사 및 창업초기기업 액셀러레이팅 운영 용역',
    shortName: 'Seed 0',
    period: '2025.08~2029.12',
    endDate: '2029.12',
    calcType: 'FIXED_RATE',
    calcNote: 'CTS 방식 — 급수별 고정액 기준 정액정산',
    gradeConfigs: [
      { grade: '책임연구원', label: '책임연구원', unitCost: 10705945, isActualSalary: false },
      { grade: '연구원', label: '연구원', unitCost: 8209176, isActualSalary: false },
      { grade: '연구보조원', label: '연구보조원', unitCost: 5487557, isActualSalary: false },
      { grade: '보조원', label: '보조원', unitCost: 4115806, isActualSalary: false },
    ],
    currentLabel: '서류 투입 인력 (25년 12월 기준) — 예산상 26년 1월부터 적용',
    changedLabel: '변경 투입 인력',
    currentStaff: [
      calcEntry('seed_c01', '강신일', '책임연구원', 10705945, 70, 10),
      calcEntry('seed_c02', '최종옥', '연구원', 8209176, 75, 10),
      calcEntry('seed_c03', '김선미', '연구보조원', 5487557, 70, 8),
      calcEntry('seed_c04', '변민욱', '연구보조원', 5487557, 70, 8),
      calcEntry('seed_c05', '(신���)', '연구보조원', 5487557, 70, 10, 'FIXED_RATE', { note: '신규 추가 필요' }),
      calcEntry('seed_c06', '남건욱', '보조원', 4115806, 75, 10, 'FIXED_RATE', { note: '변경 필요' }),
      calcEntry('seed_c07', '(신규)', '보조원', 4115806, 75, 10, 'FIXED_RATE', { note: '신규 추가 필요' }),
      calcEntry('seed_c08', '김민주(코지)', '보조원', 0, 0, 0, 'NO_COST', { note: 'YP라 인건비 지원 없음' }),
    ],
    changedStaff: [],
    notes: [
      'CTS 방식 — 급수별 고정액 기준 정액정산',
      '예산상 26년 1월부터 적용',
      '신규 연구보조원 1명 추가 필요',
      '남건욱 변경 필요',
      '신규 보조원 1명 추가 필요',
      '김민주(코지): YP로 인건비 지원 없음',
    ],
  },

  // ── 7. CTS 2025~2028 ──
  {
    id: 'cts_2528',
    name: '2025~2028 창업·투자 전문기관을 통한 혁신적기술프로그램(CTS) 참여기업 역량강화',
    shortName: 'CTS 2025~2028',
    period: '2025.10~2028.12',
    endDate: '2028.12',
    calcType: 'FIXED_RATE',
    calcNote: 'CTS 방식 — 급수별 고정액 기준 정액정산',
    gradeConfigs: [
      { grade: '책임연구원', label: '책임연구원', unitCost: 7411808, isActualSalary: false },
      { grade: '연구원', label: '연구원', unitCost: 5683276, isActualSalary: false },
      { grade: '연구보조원', label: '연구보조원', unitCost: 3799078, isActualSalary: false },
      { grade: '보조원', label: '보조원', unitCost: 2849404, isActualSalary: false },
    ],
    currentLabel: '서류 투입 인력 (25년 12월 기준)',
    changedLabel: '변경 투입 인력',
    currentStaff: [
      calcEntry('cts28_c01', '김정태', '책임연구원', 7411808, 20, 12),
      calcEntry('cts28_c02', '이예지', '연구원', 5683276, 50, 12),
      calcEntry('cts28_c03', '김원희', '연구보조원', 3799078, 80, 12),
      calcEntry('cts28_c04', '양인영', '연구보조원', 3799078, 80, 12),
      calcEntry('cts28_c05', '김예빈', '연구보조원', 3799078, 80, 12),
      calcEntry('cts28_c06', '이시은', '연구보조원', 3799078, 80, 12),
      calcEntry('cts28_c07', '최상배', '보조원', 2849404, 80, 12),
    ],
    changedStaff: [
      calcEntry('cts28_n01', '김정태', '책임연구원', 7411808, 20, 12),
      calcEntry('cts28_n02', '노성진', '연구원', 5683276, 50, 12, 'FIXED_RATE', { note: '이예지 대체' }),
      calcEntry('cts28_n03', '김원희', '연구보조원', 3799078, 80, 1, 'FIXED_RATE', { note: '12개월→1개월' }),
      calcEntry('cts28_n04', '양인영', '연구보조원', 3799078, 90, 12, 'FIXED_RATE', { note: '투입율 80%→90%' }),
      calcEntry('cts28_n05', '김예빈', '연구보조원', 3799078, 80, 12),
      calcEntry('cts28_n06', '이시은', '연구보조원', 3799078, 90, 12, 'FIXED_RATE', { note: '투입율 80%→90%' }),
      calcEntry('cts28_n07', '김현지', '연구보조원', 3799078, 30, 11, 'FIXED_RATE', { note: '신규 추가' }),
      calcEntry('cts28_n08', '강민경', '연구보조원', 3799078, 10, 11, 'FIXED_RATE', { note: '신규 추가' }),
      calcEntry('cts28_n09', '최지윤', '연구보조원', 3799078, 20, 11, 'FIXED_RATE', { note: '신규 추가 (보조원→연구보조원)' }),
      calcEntry('cts28_n10', '최상배', '보조원', 2849404, 80, 12),
      calcEntry('cts28_n11', '이예지', '연구원', 0, 0, 0, 'NO_COST', { note: '제외 (노성진으로 대체)' }),
    ],
    notes: [
      'CTS 방식 — 급수별 고정액 기준 정액정산',
      '노성진이 이예지를 대체',
      '김원희 12개월→1개월로 대폭 축소',
      '양인영/이시은 투입율 80%→90% 증가',
      '김현지/강민경/최지윤 신규 추가',
    ],
  },
];

// ── Utility functions ──

/** 단가 포맷 */
export function formatKRW(amount: number): string {
  if (amount === 0) return '-';
  return amount.toLocaleString('ko-KR');
}

/** 자동 계산: 단가 × 투입율 = 배정월급여 */
export function calcMonthlyPay(unitCost: number, rate: number): number {
  return Math.round(unitCost * rate / 100);
}

/** 자동 계산: 배정월급여 × 참여개월수 = 총계 */
export function calcTotal(monthlyPay: number, months: number): number {
  return monthlyPay * months;
}

/** 등급별 집계 */
export interface GradeSummary {
  grade: string;
  label: string;
  unitCost: number;
  staffCount: number;
  totalRate: number;
  totalMonthlyPay: number;
  totalAmount: number;
  isActualSalary: boolean;
}

export function computeGradeSummary(staff: KoicaStaffEntry[], gradeConfigs: GradeConfig[]): GradeSummary[] {
  const map = new Map<string, GradeSummary>();

  for (const gc of gradeConfigs) {
    map.set(gc.grade, {
      grade: gc.grade,
      label: gc.label,
      unitCost: gc.unitCost,
      staffCount: 0,
      totalRate: 0,
      totalMonthlyPay: 0,
      totalAmount: 0,
      isActualSalary: gc.isActualSalary,
    });
  }

  for (const s of staff) {
    if (s.calcType === 'NO_COST') continue;
    let summary = map.get(s.grade);
    if (!summary) {
      summary = {
        grade: s.grade, label: s.grade, unitCost: s.unitCost,
        staffCount: 0, totalRate: 0, totalMonthlyPay: 0, totalAmount: 0,
        isActualSalary: s.calcType === 'ACTUAL_SALARY',
      };
      map.set(s.grade, summary);
    }
    summary.staffCount++;
    summary.totalRate += s.rate;
    summary.totalMonthlyPay += s.monthlyPay;
    summary.totalAmount += s.total;
  }

  return Array.from(map.values()).filter(s => s.staffCount > 0);
}

/** 변경 사항 비교 */
export interface StaffDiff {
  name: string;
  type: 'added' | 'removed' | 'changed' | 'unchanged';
  changes: string[];
  currentEntry?: KoicaStaffEntry;
  changedEntry?: KoicaStaffEntry;
}

export function computeStaffDiff(current: KoicaStaffEntry[], changed: KoicaStaffEntry[]): StaffDiff[] {
  const diffs: StaffDiff[] = [];
  const changedNames = new Set(changed.map(s => s.name));
  const currentNames = new Set(current.map(s => s.name));

  // Check each current member
  for (const c of current) {
    const ch = changed.find(s => s.name === c.name);
    if (!ch) {
      diffs.push({ name: c.name, type: 'removed', changes: ['26년 변경에서 제외'], currentEntry: c });
    } else {
      const changes: string[] = [];
      if (c.grade !== ch.grade) changes.push(`등급: ${c.grade} → ${ch.grade}`);
      if (c.rate !== ch.rate) changes.push(`투입율: ${c.rate}% → ${ch.rate}%`);
      if (c.months !== ch.months) changes.push(`개월수: ${c.months} → ${ch.months}`);
      if (c.unitCost !== ch.unitCost && ch.unitCost > 0) changes.push(`단가 변경`);
      if (ch.note) changes.push(ch.note);
      diffs.push({
        name: c.name,
        type: changes.length > 0 ? 'changed' : 'unchanged',
        changes, currentEntry: c, changedEntry: ch,
      });
    }
  }

  // Check new members
  for (const ch of changed) {
    if (!currentNames.has(ch.name)) {
      diffs.push({
        name: ch.name, type: 'added',
        changes: [ch.note || '신규 투입'], changedEntry: ch,
      });
    }
  }

  return diffs;
}

// ── Cross-project person summary ──

export interface PersonProjectSummary {
  name: string;
  projects: {
    projectId: string;
    projectShortName: string;
    grade: ExpertGrade;
    currentRate: number;
    changedRate: number;
    currentMonths: number;
    changedMonths: number;
    currentTotal: number;
    changedTotal: number;
  }[];
  totalCurrentRate: number;
  totalChangedRate: number;
  totalCurrentAmount: number;
  totalChangedAmount: number;
}

export function computePersonSummary(): PersonProjectSummary[] {
  const map = new Map<string, PersonProjectSummary>();

  for (const proj of KOICA_PROJECTS) {
    // Current
    for (const s of proj.currentStaff) {
      if (s.calcType === 'NO_COST') continue;
      let person = map.get(s.name);
      if (!person) {
        person = { name: s.name, projects: [], totalCurrentRate: 0, totalChangedRate: 0, totalCurrentAmount: 0, totalChangedAmount: 0 };
        map.set(s.name, person);
      }
      let existing = person.projects.find(p => p.projectId === proj.id);
      if (!existing) {
        existing = {
          projectId: proj.id, projectShortName: proj.shortName,
          grade: s.grade, currentRate: 0, changedRate: 0,
          currentMonths: 0, changedMonths: 0, currentTotal: 0, changedTotal: 0,
        };
        person.projects.push(existing);
      }
      existing.currentRate = s.rate;
      existing.currentMonths = s.months;
      existing.currentTotal = s.total;
      existing.grade = s.grade;
    }

    // Changed
    for (const s of proj.changedStaff) {
      if (s.calcType === 'NO_COST') continue;
      let person = map.get(s.name);
      if (!person) {
        person = { name: s.name, projects: [], totalCurrentRate: 0, totalChangedRate: 0, totalCurrentAmount: 0, totalChangedAmount: 0 };
        map.set(s.name, person);
      }
      let existing = person.projects.find(p => p.projectId === proj.id);
      if (!existing) {
        existing = {
          projectId: proj.id, projectShortName: proj.shortName,
          grade: s.grade, currentRate: 0, changedRate: 0,
          currentMonths: 0, changedMonths: 0, currentTotal: 0, changedTotal: 0,
        };
        person.projects.push(existing);
      }
      existing.changedRate = s.rate;
      existing.changedMonths = s.months;
      existing.changedTotal = s.total;
      if (s.grade) existing.grade = s.grade;
    }
  }

  // Compute totals
  for (const person of map.values()) {
    person.totalCurrentRate = person.projects.reduce((s, p) => s + p.currentRate, 0);
    person.totalChangedRate = person.projects.reduce((s, p) => s + (p.changedRate || p.currentRate), 0);
    person.totalCurrentAmount = person.projects.reduce((s, p) => s + p.currentTotal, 0);
    person.totalChangedAmount = person.projects.reduce((s, p) => s + (p.changedTotal || p.currentTotal), 0);
  }

  return Array.from(map.values()).sort((a, b) => b.totalCurrentRate - a.totalCurrentRate);
}
