import { describe, expect, it } from 'vitest';

import {
  buildEmergencyLedgerChangeSet,
  type EmergencyLedgerRow,
} from './emergency-ledger-reconciliation';

function makeRow(overrides: Partial<EmergencyLedgerRow> = {}): EmergencyLedgerRow {
  return {
    ledger_row_id: 'row-001',
    project_id: 'p-finance',
    week_id: '2026-04-w3',
    ledger_date: '2026-04-15',
    entry_type: 'EXPENSE',
    direction: 'OUTFLOW',
    amount: 150000,
    account_code: 'TRAVEL',
    counterparty: 'KTX',
    description: '출장 교통비',
    evidence_url: 'https://drive.google.com/file/d/1',
    operator_email: 'pm@example.com',
    updated_at: '2026-04-17T09:00:00.000Z',
    incident_id: 'inc-001',
    change_reason: 'baseline',
    row_status: 'ACTIVE',
    ...overrides,
  };
}

describe('emergency ledger reconciliation diff engine', () => {
  it('builds create, update, and delete candidates from baseline and emergency sheet rows', () => {
    const baselineRows = [
      makeRow(),
      makeRow({
        ledger_row_id: 'row-002',
        amount: 320000,
        description: '항공권',
      }),
      makeRow({
        ledger_row_id: 'row-003',
        amount: 99000,
        description: '숙박비',
      }),
    ];

    const sheetRows = [
      makeRow({
        ledger_row_id: 'row-001',
        amount: 175000,
        change_reason: '실제 교통비 정정',
        updated_at: '2026-04-17T12:00:00.000Z',
      }),
      makeRow({
        ledger_row_id: 'row-002',
        amount: 320000,
        description: '항공권',
      }),
      makeRow({
        ledger_row_id: 'row-004',
        amount: 44000,
        description: '주차비',
        change_reason: 'outage create',
      }),
    ];

    const changeSet = buildEmergencyLedgerChangeSet({
      baselineRows,
      sheetRows,
    });

    expect(changeSet.summary).toEqual({
      createCount: 1,
      updateCount: 1,
      deleteCount: 1,
      unchangedCount: 1,
    });

    expect(changeSet.changes).toEqual([
      expect.objectContaining({
        operation: 'UPDATE',
        ledger_row_id: 'row-001',
        changed_fields: ['amount', 'change_reason', 'updated_at'],
      }),
      expect.objectContaining({
        operation: 'DELETE',
        ledger_row_id: 'row-003',
        changed_fields: ['row_status'],
      }),
      expect.objectContaining({
        operation: 'CREATE',
        ledger_row_id: 'row-004',
        changed_fields: expect.arrayContaining(['amount', 'change_reason', 'description']),
      }),
    ]);
  });

  it('treats deleted sheet rows as delete candidates instead of hard deletes', () => {
    const baselineRows = [
      makeRow({ ledger_row_id: 'row-010', description: '삭제 예정' }),
    ];
    const sheetRows = [
      makeRow({
        ledger_row_id: 'row-010',
        description: '삭제 예정',
        row_status: 'DELETED',
        change_reason: '운영자가 삭제 표시',
      }),
    ];

    const changeSet = buildEmergencyLedgerChangeSet({
      baselineRows,
      sheetRows,
    });

    expect(changeSet.summary.deleteCount).toBe(1);
    expect(changeSet.changes[0]).toEqual(expect.objectContaining({
      operation: 'DELETE',
      ledger_row_id: 'row-010',
      changed_fields: ['change_reason', 'row_status'],
      after: expect.objectContaining({
        row_status: 'DELETED',
      }),
    }));
  });

  it('fails closed when row identity is missing or duplicated', () => {
    expect(() => buildEmergencyLedgerChangeSet({
      baselineRows: [makeRow({ ledger_row_id: '' })],
      sheetRows: [],
    })).toThrow(/ledger_row_id/i);

    expect(() => buildEmergencyLedgerChangeSet({
      baselineRows: [makeRow({ ledger_row_id: 'dup' }), makeRow({ ledger_row_id: 'dup', amount: 2 })],
      sheetRows: [],
    })).toThrow(/duplicate ledger_row_id/i);
  });
});
