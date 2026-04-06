import { describe, expect, it } from 'vitest';
import {
  computeEvidenceMissing,
  resolveEvidenceChecklist,
  computeEvidenceStatus,
  computeEvidenceSummary,
  isValidDriveUrl,
  normalizeEvidenceEntryKey,
  resolveEvidenceCompletedDesc,
  resolveEvidenceCompletedManualDesc,
  resolvePreferredEvidenceUploadCategory,
  applyUploadedEvidenceCategories,
} from './evidence-helpers';

// Helper to build a minimal Transaction-like object
function makeTx(overrides: Record<string, unknown> = {}): any {
  return {
    evidenceRequired: [],
    evidenceStatus: undefined,
    evidenceDriveLink: undefined,
    evidenceDriveFolderId: undefined,
    evidenceAutoListedDesc: undefined,
    evidenceCompletedDesc: undefined,
    evidenceCompletedManualDesc: undefined,
    ...overrides,
  };
}

// ── resolveEvidenceCompletedManualDesc ──

describe('resolveEvidenceCompletedManualDesc', () => {
  it('returns explicit manual override when present', () => {
    const tx = makeTx({
      evidenceCompletedManualDesc: '계약서',
      evidenceAutoListedDesc: '세금계산서',
      evidenceCompletedDesc: '세금계산서, 계약서',
    });
    expect(resolveEvidenceCompletedManualDesc(tx)).toBe('계약서');
  });

  it('derives manual-only items by removing auto items from completed', () => {
    const tx = makeTx({
      evidenceAutoListedDesc: '세금계산서',
      evidenceCompletedDesc: '세금계산서, 계약서',
    });
    expect(resolveEvidenceCompletedManualDesc(tx)).toBe('계약서');
  });

  it('returns empty when completed equals auto', () => {
    const tx = makeTx({
      evidenceAutoListedDesc: '세금계산서',
      evidenceCompletedDesc: '세금계산서',
    });
    expect(resolveEvidenceCompletedManualDesc(tx)).toBe('');
  });

  it('returns completed as-is when no auto list', () => {
    const tx = makeTx({
      evidenceCompletedDesc: '계약서, 견적서',
    });
    expect(resolveEvidenceCompletedManualDesc(tx)).toBe('계약서, 견적서');
  });

  it('returns empty when no fields are set', () => {
    const tx = makeTx();
    expect(resolveEvidenceCompletedManualDesc(tx)).toBe('');
  });

  it('handles whitespace-only manual desc', () => {
    const tx = makeTx({
      evidenceCompletedManualDesc: '   ',
      evidenceCompletedDesc: '계약서',
    });
    // whitespace trims to empty, so falls through to derivation
    expect(resolveEvidenceCompletedManualDesc(tx)).toBe('계약서');
  });

  it('handles null/undefined fields gracefully', () => {
    const tx = makeTx({
      evidenceCompletedManualDesc: null,
      evidenceAutoListedDesc: null,
      evidenceCompletedDesc: null,
    });
    expect(resolveEvidenceCompletedManualDesc(tx)).toBe('');
  });
});

// ── resolveEvidenceCompletedDesc ──

describe('resolveEvidenceCompletedDesc', () => {
  it('merges auto and manual without duplicates', () => {
    const tx = makeTx({
      evidenceAutoListedDesc: '세금계산서, 입금확인서',
      evidenceCompletedManualDesc: '계약서',
      evidenceCompletedDesc: '세금계산서, 입금확인서, 계약서',
    });
    expect(resolveEvidenceCompletedDesc(tx)).toBe('세금계산서, 입금확인서, 계약서');
  });

  it('returns auto-only when no manual entries', () => {
    const tx = makeTx({
      evidenceAutoListedDesc: '세금계산서',
      evidenceCompletedDesc: '세금계산서',
    });
    expect(resolveEvidenceCompletedDesc(tx)).toBe('세금계산서');
  });

  it('returns manual-only when no auto list', () => {
    const tx = makeTx({
      evidenceCompletedManualDesc: '계약서',
    });
    expect(resolveEvidenceCompletedDesc(tx)).toBe('계약서');
  });

  it('falls back to evidenceCompletedDesc when both auto and manual are empty', () => {
    const tx = makeTx({
      evidenceCompletedDesc: '레거시 데이터',
    });
    expect(resolveEvidenceCompletedDesc(tx)).toBe('레거시 데이터');
  });

  it('returns empty when nothing is set', () => {
    const tx = makeTx();
    expect(resolveEvidenceCompletedDesc(tx)).toBe('');
  });

  it('deduplicates case-insensitively', () => {
    const tx = makeTx({
      evidenceAutoListedDesc: '세금계산서',
      evidenceCompletedManualDesc: '세금계산서',
    });
    // same entry should not be duplicated
    expect(resolveEvidenceCompletedDesc(tx)).toBe('세금계산서');
  });
});

// ── computeEvidenceStatus ──

describe('computeEvidenceStatus', () => {
  describe('without evidenceRequired', () => {
    it('returns COMPLETE when link and completed desc both present', () => {
      const tx = makeTx({
        evidenceDriveLink: 'https://drive.google.com/folder/abc',
        evidenceCompletedDesc: '계약서',
      });
      expect(computeEvidenceStatus(tx)).toBe('COMPLETE');
    });

    it('returns PARTIAL when only link present', () => {
      const tx = makeTx({
        evidenceDriveLink: 'https://drive.google.com/folder/abc',
      });
      expect(computeEvidenceStatus(tx)).toBe('PARTIAL');
    });

    it('returns PARTIAL when only completed desc present', () => {
      const tx = makeTx({
        evidenceCompletedDesc: '세금계산서',
      });
      expect(computeEvidenceStatus(tx)).toBe('PARTIAL');
    });

    it('returns PARTIAL when folderId present (no link)', () => {
      const tx = makeTx({
        evidenceDriveFolderId: 'fld-001',
      });
      expect(computeEvidenceStatus(tx)).toBe('PARTIAL');
    });

    it('returns MISSING when nothing present', () => {
      const tx = makeTx();
      expect(computeEvidenceStatus(tx)).toBe('MISSING');
    });
  });

  describe('with evidenceRequired', () => {
    it('returns COMPLETE when all required items matched and link present', () => {
      const tx = makeTx({
        evidenceDriveFolderId: 'fld-001',
        evidenceRequired: ['세금계산서', '계약서'],
        evidenceAutoListedDesc: '세금계산서',
        evidenceCompletedManualDesc: '계약서',
      });
      expect(computeEvidenceStatus(tx)).toBe('COMPLETE');
    });

    it('returns PARTIAL when some required items missing but link present', () => {
      const tx = makeTx({
        evidenceDriveLink: 'https://drive.google.com/folder/abc',
        evidenceRequired: ['세금계산서', '계약서'],
        evidenceCompletedDesc: '세금계산서',
      });
      expect(computeEvidenceStatus(tx)).toBe('PARTIAL');
    });

    it('returns PARTIAL when completed items exist but no link', () => {
      const tx = makeTx({
        evidenceRequired: ['세금계산서'],
        evidenceCompletedDesc: '세금계산서',
      });
      expect(computeEvidenceStatus(tx)).toBe('PARTIAL');
    });

    it('returns MISSING when no completed items and no link', () => {
      const tx = makeTx({
        evidenceRequired: ['세금계산서', '계약서'],
      });
      expect(computeEvidenceStatus(tx)).toBe('MISSING');
    });

    it('matches required items case-insensitively', () => {
      const tx = makeTx({
        evidenceDriveLink: 'https://drive.google.com/x',
        evidenceRequired: ['Invoice'],
        evidenceCompletedDesc: 'invoice',
      });
      expect(computeEvidenceStatus(tx)).toBe('COMPLETE');
    });
  });
});

// ── isValidDriveUrl ──

describe('isValidDriveUrl', () => {
  it('accepts drive.google.com URL', () => {
    expect(isValidDriveUrl('https://drive.google.com/drive/folders/abc')).toBe(true);
  });

  it('accepts docs.google.com URL', () => {
    expect(isValidDriveUrl('https://docs.google.com/spreadsheets/d/abc')).toBe(true);
  });

  it('accepts http URL', () => {
    expect(isValidDriveUrl('http://drive.google.com/drive/folders/abc')).toBe(true);
  });

  it('rejects non-Google URL', () => {
    expect(isValidDriveUrl('https://example.com/file.pdf')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidDriveUrl('')).toBe(false);
  });

  it('rejects whitespace-only string', () => {
    expect(isValidDriveUrl('   ')).toBe(false);
  });

  it('rejects null-ish input', () => {
    expect(isValidDriveUrl(null as any)).toBe(false);
    expect(isValidDriveUrl(undefined as any)).toBe(false);
  });

  it('accepts URL with leading/trailing spaces', () => {
    expect(isValidDriveUrl('  https://drive.google.com/folder/x  ')).toBe(true);
  });

  it('rejects plain text containing google.com', () => {
    expect(isValidDriveUrl('go to drive.google.com')).toBe(false);
  });
});

// ── computeEvidenceMissing ──

describe('computeEvidenceMissing', () => {
  it('returns empty array when evidenceRequired is empty', () => {
    const tx = makeTx({ evidenceRequired: [] });
    expect(computeEvidenceMissing(tx)).toEqual([]);
  });

  it('returns all required items when nothing is completed', () => {
    const tx = makeTx({
      evidenceRequired: ['세금계산서', '계약서'],
    });
    expect(computeEvidenceMissing(tx)).toEqual(['세금계산서', '계약서']);
  });

  it('returns only missing items', () => {
    const tx = makeTx({
      evidenceRequired: ['세금계산서', '계약서', '견적서'],
      evidenceCompletedDesc: '세금계산서, 견적서',
    });
    expect(computeEvidenceMissing(tx)).toEqual(['계약서']);
  });

  it('returns empty when all required items are completed', () => {
    const tx = makeTx({
      evidenceRequired: ['세금계산서', '계약서'],
      evidenceAutoListedDesc: '세금계산서',
      evidenceCompletedManualDesc: '계약서',
    });
    expect(computeEvidenceMissing(tx)).toEqual([]);
  });

  it('uses merged auto+manual desc for matching', () => {
    const tx = makeTx({
      evidenceRequired: ['세금계산서', '입금확인서', '계약서'],
      evidenceAutoListedDesc: '세금계산서, 입금확인서',
      evidenceCompletedManualDesc: '계약서',
    });
    expect(computeEvidenceMissing(tx)).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const tx = makeTx({
      evidenceRequired: ['Invoice'],
      evidenceCompletedDesc: 'invoice attached',
    });
    expect(computeEvidenceMissing(tx)).toEqual([]);
  });

  it('matches normalized evidence aliases', () => {
    const tx = makeTx({
      evidenceRequired: ['전자세금계산서', '지출결의서', '참석확인서'],
      evidenceCompletedDesc: '세금계산서, 지출결의, 참석자명단',
    });
    expect(computeEvidenceMissing(tx)).toEqual([]);
  });
});

describe('evidence normalization', () => {
  it('normalizes common evidence aliases to the same key', () => {
    expect(normalizeEvidenceEntryKey('전자세금계산서')).toBe('세금계산서');
    expect(normalizeEvidenceEntryKey('지출결의서')).toBe('지출결의');
    expect(normalizeEvidenceEntryKey('참석확인서')).toBe('참석자명단');
  });

  it('builds a checklist snapshot for UI coloring', () => {
    const checklist = resolveEvidenceChecklist(makeTx({
      evidenceRequired: ['전자세금계산서', '입금확인증'],
      evidenceCompletedDesc: '세금계산서',
      evidenceDriveFolderId: 'folder-1',
    }));

    expect(checklist.status).toBe('PARTIAL');
    expect(checklist.missing).toEqual(['입금확인증']);
    expect(checklist.hasLink).toBe(true);
  });
});

describe('resolvePreferredEvidenceUploadCategory', () => {
  it('prefers the matching required evidence label over the parser label', () => {
    expect(resolvePreferredEvidenceUploadCategory({
      requiredDesc: '전자세금계산서, 참석확인서',
      completedDesc: '',
      detectedCategory: '세금계산서',
      fallback: '세금계산서',
    })).toBe('전자세금계산서');
  });

  it('uses the only remaining required evidence when the file name is ambiguous', () => {
    expect(resolvePreferredEvidenceUploadCategory({
      requiredDesc: '세금계산서, 입금확인증',
      completedDesc: '세금계산서',
      detectedCategory: '기타',
      fallback: '기타',
    })).toBe('입금확인증');
  });
});

describe('applyUploadedEvidenceCategories', () => {
  it('merges uploaded evidence into completed and pending lists immediately', () => {
    const result = applyUploadedEvidenceCategories(makeTx({
      evidenceRequired: ['전자세금계산서', '입금확인증'],
      evidenceDriveFolderId: 'folder-1',
      evidenceCompletedDesc: '전자세금계산서',
    }), ['입금확인증']);

    expect(result.evidenceCompletedDesc).toBe('전자세금계산서, 입금확인증');
    expect(result.evidenceCompletedManualDesc).toBe('입금확인증');
    expect(result.evidencePendingDesc).toBe('');
    expect(result.evidenceMissing).toEqual([]);
    expect(result.evidenceStatus).toBe('COMPLETE');
  });

  it('deduplicates aliases when uploaded categories overlap existing completed items', () => {
    const result = applyUploadedEvidenceCategories(makeTx({
      evidenceRequired: ['세금계산서'],
      evidenceDriveLink: 'https://drive.google.com/folder/x',
      evidenceCompletedDesc: '전자세금계산서',
    }), ['세금계산서']);

    expect(result.evidenceCompletedDesc).toBe('전자세금계산서');
    expect(result.evidenceCompletedManualDesc).toBe('');
    expect(result.evidenceStatus).toBe('COMPLETE');
  });
});

// ── computeEvidenceSummary ──

describe('computeEvidenceSummary', () => {
  it('returns zeroes for empty transaction list', () => {
    expect(computeEvidenceSummary([])).toEqual({
      complete: 0,
      partial: 0,
      missing: 0,
    });
  });

  it('uses pre-computed evidenceStatus when available', () => {
    const transactions = [
      makeTx({ evidenceStatus: 'COMPLETE' }),
      makeTx({ evidenceStatus: 'PARTIAL' }),
      makeTx({ evidenceStatus: 'MISSING' }),
      makeTx({ evidenceStatus: 'COMPLETE' }),
    ];
    expect(computeEvidenceSummary(transactions)).toEqual({
      complete: 2,
      partial: 1,
      missing: 1,
    });
  });

  it('computes status on the fly when evidenceStatus is not set', () => {
    const transactions = [
      makeTx({
        evidenceDriveLink: 'https://drive.google.com/x',
        evidenceCompletedDesc: '계약서',
      }),
      makeTx(), // no evidence at all => MISSING
    ];
    expect(computeEvidenceSummary(transactions)).toEqual({
      complete: 1,
      partial: 0,
      missing: 1,
    });
  });

  it('counts all as missing when no evidence data present', () => {
    const transactions = [makeTx(), makeTx(), makeTx()];
    expect(computeEvidenceSummary(transactions)).toEqual({
      complete: 0,
      partial: 0,
      missing: 3,
    });
  });

  it('handles mixed pre-computed and dynamic statuses', () => {
    const transactions = [
      makeTx({ evidenceStatus: 'COMPLETE' }),
      makeTx({ evidenceDriveLink: 'https://drive.google.com/x' }), // PARTIAL (link only)
      makeTx({ evidenceStatus: 'MISSING' }),
    ];
    expect(computeEvidenceSummary(transactions)).toEqual({
      complete: 1,
      partial: 1,
      missing: 1,
    });
  });
});
