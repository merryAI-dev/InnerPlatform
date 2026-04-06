import type { Transaction } from '../data/types';
import { suggestEvidenceUploadFileName, deriveEvidenceLabelFromFileName, inferEvidenceCategoryFromFileName } from './drive-evidence';
import { applyUploadedEvidenceCategories, resolvePreferredEvidenceUploadCategory } from './evidence-helpers';

export interface EvidenceUploadDraftSeed {
  parserCategory: string;
  category: string;
  requiredCategory: string;
  suggestedFileName: string;
}

export function buildEvidenceUploadDraftSeeds(input: {
  files: Array<{ name: string; type?: string }>;
  requiredDesc?: string;
  completedDesc?: string;
  transaction?: Pick<Transaction, 'dateTime' | 'budgetCategory' | 'budgetSubCategory' | 'counterparty' | 'memo'>;
}): EvidenceUploadDraftSeed[] {
  const requiredEntries = String(input.requiredDesc || '')
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  let nextCompletedDesc = String(input.completedDesc || '');

  return input.files.map((file) => {
    const parserCategory = inferEvidenceCategoryFromFileName(file.name);
    const detectedCategory = parserCategory === '기타'
      ? deriveEvidenceLabelFromFileName(file.name)
      : parserCategory;
    const category = resolvePreferredEvidenceUploadCategory({
      evidenceRequired: requiredEntries,
      requiredDesc: input.requiredDesc,
      completedDesc: nextCompletedDesc,
      detectedCategory,
      fallback: detectedCategory,
    });
    const suggestedFileName = suggestEvidenceUploadFileName({
      originalFileName: file.name,
      category,
      transaction: input.transaction,
    });
    nextCompletedDesc = applyUploadedEvidenceCategories({
      evidenceRequired: requiredEntries,
      evidenceRequiredDesc: input.requiredDesc,
      evidenceDriveLink: '',
      evidenceDriveFolderId: '',
      evidenceCompletedDesc: nextCompletedDesc,
      evidenceCompletedManualDesc: '',
      evidenceAutoListedDesc: '',
    }, [category]).evidenceCompletedDesc;
    return {
      parserCategory,
      category,
      requiredCategory: requiredEntries.includes(category) ? category : '',
      suggestedFileName,
    };
  });
}

export function buildImmediateEvidenceUploadState(input: {
  evidenceRequired?: string[];
  evidenceRequiredDesc?: string;
  evidenceDriveLink?: string;
  evidenceDriveFolderId?: string;
  evidenceCompletedDesc?: string;
  evidenceCompletedManualDesc?: string;
  evidenceAutoListedDesc?: string;
  uploadedCategories: string[];
}) {
  return applyUploadedEvidenceCategories({
    evidenceRequired: input.evidenceRequired,
    evidenceRequiredDesc: input.evidenceRequiredDesc,
    evidenceDriveLink: input.evidenceDriveLink,
    evidenceDriveFolderId: input.evidenceDriveFolderId,
    evidenceCompletedDesc: input.evidenceCompletedDesc,
    evidenceCompletedManualDesc: input.evidenceCompletedManualDesc,
    evidenceAutoListedDesc: input.evidenceAutoListedDesc,
  }, input.uploadedCategories);
}

export function buildOptimisticUploadedEvidencePatch(input: {
  transaction: Transaction;
  folderId: string;
  folderName?: string;
  webViewLink?: string;
  sharedDriveId?: string;
  uploadedCategories: string[];
  updatedAt: string;
}): Partial<Transaction> {
  const immediate = buildImmediateEvidenceUploadState({
    evidenceRequired: input.transaction.evidenceRequired,
    evidenceRequiredDesc: input.transaction.evidenceRequiredDesc,
    evidenceDriveLink: input.webViewLink || input.transaction.evidenceDriveLink,
    evidenceDriveFolderId: input.folderId,
    evidenceCompletedDesc: input.transaction.evidenceCompletedDesc,
    evidenceCompletedManualDesc: input.transaction.evidenceCompletedManualDesc,
    evidenceAutoListedDesc: input.transaction.evidenceAutoListedDesc,
    uploadedCategories: input.uploadedCategories,
  });
  return {
    version: input.transaction.version,
    evidenceDriveFolderId: input.folderId,
    evidenceDriveFolderName: input.folderName || input.transaction.evidenceDriveFolderName,
    evidenceDriveLink: input.webViewLink || input.transaction.evidenceDriveLink,
    evidenceDriveSharedDriveId: input.sharedDriveId || input.transaction.evidenceDriveSharedDriveId,
    evidenceDriveSyncStatus: 'UPLOADED',
    evidenceCompletedDesc: immediate.evidenceCompletedDesc,
    evidenceCompletedManualDesc: immediate.evidenceCompletedManualDesc,
    evidencePendingDesc: immediate.evidencePendingDesc,
    evidenceMissing: immediate.evidenceMissing,
    evidenceStatus: immediate.evidenceStatus,
    updatedAt: input.updatedAt,
  };
}
