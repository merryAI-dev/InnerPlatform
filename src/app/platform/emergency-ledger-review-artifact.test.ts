import { describe, expect, it } from 'vitest';

import {
  buildEmergencyLedgerReviewArtifact,
  type EmergencyLedgerChangeCandidate,
} from './emergency-ledger-review-artifact';

function makeChange(overrides: Partial<EmergencyLedgerChangeCandidate> = {}): EmergencyLedgerChangeCandidate {
  return {
    operation: 'UPDATE',
    ledger_row_id: 'row-001',
    before: {
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
    },
    after: {
      ledger_row_id: 'row-001',
      project_id: 'p-finance',
      week_id: '2026-04-w3',
      ledger_date: '2026-04-15',
      entry_type: 'EXPENSE',
      direction: 'OUTFLOW',
      amount: 175000,
      account_code: 'TRAVEL',
      counterparty: 'KTX',
      description: '출장 교통비',
      evidence_url: 'https://drive.google.com/file/d/1',
      operator_email: 'pm@example.com',
      updated_at: '2026-04-17T12:00:00.000Z',
      incident_id: 'inc-001',
      change_reason: '실제 금액 정정',
      row_status: 'ACTIVE',
    },
    changed_fields: ['amount', 'change_reason', 'updated_at'],
    ...overrides,
  };
}

describe('emergency ledger review artifact', () => {
  it('builds reviewer-facing entries with stable summaries and risk badges', () => {
    const artifact = buildEmergencyLedgerReviewArtifact({
      incidentId: 'inc-001',
      changes: [
        makeChange(),
        makeChange({
          operation: 'DELETE',
          ledger_row_id: 'row-002',
          changed_fields: ['row_status'],
          after: {
            ...makeChange().after!,
            ledger_row_id: 'row-002',
            row_status: 'DELETED',
          },
        }),
        makeChange({
          operation: 'CREATE',
          ledger_row_id: 'row-003',
          before: null,
          changed_fields: ['amount', 'description', 'project_id', 'week_id'],
          after: {
            ...makeChange().after!,
            ledger_row_id: 'row-003',
            amount: 44000,
            description: '주차비',
          },
        }),
      ],
    });

    expect(artifact.summary).toEqual({
      incidentId: 'inc-001',
      totalChanges: 3,
      createCount: 1,
      updateCount: 1,
      deleteCount: 1,
      highRiskCount: 1,
    });

    expect(artifact.entries).toEqual([
      expect.objectContaining({
        ledger_row_id: 'row-001',
        operation: 'UPDATE',
        risk_badge: 'MEDIUM',
        review_label: 'UPDATE · p-finance · 2026-04-w3',
      }),
      expect.objectContaining({
        ledger_row_id: 'row-002',
        operation: 'DELETE',
        risk_badge: 'HIGH',
      }),
      expect.objectContaining({
        ledger_row_id: 'row-003',
        operation: 'CREATE',
        risk_badge: 'MEDIUM',
      }),
    ]);
  });

  it('fails closed when change candidates have no operator context', () => {
    expect(() => buildEmergencyLedgerReviewArtifact({
      incidentId: 'inc-001',
      changes: [
        makeChange({
          before: {
            ...makeChange().before!,
            operator_email: '',
          },
          after: {
            ...makeChange().after!,
            operator_email: '',
          },
        }),
      ],
    })).toThrow(/operator_email/i);
  });
});
