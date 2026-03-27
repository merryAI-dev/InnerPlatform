import { describe, expect, it } from 'vitest';
import { getYearMondayWeeks } from './cashflow-weeks';
import { SETTLEMENT_COLUMNS, type ImportRow } from './settlement-csv';
import { buildSettlementActualSyncPayload } from './settlement-sheet-sync';
import {
  buildSettlementDerivationContext,
  isSettlementRowMeaningful,
  prepareSettlementImportRows,
  pruneEmptySettlementRows,
  resolveEvidenceRequiredDesc,
} from './settlement-sheet-prepare';

function makeRow(values: Record<string, string>): ImportRow {
  return {
    tempId: `row-${Math.random().toString(36).slice(2, 8)}`,
    cells: SETTLEMENT_COLUMNS.map((column) => values[column.csvHeader] || ''),
  };
}

function readCell(row: ImportRow, header: string): string {
  const index = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
  expect(index).toBeGreaterThanOrEqual(0);
  return row.cells[index];
}

function getColumnIndex(header: string): number {
  return SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
}

// ── isSettlementRowMeaningful ──

describe('isSettlementRowMeaningful', () => {
  it('returns false for null or undefined', () => {
    expect(isSettlementRowMeaningful(null)).toBe(false);
    expect(isSettlementRowMeaningful(undefined)).toBe(false);
  });

  it('returns false for a completely empty row', () => {
    const empty = makeRow({});
    expect(isSettlementRowMeaningful(empty)).toBe(false);
  });

  it('returns true for a row with substantive content', () => {
    const meaningful = makeRow({
      '거래일시': '2026-03-05',
      '지급처': '카페 메리',
    });
    expect(isSettlementRowMeaningful(meaningful)).toBe(true);
  });

  it('returns false for a row that only has non-substantive fields', () => {
    const nonSubstantive = makeRow({
      'No.': '1',
      '해당 주차': '26-03-01',
      '필수증빙자료 리스트': '영수증',
      '실제 구비 완료된 증빙자료 리스트': '영수증',
      '준비필요자료': '결과보고서',
    });
    expect(isSettlementRowMeaningful(nonSubstantive)).toBe(false);
  });

  it('returns true when a row has at least one substantive field with data', () => {
    const withMemo = makeRow({
      'No.': '1',
      '상세 적요': '테스트 메모',
    });
    expect(isSettlementRowMeaningful(withMemo)).toBe(true);
  });

  it('returns false for a row with only whitespace in substantive fields', () => {
    const whitespace = makeRow({
      '작성자': '   ',
      '거래일시': '  ',
    });
    expect(isSettlementRowMeaningful(whitespace)).toBe(false);
  });
});

// ── pruneEmptySettlementRows ──

describe('pruneEmptySettlementRows', () => {
  it('returns empty array for null or undefined', () => {
    expect(pruneEmptySettlementRows(null)).toEqual([]);
    expect(pruneEmptySettlementRows(undefined)).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(pruneEmptySettlementRows([])).toEqual([]);
  });

  it('filters out empty rows from a mixed array', () => {
    const meaningful = makeRow({ '거래일시': '2026-03-05', '지급처': '카페' });
    const empty1 = makeRow({});
    const empty2 = makeRow({ 'No.': '2', '해당 주차': '26-03-01' });
    const meaningful2 = makeRow({ '비목': '여비', '세목': '교통비' });

    const result = pruneEmptySettlementRows([meaningful, empty1, empty2, meaningful2]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(meaningful);
    expect(result[1]).toBe(meaningful2);
  });

  it('returns empty array when all rows are empty', () => {
    const empty1 = makeRow({});
    const empty2 = makeRow({ 'No.': '1' });
    expect(pruneEmptySettlementRows([empty1, empty2])).toEqual([]);
  });

  it('returns all rows when none are empty', () => {
    const row1 = makeRow({ '거래일시': '2026-03-05' });
    const row2 = makeRow({ '지급처': '카페' });
    const result = pruneEmptySettlementRows([row1, row2]);
    expect(result).toHaveLength(2);
  });
});

// ── resolveEvidenceRequiredDesc ──

describe('resolveEvidenceRequiredDesc', () => {
  it('returns empty string when map is undefined', () => {
    expect(resolveEvidenceRequiredDesc(undefined, '회의비', '다과비')).toBe('');
  });

  it('returns empty string for empty map', () => {
    expect(resolveEvidenceRequiredDesc({}, '회의비', '다과비')).toBe('');
  });

  it('matches composite key (budgetCode|subCode)', () => {
    const map = { '회의비|다과비': '영수증, 결과보고서' };
    expect(resolveEvidenceRequiredDesc(map, '회의비', '다과비')).toBe('영수증, 결과보고서');
  });

  it('falls back to subCode key', () => {
    const map = { '다과비': '영수증' };
    expect(resolveEvidenceRequiredDesc(map, '회의비', '다과비')).toBe('영수증');
  });

  it('falls back to budgetCode key', () => {
    const map = { '회의비': '회의록' };
    expect(resolveEvidenceRequiredDesc(map, '회의비', '다과비')).toBe('회의록');
  });

  it('normalizes budget labels by stripping leading numbers', () => {
    const map = { '회의비|다과비': '영수증' };
    expect(resolveEvidenceRequiredDesc(map, '1. 회의비', '1-1. 다과비')).toBe('영수증');
  });

  it('falls back to normalized subCode or budgetCode after normalization', () => {
    const map = { '교통비': '출장신청서' };
    expect(resolveEvidenceRequiredDesc(map, '2. 여비', '2-1. 교통비')).toBe('출장신청서');
  });

  it('returns empty string when nothing matches', () => {
    const map = { '인건비|급여': '근로계약서' };
    expect(resolveEvidenceRequiredDesc(map, '회의비', '다과비')).toBe('');
  });
});

// ── buildSettlementDerivationContext ──

describe('buildSettlementDerivationContext', () => {
  it('returns a context with projectId and defaultLedgerId', () => {
    const ctx = buildSettlementDerivationContext('proj-123', 'ledger-456');
    expect(ctx.projectId).toBe('proj-123');
    expect(ctx.defaultLedgerId).toBe('ledger-456');
  });

  it('resolves column indices for all expected fields', () => {
    const ctx = buildSettlementDerivationContext('p', 'l');
    expect(ctx.dateIdx).toBe(getColumnIndex('거래일시'));
    expect(ctx.weekIdx).toBe(getColumnIndex('해당 주차'));
    expect(ctx.depositIdx).toBe(getColumnIndex('입금액(사업비,공급가액,은행이자)'));
    expect(ctx.refundIdx).toBe(getColumnIndex('매입부가세 반환'));
    expect(ctx.expenseIdx).toBe(getColumnIndex('사업비 사용액'));
    expect(ctx.vatInIdx).toBe(getColumnIndex('매입부가세'));
    expect(ctx.bankAmountIdx).toBe(getColumnIndex('통장에 찍힌 입/출금액'));
    expect(ctx.balanceIdx).toBe(getColumnIndex('통장잔액'));
    expect(ctx.evidenceIdx).toBe(getColumnIndex('필수증빙자료 리스트'));
    expect(ctx.evidenceCompletedIdx).toBe(getColumnIndex('실제 구비 완료된 증빙자료 리스트'));
    expect(ctx.evidencePendingIdx).toBe(getColumnIndex('준비필요자료'));
  });

  it('all column indices are valid (non-negative)', () => {
    const ctx = buildSettlementDerivationContext('p', 'l');
    expect(ctx.dateIdx).toBeGreaterThanOrEqual(0);
    expect(ctx.weekIdx).toBeGreaterThanOrEqual(0);
    expect(ctx.depositIdx).toBeGreaterThanOrEqual(0);
    expect(ctx.refundIdx).toBeGreaterThanOrEqual(0);
    expect(ctx.expenseIdx).toBeGreaterThanOrEqual(0);
    expect(ctx.vatInIdx).toBeGreaterThanOrEqual(0);
    expect(ctx.bankAmountIdx).toBeGreaterThanOrEqual(0);
    expect(ctx.balanceIdx).toBeGreaterThanOrEqual(0);
    expect(ctx.evidenceIdx).toBeGreaterThanOrEqual(0);
    expect(ctx.evidenceCompletedIdx).toBeGreaterThanOrEqual(0);
    expect(ctx.evidencePendingIdx).toBeGreaterThanOrEqual(0);
  });
});

// ── prepareSettlementImportRows ──

describe('prepareSettlementImportRows', () => {
  it('derives week/evidence state so imported rows are recognized by cashflow sync', () => {
    const prepared = prepareSettlementImportRows(
      [
        makeRow({
          '작성자': '메리',
          '거래일시': '2026-03-05',
          '지출구분': '계좌이체',
          '비목': '회의비',
          '세목': '다과비',
          'cashflow항목': '직접사업비',
          '통장에 찍힌 입/출금액': '33,000',
          '사업비 사용액': '30,000',
          '매입부가세': '3,000',
          '실제 구비 완료된 증빙자료 리스트': '영수증',
          '지급처': '카페 메리',
        }),
      ],
      {
        projectId: 'p-001',
        defaultLedgerId: 'l-001',
        evidenceRequiredMap: {
          '회의비|다과비': '영수증, 결과보고서',
        },
      },
    );

    expect(prepared).toHaveLength(1);
    expect(readCell(prepared[0], '해당 주차')).toBeTruthy();
    expect(readCell(prepared[0], '필수증빙자료 리스트')).toBe('영수증, 결과보고서');
    expect(readCell(prepared[0], '준비필요자료')).toBe('결과보고서');
    expect(prepared[0].error).toBeUndefined();

    const payload = buildSettlementActualSyncPayload(prepared, getYearMondayWeeks(2026));
    expect(payload).toHaveLength(1);
    expect(payload[0]?.amounts.DIRECT_COST_OUT).toBe(30000);
  });

  it('drops rows that only contain derived or protected settlement fields', () => {
    const meaningful = makeRow({
      'No.': '1',
      '거래일시': '2026-03-05',
      '지급처': '카페 메리',
    });
    const derivedOnly = makeRow({
      'No.': '2',
      '필수증빙자료 리스트': '영수증',
      '실제 구비 완료된 증빙자료 리스트': '영수증',
      '준비필요자료': '결과보고서',
    });

    expect(isSettlementRowMeaningful(meaningful)).toBe(true);
    expect(isSettlementRowMeaningful(derivedOnly)).toBe(false);
    expect(pruneEmptySettlementRows([meaningful, derivedOnly])).toEqual([meaningful]);
  });

  it('returns empty array for null or empty input', () => {
    expect(prepareSettlementImportRows(null, { projectId: 'p', defaultLedgerId: 'l' })).toEqual([]);
    expect(prepareSettlementImportRows([], { projectId: 'p', defaultLedgerId: 'l' })).toEqual([]);
    expect(prepareSettlementImportRows(undefined, { projectId: 'p', defaultLedgerId: 'l' })).toEqual([]);
  });

  it('returns empty array when all rows are non-meaningful', () => {
    const emptyRow = makeRow({ 'No.': '1', '해당 주차': '26-03-01' });
    const result = prepareSettlementImportRows(
      [emptyRow],
      { projectId: 'p', defaultLedgerId: 'l' },
    );
    expect(result).toEqual([]);
  });

  it('normalizes cells with NFC and trims whitespace', () => {
    const row = makeRow({
      '거래일시': '  2026-03-05  ',
      '지급처': '  카페 메리  ',
      '상세 적요': ' 간식 구매 ',
    });
    const prepared = prepareSettlementImportRows(
      [row],
      { projectId: 'p', defaultLedgerId: 'l' },
    );

    expect(prepared).toHaveLength(1);
    expect(readCell(prepared[0], '거래일시')).toBe('2026-03-05');
    expect(readCell(prepared[0], '지급처')).toBe('카페 메리');
    expect(readCell(prepared[0], '상세 적요')).toBe('간식 구매');
  });

  it('renumbers rows sequentially', () => {
    const row1 = makeRow({ '거래일시': '2026-03-05', '지급처': 'A', 'No.': '99' });
    const row2 = makeRow({ '거래일시': '2026-03-06', '지급처': 'B', 'No.': '100' });

    const prepared = prepareSettlementImportRows(
      [row1, row2],
      { projectId: 'p', defaultLedgerId: 'l' },
    );

    expect(readCell(prepared[0], 'No.')).toBe('1');
    expect(readCell(prepared[1], 'No.')).toBe('2');
  });

  it('applies evidence map with normalized budget labels', () => {
    const row = makeRow({
      '거래일시': '2026-03-05',
      '비목': '1. 회의비',
      '세목': '1-1. 다과비',
      '지급처': '카페',
    });

    const prepared = prepareSettlementImportRows(
      [row],
      {
        projectId: 'p',
        defaultLedgerId: 'l',
        evidenceRequiredMap: { '회의비|다과비': '영수증' },
      },
    );

    expect(readCell(prepared[0], '필수증빙자료 리스트')).toBe('영수증');
  });

  it('preserves existing evidence when map has no match', () => {
    const row = makeRow({
      '거래일시': '2026-03-05',
      '비목': '인건비',
      '세목': '급여',
      '지급처': '직원',
      '필수증빙자료 리스트': '기존 증빙',
    });

    const prepared = prepareSettlementImportRows(
      [row],
      {
        projectId: 'p',
        defaultLedgerId: 'l',
        evidenceRequiredMap: { '회의비|다과비': '영수증' },
      },
    );

    // When the map doesn't match, the original evidence stays
    expect(readCell(prepared[0], '필수증빙자료 리스트')).toBe('기존 증빙');
  });

  it('works without evidenceRequiredMap option', () => {
    const row = makeRow({
      '거래일시': '2026-03-05',
      '지급처': '카페',
      '비목': '회의비',
      '세목': '다과비',
    });

    const prepared = prepareSettlementImportRows(
      [row],
      { projectId: 'p', defaultLedgerId: 'l' },
    );

    expect(prepared).toHaveLength(1);
    expect(readCell(prepared[0], '필수증빙자료 리스트')).toBe('');
  });

  it('assigns tempId to rows if missing', () => {
    const row: ImportRow = {
      tempId: '',
      cells: SETTLEMENT_COLUMNS.map((col) => {
        if (col.csvHeader === '거래일시') return '2026-03-05';
        if (col.csvHeader === '지급처') return '카페';
        return '';
      }),
    };

    const prepared = prepareSettlementImportRows(
      [row],
      { projectId: 'p', defaultLedgerId: 'l' },
    );

    expect(prepared).toHaveLength(1);
    expect(prepared[0].tempId).toBeTruthy();
    expect(prepared[0].tempId).toContain('sheet-import-');
  });
});
