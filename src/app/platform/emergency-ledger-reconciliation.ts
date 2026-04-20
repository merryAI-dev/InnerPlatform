export type EmergencyLedgerRowStatus = 'ACTIVE' | 'DELETED';

export interface EmergencyLedgerRow {
  ledger_row_id: string;
  project_id: string;
  week_id: string;
  ledger_date: string;
  entry_type: string;
  direction: string;
  amount: number;
  account_code: string;
  counterparty: string;
  description: string;
  evidence_url: string;
  operator_email: string;
  updated_at: string;
  incident_id: string;
  change_reason: string;
  row_status: EmergencyLedgerRowStatus;
}

export type EmergencyLedgerChangeOperation = 'CREATE' | 'UPDATE' | 'DELETE';

export interface EmergencyLedgerChangeCandidate {
  operation: EmergencyLedgerChangeOperation;
  ledger_row_id: string;
  before: EmergencyLedgerRow | null;
  after: EmergencyLedgerRow | null;
  changed_fields: string[];
}

export interface EmergencyLedgerChangeSet {
  changes: EmergencyLedgerChangeCandidate[];
  summary: {
    createCount: number;
    updateCount: number;
    deleteCount: number;
    unchangedCount: number;
  };
}

const TRACKED_FIELDS: Array<keyof EmergencyLedgerRow> = [
  'project_id',
  'week_id',
  'ledger_date',
  'entry_type',
  'direction',
  'amount',
  'account_code',
  'counterparty',
  'description',
  'evidence_url',
  'operator_email',
  'updated_at',
  'incident_id',
  'change_reason',
  'row_status',
];

function assertValidLedgerRowId(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('ledger_row_id is required');
  }
  return normalized;
}

function buildRowMap(rows: EmergencyLedgerRow[]): Map<string, EmergencyLedgerRow> {
  const map = new Map<string, EmergencyLedgerRow>();
  for (const row of rows) {
    const ledgerRowId = assertValidLedgerRowId(row.ledger_row_id);
    if (map.has(ledgerRowId)) {
      throw new Error(`duplicate ledger_row_id: ${ledgerRowId}`);
    }
    map.set(ledgerRowId, {
      ...row,
      ledger_row_id: ledgerRowId,
    });
  }
  return map;
}

function isEqualField(left: EmergencyLedgerRow[keyof EmergencyLedgerRow], right: EmergencyLedgerRow[keyof EmergencyLedgerRow]): boolean {
  return left === right;
}

function diffFields(before: EmergencyLedgerRow | null, after: EmergencyLedgerRow | null): string[] {
  if (!before && !after) return [];
  const changed = TRACKED_FIELDS.filter((field) => {
    const left = before?.[field];
    const right = after?.[field];
    return !isEqualField(left, right);
  });
  return changed.sort();
}

export function buildEmergencyLedgerChangeSet(input: {
  baselineRows: EmergencyLedgerRow[];
  sheetRows: EmergencyLedgerRow[];
}): EmergencyLedgerChangeSet {
  const baselineById = buildRowMap(input.baselineRows);
  const sheetById = buildRowMap(input.sheetRows);
  const allIds = new Set<string>([
    ...baselineById.keys(),
    ...sheetById.keys(),
  ]);

  const changes: EmergencyLedgerChangeCandidate[] = [];
  let unchangedCount = 0;

  for (const ledgerRowId of Array.from(allIds).sort()) {
    const before = baselineById.get(ledgerRowId) ?? null;
    const after = sheetById.get(ledgerRowId) ?? null;

    if (!before && after) {
      if (after.row_status === 'DELETED') {
        unchangedCount += 1;
        continue;
      }
      changes.push({
        operation: 'CREATE',
        ledger_row_id: ledgerRowId,
        before: null,
        after,
        changed_fields: diffFields(null, after),
      });
      continue;
    }

    if (before && !after) {
      changes.push({
        operation: 'DELETE',
        ledger_row_id: ledgerRowId,
        before,
        after: {
          ...before,
          row_status: 'DELETED',
        },
        changed_fields: ['row_status'],
      });
      continue;
    }

    if (!before || !after) {
      continue;
    }

    const changedFields = diffFields(before, after);
    if (changedFields.length === 0) {
      unchangedCount += 1;
      continue;
    }

    if (after.row_status === 'DELETED') {
      changes.push({
        operation: 'DELETE',
        ledger_row_id: ledgerRowId,
        before,
        after,
        changed_fields: changedFields,
      });
      continue;
    }

    changes.push({
      operation: 'UPDATE',
      ledger_row_id: ledgerRowId,
      before,
      after,
      changed_fields: changedFields,
    });
  }

  return {
    changes,
    summary: {
      createCount: changes.filter((candidate) => candidate.operation === 'CREATE').length,
      updateCount: changes.filter((candidate) => candidate.operation === 'UPDATE').length,
      deleteCount: changes.filter((candidate) => candidate.operation === 'DELETE').length,
      unchangedCount,
    },
  };
}
