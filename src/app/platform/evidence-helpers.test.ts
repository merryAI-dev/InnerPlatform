import { describe, expect, it } from 'vitest';
import {
  computeEvidenceMissing,
  computeEvidenceStatus,
  resolveEvidenceCompletedDesc,
  resolveEvidenceCompletedManualDesc,
} from './evidence-helpers';

describe('evidence-helpers', () => {
  it('prefers explicit manual override when present', () => {
    const tx = {
      evidenceAutoListedDesc: '세금계산서, 입금확인서',
      evidenceCompletedManualDesc: '계약서',
      evidenceCompletedDesc: '세금계산서, 입금확인서, 계약서',
    } as any;

    expect(resolveEvidenceCompletedManualDesc(tx)).toBe('계약서');
    expect(resolveEvidenceCompletedDesc(tx)).toBe('세금계산서, 입금확인서, 계약서');
  });

  it('derives legacy manual-only values from completed desc when auto list exists', () => {
    const tx = {
      evidenceAutoListedDesc: '세금계산서',
      evidenceCompletedDesc: '세금계산서, 계약서',
    } as any;

    expect(resolveEvidenceCompletedManualDesc(tx)).toBe('계약서');
    expect(resolveEvidenceCompletedDesc(tx)).toBe('세금계산서, 계약서');
  });

  it('uses merged auto/manual evidence for status and missing checks', () => {
    const tx = {
      evidenceDriveFolderId: 'fld-001',
      evidenceRequired: ['세금계산서', '입금확인서', '계약서'],
      evidenceAutoListedDesc: '세금계산서, 입금확인서',
      evidenceCompletedManualDesc: '계약서',
    } as any;

    expect(computeEvidenceStatus(tx)).toBe('COMPLETE');
    expect(computeEvidenceMissing(tx)).toEqual([]);
  });
});
