import { describe, expect, it } from 'vitest';
import type { Transaction } from '../data/types';
import { getYearMondayWeeks } from './cashflow-weeks';
import {
  analyzeSettlementHeaderMapping,
  createQuickEntryImportRow,
  buildSettlementDataPreview,
  createEmptyImportRow,
  exportImportRowsCsv,
  exportSettlementCsv,
  getCashflowLineLabelForExport,
  importRowToTransaction,
  normalizeMatrixToImportRows,
  parseCashflowLineLabel,
  SETTLEMENT_COLUMNS,
  transactionsToImportRows,
  type ImportRow,
} from './settlement-csv';

function readCell(row: { cells: string[] }, header: string): string {
  const index = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
  expect(index).toBeGreaterThanOrEqual(0);
  return row.cells[index];
}

function makeImportRow(values: Record<string, string>, tempId?: string): ImportRow {
  return {
    tempId: tempId || `test-${Math.random().toString(36).slice(2, 8)}`,
    cells: SETTLEMENT_COLUMNS.map((col) => values[col.csvHeader] || ''),
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const now = new Date().toISOString();
  return {
    id: 'tx-001',
    ledgerId: 'l-001',
    projectId: 'p-001',
    state: 'DRAFT',
    dateTime: '2026-03-05',
    weekCode: '',
    direction: 'OUT',
    method: 'TRANSFER',
    cashflowCategory: 'OUTSOURCING',
    cashflowLabel: '직접사업비',
    budgetCategory: '회의비',
    counterparty: '카페 메리',
    memo: '간식 구매',
    amounts: {
      bankAmount: 33000,
      depositAmount: 0,
      expenseAmount: 30000,
      vatIn: 3000,
      vatOut: 0,
      vatRefund: 0,
      balanceAfter: 955000,
    },
    evidenceRequired: [],
    evidenceStatus: 'MISSING',
    evidenceMissing: [],
    attachmentsCount: 0,
    createdBy: 'test',
    createdAt: now,
    updatedBy: 'test',
    updatedAt: now,
    author: '메리',
    budgetSubCategory: '다과비',
    ...overrides,
  };
}

// ── parseCashflowLineLabel ──

describe('parseCashflowLineLabel', () => {
  it('returns undefined for empty input', () => {
    expect(parseCashflowLineLabel('')).toBeUndefined();
  });

  it('matches exact canonical labels', () => {
    expect(parseCashflowLineLabel('매출액(입금)')).toBe('SALES_IN');
    expect(parseCashflowLineLabel('직접사업비')).toBe('DIRECT_COST_OUT');
    expect(parseCashflowLineLabel('매입부가세')).toBe('INPUT_VAT_OUT');
  });

  it('matches alias labels', () => {
    expect(parseCashflowLineLabel('MYSC선입금')).toBe('MYSC_PREPAY_IN');
    expect(parseCashflowLineLabel('MYSC 선입금(입금필요시)')).toBe('MYSC_PREPAY_IN');
    expect(parseCashflowLineLabel('MYSC인건비')).toBe('MYSC_LABOR_OUT');
    expect(parseCashflowLineLabel('MYSC수익(간접비등)')).toBe('MYSC_PROFIT_OUT');
  });

  it('fuzzy-matches by stripping spaces', () => {
    expect(parseCashflowLineLabel('MYSC 인건비')).toBe('MYSC_LABOR_OUT');
    expect(parseCashflowLineLabel('MYSC 수익(간접비등)')).toBe('MYSC_PROFIT_OUT');
    expect(parseCashflowLineLabel('은행이자(입금)')).toBe('BANK_INTEREST_IN');
  });

  it('returns undefined for unknown labels', () => {
    expect(parseCashflowLineLabel('알 수 없는 항목')).toBeUndefined();
    expect(parseCashflowLineLabel('random text')).toBeUndefined();
  });
});

// ── getCashflowLineLabelForExport ──

describe('getCashflowLineLabelForExport', () => {
  it('returns empty string for falsy input', () => {
    expect(getCashflowLineLabelForExport(undefined)).toBe('');
    expect(getCashflowLineLabelForExport('')).toBe('');
  });

  it('returns the Korean label for all known line IDs', () => {
    expect(getCashflowLineLabelForExport('MYSC_PREPAY_IN')).toBe('MYSC 선입금(잔금 등 입금 필요 시)');
    expect(getCashflowLineLabelForExport('SALES_IN')).toBe('매출액(입금)');
    expect(getCashflowLineLabelForExport('SALES_VAT_IN')).toBe('매출부가세(입금)');
    expect(getCashflowLineLabelForExport('TEAM_SUPPORT_IN')).toBe('팀지원금(입금)');
    expect(getCashflowLineLabelForExport('BANK_INTEREST_IN')).toBe('은행이자(입금)');
    expect(getCashflowLineLabelForExport('DIRECT_COST_OUT')).toBe('직접사업비');
    expect(getCashflowLineLabelForExport('INPUT_VAT_OUT')).toBe('매입부가세');
    expect(getCashflowLineLabelForExport('MYSC_LABOR_OUT')).toBe('MYSC 인건비');
    expect(getCashflowLineLabelForExport('MYSC_PROFIT_OUT')).toBe('MYSC 수익(간접비 등)');
    expect(getCashflowLineLabelForExport('SALES_VAT_OUT')).toBe('매출부가세(출금)');
    expect(getCashflowLineLabelForExport('TEAM_SUPPORT_OUT')).toBe('팀지원금(출금)');
    expect(getCashflowLineLabelForExport('BANK_INTEREST_OUT')).toBe('은행이자(출금)');
  });

  it('returns the raw lineId for unknown IDs', () => {
    expect(getCashflowLineLabelForExport('UNKNOWN_ID')).toBe('UNKNOWN_ID');
  });
});

// ── analyzeSettlementHeaderMapping ──

describe('analyzeSettlementHeaderMapping', () => {
  it('identifies valid settlement headers', () => {
    const matrix = [
      ['작성자', 'No.', '거래일시', '해당 주차', '지출구분', '비목', '세목', '세세목', 'cashflow항목', '통장잔액', '통장에 찍힌 입/출금액', '입금액(사업비,공급가액,은행이자)', '매입부가세 반환', '사업비 사용액', '매입부가세', '지급처', '상세 적요', '필수증빙자료 리스트', '실제 구비 완료된 증빙자료 리스트', '준비필요자료', '증빙자료 드라이브', '준비 필요자료', 'e나라 등록', 'e나라 집행', '부가세 지결 완료여부', '최종완료', '비고'],
      ['메리', '1', '2026-03-05', '', '출금', '회의비', '다과비', '', '직접사업비', '955,000', '33,000', '', '', '30,000', '3,000', '카페 메리', '간식 구매', '', '', '', '', '', '', '', '', '', ''],
    ];

    const analysis = analyzeSettlementHeaderMapping(matrix);
    expect(analysis.matchedHeaders.length).toBeGreaterThan(10);
    expect(analysis.unmatchedHeaders.length).toBe(0);
    expect(analysis.matchedCriticalFields).toContain('거래일시');
    expect(analysis.matchedCriticalFields).toContain('비목');
    expect(analysis.matchedCriticalFields).toContain('지급처');
  });

  it('reports missing headers when matrix is sparse', () => {
    const matrix = [
      ['작성자', 'No.', '거래일시'],
      ['메리', '1', '2026-03-05'],
    ];

    const analysis = analyzeSettlementHeaderMapping(matrix);
    expect(analysis.unmatchedCriticalFields.length).toBeGreaterThan(0);
    expect(analysis.matchedCriticalFields).toContain('거래일시');
  });

  it('matches Korean alias headers in two-row grouped format', () => {
    const matrix = [
      ['기본정보', '', '', '', '', '', '', '', '', '', '', '입금합계', '', '출금합계', '', '사업팀', '', '', '', '', '정산지원', '', '도담', '', '', '', '비고'],
      ['작성자', 'No.', '거래일시', '해당 주차', '지출구분', '비목', '세목', '세세목', 'cashflow항목', '통장잔액', '통장에 찍힌 입/출금액', '입금액(사업비,공급가액,은행이자)', '매입부가세 반환', '사업비 사용액', '매입부가세', '지급처', '상세 적요', '필수증빙자료 리스트', '실제 구비 완료된 증빙자료 리스트', '준비필요자료', '증빙자료 드라이브', '준비 필요자료', 'e나라 등록', 'e나라 집행', '부가세 지결 완료여부', '최종완료', '비고'],
      ['메리', '1', '2026-03-05', '', '출금', '회의비', '다과비', '', '직접사업비', '', '33,000', '', '', '30,000', '3,000', '카페 메리', '간식 구매', '', '', '', '', '', '', '', '', '', ''],
    ];

    const analysis = analyzeSettlementHeaderMapping(matrix);
    // Single-row header already contains all detail columns, so no two-row merge needed
    expect(analysis.headerRowIndices.length).toBeGreaterThanOrEqual(1);
    expect(analysis.matchedCriticalFields).toContain('사업비 사용액');
    expect(analysis.matchedCriticalFields).toContain('상세 적요');
  });

  it('returns empty analysis for empty matrix', () => {
    const analysis = analyzeSettlementHeaderMapping([]);
    expect(analysis.headers).toEqual([]);
    expect(analysis.matchedHeaders).toEqual([]);
  });
});

// ── normalizeMatrixToImportRows ──

describe('normalizeMatrixToImportRows', () => {
  it('parses grouped two-row settlement headers from the common sheet format', () => {
    const matrix = [
      ['사업명', '샘플 사업'],
      ['작성자', 'No.', '거래일시', '해당 주차', '지출구분', '비목', '세목', '세세목', 'cashflow항목', '통장잔액', '통장에 찍힌 입/출금액', '입금합계', '', '출금합계', '', '사업팀', '', '', '', '', '정산지원 담당자', '', '도담', '', '', '', '비고'],
      ['', '', '', '', '', '', '', '', '', '', '', '입금액(사업비, 공급가액,은행이자)', '매입부가세 반환', '사업비 사용액', '매입부가세', '지급처', '상세 적요', '필수증빙자료 리스트', '실제 구비 완료된 증빙자료 리스트', '준비필요자료', '증빙자료 드라이브', '(도담 or 써니) 준비 필요자료', 'e나라 등록', 'e나라 집행', '부가세 지결 완료여부', '최종완료', '비고'],
      ['메리', '7', '2026-03-05', '', '출금', '회의비', '다과비', '', '직접사업비', '955,000', '33,000', '', '', '30,000', '3,000', '카페 메리', '간식 구매', '영수증', '영수증', '', 'https://drive.google.com/example', '없음', 'Y', 'N', '완료', 'Y', '샘플 비고'],
    ];

    const rows = normalizeMatrixToImportRows(matrix);

    expect(rows).toHaveLength(1);
    expect(readCell(rows[0], 'No.')).toBe('1');
    expect(readCell(rows[0], '작성자')).toBe('메리');
    expect(readCell(rows[0], '입금액(사업비,공급가액,은행이자)')).toBe('');
    expect(readCell(rows[0], '사업비 사용액')).toBe('30,000');
    expect(readCell(rows[0], '매입부가세')).toBe('3,000');
    expect(readCell(rows[0], '지급처')).toBe('카페 메리');
    expect(readCell(rows[0], '필수증빙자료 리스트')).toBe('영수증');
    expect(readCell(rows[0], '실제 구비 완료된 증빙자료 리스트')).toBe('영수증');
    expect(readCell(rows[0], '준비 필요자료')).toBe('없음');
    expect(readCell(rows[0], 'e나라 등록')).toBe('Y');
    expect(readCell(rows[0], '최종완료')).toBe('Y');
    expect(readCell(rows[0], '비고')).toBe('샘플 비고');
  });

  it('supports hybrid two-row headers and merges special workbook evidence columns', () => {
    const matrix = [
      ['기본 정보', '', '', '', '', '', '', '', '', '', '입금/출금', '입금/출금', '입금/출금', '입금/출금', '사업팀', '사업팀', '증빙', '증빙', '정산지원', '도담', '도담'],
      ['작성자', 'No.', '거래일시', '비목', '세목', 'cashflow항목', '통장잔액', '통장에 찍힌 입/출금액', '입금액', '매입부가세 반환', '사업비 사용액', '매입부가세', '지급처', '상세 적요(내용)', '필수 증빙 자료', '추가 증빙 자료', '작성 필요 자료', '드라이브 바로가기', '도담 준비 필요자료', 'e나라 등록', '최종완료'],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['보람', '12', '2026-03-17', '여비', '교통비', '직접사업비(공급가액)+매입부가세', '120,000', '', '', '', '50,000', '5,000', 'KTX', '서울 출장', '출장신청서', '영수증', '지출결의서', 'https://drive.google.com/example', '정산 메모', 'Y', 'N'],
    ];

    const analysis = analyzeSettlementHeaderMapping(matrix);
    const rows = normalizeMatrixToImportRows(matrix);

    expect(analysis.matchedHeaders.some((header) => header.includes('상세 적요'))).toBe(true);
    expect(rows).toHaveLength(1);
    expect(readCell(rows[0], '상세 적요')).toBe('서울 출장');
    expect(readCell(rows[0], '필수증빙자료 리스트')).toBe('출장신청서, 영수증');
    expect(readCell(rows[0], '준비필요자료')).toBe('지출결의서');
    expect(readCell(rows[0], '증빙자료 드라이브')).toBe('https://drive.google.com/example');
    expect(readCell(rows[0], '준비 필요자료')).toBe('정산 메모');
    expect(readCell(rows[0], '사업비 사용액')).toBe('50,000');
    expect(readCell(rows[0], '매입부가세')).toBe('5,000');
  });

  it('skips explanatory top rows and selects grouped plus detail headers from usage workbooks', () => {
    const matrix = [
      ['s', '', '', '드롭다운에서 선택', '', '', '', '', '', '', '', '', '', '< 매입부가세 관리가 필요한 사업>', '', '', '', '', '', '', '', '', '', '', ''],
      ['작성자', 'No.', '거래일시', '해당 주차', '지출구분', '비목', '세목', 'cashflow항목', '통장잔액', '통장에 찍힌\n입/출금액', '<입금합계>', '', '<출금합계>', '', '사업팀', '', '', '', '', '파워하우스 담당자', ''],
      ['', '', '', '', '', '', '', '', '', '', '입금액(사업비, 공급가액,은행이자)', '매입부가세 반환', '사업비 사용액 (공급가액, 원천세, 매출부가세,은행이자)', '매입부가세', '지급처', '상세 적요(내용)', '필수 증빙 자료', '추가 증빙 자료', '작성 필요 자료', '도담 준비 필요자료', '드라이브 바로가기'],
      ['보람', '14', '2026-03-17', '26-03-03', '출금', '여비', '교통비', '직접사업비(공급가액)+매입부가세', '120,000', '', '', '', '50,000', '5,000', 'KTX', '서울 출장', '출장신청서', '영수증', '지출결의서', '정산 메모', 'https://drive.google.com/example'],
    ];

    const analysis = analyzeSettlementHeaderMapping(matrix);
    const rows = normalizeMatrixToImportRows(matrix);

    expect(analysis.headerRowIndices).toEqual([1, 2]);
    expect(analysis.matchedCriticalFields).toEqual(expect.arrayContaining([
      '사업비 사용액',
      '지급처',
      '상세 적요',
      '필수증빙자료 리스트',
      '증빙자료 드라이브',
    ]));
    expect(rows).toHaveLength(1);
    expect(readCell(rows[0], '사업비 사용액')).toBe('50,000');
    expect(readCell(rows[0], '지급처')).toBe('KTX');
    expect(readCell(rows[0], '상세 적요')).toBe('서울 출장');
    expect(readCell(rows[0], '필수증빙자료 리스트')).toBe('출장신청서, 영수증');
    expect(readCell(rows[0], '준비필요자료')).toBe('지출결의서');
    expect(readCell(rows[0], '준비 필요자료')).toBe('정산 메모');
    expect(readCell(rows[0], '증빙자료 드라이브')).toBe('https://drive.google.com/example');
  });

  it('returns empty array for matrix with fewer than 2 rows', () => {
    expect(normalizeMatrixToImportRows([])).toEqual([]);
    expect(normalizeMatrixToImportRows([['거래일시']])).toEqual([]);
  });

  it('skips fully empty data rows', () => {
    const matrix = [
      ['작성자', 'No.', '거래일시', '지급처'],
      ['메리', '1', '2026-03-05', '카페'],
      ['', '', '', ''],
      ['보람', '2', '2026-03-06', 'KTX'],
    ];
    const rows = normalizeMatrixToImportRows(matrix);
    expect(rows).toHaveLength(2);
    expect(readCell(rows[0], '작성자')).toBe('메리');
    expect(readCell(rows[1], '작성자')).toBe('보람');
  });

  it('auto-fills No. column with sequential numbers', () => {
    const matrix = [
      ['작성자', 'No.', '거래일시'],
      ['메리', '99', '2026-03-05'],
      ['보람', '100', '2026-03-06'],
    ];
    const rows = normalizeMatrixToImportRows(matrix);
    expect(readCell(rows[0], 'No.')).toBe('1');
    expect(readCell(rows[1], 'No.')).toBe('2');
  });

  it('builds expense preview rows without header lines', () => {
    const matrix = [
      ['안내', '설명'],
      ['작성자', 'No.', '거래일시', '사업팀', ''],
      ['', '', '', '지급처', '상세 적요(내용)'],
      ['보람', '1', '2026-03-17', 'KTX', '서울 출장'],
      ['메리', '2', '2026-03-18', '카페 메리', '간식 구매'],
    ];

    const preview = buildSettlementDataPreview(matrix, 10, 5);

    expect(preview).toEqual([
      ['보람', '1', '2026-03-17', 'KTX', '서울 출장'],
      ['메리', '2', '2026-03-18', '카페 메리', '간식 구매'],
    ]);
  });
});

// ── createEmptyImportRow ──

describe('createEmptyImportRow', () => {
  it('creates a row with the correct number of empty cells', () => {
    const row = createEmptyImportRow();
    expect(row.cells).toHaveLength(SETTLEMENT_COLUMNS.length);
    expect(row.cells.every((c) => c === '')).toBe(true);
  });

  it('has a tempId', () => {
    const row = createEmptyImportRow();
    expect(row.tempId).toBeTruthy();
    expect(typeof row.tempId).toBe('string');
  });

  it('generates unique tempIds', () => {
    const row1 = createEmptyImportRow();
    const row2 = createEmptyImportRow();
    expect(row1.tempId).not.toBe(row2.tempId);
  });

  it('stores a non-standard entry kind when provided', () => {
    const row = createEmptyImportRow('DEPOSIT');
    expect(row.entryKind).toBe('DEPOSIT');
  });
});

describe('createQuickEntryImportRow', () => {
  it('creates an adjustment row with the expected metadata', () => {
    const row = createQuickEntryImportRow('ADJUSTMENT');
    expect(row.entryKind).toBe('ADJUSTMENT');
    expect(readCell(row, '상세 적요')).toBe('잔액 조정');
    expect(readCell(row, '거래일시')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── transactionsToImportRows ──

describe('transactionsToImportRows', () => {
  const weeks = getYearMondayWeeks(2026);

  it('converts a transaction to an ImportRow with correct cell values', () => {
    const tx = makeTransaction();
    const rows = transactionsToImportRows([tx], weeks);

    expect(rows).toHaveLength(1);
    expect(rows[0].sourceTxId).toBe('tx-001');
    expect(readCell(rows[0], 'No.')).toBe('1');
    expect(readCell(rows[0], '작성자')).toBe('메리');
    expect(readCell(rows[0], '거래일시')).toBe('2026-03-05');
    expect(readCell(rows[0], '지출구분')).toBe('계좌이체');
    expect(readCell(rows[0], '비목')).toBe('회의비');
    expect(readCell(rows[0], '세목')).toBe('다과비');
    expect(readCell(rows[0], '지급처')).toBe('카페 메리');
    expect(readCell(rows[0], '상세 적요')).toBe('간식 구매');
    expect(readCell(rows[0], '통장잔액')).toContain('955');
    expect(readCell(rows[0], '사업비 사용액')).toContain('30');
    expect(readCell(rows[0], '매입부가세')).toContain('3');
  });

  it('sorts transactions by dateTime', () => {
    const tx1 = makeTransaction({ id: 'tx-b', dateTime: '2026-03-10' });
    const tx2 = makeTransaction({ id: 'tx-a', dateTime: '2026-03-05' });
    const rows = transactionsToImportRows([tx1, tx2], weeks);

    expect(rows[0].sourceTxId).toBe('tx-a');
    expect(rows[1].sourceTxId).toBe('tx-b');
    expect(readCell(rows[0], 'No.')).toBe('1');
    expect(readCell(rows[1], 'No.')).toBe('2');
  });

  it('populates the week label column', () => {
    const tx = makeTransaction({ dateTime: '2026-03-05' });
    const rows = transactionsToImportRows([tx], weeks);
    expect(readCell(rows[0], '해당 주차')).toBeTruthy();
  });

  it('returns empty array for empty transactions', () => {
    expect(transactionsToImportRows([], weeks)).toEqual([]);
  });
});

// ── importRowToTransaction ──

describe('importRowToTransaction', () => {
  it('maps all fields from ImportRow to Transaction', () => {
    const row = makeImportRow({
      '작성자': '메리',
      '거래일시': '2026-03-05',
      '지출구분': '계좌이체',
      '비목': '회의비',
      '세목': '다과비',
      'cashflow항목': '직접사업비',
      '통장잔액': '955,000',
      '통장에 찍힌 입/출금액': '33,000',
      '사업비 사용액': '30,000',
      '매입부가세': '3,000',
      '지급처': '카페 메리',
      '상세 적요': '간식 구매',
      '필수증빙자료 리스트': '영수증',
      '실제 구비 완료된 증빙자료 리스트': '영수증',
      'e나라 등록': 'Y',
      '부가세 지결 완료여부': 'Y',
      '최종완료': 'Y',
      '비고': '테스트 비고',
    });

    const result = importRowToTransaction(row, 'p-001', 'l-001', 0);
    expect(result.error).toBeUndefined();
    expect(result.transaction).toBeDefined();

    const tx = result.transaction!;
    expect(tx.projectId).toBe('p-001');
    expect(tx.ledgerId).toBe('l-001');
    expect(tx.dateTime).toBe('2026-03-05');
    expect(tx.method).toBe('TRANSFER');
    expect(tx.direction).toBe('OUT');
    expect(tx.budgetCategory).toBe('회의비');
    expect(tx.budgetSubCategory).toBe('다과비');
    expect(tx.budgetSubSubCategory).toBeUndefined();
    expect(tx.counterparty).toBe('카페 메리');
    expect(tx.memo).toBe('간식 구매');
    expect(tx.amounts.bankAmount).toBe(33000);
    expect(tx.amounts.expenseAmount).toBe(30000);
    expect(tx.amounts.vatIn).toBe(3000);
    expect(tx.amounts.balanceAfter).toBe(955000);
    expect(tx.author).toBe('메리');
    expect(tx.evidenceRequiredDesc).toBe('영수증');
    expect(tx.eNaraRegistered).toBe('Y');
    expect(tx.vatSettlementDone).toBe(true);
    expect(tx.settlementComplete).toBe(true);
    expect(tx.settlementNote).toBe('테스트 비고');
  });

  it('returns error for unparseable date', () => {
    const row = makeImportRow({ '거래일시': 'not-a-date', '통장에 찍힌 입/출금액': '10,000' });
    const result = importRowToTransaction(row, 'p-001', 'l-001', 0);
    expect(result.error).toBeTruthy();
  });

  it('returns empty result for effectively empty row', () => {
    const row = makeImportRow({ 'No.': '5', '해당 주차': '26-03-01' });
    const result = importRowToTransaction(row, 'p-001', 'l-001', 0);
    expect(result.transaction).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('infers IN direction for income cashflow lines', () => {
    const row = makeImportRow({
      '거래일시': '2026-03-05',
      'cashflow항목': '매출액(입금)',
      '통장에 찍힌 입/출금액': '100,000',
    });
    const result = importRowToTransaction(row, 'p-001', 'l-001', 0);
    expect(result.transaction?.direction).toBe('IN');
  });

  it('maps card payment method from label', () => {
    const row = makeImportRow({
      '거래일시': '2026-03-05',
      '지출구분': '사업비카드',
      '통장에 찍힌 입/출금액': '50,000',
    });
    const result = importRowToTransaction(row, 'p-001', 'l-001', 0);
    expect(result.transaction?.method).toBe('CORP_CARD_1');
  });

  it('uses sourceTxId for id when present', () => {
    const row: ImportRow = {
      tempId: 'tmp-1',
      sourceTxId: 'existing-tx-id',
      cells: SETTLEMENT_COLUMNS.map((col) => {
        if (col.csvHeader === '거래일시') return '2026-03-05';
        if (col.csvHeader === '통장에 찍힌 입/출금액') return '10,000';
        return '';
      }),
    };
    const result = importRowToTransaction(row, 'p-001', 'l-001', 0);
    expect(result.transaction?.id).toBe('existing-tx-id');
  });

  it('infers IN direction from a deposit entry row without cashflow label', () => {
    const row = makeImportRow({
      '거래일시': '2026-03-05',
      '입금액(사업비,공급가액,은행이자)': '100,000',
      '통장에 찍힌 입/출금액': '100,000',
    });
    row.entryKind = 'DEPOSIT';

    const result = importRowToTransaction(row, 'p-001', 'l-001', 0);
    expect(result.transaction?.direction).toBe('IN');
    expect(result.transaction?.entryKind).toBe('DEPOSIT');
  });

  it('requires a note for adjustment rows', () => {
    const row = makeImportRow({
      '거래일시': '2026-03-05',
      '통장잔액': '500,000',
    });
    row.entryKind = 'ADJUSTMENT';

    const result = importRowToTransaction(row, 'p-001', 'l-001', 0);
    expect(result.error).toBe('조정 사유를 비고에 입력해 주세요');
  });
});

// ── exportSettlementCsv ──

describe('exportSettlementCsv', () => {
  const weeks = getYearMondayWeeks(2026);

  it('produces CSV with group header, column header, and data rows', () => {
    const tx = makeTransaction({ dateTime: '2026-03-05' });
    const csv = exportSettlementCsv([tx], weeks);
    const lines = csv.split('\n');

    // At least: group header + column header + 1 data row
    expect(lines.length).toBeGreaterThanOrEqual(3);

    // Column header row should contain known headers
    expect(lines[1]).toContain('작성자');
    expect(lines[1]).toContain('거래일시');
    expect(lines[1]).toContain('비목');
  });

  it('sorts transactions by date within the CSV', () => {
    const txLate = makeTransaction({ id: 'tx-late', dateTime: '2026-03-20', counterparty: 'B사' });
    const txEarly = makeTransaction({ id: 'tx-early', dateTime: '2026-03-05', counterparty: 'A사' });
    const csv = exportSettlementCsv([txLate, txEarly], weeks);

    const dataLines = csv.split('\n').slice(2); // skip group + column headers
    expect(dataLines.length).toBeGreaterThanOrEqual(2);
    // First data row should be the earlier date
    expect(dataLines[0]).toContain('A사');
  });

  it('escapes CSV cells containing commas or quotes', () => {
    const tx = makeTransaction({ memo: '간식, "특별" 구매', counterparty: '카페,메리' });
    const csv = exportSettlementCsv([tx], weeks);
    // Cells with commas should be quoted
    expect(csv).toContain('"카페,메리"');
    expect(csv).toContain('"간식, ""특별"" 구매"');
  });

  it('returns only headers for empty transactions', () => {
    const csv = exportSettlementCsv([], weeks);
    const lines = csv.split('\n');
    // Only group header + column header
    expect(lines).toHaveLength(2);
  });

  it('maps payment method to Korean label', () => {
    const tx = makeTransaction({ method: 'CORP_CARD_1' });
    const csv = exportSettlementCsv([tx], weeks);
    expect(csv).toContain('사업비카드');
  });

  it('maps boolean fields to Y or empty', () => {
    const tx = makeTransaction({ vatSettlementDone: true, settlementComplete: false });
    const csv = exportSettlementCsv([tx], weeks);
    const lines = csv.split('\n');
    const dataRow = lines[2];
    // vatSettlementDone=true should be Y somewhere in the row
    expect(dataRow).toContain('Y');
  });
});

// ── exportImportRowsCsv ──

describe('exportImportRowsCsv', () => {
  it('produces CSV with group header, column header, and data rows', () => {
    const row = makeImportRow({ '작성자': '메리', '거래일시': '2026-03-05', '지급처': '카페' });
    const csv = exportImportRowsCsv([row]);
    const lines = csv.split('\n');

    expect(lines.length).toBe(3); // group header + column header + 1 data row
    expect(lines[1]).toContain('작성자');
    expect(lines[2]).toContain('메리');
  });

  it('returns only headers for empty rows', () => {
    const csv = exportImportRowsCsv([]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
  });

  it('escapes special characters', () => {
    const row = makeImportRow({ '상세 적요': '설명, "특이사항" 포함' });
    const csv = exportImportRowsCsv([row]);
    expect(csv).toContain('"설명, ""특이사항"" 포함"');
  });

  it('round-trips with normalizeMatrixToImportRows', () => {
    const original = makeImportRow({
      '작성자': '보람',
      '거래일시': '2026-03-17',
      '지출구분': '출금',
      '비목': '여비',
      '세목': '교통비',
      '지급처': 'KTX',
      '상세 적요': '서울 출장',
      '사업비 사용액': '50000',
    });
    const csv = exportImportRowsCsv([original]);

    // Parse CSV back to matrix
    const matrix = csv.split('\n').map((line) => line.split(','));
    // The matrix should have group header + column header + 1 data row
    expect(matrix).toHaveLength(3);
    // The data row should contain original values
    expect(matrix[2].join(',')).toContain('보람');
    expect(matrix[2].join(',')).toContain('KTX');
  });
});
