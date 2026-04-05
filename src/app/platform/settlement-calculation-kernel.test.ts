import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportRow } from './settlement-csv';
import type { SettlementDerivationContext } from './settlement-row-derivation';

const platformBffMocks = vi.hoisted(() => ({
  deriveSettlementRowsViaBff: vi.fn(),
  isPlatformApiEnabled: vi.fn(() => false),
  previewSettlementActualSyncViaBff: vi.fn(),
  previewSettlementFlowSnapshotsViaBff: vi.fn(),
}));

vi.mock('../lib/platform-bff-client', () => ({
  ...platformBffMocks,
}));

import { getYearMondayWeeks } from './cashflow-weeks';
import {
  aggregateBudgetActualsAuthoritatively,
  deriveSettlementRowsAuthoritatively,
  previewSettlementActualSyncAuthoritatively,
  previewSettlementFlowSnapshotsAuthoritatively,
} from './settlement-calculation-kernel';

function createEmptyCells(): string[] {
  return Array.from({ length: 27 }, () => '');
}

function createRow(cells: string[]): ImportRow {
  return {
    tempId: `row-${Math.random().toString(36).slice(2)}`,
    cells,
  };
}

function createDerivationContext(): SettlementDerivationContext {
  return {
    projectId: 'p001',
    defaultLedgerId: 'l001',
    dateIdx: 2,
    weekIdx: 3,
    depositIdx: 11,
    refundIdx: 12,
    expenseIdx: 13,
    vatInIdx: 14,
    bankAmountIdx: 10,
    balanceIdx: 9,
    evidenceIdx: 16,
    evidenceCompletedIdx: 17,
    evidencePendingIdx: 18,
  };
}

describe('settlement-calculation-kernel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformBffMocks.isPlatformApiEnabled.mockReturnValue(false);
  });

  it('derives settlement rows locally even when runtime is provided', async () => {
    platformBffMocks.isPlatformApiEnabled.mockReturnValue(true);
    platformBffMocks.deriveSettlementRowsViaBff.mockResolvedValue([
      { tempId: 'from-bff', cells: createEmptyCells() },
    ] as ImportRow[]);

    const cells = createEmptyCells();
    cells[2] = '2025-01-06';
    cells[8] = '직접사업비';
    cells[10] = '33,000';
    cells[13] = '30,000';

    const rows = await deriveSettlementRowsAuthoritatively({
      rows: [createRow(cells)],
      context: createDerivationContext(),
      options: { mode: 'row' },
      runtime: {
        tenantId: 'mysc',
        projectId: 'p001',
        actor: { uid: 'u001', role: 'pm' },
      },
    });

    expect(platformBffMocks.deriveSettlementRowsViaBff).not.toHaveBeenCalled();
    expect(rows.some((row) => row.tempId === 'from-bff')).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it('builds local flow snapshots even when runtime is provided', async () => {
    platformBffMocks.isPlatformApiEnabled.mockReturnValue(true);
    platformBffMocks.previewSettlementFlowSnapshotsViaBff.mockResolvedValue([{
      tempId: 'from-bff',
      sourceTxId: 'bank:expense-1',
      entryKind: 'EXPENSE',
      budgetKey: 'from-bff',
      budgetCode: 'from-bff',
      subCode: 'from-bff',
      lineId: 'DIRECT_COST_OUT',
      bankAmount: 1,
      expenseAmount: 1,
      vatIn: 0,
      depositAmount: 0,
      refundAmount: 0,
      budgetActualAmount: 1,
      cashflowActualLineAmounts: { DIRECT_COST_OUT: 1 },
      manualOutflowPending: false,
    }]);

    const cells = createEmptyCells();
    cells[5] = '회의비';
    cells[6] = '다과비';
    cells[8] = '직접사업비';
    cells[10] = '33,000';
    cells[13] = '30,000';

    const snapshots = await previewSettlementFlowSnapshotsAuthoritatively({
      rows: [createRow(cells)],
      runtime: {
        tenantId: 'mysc',
        projectId: 'p001',
        actor: { uid: 'u001', role: 'pm' },
      },
    });

    expect(platformBffMocks.previewSettlementFlowSnapshotsViaBff).not.toHaveBeenCalled();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      budgetKey: '회의비|다과비',
      budgetCode: '회의비',
      subCode: '다과비',
      lineId: 'DIRECT_COST_OUT',
      budgetActualAmount: 30000,
    });
  });

  it('builds actual sync payloads locally even when runtime is provided', async () => {
    platformBffMocks.isPlatformApiEnabled.mockReturnValue(true);
    platformBffMocks.previewSettlementActualSyncViaBff.mockResolvedValue([{
      yearMonth: '2099-12',
      weekNo: 99,
      amounts: { DIRECT_COST_OUT: 1 },
    }]);

    const yearWeeks = getYearMondayWeeks(2025);
    const cells = createEmptyCells();
    cells[2] = '2025-01-06';
    cells[3] = '25-1-1';
    cells[8] = '직접사업비';
    cells[10] = '33,000';
    cells[13] = '30,000';
    cells[14] = '3,000';

    const payload = await previewSettlementActualSyncAuthoritatively({
      rows: [createRow(cells)],
      yearWeeks,
      runtime: {
        tenantId: 'mysc',
        projectId: 'p001',
        actor: { uid: 'u001', role: 'pm' },
      },
    });

    expect(platformBffMocks.previewSettlementActualSyncViaBff).not.toHaveBeenCalled();
    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      yearMonth: yearWeeks[0]?.yearMonth,
      weekNo: 1,
    });
    expect(payload[0]?.amounts.DIRECT_COST_OUT).toBe(30000);
    expect(payload[0]?.amounts.INPUT_VAT_OUT).toBe(3000);
  });

  it('aggregates budget actuals locally even when runtime is provided', async () => {
    platformBffMocks.isPlatformApiEnabled.mockReturnValue(true);
    platformBffMocks.previewSettlementFlowSnapshotsViaBff.mockResolvedValue([{
      tempId: 'from-bff',
      sourceTxId: 'bank:expense-1',
      entryKind: 'EXPENSE',
      budgetKey: 'from-bff',
      budgetCode: 'from-bff',
      subCode: 'from-bff',
      lineId: 'DIRECT_COST_OUT',
      bankAmount: 1,
      expenseAmount: 1,
      vatIn: 0,
      depositAmount: 0,
      refundAmount: 0,
      budgetActualAmount: 1,
      cashflowActualLineAmounts: { DIRECT_COST_OUT: 1 },
      manualOutflowPending: false,
    }]);

    const spentMap = await aggregateBudgetActualsAuthoritatively({
      rows: [createRow([
        '', '', '2025-01-06', '25-01-1', '', '회의비', '다과비', '', '직접사업비', '', '33,000', '', '', '30,000', '3,000',
      ])],
      runtime: {
        tenantId: 'mysc',
        projectId: 'p001',
        actor: { uid: 'u001', role: 'pm' },
      },
    });

    expect(platformBffMocks.previewSettlementFlowSnapshotsViaBff).not.toHaveBeenCalled();
    expect(spentMap.get('회의비|다과비')).toBe(30000);
  });
});
