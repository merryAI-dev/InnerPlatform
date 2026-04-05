import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportRow } from './settlement-csv';

const platformBffMocks = vi.hoisted(() => ({
  deriveSettlementRowsViaBff: vi.fn(),
  isPlatformApiEnabled: vi.fn(() => false),
  previewSettlementActualSyncViaBff: vi.fn(),
  previewSettlementFlowSnapshotsViaBff: vi.fn(),
}));

vi.mock('../lib/platform-bff-client', () => ({
  ...platformBffMocks,
}));

import {
  aggregateBudgetActualsAuthoritatively,
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

describe('settlement-calculation-kernel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformBffMocks.isPlatformApiEnabled.mockReturnValue(false);
  });

  it('builds local flow snapshots when runtime is unavailable', async () => {
    const cells = createEmptyCells();
    cells[5] = '회의비';
    cells[6] = '다과비';
    cells[8] = '직접사업비';
    cells[10] = '33,000';
    cells[13] = '30,000';

    const snapshots = await previewSettlementFlowSnapshotsAuthoritatively({
      rows: [createRow(cells)],
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      budgetKey: '회의비|다과비',
      budgetCode: '회의비',
      subCode: '다과비',
      lineId: 'DIRECT_COST_OUT',
      budgetActualAmount: 30000,
    });
    expect(platformBffMocks.previewSettlementFlowSnapshotsViaBff).not.toHaveBeenCalled();
  });

  it('aggregates budget actuals from BFF flow snapshot previews when runtime is enabled', async () => {
    platformBffMocks.isPlatformApiEnabled.mockReturnValue(true);
    platformBffMocks.previewSettlementFlowSnapshotsViaBff.mockResolvedValue([{
      tempId: 'imp-1',
      sourceTxId: 'bank:expense-1',
      entryKind: 'EXPENSE',
      budgetKey: '회의비|다과비',
      budgetCode: '회의비',
      subCode: '다과비',
      lineId: 'DIRECT_COST_OUT',
      bankAmount: 33000,
      expenseAmount: 30000,
      vatIn: 3000,
      depositAmount: 0,
      refundAmount: 0,
      budgetActualAmount: 30000,
      cashflowActualLineAmounts: {
        DIRECT_COST_OUT: 30000,
        INPUT_VAT_OUT: 3000,
      },
      manualOutflowPending: false,
    }]);

    const spentMap = await aggregateBudgetActualsAuthoritatively({
      rows: [{
        tempId: 'imp-1',
        sourceTxId: 'bank:expense-1',
        entryKind: 'EXPENSE',
        cells: createEmptyCells(),
      }],
      runtime: {
        tenantId: 'mysc',
        projectId: 'p001',
        actor: { uid: 'u001', role: 'pm' },
      },
    });

    expect(platformBffMocks.previewSettlementFlowSnapshotsViaBff).toHaveBeenCalledWith({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm' },
      projectId: 'p001',
      rows: expect.any(Array),
    });
    expect(spentMap.get('회의비|다과비')).toBe(30000);
  });
});
