import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SETTLEMENT_COLUMNS, type ImportRow } from '../platform/settlement-csv';
import { createFirestoreDb } from '../../../server/bff/firestore.mjs';
import {
  buildExpenseSheetPersistenceDoc,
  buildWeeklySubmissionStatusPatch,
} from './portal-store.persistence';
import { buildBankImportIntakeDoc } from './portal-store.intake';
import type { BankImportIntakeItem } from './types';
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

function makeIntakeItem(overrides: Partial<BankImportIntakeItem> = {}): BankImportIntakeItem {
  return {
    id: 'bank-fp-001',
    projectId: settlementProjectId,
    sourceTxId: 'bank:bank-fp-001',
    bankFingerprint: 'bank-fp-001',
    bankSnapshot: {
      accountNumber: '111-222-333',
      dateTime: '2026-04-06T09:00:00+09:00',
      counterparty: '메리 사업팀',
      memo: '법인카드 결제',
      signedAmount: -120000,
      balanceAfter: 910000,
    },
    matchState: 'PENDING_INPUT',
    projectionStatus: 'NOT_PROJECTED',
    evidenceStatus: 'MISSING',
    manualFields: {
      expenseAmount: 120000,
      budgetCategory: '여비',
      budgetSubCategory: '교통비',
      cashflowCategory: 'TRAVEL',
    },
    reviewReasons: [],
    lastUploadBatchId: 'batch-1',
    createdAt: '2026-04-06T00:00:00.000Z',
    updatedAt: '2026-04-06T00:00:00.000Z',
    updatedBy: 'PM 보람',
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
    await clearCollection(`orgs/${tenantId}/projects/${projectId}/expense_intake`);
    await clearCollection(`orgs/${tenantId}/weeklySubmissionStatus`);
  });

  afterAll(async () => {
    await clearCollection(`orgs/${tenantId}/projects/${projectId}/expense_sheets`);
    await clearCollection(`orgs/${tenantId}/projects/${projectId}/expense_intake`);
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

  it('persists expense intake items as a project-scoped authoritative intake layer', async () => {
    const payload = buildBankImportIntakeDoc({
      orgId: tenantId,
      item: makeIntakeItem(),
    });

    await db.doc(`orgs/${tenantId}/projects/${projectId}/expense_intake/bank-fp-001`).set(payload, { merge: true });

    const stored = await db.doc(`orgs/${tenantId}/projects/${projectId}/expense_intake/bank-fp-001`).get();
    expect(stored.exists).toBe(true);
    expect(stored.data()).toMatchObject({
      tenantId,
      id: 'bank-fp-001',
      projectId,
      sourceTxId: 'bank:bank-fp-001',
      matchState: 'PENDING_INPUT',
      projectionStatus: 'NOT_PROJECTED',
      evidenceStatus: 'MISSING',
      manualFields: {
        expenseAmount: 120000,
        budgetCategory: '여비',
        budgetSubCategory: '교통비',
        cashflowCategory: 'TRAVEL',
      },
      reviewReasons: [],
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
