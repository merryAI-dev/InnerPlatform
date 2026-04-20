import type { EmergencyLedgerChangeCandidate } from './emergency-ledger-reconciliation';

export type EmergencyLedgerRiskBadge = 'LOW' | 'MEDIUM' | 'HIGH';

export interface EmergencyLedgerReviewEntry {
  ledger_row_id: string;
  operation: EmergencyLedgerChangeCandidate['operation'];
  review_label: string;
  risk_badge: EmergencyLedgerRiskBadge;
  operator_email: string;
  updated_at: string;
  change_reason: string;
  evidence_url: string;
  changed_fields: string[];
  before: EmergencyLedgerChangeCandidate['before'];
  after: EmergencyLedgerChangeCandidate['after'];
}

export interface EmergencyLedgerReviewArtifact {
  summary: {
    incidentId: string;
    totalChanges: number;
    createCount: number;
    updateCount: number;
    deleteCount: number;
    highRiskCount: number;
  };
  entries: EmergencyLedgerReviewEntry[];
}

function pickOperatorEmail(change: EmergencyLedgerChangeCandidate): string {
  const value = String(change.after?.operator_email || change.before?.operator_email || '').trim();
  if (!value) {
    throw new Error(`operator_email is required for ${change.ledger_row_id}`);
  }
  return value;
}

function pickUpdatedAt(change: EmergencyLedgerChangeCandidate): string {
  return String(change.after?.updated_at || change.before?.updated_at || '').trim();
}

function pickChangeReason(change: EmergencyLedgerChangeCandidate): string {
  return String(change.after?.change_reason || change.before?.change_reason || '').trim();
}

function pickEvidenceUrl(change: EmergencyLedgerChangeCandidate): string {
  return String(change.after?.evidence_url || change.before?.evidence_url || '').trim();
}

function buildRiskBadge(change: EmergencyLedgerChangeCandidate): EmergencyLedgerRiskBadge {
  if (change.operation === 'DELETE') return 'HIGH';
  if (change.changed_fields.includes('amount')) return 'MEDIUM';
  return 'LOW';
}

function buildReviewLabel(change: EmergencyLedgerChangeCandidate): string {
  const source = change.after || change.before;
  return `${change.operation} · ${source?.project_id || 'unknown-project'} · ${source?.week_id || 'unknown-week'}`;
}

export function buildEmergencyLedgerReviewArtifact(input: {
  incidentId: string;
  changes: EmergencyLedgerChangeCandidate[];
}): EmergencyLedgerReviewArtifact {
  const entries = input.changes.map((change) => ({
    ledger_row_id: change.ledger_row_id,
    operation: change.operation,
    review_label: buildReviewLabel(change),
    risk_badge: buildRiskBadge(change),
    operator_email: pickOperatorEmail(change),
    updated_at: pickUpdatedAt(change),
    change_reason: pickChangeReason(change),
    evidence_url: pickEvidenceUrl(change),
    changed_fields: [...change.changed_fields],
    before: change.before,
    after: change.after,
  }));

  return {
    summary: {
      incidentId: input.incidentId,
      totalChanges: entries.length,
      createCount: entries.filter((entry) => entry.operation === 'CREATE').length,
      updateCount: entries.filter((entry) => entry.operation === 'UPDATE').length,
      deleteCount: entries.filter((entry) => entry.operation === 'DELETE').length,
      highRiskCount: entries.filter((entry) => entry.risk_badge === 'HIGH').length,
    },
    entries,
  };
}
