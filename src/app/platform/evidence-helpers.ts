import type { EvidenceStatus, Transaction } from '../data/types';

function splitEvidenceDesc(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeEvidenceEntryKey(raw: string): string {
  const normalized = String(raw || '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[_\-\s()[\]{}]+/g, '');
  if (!normalized) return '';
  if (normalized.includes('zoominvoice')) return 'zoominvoice';
  if (normalized.includes('표준재무제표증명') || normalized.includes('재무제표증명')) return '표준재무제표증명';
  if (normalized.includes('전자세금계산서') || normalized.includes('세금계산서') || normalized.includes('taxinvoice')) return '세금계산서';
  if (normalized.includes('입금확인증') || normalized.includes('입금확인서') || normalized.includes('입금증') || normalized.includes('depositconfirmation')) return '입금확인서';
  if (normalized.includes('송금확인서') || normalized.includes('송금확인증')) return '입금확인서';
  if (normalized.includes('이체확인증') || normalized.includes('이체확인서') || normalized.includes('계좌이체확인증') || normalized.includes('transferconfirmation')) return '이체확인증';
  if (normalized.includes('지출결의서') || normalized.includes('지출결의') || normalized.includes('품의서')) return '지출결의';
  if (normalized.includes('거래명세표') || normalized.includes('거래명세서') || normalized.includes('거래내역서') || normalized.includes('statement')) return '거래명세서';
  if (normalized.includes('참석확인서') || normalized.includes('참석자명단') || normalized.includes('출석부') || normalized.includes('attendance')) return '참석자명단';
  if (normalized.includes('해외송금영수증') || normalized.includes('wirereceipt') || normalized.includes('swift')) return '해외송금영수증';
  if (normalized.includes('invoice')) return '세금계산서';
  return normalized;
}

function mergeEvidenceDesc(...values: string[]): string {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const entry of splitEvidenceDesc(value)) {
      const key = normalizeEvidenceEntryKey(entry);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged.join(', ');
}

function resolveRequiredEvidenceEntries(input: {
  evidenceRequired?: string[];
  evidenceRequiredDesc?: string;
}): string[] {
  return Array.isArray(input.evidenceRequired) && input.evidenceRequired.length > 0
    ? input.evidenceRequired.map((entry) => String(entry || '').trim()).filter(Boolean)
    : splitEvidenceDesc(String(input.evidenceRequiredDesc || ''));
}

export function resolveEvidenceCompletedManualDesc(tx: Transaction): string {
  const manual = tx.evidenceCompletedManualDesc?.trim() || '';
  if (manual) return manual;

  const completed = tx.evidenceCompletedDesc?.trim() || '';
  const auto = tx.evidenceAutoListedDesc?.trim() || '';
  if (!completed) return '';
  if (!auto) return completed;

  const autoKeys = new Set(splitEvidenceDesc(auto).map(normalizeEvidenceEntryKey));
  return splitEvidenceDesc(completed)
    .filter((entry) => !autoKeys.has(normalizeEvidenceEntryKey(entry)))
    .join(', ');
}

export function resolveEvidenceCompletedDesc(tx: Transaction): string {
  const auto = tx.evidenceAutoListedDesc?.trim() || '';
  const manual = resolveEvidenceCompletedManualDesc(tx);
  const resolved = mergeEvidenceDesc(auto, manual);
  if (resolved) return resolved;
  return tx.evidenceCompletedDesc?.trim() || '';
}

export function resolveEvidenceChecklist(tx: Pick<
  Transaction,
  'evidenceRequired' | 'evidenceRequiredDesc' | 'evidenceDriveLink' | 'evidenceDriveFolderId' | 'evidenceCompletedDesc' | 'evidenceCompletedManualDesc' | 'evidenceAutoListedDesc'
>): {
  required: string[];
  completed: string[];
  missing: string[];
  status: EvidenceStatus;
  hasLink: boolean;
} {
  const required = Array.isArray(tx.evidenceRequired) && tx.evidenceRequired.length > 0
    ? tx.evidenceRequired.map((entry) => String(entry || '').trim()).filter(Boolean)
    : splitEvidenceDesc(String(tx.evidenceRequiredDesc || ''));
  const completed = splitEvidenceDesc(resolveEvidenceCompletedDesc(tx as Transaction));
  const completedKeys = new Set(completed.map(normalizeEvidenceEntryKey).filter(Boolean));
  const missing = required.filter((entry) => {
    const key = normalizeEvidenceEntryKey(entry);
    if (!key) return true;
    return !completedKeys.has(key);
  });
  const hasLink = !!tx.evidenceDriveLink?.trim() || !!tx.evidenceDriveFolderId?.trim();
  const status: EvidenceStatus = required.length === 0
    ? (hasLink && completed.length > 0 ? 'COMPLETE' : (hasLink || completed.length > 0 ? 'PARTIAL' : 'MISSING'))
    : (missing.length === 0 && hasLink ? 'COMPLETE' : (hasLink || completed.length > 0 ? 'PARTIAL' : 'MISSING'));
  return { required, completed, missing, status, hasLink };
}

export function resolvePreferredEvidenceUploadCategory(input: {
  evidenceRequired?: string[];
  requiredDesc?: string;
  completedDesc?: string;
  detectedCategory?: string;
  fallback?: string;
}): string {
  const required = resolveRequiredEvidenceEntries({
    evidenceRequired: input.evidenceRequired,
    evidenceRequiredDesc: input.requiredDesc,
  });
  const completedKeys = new Set(splitEvidenceDesc(String(input.completedDesc || '')).map(normalizeEvidenceEntryKey).filter(Boolean));
  const missingRequired = required.filter((entry) => !completedKeys.has(normalizeEvidenceEntryKey(entry)));
  const detectedCategory = String(input.detectedCategory || '').trim();
  const detectedKey = normalizeEvidenceEntryKey(detectedCategory);

  if (detectedKey) {
    const matchingMissing = missingRequired.find((entry) => normalizeEvidenceEntryKey(entry) === detectedKey);
    if (matchingMissing) return matchingMissing;
    const matchingRequired = required.find((entry) => normalizeEvidenceEntryKey(entry) === detectedKey);
    if (matchingRequired) return matchingRequired;
  }

  if (missingRequired.length === 1) return missingRequired[0];
  if (detectedCategory && detectedCategory !== '기타') return detectedCategory;
  if (required.length === 1) return required[0];
  return String(input.fallback || detectedCategory || '기타').trim() || '기타';
}

export function applyUploadedEvidenceCategories(
  tx: Pick<
    Transaction,
    'evidenceRequired' | 'evidenceRequiredDesc' | 'evidenceDriveLink' | 'evidenceDriveFolderId' | 'evidenceCompletedDesc' | 'evidenceCompletedManualDesc' | 'evidenceAutoListedDesc'
  >,
  uploadedCategories: string[],
): {
  evidenceCompletedDesc: string;
  evidenceCompletedManualDesc: string;
  evidencePendingDesc: string;
  evidenceMissing: string[];
  evidenceStatus: EvidenceStatus;
} {
  const currentCompletedDesc = resolveEvidenceCompletedDesc(tx as Transaction);
  const currentCompletedKeys = new Set(splitEvidenceDesc(currentCompletedDesc).map(normalizeEvidenceEntryKey).filter(Boolean));
  const nextUploadedOnly = uploadedCategories.filter((entry) => {
    const key = normalizeEvidenceEntryKey(entry);
    return key && !currentCompletedKeys.has(key);
  });
  const nextManualDesc = mergeEvidenceDesc(
    String(tx.evidenceCompletedManualDesc || ''),
    nextUploadedOnly.join(', '),
  );
  const nextCompletedDesc = mergeEvidenceDesc(
    currentCompletedDesc,
    nextUploadedOnly.join(', '),
  );
  const checklist = resolveEvidenceChecklist({
    evidenceRequired: tx.evidenceRequired,
    evidenceRequiredDesc: tx.evidenceRequiredDesc,
    evidenceDriveLink: tx.evidenceDriveLink,
    evidenceDriveFolderId: tx.evidenceDriveFolderId,
    evidenceCompletedDesc: nextCompletedDesc,
    evidenceCompletedManualDesc: '',
    evidenceAutoListedDesc: '',
  });
  return {
    evidenceCompletedDesc: nextCompletedDesc,
    evidenceCompletedManualDesc: nextManualDesc,
    evidencePendingDesc: checklist.missing.join(', '),
    evidenceMissing: checklist.missing,
    evidenceStatus: checklist.status,
  };
}

/**
 * 증빙 상태 자동 계산
 * Transaction의 evidenceDriveLink, evidenceRequiredDesc, 자동 집계 + 수기 보정 기반
 */
export function computeEvidenceStatus(tx: Transaction): EvidenceStatus {
  return resolveEvidenceChecklist(tx).status;
}

/**
 * 유효한 Google Drive URL 검증
 */
export function isValidDriveUrl(url: string): boolean {
  if (!url?.trim()) return false;
  return /^https?:\/\/(drive\.google\.com|docs\.google\.com)/.test(url.trim());
}

/**
 * 증빙 미제출 항목 계산
 * evidenceRequired에서 completedDesc에 포함되지 않은 항목 반환
 */
export function computeEvidenceMissing(tx: Transaction): string[] {
  return resolveEvidenceChecklist(tx).missing;
}

/**
 * 증빙 요약 통계 (WeekSection 헤더용)
 */
export function computeEvidenceSummary(transactions: Transaction[]): {
  complete: number;
  partial: number;
  missing: number;
} {
  let complete = 0;
  let partial = 0;
  let missing = 0;
  for (const tx of transactions) {
    const status = tx.evidenceStatus || computeEvidenceStatus(tx);
    if (status === 'COMPLETE') complete++;
    else if (status === 'PARTIAL') partial++;
    else missing++;
  }
  return { complete, partial, missing };
}
