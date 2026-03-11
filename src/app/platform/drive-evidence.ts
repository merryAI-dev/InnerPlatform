import type { Evidence, Transaction } from '../data/types';

const INVALID_DRIVE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MULTI_SPACE = /\s+/g;
const MULTI_UNDERSCORE = /_+/g;

export interface DriveTransactionFolderDescriptor {
  dateToken: string;
  budgetToken: string;
  subBudgetToken: string;
  transactionToken: string;
  folderName: string;
}

function normalizeSegment(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(INVALID_DRIVE_CHARS, ' ')
    .replace(MULTI_SPACE, ' ')
    .replace(/[()\[\]{}]/g, '')
    .replace(/\s/g, '_')
    .replace(MULTI_UNDERSCORE, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

export function formatDriveDateToken(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return 'undated';
  const match = raw.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})/);
  if (!match) return normalizeSegment(raw.slice(0, 10), 'undated');
  return `${match[1]}${match[2]}${match[3]}`;
}

export function buildDriveProjectFolderName(projectName: string, projectId?: string): string {
  const nameToken = normalizeSegment(projectName, 'project');
  const idToken = normalizeSegment(projectId || '', '');
  return idToken ? `${nameToken}_${idToken}` : nameToken;
}

export function buildDriveTransactionFolderDescriptor(
  tx: Pick<Transaction, 'id' | 'dateTime' | 'budgetCategory' | 'budgetSubCategory' | 'counterparty' | 'memo'>,
): DriveTransactionFolderDescriptor {
  const dateToken = formatDriveDateToken(tx.dateTime);
  const budgetToken = normalizeSegment(tx.budgetCategory || tx.counterparty || '미분류', '미분류');
  const subBudgetToken = normalizeSegment(tx.budgetSubCategory || tx.memo || '기타', '기타');
  const transactionToken = normalizeSegment(tx.id || '', 'tx');
  const folderName = [dateToken, budgetToken, subBudgetToken, transactionToken].join('_');
  return { dateToken, budgetToken, subBudgetToken, transactionToken, folderName };
}

export function buildDriveTransactionFolderName(
  tx: Pick<Transaction, 'id' | 'dateTime' | 'budgetCategory' | 'budgetSubCategory' | 'counterparty' | 'memo'>,
): string {
  return buildDriveTransactionFolderDescriptor(tx).folderName;
}

export function parseDriveTransactionFolderName(folderName: string): DriveTransactionFolderDescriptor | null {
  const match = String(folderName || '').trim().match(/^([^_]+)_([^_]+)_([^_]+)_(.+)$/);
  if (!match) return null;
  return {
    dateToken: match[1],
    budgetToken: match[2],
    subBudgetToken: match[3],
    transactionToken: match[4],
    folderName: match[0],
  };
}

const CATEGORY_PATTERNS: Array<{ category: string; patterns: RegExp[] }> = [
  { category: '세금계산서', patterns: [/세금계산서/i, /tax[_\s-]?invoice/i, /invoice/i] },
  { category: '영수증', patterns: [/영수증/i, /receipt/i, /카드매출전표/i] },
  { category: '입금확인서', patterns: [/입금확인/i, /송금확인/i, /transfer/i, /deposit/i] },
  { category: '계약서', patterns: [/계약서/i, /contract/i, /agreement/i] },
  { category: '거래명세서', patterns: [/거래명세/i, /statement/i] },
  { category: '지출결의서', patterns: [/지출결의/i, /품의서/i] },
  { category: '참석자명단', patterns: [/참석자명단/i, /출석부/i, /attendance/i] },
  { category: '결과보고서', patterns: [/결과보고서/i, /보고서/i, /report/i] },
  { category: '통장사본', patterns: [/통장사본/i, /bank[_\s-]?copy/i] },
  { category: '사진', patterns: [/사진/i, /photo/i, /image/i] },
];

export function inferEvidenceCategoryFromFileName(fileName: string, fallback = '기타'): string {
  const normalized = String(fileName || '').trim();
  if (!normalized) return fallback;
  const matched = CATEGORY_PATTERNS.find((entry) => entry.patterns.some((pattern) => pattern.test(normalized)));
  return matched?.category || fallback;
}

export function buildEvidenceCompletedDesc(evidences: Evidence[]): string {
  const categories = evidences
    .map((evidence) => evidence.category || evidence.parserCategory || inferEvidenceCategoryFromFileName(evidence.fileName))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(categories)].join(', ');
}
