import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseWithSchema, cashflowExportSchema } from './schemas.mjs';
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
              weekStart: '2025-12-31',
              weekEnd: '2026-01-06',
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
      '26-2-1', '26-2-2', '26-2-3', '26-2-4', '26-2-5',
    ]);
    expect(rows.some((row) => row[0] === '기간')).toBe(false);
    expect(rows.some((row) => row[0] === 'Projection')).toBe(false);
    expect(rows.some((row) => row[0] === 'Actual')).toBe(false);
    expect(salesRow).toEqual([
      '매출액(입금)',
      100, 0, 0, 0, 0,
      200, 0, 0, 0, 0,
    ]);
  });
});
