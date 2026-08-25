import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseWithSchema, cashflowExportSchema, cashflowWeekAmountsSchema } from './schemas.mjs';
import {
  buildCashflowExportFileName,
  buildCashflowExportWorkbookBuffer,
  expandCashflowYearMonthRange,
} from './cashflow-export.mjs';

describe('cashflow export bff helper', () => {
  it('expands year-month range in ascending order', () => {
    expect(expandCashflowYearMonthRange('2026-01', '2026-03')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(expandCashflowYearMonthRange('2026-03', '2026-01')).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('builds a single project filename with project name', () => {
    expect(buildCashflowExportFileName({
      scope: 'single',
      projectName: '알파 프로젝트',
      yearMonths: ['2026-01', '2026-02'],
      variant: 'single-project',
    })).toContain('알파 프로젝트');
  });

  it('accepts legacy basis export requests during the compatibility window', () => {
    expect(() => parseWithSchema(cashflowExportSchema, {
      scope: 'all',
      basis: '공급가액',
      startYearMonth: '2026-01',
      endYearMonth: '2026-01',
      variant: 'multi-sheet',
    })).not.toThrow();
  });

  it('accepts a bounded list of selected project ids and rejects unsafe ids', () => {
    expect(() => parseWithSchema(cashflowExportSchema, {
      scope: 'all',
      projectIds: ['project-a', 'project-b'],
      startYearMonth: '2026-01',
      endYearMonth: '2026-01',
      variant: 'multi-sheet',
    })).not.toThrow();
    expect(() => parseWithSchema(cashflowExportSchema, {
      scope: 'all',
      projectIds: ['other/project'],
      startYearMonth: '2026-01',
      endYearMonth: '2026-01',
      variant: 'multi-sheet',
    })).toThrow();
  });

  it('accepts canonical accountTypes, department, and sortBy export filters', () => {
    const parsed = parseWithSchema(cashflowExportSchema, {
      scope: 'all',
      projectIds: ['project-a', 'project-b'],
      department: 'CIC1',
      accountTypes: ['DEDICATED', 'OTHER'],
      sortBy: 'DEPARTMENT',
      startYearMonth: '2024-01',
      endYearMonth: '2024-12',
      variant: 'multi-sheet',
    });

    expect(parsed).toMatchObject({
      department: 'CIC1',
      accountTypes: ['DEDICATED', 'OTHER'],
      sortBy: 'DEPARTMENT',
    });
  });

  it('accepts selected scope only with an explicit project list', () => {
    const base = {
      scope: 'selected',
      startYearMonth: '2024-01',
      endYearMonth: '2024-12',
      variant: 'multi-sheet',
    };

    expect(() => parseWithSchema(cashflowExportSchema, {
      ...base,
      projectIds: ['project-a'],
    })).not.toThrow();
    expect(() => parseWithSchema(cashflowExportSchema, base)).toThrow();
  });

  it('keeps legacy accountType including OTHER while rejecting ambiguous or invalid filters', () => {
    const base = {
      scope: 'all',
      startYearMonth: '2024-01',
      endYearMonth: '2024-12',
      variant: 'multi-sheet',
    };

    expect(() => parseWithSchema(cashflowExportSchema, { ...base, accountType: 'OTHER' })).not.toThrow();
    expect(() => parseWithSchema(cashflowExportSchema, {
      ...base,
      accountType: 'DEDICATED',
      accountTypes: ['DEDICATED'],
    })).toThrow();
    expect(() => parseWithSchema(cashflowExportSchema, {
      ...base,
      accountTypes: ['DEDICATED', 'DEDICATED'],
    })).toThrow();
    expect(() => parseWithSchema(cashflowExportSchema, {
      ...base,
      accountTypes: ['UNKNOWN'],
    })).toThrow();
    expect(() => parseWithSchema(cashflowExportSchema, { ...base, sortBy: 'UNKNOWN' })).toThrow();
  });

  it('names selected exports without claiming that every project was included', () => {
    expect(buildCashflowExportFileName({
      scope: 'selected',
      yearMonths: ['2024-01', '2024-12'],
      variant: 'multi-sheet',
    })).toContain('선택사업_개별시트');
  });

  it('rejects raw week 6 for cashflow week writes because storage uses financeWeek 1..5', () => {
    expect(() => parseWithSchema(cashflowWeekAmountsSchema, {
      yearMonth: '2026-08',
      weekNo: 6,
      mode: 'actual',
      amounts: { DIRECT_COST_OUT: 1000 },
    }, 'Invalid cashflow week request')).toThrow(/expected number to be <=5/);
  });

  it('creates a non-empty xlsx buffer', async () => {
    const buffer = await buildCashflowExportWorkbookBuffer({
      variant: 'single-project',
      yearMonths: ['2026-01'],
      projects: [
        {
          id: 'proj-a',
          name: '알파 프로젝트',
          shortName: '알파',
          weeks: [
            {
              id: 'proj-a-2026-01-w1',
              projectId: 'proj-a',
              yearMonth: '2026-01',
              weekNo: 1,
              weekStart: '2026-01-01',
              weekEnd: '2026-01-04',
              projection: { SALES_IN: 1000 },
              actual: { SALES_IN: 900 },
              pmSubmitted: true,
              adminClosed: false,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
      ],
    });

    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('keeps the single-project metadata row aligned with the app workbook spec', async () => {
    const buffer = await buildCashflowExportWorkbookBuffer({
      variant: 'single-project',
      yearMonths: ['2026-01'],
      projects: [
        {
          id: 'proj-a',
          name: '알파 프로젝트',
          shortName: '알파',
          transactions: [],
          weeks: [],
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Projection');
    const rows = worksheet.getSheetValues().filter(Boolean).map((row) => Array.isArray(row) ? row.slice(1) : []);

    expect(rows[0]).toEqual(['사업', '알파 프로젝트', '사업 ID', 'proj-a', '거래 수', 0]);
  });

  it('omits top-level period metadata from combined exports', async () => {
    const buffer = await buildCashflowExportWorkbookBuffer({
      variant: 'combined',
      yearMonths: ['2026-01'],
      projects: [
        {
          id: 'proj-a',
          name: '알파 프로젝트',
          weeks: [],
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('전체 사업');
    const rows = worksheet.getSheetValues().filter(Boolean).map((row) => Array.isArray(row) ? row.slice(1) : []);

    expect(rows.some((row) => row[0] === '대상 기간')).toBe(false);
  });

  it('renders annual single-project exports as a horizontal worksheet', async () => {
    const buffer = await buildCashflowExportWorkbookBuffer({
      variant: 'single-project',
      yearMonths: ['2026-01', '2026-02'],
      projects: [
        {
          id: 'proj-wide',
          name: '가로형 프로젝트',
          weeks: [
            {
              id: 'proj-wide-2026-01-w1',
              projectId: 'proj-wide',
              yearMonth: '2026-01',
              weekNo: 1,
              weekStart: '2025-12-31',
              weekEnd: '2026-01-06',
              projection: { SALES_IN: 100, DIRECT_COST_OUT: 25 },
              actual: {},
              pmSubmitted: true,
              adminClosed: false,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'proj-wide-2026-02-w1',
              projectId: 'proj-wide',
              yearMonth: '2026-02',
              weekNo: 1,
              weekStart: '2026-02-04',
              weekEnd: '2026-02-10',
              projection: { SALES_IN: 200, DIRECT_COST_OUT: 50 },
              actual: {},
              pmSubmitted: true,
              adminClosed: false,
              createdAt: '2026-02-01T00:00:00.000Z',
              updatedAt: '2026-02-01T00:00:00.000Z',
            },
          ],
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Projection');
    const rows = worksheet.getSheetValues().filter(Boolean).map((row) => Array.isArray(row) ? row.slice(1) : []);
    const headerRow = rows.find((row) => row[0] === '항목');
    const salesRow = rows.find((row) => row[0] === '매출액(입금)');

    expect(rows.filter((row) => row[0] === '매출액(입금)')).toHaveLength(1);
    expect(headerRow).toEqual([
      '항목',
      '26-1-1', '26-1-2', '26-1-3', '26-1-4', '26-1-5',
      '26-1-Total',
      '26-2-1', '26-2-2', '26-2-3', '26-2-4', '26-2-5',
      '26-2-Total',
    ]);
    expect(rows.some((row) => row[0] === '기간')).toBe(false);
    expect(rows.some((row) => row[0] === 'Projection')).toBe(false);
    expect(rows.some((row) => row[0] === 'Actual')).toBe(false);
    expect(salesRow).toEqual([
      '매출액(입금)',
      100, 0, 0, 0, 0,
      100,
      200, 0, 0, 0, 0,
      200,
    ]);
  });

  it('applies the MYSCube cashflow worksheet format and monthly Total column', async () => {
    const buffer = await buildCashflowExportWorkbookBuffer({
      variant: 'single-project',
      yearMonths: ['2026-01'],
      projects: [{
        id: 'proj-format',
        name: '서식 프로젝트',
        weeks: [{
          id: 'proj-format-2026-01-w1', projectId: 'proj-format', yearMonth: '2026-01', weekNo: 1,
          projection: { SALES_IN: 1000, DIRECT_COST_OUT: 250 }, actual: {},
        }],
      }],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('Projection');
    const header = worksheet.getRow(2);
    const sales = worksheet.getRow(
      worksheet.getSheetValues().findIndex((row) => Array.isArray(row) && row[1] === '매출액(입금)'),
    );

    expect(header.values.slice(1)).toEqual(['항목', '26-1-1', '26-1-2', '26-1-3', '26-1-4', '26-1-5', '26-1-Total']);
    expect(sales.values.slice(1)).toEqual(['매출액(입금)', 1000, 0, 0, 0, 0, 1000]);
    expect(worksheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 2 });
    expect(worksheet.getColumn(1).width).toBeGreaterThanOrEqual(22);
    expect(header.getCell(1).font.bold).toBe(true);
    expect(sales.getCell(2).numFmt).toContain('#,##0');
  });

  it('orders workbook sheets by department, project name, and id when requested', async () => {
    const buffer = await buildCashflowExportWorkbookBuffer({
      variant: 'multi-sheet',
      sortBy: 'DEPARTMENT',
      yearMonths: ['2024-01'],
      projects: [
        { id: 'p3', name: '가 사업', shortName: 'A-B-가', department: '센터B', weeks: [] },
        { id: 'p2', name: '나 사업', shortName: 'B-A-나', department: '센터A', weeks: [] },
        { id: 'p1', name: '가 사업', shortName: 'D-A-가-2', department: '센터A', weeks: [] },
        { id: 'p0', name: '가 사업', shortName: 'C-A-가-1', department: '센터A', weeks: [] },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    expect(workbook.worksheets.map(({ name }) => name)).toEqual(['C-A-가-1', 'D-A-가-2', 'B-A-나', 'A-B-가']);
  });

  it('orders combined workbook project sections by department too', async () => {
    const buffer = await buildCashflowExportWorkbookBuffer({
      variant: 'combined',
      sortBy: 'DEPARTMENT',
      scope: 'selected',
      yearMonths: ['2024-01'],
      projects: [
        { id: 'p-b', name: '가 사업', department: '센터B', weeks: [] },
        { id: 'p-a2', name: '나 사업', department: '센터A', weeks: [] },
        { id: 'p-a1', name: '가 사업', department: '센터A', weeks: [] },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet('선택 사업');
    const projectNames = worksheet
      .getSheetValues()
      .filter((row) => Array.isArray(row) && row[1] === '사업')
      .map((row) => row[2]);

    expect(projectNames).toEqual(['가 사업', '나 사업', '가 사업']);
  });
});
