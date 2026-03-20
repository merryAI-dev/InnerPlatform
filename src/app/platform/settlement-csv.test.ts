import { describe, expect, it } from 'vitest';
import { analyzeSettlementHeaderMapping, buildSettlementDataPreview, normalizeMatrixToImportRows, SETTLEMENT_COLUMNS } from './settlement-csv';

function readCell(row: { cells: string[] }, header: string): string {
  const index = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
  expect(index).toBeGreaterThanOrEqual(0);
  return row.cells[index];
}

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
