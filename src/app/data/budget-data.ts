// ═══════════════════════════════════════════════════════════════
// MYSC 사업비 관리 통합 플랫폼 — 예산총괄 & 사업비 관리 Mock Data
// 구글시트 "1.예산총괄시트" 기반 재현
// ═══════════════════════════════════════════════════════════════

// ── 예산총괄 행 타입 ──

export type BudgetRowType = 'ITEM' | 'SUBTOTAL' | 'TOTAL';
export type BudgetFixType = 'FIXED' | 'ADJUSTABLE' | 'NONE';

export interface BudgetRow {
  id: string;
  projectId: string;
  category: string;        // 사업비 구분
  budgetCode: string;      // 비목
  subCode: string;         // 세목
  calcDesc: string;        // 산정 내역
  initialBudget: number;   // 최초 승인 예산
  lastYearBudget: number;  // (추후삭제) 지난해 예산
  comparison: string;      // 비교
  revisedAug: number;      // 변경 예산(8월말)
  revisedOct: number;      // 변경 예산(10월중순)
  planAmount: number;      // 사용계획서 상
  composition: number;     // 구성비 (소수점)
  spent: number;           // 소진금액
  vatPurchase: number;     // 매입부가세(공급가액인 경우)
  burnRate: number;        // 소진율 (소수점)
  balance: number;         // 잔액(예산-소진)
  balanceOct: number;      // 잔액(10월중순 변경 전제)
  note: string;            // 특이사항
  rowType: BudgetRowType;
  fixType: BudgetFixType;
  groupId?: string;        // 소속 그룹(소계 연결)
  order: number;
}

// ── 통장/카드 정보 (보안) ──

export interface BankInfo {
  label: string;
  value: string;
  masked: string;
  type: 'ACCOUNT' | 'CARD' | 'PIN' | 'CVC';
}

// ── 거래 타임라인 이벤트 ──

export interface BudgetTimelineEvent {
  id: string;
  projectId: string;
  date: string;
  content: string;
  amount?: number;
  direction?: 'IN' | 'OUT';
  tag?: string;
}

// ── 예산 보조 테이블 행 ──

export interface BudgetAuxRow {
  label: string;
  amount: number;
  ratio: number;
}

// ── 사업비 관리 세트 (Expense Set) ──

export type ExpenseSetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface ExpenseItem {
  id: string;
  setId: string;
  date: string;
  budgetCode: string;      // 비목
  subCode: string;         // 세목
  vendor: string;          // 거래처
  description: string;     // 적요/내용
  amountNet: number;       // 공급가액
  vat: number;             // 부가세
  amountGross: number;     // 공급대가
  paymentMethod: 'BANK_TRANSFER' | 'CARD' | 'CASH';
  evidenceStatus: 'MISSING' | 'PARTIAL' | 'COMPLETE';
  evidenceFiles: string[];
  note: string;
}

export interface ExpenseSet {
  id: string;
  projectId: string;
  ledgerId: string;
  title: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  status: ExpenseSetStatus;
  period: string;          // "2024-11" 등
  items: ExpenseItem[];
  totalNet: number;
  totalVat: number;
  totalGross: number;
  submittedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// P-2024-HAE: "2024 해양수산 AC" 예산총괄 데이터
// ═══════════════════════════════════════════════════════════════

export const BUDGET_META = {
  projectId: 'p001-hae',
  projectName: '2024 해양수산 AC',
  year: 2024,
  funder: '해양수산부',
  basis: '공급가액' as const,
  basisOption: '(공급대가 선택 가능)',
  lastUpdated: '2024.11.05',
  updatedBy: '람쥐',
  totalBudget: 260000000,
  guide: {
    fixedLabel: '못 빼는 돌(고정)',
    fixedColor: 'blue',
    adjustableLabel: '조정 가능한 큰 돌',
    adjustableColor: 'red',
  },
};

export const BANK_INFO: BankInfo[] = [
  { label: '사업비 통장(국민)', value: '123-45-678906', masked: '국민 ***-**-*****6', type: 'ACCOUNT' },
  { label: '법인카드', value: '5205-1234-5678-0938', masked: '5205-****-****-0938', type: 'CARD' },
  { label: '카드 비밀번호', value: '1234', masked: '••••', type: 'PIN' },
  { label: 'CVC', value: '123', masked: '•••', type: 'CVC' },
];

export const BUDGET_ROWS: BudgetRow[] = [
  // ── 소계1: MYSC 인건비 ──
  {
    id: 'br001',
    projectId: 'p001-hae',
    category: 'MYSC 인건비',
    budgetCode: '1. 인건비',
    subCode: '1.1 참여인력',
    calcDesc: '',
    initialBudget: 35512000,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 35512000,
    revisedOct: 35512000,
    planAmount: 0,
    composition: 0.1366,
    spent: 0,
    vatPurchase: 0,
    burnRate: 0,
    balance: 35512000,
    balanceOct: 35512000,
    note: '35,512,000',
    rowType: 'ITEM',
    fixType: 'FIXED',
    groupId: 'g1',
    order: 1,
  },
  {
    id: 'br-sub1',
    projectId: 'p001-hae',
    category: '',
    budgetCode: '',
    subCode: '',
    calcDesc: '',
    initialBudget: 35512000,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 35512000,
    revisedOct: 35512000,
    planAmount: 0,
    composition: 0.1366,
    spent: 0,
    vatPurchase: 0,
    burnRate: 0,
    balance: 35512000,
    balanceOct: 35512000,
    note: '',
    rowType: 'SUBTOTAL',
    fixType: 'NONE',
    groupId: 'g1',
    order: 2,
  },

  // ── 소계2: 직접사업비 (프로그램 운영비) ──
  {
    id: 'br002',
    projectId: 'p001-hae',
    category: '직접사업비',
    budgetCode: '2. 프로그램 운영비',
    subCode: '2.1 전문가 활용비',
    calcDesc: '멘토/강사',
    initialBudget: 50000000,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 50000000,
    revisedOct: 50000000,
    planAmount: 0,
    composition: 0.1923,
    spent: 12500000,
    vatPurchase: 0,
    burnRate: 0.25,
    balance: 37500000,
    balanceOct: 37500000,
    note: '',
    rowType: 'ITEM',
    fixType: 'NONE',
    groupId: 'g2',
    order: 3,
  },
  {
    id: 'br003',
    projectId: 'p001-hae',
    category: '직접사업비',
    budgetCode: '2. 프로그램 운영비',
    subCode: '2.2 위탁용역비',
    calcDesc: 'IR디자인/데모데이',
    initialBudget: 60000000,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 60000000,
    revisedOct: 60000000,
    planAmount: 0,
    composition: 0.2308,
    spent: 18900000,
    vatPurchase: 1717000,
    burnRate: 0.315,
    balance: 41100000,
    balanceOct: 41100000,
    note: 'IR디자인 6만원*15장*3개기업=135만원(잔금) / 통합데모데이 예상비용 약 1,500만원',
    rowType: 'ITEM',
    fixType: 'ADJUSTABLE',
    groupId: 'g2',
    order: 4,
  },
  {
    id: 'br004',
    projectId: 'p001-hae',
    category: '직접사업비',
    budgetCode: '',
    subCode: '2.3 기타운영비',
    calcDesc: '',
    initialBudget: 20000000,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 20000000,
    revisedOct: 20000000,
    planAmount: 0,
    composition: 0.0769,
    spent: 3200000,
    vatPurchase: 0,
    burnRate: 0.16,
    balance: 16800000,
    balanceOct: 16800000,
    note: '전용',
    rowType: 'ITEM',
    fixType: 'NONE',
    groupId: 'g2',
    order: 5,
  },
  {
    id: 'br005',
    projectId: 'p001-hae',
    category: 'MYSC 수익',
    budgetCode: '',
    subCode: '2.4 오피스아워',
    calcDesc: '',
    initialBudget: 0,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 0,
    revisedOct: 0,
    planAmount: 0,
    composition: 0,
    spent: 0,
    vatPurchase: 0,
    burnRate: 0,
    balance: 0,
    balanceOct: 0,
    note: '*공급대가정산인데 매입부가세 발생 시 수익이지만 우선 제외',
    rowType: 'ITEM',
    fixType: 'NONE',
    groupId: 'g2',
    order: 6,
  },
  {
    id: 'br-sub2',
    projectId: 'p001-hae',
    category: '',
    budgetCode: '',
    subCode: '',
    calcDesc: '',
    initialBudget: 130000000,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 130000000,
    revisedOct: 130000000,
    planAmount: 0,
    composition: 0.5000,
    spent: 34600000,
    vatPurchase: 1717000,
    burnRate: 0.2662,
    balance: 95400000,
    balanceOct: 95400000,
    note: '',
    rowType: 'SUBTOTAL',
    fixType: 'NONE',
    groupId: 'g2',
    order: 7,
  },

  // ── 소계3: 업무추진비 ──
  {
    id: 'br006',
    projectId: 'p001-hae',
    category: '직접사업비',
    budgetCode: '3. 업무 추진비',
    subCode: '3.2 회의비',
    calcDesc: '',
    initialBudget: 14488000,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 14488000,
    revisedOct: 14488000,
    planAmount: 0,
    composition: 0.0557,
    spent: 1185000,
    vatPurchase: 107728,
    burnRate: 0.082,
    balance: 13303000,
    balanceOct: 13303000,
    note: 'VAT 포함이었다니! (대략) 1,077,272원',
    rowType: 'ITEM',
    fixType: 'NONE',
    groupId: 'g3',
    order: 8,
  },
  {
    id: 'br-sub3',
    projectId: 'p001-hae',
    category: '',
    budgetCode: '',
    subCode: '',
    calcDesc: '',
    initialBudget: 14488000,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 14488000,
    revisedOct: 14488000,
    planAmount: 0,
    composition: 0.0557,
    spent: 1185000,
    vatPurchase: 107728,
    burnRate: 0.082,
    balance: 13303000,
    balanceOct: 13303000,
    note: '',
    rowType: 'SUBTOTAL',
    fixType: 'NONE',
    groupId: 'g3',
    order: 9,
  },

  // ── 소계4: 팀지원금 ──
  {
    id: 'br007',
    projectId: 'p001-hae',
    category: '직접사업비',
    budgetCode: '4. 팀지원금',
    subCode: '4. 팀지원금',
    calcDesc: '',
    initialBudget: 80000000,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 80000000,
    revisedOct: 80000000,
    planAmount: 0,
    composition: 0.3077,
    spent: 0,
    vatPurchase: 0,
    burnRate: 0,
    balance: 80000000,
    balanceOct: 80000000,
    note: '',
    rowType: 'ITEM',
    fixType: 'ADJUSTABLE',
    groupId: 'g4',
    order: 10,
  },
  {
    id: 'br-sub4',
    projectId: 'p001-hae',
    category: '',
    budgetCode: '',
    subCode: '',
    calcDesc: '',
    initialBudget: 80000000,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 80000000,
    revisedOct: 80000000,
    planAmount: 0,
    composition: 0.3077,
    spent: 0,
    vatPurchase: 0,
    burnRate: 0,
    balance: 80000000,
    balanceOct: 80000000,
    note: '',
    rowType: 'SUBTOTAL',
    fixType: 'NONE',
    groupId: 'g4',
    order: 11,
  },

  // ── 총계 ──
  {
    id: 'br-total',
    projectId: 'p001-hae',
    category: '',
    budgetCode: '',
    subCode: '',
    calcDesc: '',
    initialBudget: 260000000,
    lastYearBudget: 0,
    comparison: '',
    revisedAug: 260000000,
    revisedOct: 260000000,
    planAmount: 0,
    composition: 1.0,
    spent: 35785000,
    vatPurchase: 1824728,
    burnRate: 0.1376,
    balance: 224215000,
    balanceOct: 224215000,
    note: '',
    rowType: 'TOTAL',
    fixType: 'NONE',
    order: 12,
  },
];

// ── 예산 하단 보조 테이블 ──

export const BUDGET_AUX_ROWS: BudgetAuxRow[] = [
  { label: '자부담액', amount: 0, ratio: 0 },
  { label: 'MYSC 인건비', amount: 35512000, ratio: 0.1366 },
  { label: '(A) 인건비&수익', amount: 35512000, ratio: 0.1366 },
];

// ── 거래 타임라인 ──

export const BUDGET_TIMELINE: BudgetTimelineEvent[] = [
  { id: 'bt001', projectId: 'p001-hae', date: '2024-11-27', content: '통장잔액 확인', amount: 224215000, tag: '잔액' },
  { id: 'bt002', projectId: 'p001-hae', date: '2024-11-28', content: '11월 부가세 환급 입금', amount: 444090, direction: 'IN', tag: 'VAT' },
  { id: 'bt003', projectId: 'p001-hae', date: '2024-11-28', content: '회계법인 지출', amount: 1185000, direction: 'OUT', tag: '회의비' },
  { id: 'bt004', projectId: 'p001-hae', date: '2024-12-05', content: '회계법인 부가세 환입', amount: 107728, direction: 'IN', tag: 'VAT' },
  { id: 'bt005', projectId: 'p001-hae', date: '2024-12-05', content: '기타 미리환급', amount: 250000, direction: 'IN', tag: 'VAT' },
  { id: 'bt006', projectId: 'p001-hae', date: '2024-12-10', content: '별도지출(운영비계좌) 메모', tag: '메모' },
];

// ═══════════════════════════════════════════════════════════════
// 사업비 관리 세트 (Expense Sets) — Mock Data
// 관리자가 아닌 일반 회원들이 생성 가능
// ═══════════════════════════════════════════════════════════════

export const EXPENSE_SETS: ExpenseSet[] = [
  {
    id: 'es001',
    projectId: 'p001',
    ledgerId: 'l001',
    title: '2025년 1월 사업비 정산',
    createdBy: 'u002',
    createdByName: '데이나',
    createdAt: '2025-01-20T09:00:00Z',
    updatedAt: '2025-01-25T14:00:00Z',
    status: 'APPROVED',
    period: '2025-01',
    totalNet: 8500000,
    totalVat: 772727,
    totalGross: 9272727,
    submittedAt: '2025-01-22T10:00:00Z',
    approvedBy: 'u001',
    approvedAt: '2025-01-25T14:00:00Z',
    items: [
      {
        id: 'ei001',
        setId: 'es001',
        date: '2025-01-10',
        budgetCode: '2. 프로그램 운영비',
        subCode: '2.1 전문가 활용비',
        vendor: '김전문가',
        description: '멘토링 자문료 (1차)',
        amountNet: 3000000,
        vat: 272727,
        amountGross: 3272727,
        paymentMethod: 'BANK_TRANSFER',
        evidenceStatus: 'COMPLETE',
        evidenceFiles: ['세금계산서_멘토링1차.pdf'],
        note: '',
      },
      {
        id: 'ei002',
        setId: 'es001',
        date: '2025-01-15',
        budgetCode: '2. 프로그램 운영비',
        subCode: '2.2 위탁용역비',
        vendor: 'IR디자인스튜디오',
        description: 'IR자료 디자인 (3개 기업)',
        amountNet: 4000000,
        vat: 363636,
        amountGross: 4363636,
        paymentMethod: 'BANK_TRANSFER',
        evidenceStatus: 'COMPLETE',
        evidenceFiles: ['세금계산서_IR디자인.pdf', '납품확인서.pdf'],
        note: 'IR디자인 6만원*15장*3개기업',
      },
      {
        id: 'ei003',
        setId: 'es001',
        date: '2025-01-18',
        budgetCode: '3. 업무 추진비',
        subCode: '3.2 회의비',
        vendor: '카페 오피스',
        description: '참여기업 미팅 (1월 3회)',
        amountNet: 1500000,
        vat: 136364,
        amountGross: 1636364,
        paymentMethod: 'CARD',
        evidenceStatus: 'COMPLETE',
        evidenceFiles: ['카드영수증_0118.pdf'],
        note: '',
      },
    ],
  },
  {
    id: 'es002',
    projectId: 'p001',
    ledgerId: 'l001',
    title: '2025년 2월 사업비 정산',
    createdBy: 'u002',
    createdByName: '데이나',
    createdAt: '2025-02-18T09:00:00Z',
    updatedAt: '2025-02-20T11:00:00Z',
    status: 'SUBMITTED',
    period: '2025-02',
    totalNet: 15200000,
    totalVat: 1381818,
    totalGross: 16581818,
    submittedAt: '2025-02-20T11:00:00Z',
    items: [
      {
        id: 'ei004',
        setId: 'es002',
        date: '2025-02-05',
        budgetCode: '2. 프로그램 운영비',
        subCode: '2.1 전문가 활용비',
        vendor: '박강사',
        description: '워크숍 강사료',
        amountNet: 5000000,
        vat: 454545,
        amountGross: 5454545,
        paymentMethod: 'BANK_TRANSFER',
        evidenceStatus: 'COMPLETE',
        evidenceFiles: ['세금계산서_강사료.pdf'],
        note: '',
      },
      {
        id: 'ei005',
        setId: 'es002',
        date: '2025-02-12',
        budgetCode: '2. 프로그램 운영비',
        subCode: '2.2 위탁용역비',
        vendor: '데모데이 이벤트사',
        description: '통합데모데이 행사 운영',
        amountNet: 8000000,
        vat: 727273,
        amountGross: 8727273,
        paymentMethod: 'BANK_TRANSFER',
        evidenceStatus: 'PARTIAL',
        evidenceFiles: ['세금계산서_데모데이.pdf'],
        note: '검수확인서 추가 필요',
      },
      {
        id: 'ei006',
        setId: 'es002',
        date: '2025-02-15',
        budgetCode: '2. 프로그램 운영비',
        subCode: '2.3 기타운영비',
        vendor: '사무용품 마트',
        description: '워크숍 비품 구매',
        amountNet: 2200000,
        vat: 200000,
        amountGross: 2400000,
        paymentMethod: 'CARD',
        evidenceStatus: 'COMPLETE',
        evidenceFiles: ['카드영수증_비품.pdf'],
        note: '',
      },
    ],
  },
  {
    id: 'es003',
    projectId: 'p002',
    ledgerId: 'l003',
    title: 'IBS2 Q1 사업비 집행',
    createdBy: 'u003',
    createdByName: '베리',
    createdAt: '2025-03-15T09:00:00Z',
    updatedAt: '2025-03-15T09:00:00Z',
    status: 'DRAFT',
    period: '2025-Q1',
    totalNet: 42000000,
    totalVat: 3818182,
    totalGross: 45818182,
    items: [
      {
        id: 'ei007',
        setId: 'es003',
        date: '2025-01-20',
        budgetCode: '1. 인건비',
        subCode: '1.1 참여인력',
        vendor: 'MYSC',
        description: 'Q1 프로젝트 인건비',
        amountNet: 30000000,
        vat: 0,
        amountGross: 30000000,
        paymentMethod: 'BANK_TRANSFER',
        evidenceStatus: 'MISSING',
        evidenceFiles: [],
        note: '급여명세서 첨부 예정',
      },
      {
        id: 'ei008',
        setId: 'es003',
        date: '2025-03-10',
        budgetCode: '2. 프로그램 운영비',
        subCode: '2.1 전문가 활용비',
        vendor: '현지파트너 A',
        description: '베트남 현지 전문가 자문',
        amountNet: 12000000,
        vat: 1090909,
        amountGross: 13090909,
        paymentMethod: 'BANK_TRANSFER',
        evidenceStatus: 'MISSING',
        evidenceFiles: [],
        note: '해외송금 증빙 준비 중',
      },
    ],
  },
  {
    id: 'es004',
    projectId: 'p003',
    ledgerId: 'l005',
    title: 'CTS 2025 상반기 운영비',
    createdBy: 'u004',
    createdByName: '데이지',
    createdAt: '2025-06-20T09:00:00Z',
    updatedAt: '2025-06-28T16:00:00Z',
    status: 'REJECTED',
    period: '2025-H1',
    totalNet: 25000000,
    totalVat: 2272727,
    totalGross: 27272727,
    submittedAt: '2025-06-25T10:00:00Z',
    rejectedReason: '참여기업 지원 항목의 산출근거 불명확. 세부 내역서를 보완해 주세요.',
    items: [
      {
        id: 'ei009',
        setId: 'es004',
        date: '2025-04-15',
        budgetCode: '2. 프로그램 운영비',
        subCode: '2.1 전문가 활용비',
        vendor: '멘토링 전문가 그룹',
        description: '참여기업 역량강화 멘토링',
        amountNet: 15000000,
        vat: 1363636,
        amountGross: 16363636,
        paymentMethod: 'BANK_TRANSFER',
        evidenceStatus: 'PARTIAL',
        evidenceFiles: ['세금계산서_멘토링.pdf'],
        note: '결과보고서 미첨부',
      },
      {
        id: 'ei010',
        setId: 'es004',
        date: '2025-05-20',
        budgetCode: '3. 업무 추진비',
        subCode: '3.2 회의비',
        vendor: '스타트업 회의실',
        description: '데모데이 리허설 비용',
        amountNet: 10000000,
        vat: 909091,
        amountGross: 10909091,
        paymentMethod: 'BANK_TRANSFER',
        evidenceStatus: 'COMPLETE',
        evidenceFiles: ['세금계산서_데모데이리허설.pdf', '참석자명단.pdf'],
        note: '',
      },
    ],
  },
  {
    id: 'es005',
    projectId: 'p001',
    ledgerId: 'l001',
    title: '2025년 3월 사업비 정산',
    createdBy: 'u002',
    createdByName: '데이나',
    createdAt: '2025-03-20T09:00:00Z',
    updatedAt: '2025-03-20T09:00:00Z',
    status: 'DRAFT',
    period: '2025-03',
    totalNet: 6800000,
    totalVat: 618182,
    totalGross: 7418182,
    items: [
      {
        id: 'ei011',
        setId: 'es005',
        date: '2025-03-05',
        budgetCode: '2. 프로그램 운영비',
        subCode: '2.1 전문가 활용비',
        vendor: '이멘토',
        description: '멘토링 자문료 (2차)',
        amountNet: 3000000,
        vat: 272727,
        amountGross: 3272727,
        paymentMethod: 'BANK_TRANSFER',
        evidenceStatus: 'MISSING',
        evidenceFiles: [],
        note: '',
      },
      {
        id: 'ei012',
        setId: 'es005',
        date: '2025-03-12',
        budgetCode: '3. 업무 추진비',
        subCode: '3.2 회의비',
        vendor: '미팅룸 카페',
        description: '팀 회의 (3월)',
        amountNet: 800000,
        vat: 72727,
        amountGross: 872727,
        paymentMethod: 'CARD',
        evidenceStatus: 'COMPLETE',
        evidenceFiles: ['카드영수증_0312.pdf'],
        note: '',
      },
      {
        id: 'ei013',
        setId: 'es005',
        date: '2025-03-18',
        budgetCode: '2. 프로그램 운영비',
        subCode: '2.3 기타운영비',
        vendor: '택배 서비스',
        description: '참여기업 자료 배송비',
        amountNet: 3000000,
        vat: 272728,
        amountGross: 3272728,
        paymentMethod: 'BANK_TRANSFER',
        evidenceStatus: 'PARTIAL',
        evidenceFiles: ['거래명세서.pdf'],
        note: '세금계산서 발행 요청 중',
      },
    ],
  },
];

// ── 비목/세목 코드북 ──

export const BUDGET_CODE_BOOK = [
  { code: '1. 인건비', subCodes: ['1.1 참여인력'] },
  { code: '2. 프로그램 운영비', subCodes: ['2.1 전문가 활용비', '2.2 위탁용역비', '2.3 기타운영비', '2.4 오피스아워'] },
  { code: '3. 업무 추진비', subCodes: ['3.1 여비', '3.2 회의비'] },
  { code: '4. 팀지원금', subCodes: ['4. 팀지원금'] },
];

// ── 증빙자료 매핑 (사업별) ──
// key: projectId → (budgetCode|subCode) → evidenceRequiredDesc
export const EVIDENCE_REQUIRED_MAP: Record<string, Record<string, string>> = {
  // 예시:
  // 'p001': {
  //   '1. 인건비|1.1 참여인력': '근로계약서, 급여명세서, 이체확인증',
  //   '2. 프로그램 운영비|2.1 전문가 활용비': '용역계약서, 세금계산서, 이체확인증',
  // },
};

// ── 결제방법 라벨 ──

export const PAYMENT_METHOD_MAP: Record<string, string> = {
  BANK_TRANSFER: '계좌이체',
  CARD: '카드',
  CASH: '현금',
};

// ── 상태 라벨 ──

export const EXPENSE_STATUS_LABELS: Record<ExpenseSetStatus, string> = {
  DRAFT: '작성중',
  SUBMITTED: '제출완료',
  APPROVED: '승인',
  REJECTED: '반려',
};

export const EXPENSE_STATUS_COLORS: Record<ExpenseSetStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  SUBMITTED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  APPROVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  REJECTED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
};

export const EVIDENCE_STATUS_COLORS: Record<string, string> = {
  MISSING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  PARTIAL: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  COMPLETE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
};

export const EVIDENCE_STATUS_LABELS: Record<string, string> = {
  MISSING: '미제출',
  PARTIAL: '일부제출',
  COMPLETE: '완료',
};

// ── 포맷 헬퍼 ──

export function fmtKRW(n: number): string {
  if (n === 0) return '0';
  return n.toLocaleString('ko-KR');
}

export function fmtPercent(n: number): string {
  if (n === 0) return '0%';
  return (n * 100).toFixed(2) + '%';
}

export function fmtShort(n: number): string {
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + '억';
  if (Math.abs(n) >= 1e4) return Math.round(n / 1e4).toLocaleString() + '만';
  return n.toLocaleString();
}
