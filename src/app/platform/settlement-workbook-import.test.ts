import { describe, expect, it } from 'vitest';
import { normalizeSettlementWorkbookToImportRows, pickSettlementWorkbookSheet } from './settlement-workbook-import';

describe('settlement workbook import helpers', () => {
  it('prefers the sheet with settlement headers over unrelated sheets', () => {
    const selected = pickSettlementWorkbookSheet([
      {
        name: '메타',
        matrix: [['projectId', 'p1'], ['generatedAt', '2026-04-17']],
      },
      {
        name: '정산대장',
        matrix: [
          ['기본정보', '', '', ''],
          ['작성자', '거래일시', '해당 주차', '통장에 찍힌 입/출금액'],
          ['보람', '2026-04-15', '26-4-3', '3,100,000'],
        ],
      },
    ]);

    expect(selected?.name).toBe('정산대장');
  });

  it('normalizes rows from the selected settlement sheet', () => {
    const result = normalizeSettlementWorkbookToImportRows([
      {
        name: '정산대장',
        matrix: [
          ['기본정보', '', '', '', '', ''],
          ['작성자', '거래일시', '해당 주차', '지급처', '상세 적요', '통장에 찍힌 입/출금액'],
          ['보람', '2026-04-15', '26-4-3', 'MYSC', '인건비 지급', '3,100,000'],
        ],
      },
    ]);

    expect(result?.sheetName).toBe('정산대장');
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0]?.cells.some((cell) => cell === '인건비 지급')).toBe(true);
  });
});
