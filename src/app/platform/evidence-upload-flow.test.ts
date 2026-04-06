import { describe, expect, it } from 'vitest';
import {
  buildEvidenceUploadDraftSeeds,
  buildImmediateEvidenceUploadState,
} from './evidence-upload-flow';

describe('buildEvidenceUploadDraftSeeds', () => {
  it('prefers required evidence labels over generic parser matches', () => {
    const drafts = buildEvidenceUploadDraftSeeds({
      files: [
        { name: 'tax_invoice_april.pdf', type: 'application/pdf' },
      ],
      requiredDesc: '전자세금계산서, 참석확인서',
      completedDesc: '',
      transaction: {
        dateTime: '2026-04-02',
        budgetCategory: '교육운영비',
        budgetSubCategory: '강사비',
        counterparty: '테스트상점',
        memo: '4월 운영',
      },
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.parserCategory).toBe('세금계산서');
    expect(drafts[0]?.category).toBe('전자세금계산서');
    expect(drafts[0]?.requiredCategory).toBe('전자세금계산서');
    expect(drafts[0]?.suggestedFileName).toContain('전자세금계산서');
  });

  it('consumes completed categories while preparing multiple drafts in one batch', () => {
    const drafts = buildEvidenceUploadDraftSeeds({
      files: [
        { name: 'invoice.pdf', type: 'application/pdf' },
        { name: 'random_upload.png', type: 'image/png' },
      ],
      requiredDesc: '세금계산서, 입금확인증',
      completedDesc: '',
    });

    expect(drafts.map((draft) => draft.category)).toEqual(['세금계산서', '입금확인증']);
  });
});

describe('buildImmediateEvidenceUploadState', () => {
  it('returns immediate completed and pending fields without a follow-up sync', () => {
    const result = buildImmediateEvidenceUploadState({
      evidenceRequired: ['세금계산서', '입금확인증'],
      evidenceDriveFolderId: 'folder-1',
      evidenceCompletedDesc: '세금계산서',
      evidenceCompletedManualDesc: '',
      evidenceAutoListedDesc: '',
      uploadedCategories: ['입금확인증'],
    });

    expect(result.evidenceCompletedDesc).toBe('세금계산서, 입금확인증');
    expect(result.evidencePendingDesc).toBe('');
    expect(result.evidenceStatus).toBe('COMPLETE');
  });
});
