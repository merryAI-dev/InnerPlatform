import { describe, expect, it } from 'vitest';
import {
  classifyCashflowSheetCell,
  computeCashflowTargetRevision,
  createCashflowPinnedSnapshot,
  extractCashflowSheetFacts,
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

  it('pins business metadata, the five-week deposit schedule, and BO/BP controls', () => {
    const matrix = Array.from({ length: 55 }, () => Array.from({ length: 68 }, () => ''));
    matrix[0][1] = '최종 업데이트 : 2026.07.01 최종작성자: 보람';
    matrix[1][1] = 'Type1. 세금계산서발행+공급가액기준';
    matrix[2][1] = '전용계좌사업';
    matrix[3][1] = '정산진행';
    for (let weekIndex = 0; weekIndex < 5; weekIndex += 1) {
      const columnIndex = 3 + weekIndex;
      matrix[6][columnIndex] = `2026-06-${String(weekIndex + 1).padStart(2, '0')}`;
      matrix[7][columnIndex] = `2026.06.${String(weekIndex + 6).padStart(2, '0')}`;
      matrix[8][columnIndex] = String((weekIndex + 1) * 1000);
      matrix[13][columnIndex] = String((weekIndex + 1) * 10);
      matrix[36][columnIndex] = String((weekIndex + 1) * 5);
    }
    matrix[8][66] = '15,000';
    matrix[8][67] = '85,000';
    matrix[13][66] = '150';
    matrix[36][66] = '75';

    const weekColumns = Array.from({ length: 5 }, (_, weekIndex) => ({
      yearMonth: '2026-06', weekNo: weekIndex + 1, columnIndex: 3 + weekIndex,
    }));
    const template = {
      sections: [
        {
          mode: 'projection', weekColumns,
          lineRows: [{ rowIndex: 13, lineId: 'SALES_IN' }], derivedRows: [],
        },
        {
          mode: 'actual', weekColumns,
          lineRows: [{ rowIndex: 36, lineId: 'SALES_IN' }], derivedRows: [],
        },
      ],
    };

    expect(extractCashflowSheetFacts({ template, matrix })).toEqual({
      metadata: {
        lastUpdateText: { sourceCell: 'B1', value: '최종 업데이트 : 2026.07.01 최종작성자: 보람' },
        businessType: { sourceCell: 'B2', value: 'Type1. 세금계산서발행+공급가액기준' },
        accountType: { sourceCell: 'B3', value: '전용계좌사업' },
        settlementStatus: { sourceCell: 'B4', value: '정산진행' },
      },
      depositScheduleRows: Array.from({ length: 5 }, (_, weekIndex) => ({
        yearMonth: '2026-06',
        weekNo: weekIndex + 1,
        taxInvoiceIssuedDate: `2026-06-${String(weekIndex + 1).padStart(2, '0')}`,
        expectedDepositDate: `2026-06-${String(weekIndex + 6).padStart(2, '0')}`,
        expectedDepositAmount: (weekIndex + 1) * 1000,
        sourceCells: {
          taxInvoiceIssuedDate: `${String.fromCharCode(68 + weekIndex)}7`,
          expectedDepositDate: `${String.fromCharCode(68 + weekIndex)}8`,
          expectedDepositAmount: `${String.fromCharCode(68 + weekIndex)}9`,
        },
      })),
      annualFinancialTotals: [{
        year: 2026,
        contractAmount: 15000,
        salesVatAmount: 0,
        totalRevenueAmount: 0,
        supportAmount: 0,
      }],
      annualCashflowTotals: [],
      controlTotals: {
        deposit: { sourceCell: 'BO9', value: 15000, computed: 15000, matches: true },
        unpaid: { sourceCell: 'BP9', value: 85000 },
        projection: [{
          kind: 'line', lineId: 'SALES_IN', sourceCell: 'BO14', value: 150, computed: 150, matches: true,
          annualValues: [{ year: 2026, value: 150 }],
        }],
        actual: [{
          kind: 'line', lineId: 'SALES_IN', sourceCell: 'BO37', value: 75, computed: 75, matches: true,
          annualValues: [{ year: 2026, value: 75 }],
        }],
      },
      issues: [],
    });
  });

  it('treats future blank week cells as zero for BO sums without inventing deposit values', () => {
    const matrix = Array.from({ length: 55 }, () => Array.from({ length: 68 }, () => ''));
    const weekColumns = Array.from({ length: 60 }, (_, index) => ({
      yearMonth: `2026-${String(Math.floor(index / 5) + 1).padStart(2, '0')}`,
      weekNo: (index % 5) + 1,
      columnIndex: 3 + index,
    }));
    matrix[8][3] = '1000';
    matrix[8][66] = '1000';
    matrix[13][3] = '100';
    matrix[13][66] = '100';
    const facts = extractCashflowSheetFacts({
      matrix,
      template: {
        sections: [
          { mode: 'projection', weekColumns, lineRows: [{ rowIndex: 13, lineId: 'SALES_IN' }], derivedRows: [] },
          { mode: 'actual', weekColumns, lineRows: [], derivedRows: [] },
        ],
      },
    });

    expect(facts.depositScheduleRows[1].expectedDepositAmount).toBeNull();
    expect(facts.controlTotals.deposit).toMatchObject({ computed: 1000, value: 1000, matches: true });
    expect(facts.controlTotals.projection[0]).toMatchObject({ computed: 100, value: 100, matches: true });
  });

  it('finds the moving Total columns and keeps week values beyond the 2026 layout', () => {
    const matrix = Array.from({ length: 55 }, () => Array.from({ length: 72 }, () => ''));
    matrix[0][68] = '입금\nTotal';
    matrix[0][69] = '미지급 Total';
    const weekColumns = [
      { yearMonth: '2027-01', weekNo: 4, columnIndex: 63 },
      { yearMonth: '2027-01', weekNo: 5, columnIndex: 64 },
    ];
    matrix[8][63] = '1000';
    matrix[8][64] = '2000';
    matrix[8][68] = '3000';
    matrix[13][63] = '100';
    matrix[13][64] = '200';
    matrix[13][68] = '300';

    const facts = extractCashflowSheetFacts({
      matrix,
      template: {
        sections: [
          { mode: 'projection', headerRowIndex: 0, weekColumns, lineRows: [{ rowIndex: 13, lineId: 'SALES_IN' }], derivedRows: [] },
          { mode: 'actual', headerRowIndex: 0, weekColumns, lineRows: [], derivedRows: [] },
        ],
      },
    });

    expect(facts.depositScheduleRows).toHaveLength(2);
    expect(facts.controlTotals.deposit).toMatchObject({ sourceCell: 'BQ9', value: 3000, computed: 3000, matches: true });
    expect(facts.controlTotals.projection[0]).toMatchObject({ sourceCell: 'BQ14', value: 300, computed: 300, matches: true });
  });

  it('groups sheet finance checks by calendar year using the registered cashflow lines', () => {
    const matrix = Array.from({ length: 55 }, () => Array.from({ length: 68 }, () => ''));
    const weekColumns = [
      { yearMonth: '2025-12', weekNo: 5, columnIndex: 3 },
      { yearMonth: '2026-01', weekNo: 1, columnIndex: 4 },
    ];
    matrix[8][3] = '100';
    matrix[8][4] = '200';
    matrix[8][66] = '300';
    matrix[13][3] = '10';
    matrix[13][4] = '20';
    matrix[13][66] = '30';
    matrix[14][3] = '30';
    matrix[14][4] = '40';
    matrix[14][66] = '70';
    matrix[15][3] = '50';
    matrix[15][4] = '60';
    matrix[15][66] = '110';

    const facts = extractCashflowSheetFacts({
      matrix,
      template: {
        sections: [
          {
            mode: 'projection',
            weekColumns,
            lineRows: [
              { rowIndex: 13, lineId: 'SALES_VAT_IN' },
              { rowIndex: 14, lineId: 'MYSC_PROFIT_OUT' },
              { rowIndex: 15, lineId: 'TEAM_SUPPORT_IN' },
            ],
            derivedRows: [],
          },
          { mode: 'actual', weekColumns, lineRows: [], derivedRows: [] },
        ],
      },
    });

    expect(facts.annualFinancialTotals).toEqual([
      { year: 2025, contractAmount: 100, salesVatAmount: 10, totalRevenueAmount: 30, supportAmount: 50 },
      { year: 2026, contractAmount: 200, salesVatAmount: 20, totalRevenueAmount: 40, supportAmount: 60 },
    ]);
  });

  it('sums repeated weekly line values and marks an incomplete year as partial', () => {
    const facts = extractCashflowSheetFacts({
      cells: [
        { mode: 'projection', yearMonth: '2026-01', weekNo: 1, lineId: 'SALES_IN', direction: 'IN', state: 'VALUE', amount: 100 },
        { mode: 'projection', yearMonth: '2026-01', weekNo: 2, lineId: 'SALES_IN', direction: 'IN', state: 'VALUE', amount: 200 },
        { mode: 'projection', yearMonth: '2026-01', weekNo: 2, lineId: 'DIRECT_COST_OUT', direction: 'OUT', state: 'VALUE', amount: 40 },
      ],
    });

    expect(facts.annualCashflowTotals).toEqual([
      expect.objectContaining({
        year: 2026,
        projection: expect.objectContaining({
          source: 'WEEKLY',
          lineAmounts: { SALES_IN: 300, DIRECT_COST_OUT: 40 },
          totalIn: 300,
          totalOut: 40,
          net: 260,
          coverage: {
            status: 'PARTIAL',
            weekCount: 2,
            expectedWeekCount: 60,
            monthCount: 1,
            expectedMonthCount: 12,
          },
        }),
      }),
    ]);
  });

  it('keeps annual-only values distinct from weekly coverage', () => {
    const facts = extractCashflowSheetFacts({
      annualCells: [
        { mode: 'actual', year: 2025, lineId: 'SALES_IN', direction: 'IN', state: 'VALUE', amount: 500 },
      ],
    });

    expect(facts.annualCashflowTotals[0].actual).toMatchObject({
      source: 'ANNUAL',
      lineAmounts: { SALES_IN: 500 },
      coverage: {
        status: 'ANNUAL_ONLY',
        weekCount: 0,
        expectedWeekCount: 60,
        monthCount: 0,
        expectedMonthCount: 12,
      },
    });
  });

  it('reports an item-level mismatch when a complete weekly year differs from its annual column', () => {
    const cells = Array.from({ length: 60 }, (_, index) => ({
      mode: 'projection',
      yearMonth: `2026-${String(Math.floor(index / 5) + 1).padStart(2, '0')}`,
      weekNo: (index % 5) + 1,
      lineId: 'SALES_IN',
      direction: 'IN',
      state: 'VALUE',
      amount: 10,
    }));
    const facts = extractCashflowSheetFacts({
      cells,
      annualCells: [
        { mode: 'projection', year: 2026, lineId: 'SALES_IN', direction: 'IN', state: 'VALUE', amount: 599 },
      ],
    });

    expect(facts.annualCashflowTotals[0].projection).toMatchObject({
      source: 'WEEKLY',
      totalIn: 600,
      reconciliation: { status: 'MISMATCH', mismatchedLineIds: ['SALES_IN'] },
    });
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

  it('changes the target revision when Actual source provenance changes but the aggregate stays equal', () => {
    const first = computeCashflowTargetRevision({
      weeks: [{
        yearMonth: '2026-01',
        weekNo: 1,
        actual: { SALES_IN: 600 },
        weeklyExpenseActualBySheet: {
          bank: { SALES_IN: 500 },
          'cashflow-sheet-lab': { SALES_IN: 100 },
        },
      }],
    });
    const second = computeCashflowTargetRevision({
      weeks: [{
        yearMonth: '2026-01',
        weekNo: 1,
        actual: { SALES_IN: 600 },
        weeklyExpenseActualBySheet: {
          bank: { SALES_IN: 400 },
          'cashflow-sheet-lab': { SALES_IN: 200 },
        },
      }],
    });

    expect(first).not.toBe(second);
  });

  it('uses the JVM-compatible canonical source-key order for target revisions', () => {
    expect(computeCashflowTargetRevision({
      weeks: [{
        yearMonth: '2026-07',
        weekNo: 1,
        projection: { SALES_IN: 100 },
        actual: { DIRECT_COST_OUT: 60 },
        weeklyExpenseActualBySheet: {
          'z-source': { DIRECT_COST_OUT: 10 },
          A_source: { DIRECT_COST_OUT: 20 },
          _source: { DIRECT_COST_OUT: 30 },
        },
        adminClosed: false,
      }],
    })).toBe('sha256:013247d9be20befa6593d6a8dc9c39d3a39456651513458be7391d3aafc5383f');
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
