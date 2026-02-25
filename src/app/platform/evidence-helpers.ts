import type { EvidenceStatus, Transaction } from '../data/types';

/**
 * 증빙 상태 자동 계산
 * Transaction의 evidenceDriveLink, evidenceRequiredDesc, evidenceCompletedDesc 기반
 */
export function computeEvidenceStatus(tx: Transaction): EvidenceStatus {
  const hasLink = !!tx.evidenceDriveLink?.trim();
  const completedDesc = tx.evidenceCompletedDesc?.trim() || '';

  // evidenceRequired 배열이 비어있으면 기본 규칙 적용
  if (tx.evidenceRequired.length === 0) {
    // 텍스트 기반 판단: 완료 설명이 있거나 드라이브 링크가 있으면 COMPLETE
    if (hasLink && completedDesc) return 'COMPLETE';
    if (hasLink || completedDesc) return 'PARTIAL';
    return 'MISSING';
  }

  // evidenceRequired 배열 기반 판단
  const completed = completedDesc
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const allDone = tx.evidenceRequired.every((req) =>
    completed.some((c) => c.includes(req.toLowerCase())),
  );

  if (allDone && hasLink) return 'COMPLETE';
  if (hasLink || completed.length > 0) return 'PARTIAL';
  return 'MISSING';
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
  if (tx.evidenceRequired.length === 0) return [];
  const completed = (tx.evidenceCompletedDesc || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return tx.evidenceRequired.filter(
    (req) => !completed.some((c) => c.includes(req.toLowerCase())),
  );
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
