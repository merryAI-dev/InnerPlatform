import { describe, expect, it } from 'vitest';
import { upsertExpenseSheetTabRows } from './portal-store.persistence';

describe('upsertExpenseSheetTabRows', () => {
  it('replaces the active sheet rows immediately after save so selection reconcile does not fall back to stale rows', () => {
    const next = upsertExpenseSheetTabRows({
      sheets: [
        {
          id: 'default',
          name: '기본 탭',
          order: 0,
          rows: [
            { tempId: 'row-1', cells: ['첫번째만 남은 stale row'] },
          ],
          createdAt: '2026-04-06T00:00:00.000Z',
          updatedAt: '2026-04-06T00:00:00.000Z',
        },
      ],
      sheetId: 'default',
      sheetName: '기본 탭',
      order: 0,
      rows: [
        { tempId: 'row-1', cells: ['첫번째 row'] },
        { tempId: 'row-2', cells: ['두번째 row'] },
        { tempId: 'row-3', cells: ['세번째 row'] },
      ],
      now: '2026-04-06T01:00:00.000Z',
    });

    expect(next).toHaveLength(1);
    expect(next[0]?.rows).toHaveLength(3);
    expect(next[0]?.rows.map((row) => row.tempId)).toEqual(['row-1', 'row-2', 'row-3']);
    expect(next[0]?.updatedAt).toBe('2026-04-06T01:00:00.000Z');
  });

  it('inserts a missing active sheet when saving a newly created tab', () => {
    const next = upsertExpenseSheetTabRows({
      sheets: [
        {
          id: 'default',
          name: '기본 탭',
          order: 0,
          rows: [],
          createdAt: '2026-04-06T00:00:00.000Z',
          updatedAt: '2026-04-06T00:00:00.000Z',
        },
      ],
      sheetId: 'sheet-2',
      sheetName: '탭 2',
      order: 1,
      rows: [
        { tempId: 'row-9', cells: ['신규 탭 row'] },
      ],
      now: '2026-04-06T01:00:00.000Z',
    });

    expect(next).toHaveLength(2);
    expect(next[1]?.id).toBe('sheet-2');
    expect(next[1]?.rows).toHaveLength(1);
  });
});
