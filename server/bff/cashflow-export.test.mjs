import { describe, expect, it } from 'vitest';
import { buildCashflowExportFileName, buildCashflowExportWorkbookBuffer, expandCashflowYearMonthRange } from './cashflow-export.mjs';

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
});
