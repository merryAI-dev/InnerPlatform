import type { BankImportIntakeItem } from '../data/types';
import { isBankImportManualFieldsComplete } from './bank-import-triage';

export type BankImportWizardStatus =
  | 'NEEDS_CLASSIFICATION'
  | 'READY_TO_PROJECT'
  | 'PROJECTED_PENDING_EVIDENCE'
  | 'PROJECTED_COMPLETE'
  | 'REVIEW_REQUIRED';

export function resolveBankImportWizardStatus(item: BankImportIntakeItem): BankImportWizardStatus {
  if (item.matchState === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';
  if (!isBankImportManualFieldsComplete(item.manualFields)) return 'NEEDS_CLASSIFICATION';
  if (item.projectionStatus === 'NOT_PROJECTED') return 'READY_TO_PROJECT';
  if (item.evidenceStatus !== 'COMPLETE') return 'PROJECTED_PENDING_EVIDENCE';
  return 'PROJECTED_COMPLETE';
}

export function groupExpenseIntakeItemsForSurface(items: BankImportIntakeItem[]) {
  const grouped = {
    needsClassification: [] as BankImportIntakeItem[],
    reviewRequired: [] as BankImportIntakeItem[],
    pendingEvidence: [] as BankImportIntakeItem[],
    completed: [] as BankImportIntakeItem[],
  };

  items.forEach((item) => {
    const status = resolveBankImportWizardStatus(item);
    if (status === 'REVIEW_REQUIRED') {
      grouped.reviewRequired.push(item);
      return;
    }
    if (status === 'NEEDS_CLASSIFICATION' || status === 'READY_TO_PROJECT') {
      grouped.needsClassification.push(item);
      return;
    }
    if (status === 'PROJECTED_PENDING_EVIDENCE') {
      grouped.pendingEvidence.push(item);
      return;
    }
    grouped.completed.push(item);
  });

  return grouped;
}
