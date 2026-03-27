/**
 * 사업비 정산 E2E 시나리오 테스트
 *
 * MYSC 사업관리 플랫폼의 핵심 비즈니스 플로우를 실제 데이터 패턴으로 검증한다.
 * 81명 직원이 120개 사업의 정산/캐시플로우를 매주 다루는 실제 환경을 반영.
 */
import { describe, expect, it } from 'vitest';
import type {
  Transaction,
  CashflowSheetLineId,
  ParticipationEntry,
  SettlementSystemCode,
  BudgetCodeEntry,
  CashflowCategory,
  Direction,
  TransactionAmounts,
} from '@/app/data/types';
import { parseCsv, parseDate, parseNumber, normalizeKey, toCsv } from '../csv-utils';
import {
  SETTLEMENT_COLUMNS,
  normalizeMatrixToImportRows,
  analyzeSettlementHeaderMapping,
  parseSettlementCsv,
  importRowToTransaction,
  type ImportRow,
} from '../settlement-csv';
import {
  deriveSettlementRows,
  type SettlementDerivationContext,
} from '../settlement-row-derivation';
import {
  prepareSettlementImportRows,
  buildSettlementDerivationContext,
  resolveEvidenceRequiredDesc,
  pruneEmptySettlementRows,
} from '../settlement-sheet-prepare';
import {
  computeCashflowTotals,
  aggregateTransactionsToActual,
  mapCategoryToSheetLine,
  type CashflowTotals,
} from '../cashflow-sheet';
import {
  getMonthMondayWeeks,
  getYearMondayWeeks,
  findWeekForDate,
  type MonthMondayWeek,
} from '../cashflow-weeks';
import {
  computeEvidenceStatus,
  computeEvidenceMissing,
  computeEvidenceSummary,
} from '../evidence-helpers';
import {
  autoMatchBankTransactions,
  parseBankCsv,
  type BankTransaction,
} from '../bank-reconciliation';
import { matchBudgetCode } from '../budget-auto-match';
import { detectParticipationRisk } from '../participation-risk-rules';

// ═══════════════════════════════════════════════════════════════
// 공통 헬퍼: 실제 비즈니스 데이터 패턴 생성
// ═══════════════════════════════════════════════════════════════

function makeTransaction(overrides: Partial<Transaction> & {
  id: string;
  projectId: string;
  direction: Direction;
  dateTime: string;
}): Transaction {
  const now = '2026-01-15T09:00:00.000Z';
  return {
    ledgerId: 'ledger-1',
    state: 'SUBMITTED',
    weekCode: '',
    method: 'TRANSFER',
    cashflowCategory: overrides.direction === 'IN' ? 'CONTRACT_PAYMENT' : 'MISC_EXPENSE',
    cashflowLabel: '',
    counterparty: '',
    memo: '',
    amounts: {
      bankAmount: 0,
      depositAmount: 0,
      expenseAmount: 0,
      vatIn: 0,
      vatOut: 0,
      vatRefund: 0,
      balanceAfter: 0,
    },
    evidenceRequired: [],
    evidenceStatus: 'MISSING',
    evidenceMissing: [],
    attachmentsCount: 0,
    createdBy: 'test',
    createdAt: now,
    updatedBy: 'test',
    updatedAt: now,
    ...overrides,
  };
}

function makeParticipationEntry(params: {
  memberId: string;
  memberName: string;
  rate: number;
  settlementSystem: SettlementSystemCode;
  clientOrg: string;
  projectId: string;
  projectName: string;
}): ParticipationEntry {
  return {
    id: `${params.memberId}-${params.projectId}`,
    memberId: params.memberId,
    memberName: params.memberName,
    projectId: params.projectId,
    projectName: params.projectName,
    rate: params.rate,
    settlementSystem: params.settlementSystem,
    clientOrg: params.clientOrg,
    periodStart: '2026-01',
    periodEnd: '2026-12',
    isDocumentOnly: false,
    note: '',
    updatedAt: '2026-01-15T00:00:00.000Z',
  };
}

function getColIdx(csvHeader: string): number {
  return SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === csvHeader);
}

// ═══════════════════════════════════════════════════════════════
// 시나리오 1: PM이 사업비 시트를 CSV로 내려받아 업로드하는 전체 플로우
// ═══════════════════════════════════════════════════════════════

describe('시나리오 1: PM이 사업비 CSV를 업로드하는 전체 플로우', () => {
  // 실제 사업비 CSV — 한글 헤더, 혼합 날짜 형식, 콤마 숫자, 빈 칸 포함
  // CSV에서 콤마가 포함된 헤더/값은 반드시 쌍따옴표로 감싸야 한다
  const REAL_SETTLEMENT_CSV = [
    '기본정보,,,,,,,,,,,,입금합계,,출금합계,,사업팀,,,,,,정산지원,,도담,,,,비고',
    '작성자,No.,거래일시,해당 주차,지출구분,비목,세목,세세목,cashflow항목,통장잔액,통장에 찍힌 입/출금액,"입금액(사업비,공급가액,은행이자)",매입부가세 반환,사업비 사용액,매입부가세,지급처,상세 적요,필수증빙자료 리스트,실제 구비 완료된 증빙자료 리스트,준비필요자료,증빙자료 드라이브,준비 필요자료,e나라 등록,e나라 집행,부가세 지결 완료여부,최종완료,비고',
    '김PM,1,2026-01-05,,계좌이체,,,,매출액(입금),,,"100,000,000",,,,,사업비 선금 입금,,,,,,,,,',
    '김PM,2,2026-01-15,,계좌이체,인건비,보조연구원,,직접사업비,,"2,000,000",,,"2,000,000",,홍길동,1월 급여,세금계산서,,,,,,,,',
    '김PM,3,2026.01.20,,사업비카드,여비교통비,국내출장비,,직접사업비,,"55,000",,,"50,000","5,000",KTX,서울-부산 출장,영수증,,,,,,,,',
    '김PM,4,01-25-2026,,계좌이체,외주비,용역비,,직접사업비,,"11,000,000",,,"10,000,000","1,000,000",㈜디자인랩,홈페이지 디자인 외주,"세금계산서, 계약서",,,,,,,,',
    '김PM,5,2026-02-03,,계좌이체,소모품비,사무용품,,직접사업비,,"33,000",,,"30,000","3,000",오피스디포,A4용지 외 사무용품,영수증,,,,,,,,',
  ].join('\n');

  it('parseCsv가 한글 헤더와 혼합 형식의 CSV를 올바르게 파싱한다', () => {
    const matrix = parseCsv(REAL_SETTLEMENT_CSV);

    expect(matrix.length).toBe(7,
      '그룹헤더 1행 + 컬럼헤더 1행 + 데이터 5행 = 총 7행');
    expect(matrix[1]).toContain('거래일시',
      '두 번째 행이 컬럼 헤더여야 한다');
    // 콤마가 포함된 숫자가 제대로 분리되었는지 확인 (따옴표 안의 콤마는 필드 구분자가 아님)
    expect(matrix[2].some(cell => cell.includes('100,000,000')),
      '따옴표로 감싼 콤마 포함 숫자가 올바르게 파싱되어야 한다').toBe(true);
  });

  it('analyzeSettlementHeaderMapping이 핵심 헤더를 자동 감지한다', () => {
    const matrix = parseCsv(REAL_SETTLEMENT_CSV);
    const analysis = analyzeSettlementHeaderMapping(matrix);

    expect(analysis.matchedCriticalFields.length).toBeGreaterThan(5,
      '핵심 필드(거래일시, 비목, 사업비사용액 등) 5개 이상이 매칭되어야 한다');
    expect(analysis.matchedCriticalFields).toContain('거래일시',
      '거래일시는 반드시 매칭되어야 한다 — 날짜 없이는 정산 불가');
    expect(analysis.matchedCriticalFields).toContain('사업비 사용액',
      '사업비 사용액은 반드시 매칭되어야 한다 — 핵심 금액 필드');
  });

  it('normalizeMatrixToImportRows가 CSV 매트릭스를 정산 컬럼 순서로 정렬한다', () => {
    const matrix = parseCsv(REAL_SETTLEMENT_CSV);
    const rows = normalizeMatrixToImportRows(matrix);

    expect(rows.length).toBe(5,
      '데이터 행 5개가 ImportRow로 변환되어야 한다');

    // 첫 번째 행: 사업비 선금 입금 1억
    const row0 = rows[0];
    const dateIdx = getColIdx('거래일시');
    const depositIdx = getColIdx('입금액(사업비,공급가액,은행이자)');

    expect(row0.cells[dateIdx]).toBe('2026-01-05',
      '날짜가 원본 YYYY-MM-DD 형식으로 유지되어야 한다');
    expect(parseNumber(row0.cells[depositIdx])).toBe(100_000_000,
      '사업비 선금 1억원이 입금액 컬럼에 매핑되어야 한다 (콤마 포함 문자열에서 숫자 파싱)');

    // 네 번째 행: MM-DD-YYYY 형식의 날짜
    const row3 = rows[3];
    expect(row3.cells[dateIdx]).toBe('01-25-2026',
      'MM-DD-YYYY 형식이 원본 그대로 보존되어야 한다 (파싱은 derive 단계에서)');

    // 특수문자 거래처: ㈜디자인랩
    const counterpartyIdx = getColIdx('지급처');
    expect(row3.cells[counterpartyIdx]).toBe('㈜디자인랩',
      '한글 특수문자(㈜)가 포함된 거래처명이 유지되어야 한다');
  });

  it('deriveSettlementRows가 주차 자동 할당 및 잔액 계산을 수행한다', () => {
    const matrix = parseCsv(REAL_SETTLEMENT_CSV);
    const rows = normalizeMatrixToImportRows(matrix);
    const context = buildSettlementDerivationContext('proj-test', 'ledger-test');

    const derived = deriveSettlementRows(rows, context, { mode: 'full' });

    // 주차 자동 할당 검증: 날짜가 있으면 해당 주차가 자동 계산되어야 한다
    const weekIdx = getColIdx('해당 주차');
    const firstWeek = derived[0].cells[weekIdx];
    expect(firstWeek).toBeTruthy(
      '2026-01-05 날짜에 대해 주차 라벨이 자동 할당되어야 한다');
    expect(firstWeek).toMatch(/^\d{2}-\d{1,2}-\d{1,2}$/,
      '주차 라벨이 "YY-M-W" 형식이어야 한다 (예: 26-1-1)');

    // 잔액 계산 검증: 입금 후 출금이 차감되어야 한다
    const balanceIdx = getColIdx('통장잔액');
    const firstBalance = parseNumber(derived[0].cells[balanceIdx]);
    expect(firstBalance).toBe(100_000_000,
      '첫 입금 후 잔액이 1억원이어야 한다');

    const secondBalance = parseNumber(derived[1].cells[balanceIdx]);
    expect(secondBalance).toBe(100_000_000 - 2_000_000,
      '1억에서 200만원 출금 후 잔액이 9,800만원이어야 한다');
  });

  it('prepareSettlementImportRows가 빈 행을 제거하고 번호를 재채번한다', () => {
    const matrix = parseCsv(REAL_SETTLEMENT_CSV);
    const rawRows = normalizeMatrixToImportRows(matrix);

    // 빈 행 하나 삽입
    const withEmpty: ImportRow[] = [
      rawRows[0],
      { tempId: 'empty-1', cells: SETTLEMENT_COLUMNS.map(() => '') },
      ...rawRows.slice(1),
    ];

    const prepared = prepareSettlementImportRows(withEmpty, {
      projectId: 'proj-test',
      defaultLedgerId: 'ledger-test',
    });

    expect(prepared.length).toBe(5,
      '빈 행이 제거되어 원래 데이터 5행만 남아야 한다');

    // No. 컬럼이 1부터 순차 재채번되었는지
    const noIdx = getColIdx('No.');
    prepared.forEach((row, i) => {
      expect(row.cells[noIdx]).toBe(String(i + 1),
        `No. 컬럼이 ${i + 1}로 재채번되어야 한다`);
    });
  });

  it('최종 rows가 importRowToTransaction으로 Transaction 변환 가능해야 한다', () => {
    const matrix = parseCsv(REAL_SETTLEMENT_CSV);
    const rows = normalizeMatrixToImportRows(matrix);
    const prepared = prepareSettlementImportRows(rows, {
      projectId: 'proj-kcamp',
      defaultLedgerId: 'ledger-kcamp',
    });

    // 모든 행이 Transaction으로 변환 가능한지 검증
    const results = prepared.map((row, idx) =>
      importRowToTransaction(row, 'proj-kcamp', 'ledger-kcamp', idx),
    );

    const transactions = results.filter(r => r.transaction).map(r => r.transaction!);
    const errors = results.filter(r => r.error);

    expect(transactions.length).toBe(5,
      '5개 행 모두 Transaction으로 변환되어야 한다');
    expect(errors.length).toBe(0,
      '변환 에러가 없어야 한다');

    // 첫 번째 거래: 사업비 선금 입금 — IN 방향
    const inTx = transactions[0];
    expect(inTx.direction).toBe('IN',
      '매출액(입금) cashflow 항목은 IN 방향이어야 한다');
    expect(inTx.amounts.depositAmount).toBe(100_000_000,
      '입금액이 1억원이어야 한다');

    // 두 번째 거래: 인건비 출금 — OUT 방향
    const outTx = transactions[1];
    expect(outTx.direction).toBe('OUT',
      '직접사업비 cashflow 항목은 OUT 방향이어야 한다');
    expect(outTx.budgetCategory).toBe('인건비',
      '비목이 인건비로 매핑되어야 한다');
    expect(outTx.budgetSubCategory).toBe('보조연구원',
      '세목이 보조연구원으로 매핑되어야 한다');

    // 네 번째 거래: MM-DD-YYYY 날짜 형식이 정상 파싱
    const mixedDateTx = transactions[3];
    expect(mixedDateTx.dateTime).toBe('2026-01-25',
      'MM-DD-YYYY 형식(01-25-2026)이 ISO 날짜로 변환되어야 한다');
  });

  it('증빙 필요 매핑이 evidenceRequiredMap을 통해 자동 적용된다', () => {
    const matrix = parseCsv(REAL_SETTLEMENT_CSV);
    const rows = normalizeMatrixToImportRows(matrix);

    const prepared = prepareSettlementImportRows(rows, {
      projectId: 'proj-test',
      defaultLedgerId: 'ledger-test',
      evidenceRequiredMap: {
        '인건비|보조연구원': '근로계약서, 출근부, 급여명세서',
        '여비교통비': '출장명령서, 영수증',
        '외주비|용역비': '세금계산서, 용역계약서',
        '소모품비': '영수증',
      },
    });

    const evidenceIdx = getColIdx('필수증빙자료 리스트');

    // 인건비 행 — 비목|세목 조합으로 매칭
    expect(prepared[1].cells[evidenceIdx]).toBe('근로계약서, 출근부, 급여명세서',
      '인건비|보조연구원 조합에 대한 증빙 요건이 자동 매핑되어야 한다');

    // 여비교통비 행 — 비목만으로 매칭
    expect(prepared[2].cells[evidenceIdx]).toBe('출장명령서, 영수증',
      '여비교통비 비목에 대한 증빙 요건이 자동 매핑되어야 한다');

    // 소모품비 행
    expect(prepared[4].cells[evidenceIdx]).toBe('영수증',
      '소모품비 비목에 대한 증빙 요건이 자동 매핑되어야 한다');
  });
});

// ═══════════════════════════════════════════════════════════════
// 시나리오 2: 정산 → 캐시플로우 연동
// ═══════════════════════════════════════════════════════════════

describe('시나리오 2: 정산 거래가 캐시플로우 주차별 시트로 집계된다', () => {
  const JAN_2026_WEEKS = getMonthMondayWeeks('2026-01');

  it('IN/OUT 거래가 올바른 캐시플로우 라인에 집계된다', () => {
    const transactions: Transaction[] = [
      makeTransaction({
        id: 'tx-in-1',
        projectId: 'proj-1',
        direction: 'IN',
        dateTime: '2026-01-07',
        cashflowCategory: 'CONTRACT_PAYMENT',
        amounts: { bankAmount: 110_000_000, depositAmount: 100_000_000, expenseAmount: 0, vatIn: 0, vatOut: 10_000_000, vatRefund: 0, balanceAfter: 110_000_000 },
      }),
      makeTransaction({
        id: 'tx-out-1',
        projectId: 'proj-1',
        direction: 'OUT',
        dateTime: '2026-01-15',
        cashflowCategory: 'LABOR_COST',
        amounts: { bankAmount: 3_300_000, depositAmount: 0, expenseAmount: 3_300_000, vatIn: 300_000, vatOut: 0, vatRefund: 0, balanceAfter: 106_700_000 },
      }),
      makeTransaction({
        id: 'tx-out-2',
        projectId: 'proj-1',
        direction: 'OUT',
        dateTime: '2026-01-20',
        cashflowCategory: 'OUTSOURCING',
        amounts: { bankAmount: 5_500_000, depositAmount: 0, expenseAmount: 5_500_000, vatIn: 500_000, vatOut: 0, vatRefund: 0, balanceAfter: 101_200_000 },
      }),
    ];

    const weeklyActual = aggregateTransactionsToActual(transactions, JAN_2026_WEEKS);

    // 전체 주차 합산
    let totalSalesIn = 0;
    let totalSalesVatIn = 0;
    let totalLaborOut = 0;
    let totalDirectCostOut = 0;
    let totalInputVatOut = 0;

    for (const [, bucket] of weeklyActual) {
      totalSalesIn += bucket.SALES_IN || 0;
      totalSalesVatIn += bucket.SALES_VAT_IN || 0;
      totalLaborOut += bucket.MYSC_LABOR_OUT || 0;
      totalDirectCostOut += bucket.DIRECT_COST_OUT || 0;
      totalInputVatOut += bucket.INPUT_VAT_OUT || 0;
    }

    expect(totalSalesIn).toBe(90_000_000,
      '매출액(입금)이 9천만원이어야 한다 — depositAmount(1억) - vatOut(1천만) = 9천만');
    expect(totalSalesVatIn).toBe(10_000_000,
      '매출부가세(입금)가 1천만원이어야 한다 — vatOut 분리');
    expect(totalLaborOut).toBe(3_000_000,
      'MYSC인건비(출금)가 300만원이어야 한다 — 330만에서 매입부가세 30만 분리');
    expect(totalDirectCostOut).toBe(5_000_000,
      '직접사업비가 500만원이어야 한다 — 550만에서 매입부가세 50만 분리');
    expect(totalInputVatOut).toBe(800_000,
      '매입부가세 합계가 80만원이어야 한다 (30만 + 50만)');
  });

  it('computeCashflowTotals가 IN/OUT/NET을 정확히 계산한다', () => {
    const sheet: Partial<Record<CashflowSheetLineId, number>> = {
      SALES_IN: 100_000_000,
      SALES_VAT_IN: 10_000_000,
      BANK_INTEREST_IN: 5_000,
      DIRECT_COST_OUT: 50_000_000,
      INPUT_VAT_OUT: 5_000_000,
      MYSC_LABOR_OUT: 20_000_000,
      MYSC_PROFIT_OUT: 15_000_000,
    };

    const totals = computeCashflowTotals(sheet);

    expect(totals.totalIn).toBe(110_005_000,
      'IN 합계: 매출액 1억 + 매출부가세 1천만 + 은행이자 5천 = 1억1000만5천');
    expect(totals.totalOut).toBe(90_000_000,
      'OUT 합계: 직접사업비 5천만 + 매입부가세 500만 + 인건비 2천만 + 수익 1500만 = 9천만');
    expect(totals.net).toBe(20_005_000,
      'NET = IN - OUT = 2000만5천원 (사업 순이익)');
  });

  it('DRAFT/REJECTED 거래는 캐시플로우 집계에서 제외된다', () => {
    const transactions: Transaction[] = [
      makeTransaction({
        id: 'tx-approved',
        projectId: 'proj-1',
        direction: 'OUT',
        dateTime: '2026-01-10',
        state: 'APPROVED',
        cashflowCategory: 'OUTSOURCING',
        amounts: { bankAmount: 1_000_000, depositAmount: 0, expenseAmount: 1_000_000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
      }),
      makeTransaction({
        id: 'tx-draft',
        projectId: 'proj-1',
        direction: 'OUT',
        dateTime: '2026-01-10',
        state: 'DRAFT',
        cashflowCategory: 'OUTSOURCING',
        amounts: { bankAmount: 2_000_000, depositAmount: 0, expenseAmount: 2_000_000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
      }),
      makeTransaction({
        id: 'tx-rejected',
        projectId: 'proj-1',
        direction: 'OUT',
        dateTime: '2026-01-10',
        state: 'REJECTED',
        cashflowCategory: 'OUTSOURCING',
        amounts: { bankAmount: 3_000_000, depositAmount: 0, expenseAmount: 3_000_000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
      }),
    ];

    const weeklyActual = aggregateTransactionsToActual(transactions, JAN_2026_WEEKS);
    let totalDirectCost = 0;
    for (const [, bucket] of weeklyActual) {
      totalDirectCost += bucket.DIRECT_COST_OUT || 0;
    }

    expect(totalDirectCost).toBe(1_000_000,
      'APPROVED 거래(100만원)만 집계되어야 한다 — DRAFT(200만)와 REJECTED(300만)는 제외');
  });

  it('mapCategoryToSheetLine이 카테고리를 올바른 라인 ID로 매핑한다', () => {
    expect(mapCategoryToSheetLine('IN', 'CONTRACT_PAYMENT')).toBe('SALES_IN',
      '계약금 입금은 매출액 라인에 매핑');
    expect(mapCategoryToSheetLine('IN', 'VAT_REFUND')).toBe('SALES_VAT_IN',
      '부가세환급은 매출부가세 라인에 매핑');
    expect(mapCategoryToSheetLine('OUT', 'LABOR_COST')).toBe('MYSC_LABOR_OUT',
      '인건비는 MYSC인건비 라인에 매핑');
    expect(mapCategoryToSheetLine('OUT', 'TAX_PAYMENT')).toBe('SALES_VAT_OUT',
      '세금납부는 매출부가세(출금) 라인에 매핑');
    expect(mapCategoryToSheetLine('OUT', 'OUTSOURCING')).toBe('DIRECT_COST_OUT',
      '외주비는 직접사업비 라인에 매핑');
    expect(mapCategoryToSheetLine('OUT', 'EQUIPMENT')).toBe('DIRECT_COST_OUT',
      '장비구입비도 직접사업비 라인에 매핑');
  });
});

// ═══════════════════════════════════════════════════════════════
// 시나리오 3: 증빙 매핑 검증
// ═══════════════════════════════════════════════════════════════

describe('시나리오 3: 증빙(Evidence) 상태 추적이 올바르게 작동한다', () => {
  it('필수증빙 전부 미제출이면 MISSING 상태', () => {
    const tx = makeTransaction({
      id: 'tx-missing',
      projectId: 'proj-1',
      direction: 'OUT',
      dateTime: '2026-01-15',
      evidenceRequired: ['세금계산서', '계약서'],
    });

    expect(computeEvidenceStatus(tx)).toBe('MISSING',
      '증빙을 하나도 제출하지 않으면 MISSING이어야 한다');
  });

  it('일부만 첨부하면 PARTIAL 상태', () => {
    const tx = makeTransaction({
      id: 'tx-partial',
      projectId: 'proj-1',
      direction: 'OUT',
      dateTime: '2026-01-15',
      evidenceRequired: ['세금계산서', '계약서', '검수조서'],
      evidenceCompletedDesc: '세금계산서',
      evidenceDriveLink: 'https://drive.google.com/drive/folders/abc123',
    });

    expect(computeEvidenceStatus(tx)).toBe('PARTIAL',
      '3개 필수증빙 중 1개만 완료했으므로 PARTIAL이어야 한다');

    const missing = computeEvidenceMissing(tx);
    expect(missing).toContain('계약서',
      '계약서가 미제출 목록에 포함되어야 한다');
    expect(missing).toContain('검수조서',
      '검수조서가 미제출 목록에 포함되어야 한다');
    expect(missing).not.toContain('세금계산서',
      '세금계산서는 완료되었으므로 미제출 목록에 없어야 한다');
  });

  it('전부 첨부하고 드라이브 링크도 있으면 COMPLETE 상태', () => {
    const tx = makeTransaction({
      id: 'tx-complete',
      projectId: 'proj-1',
      direction: 'OUT',
      dateTime: '2026-01-15',
      evidenceRequired: ['세금계산서', '계약서'],
      evidenceCompletedDesc: '세금계산서, 계약서',
      evidenceDriveLink: 'https://drive.google.com/drive/folders/abc123',
    });

    expect(computeEvidenceStatus(tx)).toBe('COMPLETE',
      '모든 필수증빙이 완료되고 드라이브 링크가 있으므로 COMPLETE이어야 한다');
  });

  it('evidenceRequired가 비어있을 때 드라이브 링크 + 설명이 있으면 COMPLETE', () => {
    const tx = makeTransaction({
      id: 'tx-no-req',
      projectId: 'proj-1',
      direction: 'OUT',
      dateTime: '2026-01-15',
      evidenceRequired: [],
      evidenceCompletedDesc: '영수증 첨부 완료',
      evidenceDriveLink: 'https://drive.google.com/drive/folders/xyz',
    });

    expect(computeEvidenceStatus(tx)).toBe('COMPLETE',
      'evidenceRequired가 없어도 링크+설명이 있으면 COMPLETE');
  });

  it('computeEvidenceSummary가 거래 목록의 증빙 통계를 올바르게 집계한다', () => {
    const transactions: Transaction[] = [
      makeTransaction({ id: 'tx-1', projectId: 'p', direction: 'OUT', dateTime: '2026-01-10', evidenceStatus: 'COMPLETE' }),
      makeTransaction({ id: 'tx-2', projectId: 'p', direction: 'OUT', dateTime: '2026-01-11', evidenceStatus: 'COMPLETE' }),
      makeTransaction({ id: 'tx-3', projectId: 'p', direction: 'OUT', dateTime: '2026-01-12', evidenceStatus: 'PARTIAL' }),
      makeTransaction({ id: 'tx-4', projectId: 'p', direction: 'OUT', dateTime: '2026-01-13', evidenceStatus: 'MISSING' }),
      makeTransaction({ id: 'tx-5', projectId: 'p', direction: 'OUT', dateTime: '2026-01-14', evidenceStatus: 'MISSING' }),
    ];

    const summary = computeEvidenceSummary(transactions);
    expect(summary.complete).toBe(2, '완료 2건');
    expect(summary.partial).toBe(1, '일부제출 1건');
    expect(summary.missing).toBe(2, '미제출 2건');
  });
});

// ═══════════════════════════════════════════════════════════════
// 시나리오 4: 은행 거래 자동 대사 (Bank Reconciliation)
// ═══════════════════════════════════════════════════════════════

describe('시나리오 4: 은행 거래 자동 대사(Bank Reconciliation)', () => {
  it('parseBankCsv가 한국 은행 CSV 형식을 올바르게 파싱한다', () => {
    const bankCsvMatrix: string[][] = [
      ['거래일', '적요', '입금액', '출금액', '잔액'],
      ['2026-01-05', '사업비 선금 입금', '100,000,000', '', '100,000,000'],
      ['2026-01-15', '홍길동 1월 급여', '', '2,000,000', '98,000,000'],
      ['2026-01-20', 'KTX 교통비', '', '55,000', '97,945,000'],
      ['2026-01-25', '㈜디자인랩 용역비', '', '11,000,000', '86,945,000'],
    ];

    const bankTxs = parseBankCsv(bankCsvMatrix);

    expect(bankTxs.length).toBe(4,
      '4개 은행 거래가 파싱되어야 한다');
    expect(bankTxs[0].direction).toBe('IN',
      '입금액이 있는 거래는 IN 방향');
    expect(bankTxs[0].amount).toBe(100_000_000,
      '콤마 포함 숫자가 정확히 파싱되어야 한다');
    expect(bankTxs[1].direction).toBe('OUT',
      '출금액이 있는 거래는 OUT 방향');
    expect(bankTxs[3].balance).toBe(86_945_000,
      '잔액이 올바르게 파싱되어야 한다');
  });

  it('autoMatchBankTransactions가 날짜 ±2일, 금액 일치로 매칭한다', () => {
    const bankTxs: BankTransaction[] = [
      { id: 'b1', date: '2026-01-05', description: '선금', amount: 100_000_000, direction: 'IN', balance: 100_000_000 },
      { id: 'b2', date: '2026-01-16', description: '급여', amount: 2_000_000, direction: 'OUT', balance: 98_000_000 },
      { id: 'b3', date: '2026-01-22', description: '미확인 출금', amount: 500_000, direction: 'OUT', balance: 97_500_000 },
    ];

    const systemTxs: Transaction[] = [
      makeTransaction({
        id: 'sys-1', projectId: 'p1', direction: 'IN', dateTime: '2026-01-05',
        amounts: { bankAmount: 100_000_000, depositAmount: 100_000_000, expenseAmount: 0, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
      }),
      makeTransaction({
        id: 'sys-2', projectId: 'p1', direction: 'OUT', dateTime: '2026-01-15',
        amounts: { bankAmount: 2_000_000, depositAmount: 0, expenseAmount: 2_000_000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
      }),
    ];

    const results = autoMatchBankTransactions(bankTxs, systemTxs, 2);

    const matched = results.filter(r => r.status === 'MATCHED');
    const unmatchedBank = results.filter(r => r.status === 'UNMATCHED_BANK');
    const unmatchedSystem = results.filter(r => r.status === 'UNMATCHED_SYSTEM');

    expect(matched.length).toBe(2,
      '선금(정확 일치)과 급여(1일 차이)가 매칭되어야 한다');
    expect(unmatchedBank.length).toBe(1,
      '시스템에 없는 미확인 출금 50만원이 UNMATCHED_BANK이어야 한다');
    expect(unmatchedSystem.length).toBe(0,
      '모든 시스템 거래가 매칭되었으므로 UNMATCHED_SYSTEM이 없어야 한다');

    // 날짜 정확 일치 시 confidence = 1.0
    const exactMatch = matched.find(r => r.bankTx?.id === 'b1');
    expect(exactMatch?.confidence).toBe(1.0,
      '날짜가 정확히 일치하면 confidence가 1.0이어야 한다');

    // 1일 차이 시 confidence = 0.85
    const oneDay = matched.find(r => r.bankTx?.id === 'b2');
    expect(oneDay?.confidence).toBe(0.85,
      '날짜 1일 차이면 confidence가 0.85이어야 한다 (1 - 0.15)');
  });

  it('날짜 tolerance 초과 시 매칭하지 않는다', () => {
    const bankTxs: BankTransaction[] = [
      { id: 'b1', date: '2026-01-10', description: '출금', amount: 1_000_000, direction: 'OUT', balance: 0 },
    ];

    const systemTxs: Transaction[] = [
      makeTransaction({
        id: 'sys-1', projectId: 'p1', direction: 'OUT', dateTime: '2026-01-15',
        amounts: { bankAmount: 1_000_000, depositAmount: 0, expenseAmount: 1_000_000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
      }),
    ];

    const results = autoMatchBankTransactions(bankTxs, systemTxs, 2);
    const matched = results.filter(r => r.status === 'MATCHED');

    expect(matched.length).toBe(0,
      '날짜 차이 5일 > tolerance 2일이므로 매칭되지 않아야 한다');
  });

  it('방향이 다르면 금액이 같아도 매칭하지 않는다', () => {
    const bankTxs: BankTransaction[] = [
      { id: 'b1', date: '2026-01-10', description: '입금', amount: 1_000_000, direction: 'IN', balance: 0 },
    ];

    const systemTxs: Transaction[] = [
      makeTransaction({
        id: 'sys-1', projectId: 'p1', direction: 'OUT', dateTime: '2026-01-10',
        amounts: { bankAmount: 1_000_000, depositAmount: 0, expenseAmount: 1_000_000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
      }),
    ];

    const results = autoMatchBankTransactions(bankTxs, systemTxs, 2);
    const matched = results.filter(r => r.status === 'MATCHED');

    expect(matched.length).toBe(0,
      '은행은 IN, 시스템은 OUT이면 방향 불일치로 매칭 불가');
  });
});

// ═══════════════════════════════════════════════════════════════
// 시나리오 5: 비목 자동 제안 (Budget Auto-Match)
// ═══════════════════════════════════════════════════════════════

describe('시나리오 5: 비목 자동 제안(Budget Auto-Match)', () => {
  const codeBook: BudgetCodeEntry[] = [
    { code: '인건비', subCodes: ['책임연구원', '보조연구원', '연구보조원'] },
    { code: '여비교통비', subCodes: ['국내출장비', '해외출장비'] },
    { code: '외주비', subCodes: ['용역비', '번역비'] },
    { code: '소모품비', subCodes: ['사무용품', '전산소모품'] },
    { code: '위탁사업비', subCodes: ['위탁연구', '재위탁'] },
  ];

  it('거래처명에 비목 키워드가 있으면 exact 매칭', () => {
    const result = matchBudgetCode('홍길동', '1월 인건비 급여', '인건비', codeBook);

    expect(result.confidence).toBe('exact',
      '적요에 "인건비"가 포함되면 exact 매칭이어야 한다');
    expect(result.budgetCategory).toBe('인건비',
      '비목이 인건비로 매핑되어야 한다');
  });

  it('세목 키워드가 적요에 있으면 세목까지 exact 매칭', () => {
    const result = matchBudgetCode('㈜디자인랩', '번역비 정산', '', codeBook);

    expect(result.confidence).toBe('exact',
      '적요에 세목 "번역비"가 포함되면 exact 매칭');
    expect(result.budgetCategory).toBe('외주비',
      '번역비의 상위 비목은 외주비');
    expect(result.budgetSubCategory).toBe('번역비',
      '세목이 번역비로 매핑');
  });

  it('cashflow 라벨로 fuzzy 매칭한다', () => {
    const result = matchBudgetCode('KTX', '출장비', '여비교통비', codeBook);

    expect(result.confidence).toBe('exact',
      '거래처+적요에 여비교통비가 포함되지 않아도 cashflow 라벨의 "여비교통비" 키워드가 codeBook과 일치');
    expect(result.budgetCategory).toBe('여비교통비');
  });

  it('매칭 불가 시 none을 반환한다', () => {
    const result = matchBudgetCode('미상', '기타', '기타', codeBook);

    expect(result.confidence).toBe('none',
      '어떤 비목에도 매칭되지 않으면 none');
    expect(result.budgetCategory).toBe('',
      '비목이 빈 문자열이어야 한다');
  });

  it('빈 codeBook이면 항상 none', () => {
    const result = matchBudgetCode('홍길동', '인건비', '인건비', []);

    expect(result.confidence).toBe('none',
      'codeBook이 비어있으면 매칭 불가');
  });
});

// ═══════════════════════════════════════════════════════════════
// 시나리오 6: 참여율 이상 탐지
// ═══════════════════════════════════════════════════════════════

describe('시나리오 6: 참여율 이상 탐지 (Participation Risk)', () => {
  it('동일 정산시스템에서 참여율 합산 120%이면 위험 플래그', () => {
    const entries: ParticipationEntry[] = [
      makeParticipationEntry({
        memberId: 'm-a', memberName: '직원A', rate: 40,
        settlementSystem: 'E_NARA_DOUM', clientOrg: '환경부',
        projectId: 'p1', projectName: '사업A',
      }),
      makeParticipationEntry({
        memberId: 'm-a', memberName: '직원A', rate: 40,
        settlementSystem: 'E_NARA_DOUM', clientOrg: '산업부',
        projectId: 'p2', projectName: '사업B',
      }),
      makeParticipationEntry({
        memberId: 'm-a', memberName: '직원A', rate: 40,
        settlementSystem: 'E_NARA_DOUM', clientOrg: '복지부',
        projectId: 'p3', projectName: '사업C',
      }),
    ];

    const risk = detectParticipationRisk(entries);

    expect(risk.hasOverLimit).toBe(true,
      'e나라도움 합산 120% > 100%이므로 위험 플래그가 설정되어야 한다');
    expect(risk.overLimitMembers.length).toBeGreaterThanOrEqual(1,
      '직원A가 위험 목록에 포함되어야 한다');
    expect(risk.overLimitMembers[0].totalRate).toBe(120,
      '합산 참여율이 120%이어야 한다');
    expect(risk.overLimitMembers[0].projectNames.length).toBe(3,
      '3개 프로젝트가 관련되어야 한다');
  });

  it('참여율 합산 100% 정확하면 위험이 아닌 경고 수준', () => {
    const entries: ParticipationEntry[] = [
      makeParticipationEntry({
        memberId: 'm-b', memberName: '직원B', rate: 50,
        settlementSystem: 'E_NARA_DOUM', clientOrg: '환경부',
        projectId: 'p1', projectName: '사업A',
      }),
      makeParticipationEntry({
        memberId: 'm-b', memberName: '직원B', rate: 50,
        settlementSystem: 'E_NARA_DOUM', clientOrg: '산업부',
        projectId: 'p2', projectName: '사업B',
      }),
    ];

    const risk = detectParticipationRisk(entries);

    expect(risk.hasOverLimit).toBe(false,
      '합산 100%는 초과가 아니므로 overLimit이 아니다');
    // 80% 초과이므로 경고 수준
    expect(risk.hasWarning).toBe(true,
      '합산 100% > 80%이므로 경고(WARNING)가 있어야 한다');
  });

  it('PRIVATE/NONE 정산시스템은 참여율 합산에서 제외된다', () => {
    const entries: ParticipationEntry[] = [
      makeParticipationEntry({
        memberId: 'm-c', memberName: '직원C', rate: 80,
        settlementSystem: 'PRIVATE', clientOrg: '민간A',
        projectId: 'p1', projectName: '민간사업1',
      }),
      makeParticipationEntry({
        memberId: 'm-c', memberName: '직원C', rate: 80,
        settlementSystem: 'NONE', clientOrg: '미정',
        projectId: 'p2', projectName: '미정사업',
      }),
    ];

    const risk = detectParticipationRisk(entries);

    expect(risk.hasOverLimit).toBe(false,
      'PRIVATE/NONE 시스템은 교차검증 대상이 아니므로 위험 플래그 없음');
    expect(risk.overLimitMembers.length).toBe(0,
      '위험 목록이 비어야 한다');
  });

  it('filterMemberNames로 특정 직원만 필터링할 수 있다', () => {
    const entries: ParticipationEntry[] = [
      makeParticipationEntry({
        memberId: 'm-a', memberName: '직원A', rate: 60,
        settlementSystem: 'E_NARA_DOUM', clientOrg: '환경부',
        projectId: 'p1', projectName: '사업A',
      }),
      makeParticipationEntry({
        memberId: 'm-a', memberName: '직원A', rate: 60,
        settlementSystem: 'E_NARA_DOUM', clientOrg: '산업부',
        projectId: 'p2', projectName: '사업B',
      }),
      makeParticipationEntry({
        memberId: 'm-b', memberName: '직원B', rate: 90,
        settlementSystem: 'E_NARA_DOUM', clientOrg: '복지부',
        projectId: 'p3', projectName: '사업C',
      }),
    ];

    // 직원B만 필터링 — 90%이므로 overLimit 아님
    const riskB = detectParticipationRisk(entries, ['직원B']);
    expect(riskB.hasOverLimit).toBe(false,
      '직원B만 필터링하면 90%이므로 위험 없음');

    // 직원A만 필터링 — 120%이므로 overLimit
    const riskA = detectParticipationRisk(entries, ['직원A']);
    expect(riskA.hasOverLimit).toBe(true,
      '직원A만 필터링하면 120%이므로 위험');
  });
});

// ═══════════════════════════════════════════════════════════════
// 스트레스 테스트
// ═══════════════════════════════════════════════════════════════

describe('스트레스 1: 대량 CSV 파싱 성능', () => {
  it('500행 CSV를 파싱 + 정규화하고 행 수가 정확하다', () => {
    // 500행 CSV 생성 — normalizeMatrixToImportRows는 매 행마다 O(columns^2) 헤더 매칭 수행
    const headerGroup = '기본정보,,,,,,,,,,,,입금합계,,출금합계,,사업팀,,,,,,정산지원,,도담,,,,비고';
    const headerRow = SETTLEMENT_COLUMNS.map(c => c.csvHeader).join(',');
    const dataRows: string[] = [];

    for (let i = 0; i < 500; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      const month = String((i % 12) + 1).padStart(2, '0');
      const amount = ((i + 1) * 10000).toLocaleString('en');
      const cells = SETTLEMENT_COLUMNS.map((col) => {
        if (col.csvHeader === '작성자') return `PM${i % 10}`;
        if (col.csvHeader === 'No.') return String(i + 1);
        if (col.csvHeader === '거래일시') return `2026-${month}-${day}`;
        if (col.csvHeader === '사업비 사용액') return amount;
        if (col.csvHeader === '통장에 찍힌 입/출금액') return amount;
        if (col.csvHeader === '비목') return ['인건비', '여비교통비', '외주비', '소모품비'][i % 4];
        if (col.csvHeader === '지급처') return `거래처${i}`;
        if (col.csvHeader === '상세 적요') return `제${i + 1}회 거래 적요`;
        if (col.csvHeader === 'cashflow항목') return '직접사업비';
        return '';
      });
      dataRows.push(cells.join(','));
    }

    const csvText = [headerGroup, headerRow, ...dataRows].join('\n');

    const start = performance.now();
    const matrix = parseCsv(csvText);
    const rows = normalizeMatrixToImportRows(matrix);
    const elapsed = performance.now() - start;

    expect(rows.length).toBe(500,
      '500개 데이터 행이 모두 변환되어야 한다');
    // 성능 기준: normalizeMatrixToImportRows는 헤더 매칭에 O(rows * cols^2) 비용이 있다.
    // 실제 운영에서 PM이 업로드하는 CSV는 통상 50~200행이므로 500행은 충분한 여유.
    expect(elapsed).toBeLessThan(10_000,
      `파싱+정규화가 10초 이내여야 한다 (실제: ${elapsed.toFixed(1)}ms)`);
  });
});

describe('스트레스 2: 5년치 주차 계산 — 빈틈 없는 커버리지', () => {
  it('2022~2026년 5년치 주차가 모든 날짜를 빠짐없이 커버한다', () => {
    for (let year = 2022; year <= 2026; year++) {
      const weeks = getYearMondayWeeks(year);

      expect(weeks.length).toBeGreaterThan(40,
        `${year}년 주차 수가 40 이상이어야 한다 (일반적으로 48~53)`);
      expect(weeks.length).toBeLessThan(60,
        `${year}년 주차 수가 60 미만이어야 한다`);

      // 해당 연도의 모든 날짜가 어딘가의 주차에 속하는지 검증
      const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
      const totalDays = isLeap ? 366 : 365;
      let coveredDays = 0;

      for (let dayOfYear = 1; dayOfYear <= totalDays; dayOfYear++) {
        const date = new Date(Date.UTC(year, 0, dayOfYear));
        const isoDate = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
        const found = findWeekForDate(isoDate, weeks);

        if (found) coveredDays++;
      }

      // 주차 경계(12월 말~1월 초)에서 이전/다음 연도 주차에 속하는 날도 있을 수 있다
      // 이런 경우 findWeekForDate가 인접 월의 주차를 찾아준다
      expect(coveredDays).toBe(totalDays,
        `${year}년 ${totalDays}일 중 ${coveredDays}일만 주차에 매핑됨 — 모든 날짜가 커버되어야 한다`);
    }
  });

  it('주차 간 겹침(overlap)이 없다', () => {
    const weeks = getYearMondayWeeks(2026);

    for (let i = 0; i < weeks.length - 1; i++) {
      const current = weeks[i];
      const next = weeks[i + 1];

      // 주차가 같은 월 내에서 연속이면 겹치지 않아야 한다
      if (current.yearMonth === next.yearMonth) {
        expect(current.weekEnd < next.weekStart,
          `${current.label}의 끝(${current.weekEnd})이 ${next.label}의 시작(${next.weekStart}) 전이어야 한다`).toBe(true);
      }
    }
  });

  it('모든 주차가 정확히 7일(수~화)이다', () => {
    const weeks = getYearMondayWeeks(2026);

    for (const week of weeks) {
      const start = new Date(week.weekStart);
      const end = new Date(week.weekEnd);
      const diffMs = end.getTime() - start.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      expect(diffDays).toBe(6,
        `주차 ${week.label}의 기간이 6일(수~화, 7일간)이어야 한다 (weekStart~weekEnd 차이)`);

      // 수요일(3) 시작 확인
      const startDay = new Date(Date.UTC(
        parseInt(week.weekStart.slice(0, 4)),
        parseInt(week.weekStart.slice(5, 7)) - 1,
        parseInt(week.weekStart.slice(8, 10)),
      )).getUTCDay();
      expect(startDay).toBe(3,
        `주차 ${week.label}이 수요일(3)에 시작해야 한다 (실제: ${startDay})`);

      // 화요일(2) 종료 확인
      const endDay = new Date(Date.UTC(
        parseInt(week.weekEnd.slice(0, 4)),
        parseInt(week.weekEnd.slice(5, 7)) - 1,
        parseInt(week.weekEnd.slice(8, 10)),
      )).getUTCDay();
      expect(endDay).toBe(2,
        `주차 ${week.label}이 화요일(2)에 끝나야 한다 (실제: ${endDay})`);
    }
  });
});

describe('스트레스 3: 120개 프로젝트 동시 캐시플로우 계산', () => {
  it('120개 프로젝트의 캐시플로우를 1000ms 이내에 계산한다', () => {
    const JAN_WEEKS = getMonthMondayWeeks('2026-01');

    // 120개 프로젝트, 각 10개 거래 (총 1200건)
    const allProjectTotals: { projectId: string; totals: CashflowTotals }[] = [];

    const start = performance.now();

    for (let p = 0; p < 120; p++) {
      const projectId = `proj-${String(p + 1).padStart(3, '0')}`;
      const transactions: Transaction[] = [];

      // 입금 1건
      transactions.push(makeTransaction({
        id: `${projectId}-in`,
        projectId,
        direction: 'IN',
        dateTime: '2026-01-07',
        cashflowCategory: 'CONTRACT_PAYMENT',
        amounts: {
          bankAmount: (p + 1) * 1_000_000,
          depositAmount: (p + 1) * 1_000_000,
          expenseAmount: 0, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0,
        },
      }));

      // 출금 9건
      for (let t = 0; t < 9; t++) {
        const day = String(10 + t).padStart(2, '0');
        transactions.push(makeTransaction({
          id: `${projectId}-out-${t}`,
          projectId,
          direction: 'OUT',
          dateTime: `2026-01-${day}`,
          cashflowCategory: 'OUTSOURCING',
          amounts: {
            bankAmount: 100_000,
            depositAmount: 0,
            expenseAmount: 100_000,
            vatIn: 10_000, vatOut: 0, vatRefund: 0, balanceAfter: 0,
          },
        }));
      }

      const weeklyActual = aggregateTransactionsToActual(transactions, JAN_WEEKS);

      // 주차별 합산
      const merged: Partial<Record<CashflowSheetLineId, number>> = {};
      for (const [, bucket] of weeklyActual) {
        for (const [key, val] of Object.entries(bucket)) {
          const k = key as CashflowSheetLineId;
          merged[k] = (merged[k] || 0) + (val as number);
        }
      }

      allProjectTotals.push({
        projectId,
        totals: computeCashflowTotals(merged),
      });
    }

    const elapsed = performance.now() - start;

    expect(allProjectTotals.length).toBe(120,
      '120개 프로젝트 모두 계산되어야 한다');

    // 첫 번째 프로젝트 검증: 입금 100만 - 출금 (9 * 9만) = 100만 - 81만 = 19만
    // 직접사업비 = 9 * (100000 - 10000) = 810000, 매입부가세 = 9 * 10000 = 90000
    const first = allProjectTotals[0].totals;
    expect(first.totalIn).toBe(1_000_000,
      '첫 프로젝트 IN 합계: 100만원');
    expect(first.totalOut).toBe(900_000,
      '첫 프로젝트 OUT 합계: 직접사업비 81만 + 매입부가세 9만 = 90만원');
    expect(first.net).toBe(100_000,
      '첫 프로젝트 NET: 100만 - 90만 = 10만원');

    expect(elapsed).toBeLessThan(1000,
      `120개 프로젝트 캐시플로우 계산이 1000ms 이내여야 한다 (실제: ${elapsed.toFixed(1)}ms)`);
  });
});

describe('스트레스 4: 은행 대사 100건 x 100건 매칭', () => {
  it('100건 은행 x 100건 시스템 거래를 중복 없이 매칭한다', () => {
    const bankTxs: BankTransaction[] = [];
    const systemTxs: Transaction[] = [];

    for (let i = 0; i < 100; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      const amount = (i + 1) * 50_000;

      bankTxs.push({
        id: `bank-${i}`,
        date: `2026-01-${day}`,
        description: `거래 ${i}`,
        amount,
        direction: 'OUT',
        balance: 0,
      });

      // 시스템 거래는 날짜를 0~1일 랜덤 차이로 설정
      const sysDayOffset = i % 2; // 짝수면 같은 날, 홀수면 1일 차이
      const sysDay = Math.min(28, (i % 28) + 1 + sysDayOffset);
      systemTxs.push(makeTransaction({
        id: `sys-${i}`,
        projectId: 'proj-1',
        direction: 'OUT',
        dateTime: `2026-01-${String(sysDay).padStart(2, '0')}`,
        amounts: {
          bankAmount: amount,
          depositAmount: 0,
          expenseAmount: amount,
          vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0,
        },
      }));
    }

    const start = performance.now();
    const results = autoMatchBankTransactions(bankTxs, systemTxs, 2);
    const elapsed = performance.now() - start;

    const matched = results.filter(r => r.status === 'MATCHED');

    // 중복 매칭 검증: 각 bankTx가 최대 1번만 매칭
    const bankIds = matched.map(r => r.bankTx!.id);
    const uniqueBankIds = new Set(bankIds);
    expect(bankIds.length).toBe(uniqueBankIds.size,
      '각 은행 거래가 최대 1건의 시스템 거래에만 매칭되어야 한다 (중복 없음)');

    // 중복 매칭 검증: 각 systemTx가 최대 1번만 매칭
    const sysIds = matched.map(r => r.systemTx!.id);
    const uniqueSysIds = new Set(sysIds);
    expect(sysIds.length).toBe(uniqueSysIds.size,
      '각 시스템 거래가 최대 1건의 은행 거래에만 매칭되어야 한다 (중복 없음)');

    // 성능 — O(n*m) 알고리즘이지만 100x100 = 10,000건은 빨라야 한다
    expect(elapsed).toBeLessThan(200,
      `100x100 매칭이 200ms 이내여야 한다 (실제: ${elapsed.toFixed(1)}ms)`);
  });
});

describe('스트레스 5: 한글 인코딩 스트레스 테스트', () => {
  it('특수문자가 포함된 CSV를 올바르게 파싱한다', () => {
    const specialCsv = [
      '거래일시,지급처,상세 적요,사업비 사용액',
      '2026-01-05,㈜한국테크,"㉠ 소프트웨어 라이선스, ₩1,000,000","1,000,000"',
      '2026-01-10,"㈜코리아(주)","테스트 ""인용"" 처리",500000',
      '2026-01-15,가나다라마바사아자차카타파하,"' + '한'.repeat(200) + '",100000',
    ].join('\n');

    const matrix = parseCsv(specialCsv);

    expect(matrix.length).toBe(4,
      '헤더 1행 + 데이터 3행');

    // ㈜ 특수문자
    expect(matrix[1][1]).toBe('㈜한국테크',
      '㈜ 특수문자가 보존되어야 한다');

    // ㉠, ₩ 특수문자
    expect(matrix[1][2]).toContain('㉠',
      '㉠ 원문자가 보존되어야 한다');
    expect(matrix[1][2]).toContain('₩',
      '₩ 원화 기호가 보존되어야 한다');

    // 따옴표 이스케이프
    expect(matrix[2][2]).toContain('테스트 "인용" 처리',
      '이중 따옴표 이스케이프가 올바르게 처리되어야 한다');

    // 200자 한글 문자열
    expect(matrix[3][2]).toBe('한'.repeat(200),
      '200자 한글 문자열이 온전히 보존되어야 한다');

    // 콤마 포함 숫자 파싱 (따옴표 안)
    expect(parseNumber(matrix[1][3])).toBe(1_000_000,
      '따옴표 안의 콤마 포함 숫자가 올바르게 파싱되어야 한다');
  });

  it('parseNumber가 다양한 한국 통화 형식을 처리한다', () => {
    expect(parseNumber('1,000,000')).toBe(1_000_000, '콤마 구분 숫자');
    expect(parseNumber('₩5,000')).toBe(5_000, '₩ 기호 포함');
    expect(parseNumber('1000원')).toBe(1000, '원 단위 포함');
    expect(parseNumber(' 2,500,000 ')).toBe(2_500_000, '공백 포함');
    expect(parseNumber('')).toBe(null, '빈 문자열은 null');
    expect(parseNumber('-500,000')).toBe(-500_000, '음수 금액');
  });

  it('parseDate가 다양한 한국 날짜 형식을 처리한다', () => {
    expect(parseDate('2026-01-15')).toBe('2026-01-15', 'ISO 형식');
    expect(parseDate('2026.01.15')).toBe('2026-01-15', '마침표 구분');
    expect(parseDate('2026/01/15')).toBe('2026-01-15', '슬래시 구분');
    expect(parseDate('01-15-2026')).toBe('2026-01-15', 'MM-DD-YYYY 형식');
    expect(parseDate('')).toBe('', '빈 문자열');
    expect(parseDate('not-a-date')).toBe('', '잘못된 날짜');
  });

  it('toCsv + parseCsv 라운드트립이 데이터를 보존한다', () => {
    const original: string[][] = [
      ['이름', '금액', '비고'],
      ['㈜테스트', '1,000,000', '특수문자 ㉠㉡㉢'],
      ['홍길동', '500000', '"따옴표" 포함'],
      ['김,콤마', '0', '콤마\n줄바꿈'],
    ];

    const csv = toCsv(original);
    const parsed = parseCsv(csv);

    expect(parsed.length).toBe(original.length,
      '행 수가 보존되어야 한다');

    for (let i = 0; i < original.length; i++) {
      for (let j = 0; j < original[i].length; j++) {
        expect(parsed[i][j]).toBe(original[i][j],
          `[${i}][${j}] 셀 값이 보존되어야 한다: "${original[i][j]}"`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 추가 비즈니스 검증: 정산 행 파생 (derivation) 세부 로직
// ═══════════════════════════════════════════════════════════════

describe('정산 행 파생(Derivation) 세부 로직 검증', () => {
  it('통장금액만 있을 때 사업비사용액이 자동 계산된다', () => {
    // 실제 시나리오: PM이 통장 내역만 붙여넣으면 사업비사용액을 자동 역산
    const context = buildSettlementDerivationContext('proj-1', 'ledger-1');
    const bankAmountIdx = getColIdx('통장에 찍힌 입/출금액');
    const expenseIdx = getColIdx('사업비 사용액');
    const vatInIdx = getColIdx('매입부가세');
    const cashflowIdx = getColIdx('cashflow항목');

    const cells = SETTLEMENT_COLUMNS.map(() => '');
    cells[getColIdx('거래일시')] = '2026-01-15';
    cells[bankAmountIdx] = '1,100,000';
    cells[cashflowIdx] = '직접사업비';
    // 사업비사용액과 매입부가세 비움 — derive가 자동 계산해야 함

    const importRow: ImportRow = { tempId: 'test-1', cells };
    const derived = deriveSettlementRows([importRow], context, { mode: 'full' });

    const derivedExpense = parseNumber(derived[0].cells[expenseIdx]);
    expect(derivedExpense).toBe(1_100_000,
      '매입부가세가 없으므로 사업비사용액 = 통장금액(110만원)이어야 한다');
  });

  it('사업비사용액이 있으면 매입부가세가 자동 역산된다', () => {
    const context = buildSettlementDerivationContext('proj-1', 'ledger-1');
    const bankAmountIdx = getColIdx('통장에 찍힌 입/출금액');
    const expenseIdx = getColIdx('사업비 사용액');
    const vatInIdx = getColIdx('매입부가세');

    const cells = SETTLEMENT_COLUMNS.map(() => '');
    cells[getColIdx('거래일시')] = '2026-01-15';
    cells[bankAmountIdx] = '1,100,000';
    cells[expenseIdx] = '1,000,000';
    // 매입부가세 비움 — bankAmount - expense = 100,000

    const importRow: ImportRow = { tempId: 'test-2', cells };
    const derived = deriveSettlementRows([importRow], context, { mode: 'full' });

    const derivedVat = parseNumber(derived[0].cells[vatInIdx]);
    expect(derivedVat).toBe(100_000,
      '매입부가세 = 통장금액(110만) - 사업비사용액(100만) = 10만원');
  });

  it('resolveEvidenceRequiredDesc가 비목/세목 다양한 패턴을 매핑한다', () => {
    const map: Record<string, string> = {
      '인건비|보조연구원': '근로계약서, 급여명세서',
      '여비교통비': '출장명령서',
      '1. 인건비|1-1. 보조연구원': '급여대장',
    };

    // 정확 매칭
    expect(resolveEvidenceRequiredDesc(map, '인건비', '보조연구원')).toBe('근로계약서, 급여명세서',
      '비목|세목 정확 매칭');

    // 비목만 매칭
    expect(resolveEvidenceRequiredDesc(map, '여비교통비', '국내출장비')).toBe('출장명령서',
      '비목만으로 매칭 — 세목은 매칭 대상이 아님');

    // 번호 접두사가 있는 비목/세목 매칭
    expect(resolveEvidenceRequiredDesc(map, '1. 인건비', '1-1. 보조연구원')).toBe('급여대장',
      '번호 접두사 포함 비목/세목 매칭');

    // 매칭 불가
    expect(resolveEvidenceRequiredDesc(map, '장비비', '서버')).toBe('',
      '매핑에 없는 비목/세목은 빈 문자열');

    // undefined map
    expect(resolveEvidenceRequiredDesc(undefined, '인건비', '보조연구원')).toBe('',
      'map이 undefined면 빈 문자열');
  });
});
