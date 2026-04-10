import type {
  BankImportIntakeItem,
  BankImportManualFields,
  BankImportMatchState,
  BankImportProjectionStatus,
  BankImportSnapshot,
  EvidenceStatus,
} from '../data/types';
import { normalizeSpace, stableHash } from './csv-utils';

function normalizeBankSnapshotValue(value: string | number): string {
  if (typeof value === 'number') return String(value);
  return normalizeSpace(String(value || ''));
}

export function buildBankFingerprint(snapshot: BankImportSnapshot): string {
  return stableHash([
    normalizeBankSnapshotValue(snapshot.accountNumber),
    normalizeBankSnapshotValue(snapshot.dateTime),
    normalizeBankSnapshotValue(snapshot.counterparty),
    normalizeBankSnapshotValue(snapshot.memo),
    normalizeBankSnapshotValue(snapshot.signedAmount),
    normalizeBankSnapshotValue(snapshot.balanceAfter),
  ].join('|'));
}

export function isBankImportManualFieldsComplete(fields: BankImportManualFields | null | undefined): boolean {
  if (!fields) return false;
  return Number.isFinite(fields.expenseAmount)
    && Boolean(normalizeSpace(fields.budgetCategory || ''))
    && Boolean(normalizeSpace(fields.budgetSubCategory || ''))
    && Boolean(fields.cashflowLineId || fields.cashflowCategory);
}

function hasCriticalBankDrift(
  current: BankImportSnapshot,
  incoming: BankImportSnapshot,
): boolean {
  return normalizeSpace(current.accountNumber) !== normalizeSpace(incoming.accountNumber)
    || normalizeSpace(current.dateTime) !== normalizeSpace(incoming.dateTime)
    || current.signedAmount !== incoming.signedAmount;
}

export function resolveBankImportMatchState(input: {
  fingerprint: string;
  incomingSourceTxId: string;
  bankSnapshot: BankImportSnapshot;
  manualFields?: BankImportManualFields;
  existingItem?: BankImportIntakeItem | null;
  conflictingCandidateCount?: number;
}): BankImportMatchState {
  if ((input.conflictingCandidateCount || 0) > 1) return 'REVIEW_REQUIRED';

  const manualFields = input.manualFields || input.existingItem?.manualFields;
  const hasManualFields = isBankImportManualFieldsComplete(manualFields);
  if (!input.existingItem) {
    return hasManualFields ? 'AUTO_CONFIRMED' : 'PENDING_INPUT';
  }

  if (input.existingItem.sourceTxId !== input.incomingSourceTxId) {
    return 'REVIEW_REQUIRED';
  }

  if (hasCriticalBankDrift(input.existingItem.bankSnapshot, input.bankSnapshot)) {
    return 'REVIEW_REQUIRED';
  }

  return hasManualFields ? 'AUTO_CONFIRMED' : 'PENDING_INPUT';
}

export function resolveBankImportProjectionStatus(input: {
  matchState: BankImportMatchState;
  manualFields?: BankImportManualFields;
  evidenceStatus: EvidenceStatus;
}): BankImportProjectionStatus {
  if (input.matchState === 'REVIEW_REQUIRED' || input.matchState === 'IGNORED') {
    return 'NOT_PROJECTED';
  }
  if (!isBankImportManualFieldsComplete(input.manualFields)) {
    return 'NOT_PROJECTED';
  }
  return input.evidenceStatus === 'COMPLETE'
    ? 'PROJECTED'
    : 'PROJECTED_WITH_PENDING_EVIDENCE';
}

export function selectWizardIntakeItems(items: BankImportIntakeItem[]): BankImportIntakeItem[] {
  return [...items]
    .filter((item) => item.matchState === 'PENDING_INPUT' || item.matchState === 'REVIEW_REQUIRED')
    .sort((left, right) => {
      if (left.matchState !== right.matchState) {
        return left.matchState === 'REVIEW_REQUIRED' ? -1 : 1;
      }
      return String(right.bankSnapshot.dateTime || '').localeCompare(String(left.bankSnapshot.dateTime || ''));
    });
}
