import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SETTLEMENT_COLUMNS, type ImportRow } from '../platform/settlement-csv';
import { createFirestoreDb } from '../../../server/bff/firestore.mjs';
import {
  buildExpenseSheetPersistenceDoc,
  buildWeeklySubmissionStatusPatch,
} from './portal-store.persistence';
import {
  areExpenseSheetRowsEqual,
  reconcileExpenseSheetRowsFromSelection,
  reconcileExpenseSheetTabsFromSnapshot,
  shouldHydrateDevHarnessPortalSnapshot,
} from './portal-store';

const describeIfEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const settlementProjectId = 'p-settlement-it';

function makeRow(overrides?: Partial<ImportRow>): ImportRow {
  const cells = SETTLEMENT_COLUMNS.map(() => '');
  cells[2] = '2026-03-05';
  cells[5] = '여비';
  cells[6] = '교통비';
  cells[8] = '직접사업비';
  cells[10] = '15,000';
  cells[13] = '15,000';
  cells[14] = '1,500';
  cells[15] = 'KTX';
  return {
    tempId: 'row-001',
    cells,
    reviewHints: ['cashflow line needs confirmation'],
    reviewRequiredCellIndexes: [8, 6],
    reviewStatus: 'pending',
    userEditedCells: new Set([10, 8]),
    ...overrides,
  };
}

describeIfEmulator('portal-store persistence integration (Firestore emulator)', () => {
  const tenantId = 'mysc';
  const projectId = 'p-settlement-it';
  const db = createFirestoreDb({ projectId: 'portal-store-it' });

  async function clearCollection(path: string): Promise<void> {
    const snap = await db.collection(path).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((docItem) => batch.delete(docItem.ref));
    await batch.commit();
  }

  beforeEach(async () => {
    await clearCollection(`orgs/${tenantId}/projects/${projectId}/expense_sheets`);
    await clearCollection(`orgs/${tenantId}/weeklySubmissionStatus`);
  });

  afterAll(async () => {
    await clearCollection(`orgs/${tenantId}/projects/${projectId}/expense_sheets`);
    await clearCollection(`orgs/${tenantId}/weeklySubmissionStatus`);
  });

  it('persists expense sheet rows with the exact settlement document shape', async () => {
    const payload = buildExpenseSheetPersistenceDoc({
      orgId: tenantId,
      projectId,
      activeSheetId: 'default',
      activeSheetName: ' 기본   탭 ',
      order: 0,
      rows: [makeRow()],
      createdAt: '2026-04-05T09:00:00.000Z',
      now: '2026-04-05T10:00:00.000Z',
      updatedBy: 'PM 보람',
    });

    await db.doc(`orgs/${tenantId}/projects/${projectId}/expense_sheets/default`).set(payload, { merge: true });

    const stored = await db.doc(`orgs/${tenantId}/projects/${projectId}/expense_sheets/default`).get();
    expect(stored.exists).toBe(true);
    expect(stored.data()).toMatchObject({
      tenantId,
      id: 'default',
      projectId,
      name: '기본 탭',
      order: 0,
      createdAt: '2026-04-05T09:00:00.000Z',
      updatedAt: '2026-04-05T10:00:00.000Z',
      updatedBy: 'PM 보람',
    });
    expect(stored.data()?.rows).toEqual([
      expect.objectContaining({
        tempId: 'row-001',
        reviewHints: ['cashflow line needs confirmation'],
        reviewRequiredCellIndexes: [6, 8],
        reviewStatus: 'pending',
        userEditedCellIndexes: [8, 10],
      }),
    ]);
  });

  it('merges retryable weekly submission status transitions without losing persisted context', async () => {
    const ref = db.doc(`orgs/${tenantId}/weeklySubmissionStatus/${projectId}-2026-03-w1`);

    await ref.set(buildWeeklySubmissionStatusPatch({
      orgId: tenantId,
      projectId,
      yearMonth: '2026-03',
      weekNo: 1,
      updatedBy: 'PM 보람',
      now: '2026-04-05T10:00:00.000Z',
      expenseUpdated: true,
      expenseSyncState: 'sync_failed',
      expenseReviewPendingCount: 0,
    }), { merge: true });

    await ref.set(buildWeeklySubmissionStatusPatch({
      orgId: tenantId,
      projectId,
      yearMonth: '2026-03',
      weekNo: 1,
      updatedBy: 'PM 보람',
      now: '2026-04-05T10:05:00.000Z',
      expenseUpdated: true,
      expenseSyncState: 'synced',
      expenseReviewPendingCount: 0,
    }), { merge: true });

    const stored = await ref.get();
    expect(stored.exists).toBe(true);
    expect(stored.data()).toMatchObject({
      tenantId,
      projectId,
      yearMonth: '2026-03',
      weekNo: 1,
      expenseUpdated: true,
      expenseSyncState: 'synced',
      expenseReviewPendingCount: 0,
      expenseSyncUpdatedByName: 'PM 보람',
      expenseSyncUpdatedAt: '2026-04-05T10:05:00.000Z',
    });
  });

});

describe('portal-store expense sheet reconciliation helpers', () => {
  it('does not replace expense sheet rows when an unchanged snapshot echoes back', () => {
    const currentRows = [makeRow({ tempId: 'row-unchanged' })];
    const currentSheets = [{
      id: 'default',
      name: '기본 탭',
      rows: currentRows,
      order: 0,
    }];
    const nextSheets = [{
      id: 'default',
      name: '기본 탭',
      rows: [makeRow({ tempId: 'row-unchanged' })],
      order: 0,
    }];

    const result = reconcileExpenseSheetTabsFromSnapshot({
      currentSheets,
      nextSheets,
      activeExpenseSheetId: 'default',
    });

    expect(result.sheetsChanged).toBe(false);
    expect(result.expenseSheets).toBe(currentSheets);
    expect(areExpenseSheetRowsEqual(currentRows, nextSheets[0].rows)).toBe(true);
  });

  it('keeps active-sheet switching separate from project hydration', () => {
    const currentRows = [makeRow({ tempId: 'row-active' })];
    const sheets = [
      {
        id: 'default',
        name: '기본 탭',
        rows: currentRows,
        order: 0,
      },
      {
        id: 'sheet-2',
        name: '탭 2',
        rows: [makeRow({ tempId: 'row-sheet-2' })],
        order: 1,
      },
    ];

    const selection = reconcileExpenseSheetRowsFromSelection({
      expenseSheets: sheets,
      activeExpenseSheetId: 'sheet-2',
      currentRows,
    });

    expect(selection.rowsChanged).toBe(true);
    expect(selection.expenseSheetRows).toEqual(sheets[1].rows);
    expect(shouldHydrateDevHarnessPortalSnapshot({
      projectId: settlementProjectId,
      hydratedProjectId: settlementProjectId,
    })).toBe(false);
  });
});
