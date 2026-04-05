import { describe, expect, it } from 'vitest';
import type { ImportRow } from './settlement-csv';
import type { SettlementDerivationContext } from './settlement-row-derivation';

import { getYearMondayWeeks } from './cashflow-weeks';
import {
  aggregateBudgetActualsFromSettlementRowsLocally,
  buildSettlementActualSyncPayloadLocally,
  buildSettlementFlowSnapshotsLocally,
  deriveSettlementRowsLocally,
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
  it('does not expose authoritative wrappers or runtime config anymore', async () => {
    const module = await import('./settlement-calculation-kernel');

    expect('deriveSettlementRowsAuthoritatively' in module).toBe(false);
    expect('previewSettlementActualSyncAuthoritatively' in module).toBe(false);
    expect('previewSettlementFlowSnapshotsAuthoritatively' in module).toBe(false);
    expect('aggregateBudgetActualsAuthoritatively' in module).toBe(false);
    expect('SettlementKernelRuntimeConfig' in module).toBe(false);
  });

  it('derives settlement rows locally through the primary kernel api', () => {
    const cells = createEmptyCells();
    cells[2] = '2025-01-06';
    cells[8] = '직접사업비';
    cells[10] = '33,000';
    cells[13] = '30,000';

    const rows = deriveSettlementRowsLocally(
      [createRow(cells)],
      createDerivationContext(),
      { mode: 'row' },
    );

    expect(rows).toHaveLength(1);
  });

  it('builds local flow snapshots through the primary kernel api', () => {
    const cells = createEmptyCells();
    cells[5] = '회의비';
    cells[6] = '다과비';
    cells[8] = '직접사업비';
    cells[10] = '33,000';
    cells[13] = '30,000';

    const snapshots = buildSettlementFlowSnapshotsLocally([createRow(cells)]);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      budgetKey: '회의비|다과비',
      budgetCode: '회의비',
      subCode: '다과비',
      lineId: 'DIRECT_COST_OUT',
      budgetActualAmount: 30000,
    });
  });

  it('builds actual sync payloads locally through the primary kernel api', () => {
    const yearWeeks = getYearMondayWeeks(2025);
    const cells = createEmptyCells();
    cells[2] = '2025-01-06';
    cells[3] = '25-1-1';
    cells[8] = '직접사업비';
    cells[10] = '33,000';
    cells[13] = '30,000';
    cells[14] = '3,000';

    const payload = buildSettlementActualSyncPayloadLocally([createRow(cells)], yearWeeks);

    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      yearMonth: yearWeeks[0]?.yearMonth,
      weekNo: 1,
    });
    expect(payload[0]?.amounts.DIRECT_COST_OUT).toBe(30000);
    expect(payload[0]?.amounts.INPUT_VAT_OUT).toBe(3000);
  });

  it('aggregates budget actuals locally through the primary kernel api', () => {
    const spentMap = aggregateBudgetActualsFromSettlementRowsLocally([
      createRow([
        '', '', '2025-01-06', '25-01-1', '', '회의비', '다과비', '', '직접사업비', '', '33,000', '', '', '30,000', '3,000',
      ]),
    ]);

    expect(spentMap.get('회의비|다과비')).toBe(30000);
  });
});
