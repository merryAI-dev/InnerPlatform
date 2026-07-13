import { describe, expect, it } from 'vitest';
import {
  classifyCashflowSheetCell,
  computeCashflowTargetRevision,
  createCashflowPinnedSnapshot,
} from './cashflow-sheet-snapshot.mjs';

describe('cashflow sheet pinned snapshot', () => {
  it.each(['', '  ', '-', '―', '–'])('classifies %j as an empty cell', (rawValue) => {
    expect(classifyCashflowSheetCell(rawValue)).toEqual({ state: 'EMPTY' });
  });

  it('keeps an explicit zero distinct from an empty cell', () => {
    expect(classifyCashflowSheetCell('0')).toEqual({ state: 'VALUE', amount: 0 });
    expect(classifyCashflowSheetCell('₩ 1,234')).toEqual({ state: 'VALUE', amount: 1234 });
    expect(classifyCashflowSheetCell('(1,234)')).toEqual({ state: 'VALUE', amount: -1234 });
  });

  it('marks non-numeric sheet contents invalid instead of silently converting them to zero', () => {
    expect(classifyCashflowSheetCell('확인 필요')).toEqual({
      state: 'INVALID',
      rawValue: '확인 필요',
    });
  });

  it('pins normalized cells and keeps source and target revisions separate', () => {
    const mappings = [
      {
        mode: 'actual', yearMonth: '2026-01', weekNo: 1, lineId: 'SALES_IN',
        direction: 'IN', rowIndex: 1, columnIndex: 3, a1: 'D2', label: '매출액(입금)',
      },
      {
        mode: 'projection', yearMonth: '2026-01', weekNo: 1, lineId: 'SALES_IN',
        direction: 'IN', rowIndex: 0, columnIndex: 3, a1: 'D1', label: '매출액(입금)',
      },
    ];
    const first = createCashflowPinnedSnapshot({
      projectId: 'project-a',
      spreadsheetId: 'sheet-a',
      spreadsheetTitle: '2026 사업비',
      selectedSheetName: 'cashflow(사용내역 연동)',
      mappings,
      matrix: [[], ['', '', '', '1,000']],
      targetSnapshot: { weeks: [{ yearMonth: '2026-01', weekNo: 1, projection: { SALES_IN: 10 } }] },
      capturedAt: '2026-07-13T01:00:00.000Z',
      capturedBy: { uid: 'user-a' },
    });
    const second = createCashflowPinnedSnapshot({
      projectId: 'project-a',
      spreadsheetId: 'sheet-a',
      spreadsheetTitle: '2026 사업비',
      selectedSheetName: 'cashflow(사용내역 연동)',
      mappings: [...mappings].reverse(),
      matrix: [[], ['', '', '', '1000']],
      targetSnapshot: { weeks: [{ yearMonth: '2026-01', weekNo: 1, projection: { SALES_IN: 20 } }] },
      capturedAt: '2026-07-13T02:00:00.000Z',
      capturedBy: { uid: 'user-b' },
    });

    expect(first.cells).toEqual([
      expect.objectContaining({ mode: 'actual', state: 'VALUE', amount: 1000 }),
      expect.objectContaining({ mode: 'projection', state: 'EMPTY' }),
    ]);
    expect(first.sourceRevision).toBe(second.sourceRevision);
    expect(first.targetRevisionAtFetch).not.toBe(second.targetRevisionAtFetch);
    expect(first.summary).toEqual({ cellCount: 2, valueCount: 1, emptyCount: 1, invalidCount: 0 });
  });

  it('computes the same target revision regardless of Firestore map and week order', () => {
    const first = computeCashflowTargetRevision({
      weeks: [
        { yearMonth: '2026-02', weekNo: 1, actual: { SALES_IN: 20, VAT_IN: 2 } },
        { yearMonth: '2026-01', weekNo: 2, projection: { SALES_IN: 10 } },
      ],
    });
    const second = computeCashflowTargetRevision({
      weeks: [
        { weekNo: 2, yearMonth: '2026-01', projection: { SALES_IN: 10 } },
        { weekNo: 1, yearMonth: '2026-02', actual: { VAT_IN: 2, SALES_IN: 20 } },
      ],
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('distinguishes a missing target value, an explicit zero, and a closed week', () => {
    const missing = computeCashflowTargetRevision({
      weeks: [{ yearMonth: '2026-01', weekNo: 1, projection: {} }],
    });
    const zero = computeCashflowTargetRevision({
      weeks: [{ yearMonth: '2026-01', weekNo: 1, projection: { SALES_IN: 0 } }],
    });
    const closed = computeCashflowTargetRevision({
      weeks: [{ yearMonth: '2026-01', weekNo: 1, projection: {}, adminClosed: true }],
    });
    expect(new Set([missing, zero, closed])).toHaveLength(3);
  });

  it('keeps a full 60-week normalized mirror below the Firestore safety budget', () => {
    const mappings = [];
    const matrix = [];
    for (let modeIndex = 0; modeIndex < 2; modeIndex += 1) {
      for (let lineIndex = 0; lineIndex < 16; lineIndex += 1) {
        const rowIndex = modeIndex * 16 + lineIndex;
        matrix[rowIndex] = [];
        for (let weekIndex = 0; weekIndex < 60; weekIndex += 1) {
          const columnIndex = weekIndex + 3;
          matrix[rowIndex][columnIndex] = '1,234';
          mappings.push({
            mode: modeIndex === 0 ? 'projection' : 'actual',
            yearMonth: `2026-${String(Math.floor(weekIndex / 5) + 1).padStart(2, '0')}`,
            weekNo: (weekIndex % 5) + 1,
            lineId: `LINE_${String(lineIndex).padStart(2, '0')}`,
            direction: lineIndex < 7 ? 'IN' : 'OUT',
            rowIndex,
            columnIndex,
            a1: `R${rowIndex + 1}C${columnIndex + 1}`,
            label: `항목 ${lineIndex}`,
          });
        }
      }
    }
    const snapshot = createCashflowPinnedSnapshot({
      projectId: 'project-a',
      spreadsheetId: 'sheet-a',
      selectedSheetName: 'cashflow(사용내역 연동)',
      mappings,
      matrix,
      capturedAt: '2026-07-13T01:00:00.000Z',
    });
    expect(snapshot.cells).toHaveLength(1_920);
    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThan(700 * 1024);
  });
});
