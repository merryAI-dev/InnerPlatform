import { describe, expect, it } from 'vitest';
import {
  buildDriveProjectFolderName,
  buildDriveTransactionFolderName,
  extractDriveFolderId,
  inferEvidenceCategoryFromFileName,
  resolveEvidenceSyncPatch,
} from './google-drive.mjs';

describe('google-drive helpers', () => {
  it('builds deterministic project and transaction folder names', () => {
    expect(buildDriveProjectFolderName('온드림 AI 증빙', 'p001')).toBe('온드림_AI_증빙_p001');
    expect(buildDriveTransactionFolderName({
      id: 'tx001',
      dateTime: '2026-03-11',
      budgetCategory: '회의비',
      budgetSubCategory: '다과비',
      counterparty: '카페',
      memo: '회의 간식',
    } as any)).toBe('20260311_회의비_다과비_tx001');
  });

  it('infers evidence categories with confidence', () => {
    expect(inferEvidenceCategoryFromFileName('세금계산서_3월.pdf')).toEqual({
      category: '세금계산서',
      confidence: 0.96,
    });
    expect(inferEvidenceCategoryFromFileName('random.bin')).toEqual({
      category: '기타',
      confidence: 0.2,
    });
  });

  it('extracts folder ids from drive links or raw values', () => {
    expect(extractDriveFolderId('https://drive.google.com/drive/folders/1GD5XnPypL-s6Jp44TJjRRd0nnP0Yu_sg?usp=share_link'))
      .toBe('1GD5XnPypL-s6Jp44TJjRRd0nnP0Yu_sg');
    expect(extractDriveFolderId('1GD5XnPypL-s6Jp44TJjRRd0nnP0Yu_sg'))
      .toBe('1GD5XnPypL-s6Jp44TJjRRd0nnP0Yu_sg');
    expect(extractDriveFolderId('not-a-drive-link')).toBe('');
  });

  it('builds sync patch and preserves manual completed desc when customized', () => {
    const patch = resolveEvidenceSyncPatch({
      transaction: {
        evidenceRequired: ['세금계산서', '입금확인서', '계약서'],
        evidenceCompletedDesc: '세금계산서, 계약서',
        evidenceAutoListedDesc: '세금계산서',
        evidenceDriveLink: 'https://drive.google.com/drive/folders/fld-tx',
      },
      evidences: [
        { fileName: '세금계산서_3월.pdf', category: '세금계산서' },
        { fileName: '입금확인서_3월.pdf', category: '입금확인서' },
      ],
      folder: {
        webViewLink: 'https://drive.google.com/drive/folders/fld-tx',
      },
    });

    expect(patch.evidenceAutoListedDesc).toBe('세금계산서, 입금확인서');
    expect(patch.evidenceCompletedDesc).toBe('세금계산서, 계약서');
    expect(patch.evidencePendingDesc).toBe('입금확인서');
    expect(patch.supportPendingDocs).toBe('입금확인서');
    expect(patch.evidenceMissing).toEqual(['입금확인서']);
    expect(patch.evidenceStatus).toBe('PARTIAL');
  });

  it('uses auto-listed completed desc when manual field is empty', () => {
    const patch = resolveEvidenceSyncPatch({
      transaction: {
        evidenceRequired: ['세금계산서', '입금확인서'],
        evidenceCompletedDesc: '',
        evidenceAutoListedDesc: '',
        evidenceDriveLink: 'https://drive.google.com/drive/folders/fld-tx',
      },
      evidences: [
        { fileName: '세금계산서_3월.pdf', category: '세금계산서' },
        { fileName: '입금확인서_3월.pdf', category: '입금확인서' },
      ],
      folder: {
        webViewLink: 'https://drive.google.com/drive/folders/fld-tx',
      },
    });

    expect(patch.evidenceCompletedDesc).toBe('세금계산서, 입금확인서');
    expect(patch.evidencePendingDesc).toBeUndefined();
    expect(patch.evidenceMissing).toEqual([]);
    expect(patch.evidenceStatus).toBe('COMPLETE');
  });
});
