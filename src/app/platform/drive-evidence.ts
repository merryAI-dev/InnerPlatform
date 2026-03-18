import type { Evidence, Transaction } from '../data/types';

const INVALID_DRIVE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MULTI_SPACE = /\s+/g;
const MULTI_UNDERSCORE = /_+/g;

export const EVIDENCE_DOCUMENT_CATEGORIES = [
  '강의자료',
  '견적서',
  '결과물',
  '결과보고서',
  '계약서',
  '공문',
  '매출전표',
  '보도자료',
  '비용지급확인서',
  '사업자등록증',
  '사용계획서',
  '세금계산서',
  '신분증 사본',
  '심사결과보고서',
  '심사자료',
  '영수증',
  '우버 인증 내역',
  '운영계획',
  '원천세 내역',
  '이력서',
  '이체확인증',
  '입금확인증',
  '재단 메일',
  '정산규정',
  '지출결의',
  '진행개요',
  '진행결과보고서',
  '청구내역서',
  '청구서',
  '출장신청서',
  '통장사본',
  '해외송금영수증',
  '해외이용내역서',
  '행사계획안',
  '협약서',
  '회의록',
  'ZOOM invoice',
  '참석자명단',
  '입금확인서',
  '거래명세서',
  '사진',
  '표준재무제표증명',
  '기타',
] as const;

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
  const transactionToken = '';
  const folderName = [dateToken, budgetToken, subBudgetToken].filter(Boolean).join('_');
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

function normalizeEvidenceFileName(fileName: string): string {
  return String(fileName || '')
    .normalize('NFC')
    .trim()
    .replace(/[_-]+/g, ' ');
}

function splitFileName(fileName: string): { stem: string; extension: string } {
  const trimmed = String(fileName || '').trim();
  const lastDotIndex = trimmed.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === trimmed.length - 1) {
    return { stem: trimmed, extension: '' };
  }
  return {
    stem: trimmed.slice(0, lastDotIndex),
    extension: trimmed.slice(lastDotIndex).replace(/[^.\w]+/g, ''),
  };
}

function sanitizeFileStem(value: string, fallback = '문서'): string {
  return normalizeSegment(String(value || '').replace(/\.[^.]+$/, ''), fallback);
}

const CATEGORY_PATTERNS: Array<{ category: string; patterns: RegExp[] }> = [
  { category: 'ZOOM invoice', patterns: [/zoom\s*invoice/i] },
  { category: '심사결과보고서', patterns: [/심사\s*결과\s*보고서/i] },
  { category: '진행결과보고서', patterns: [/진행\s*결과\s*보고서/i] },
  { category: '결과보고서', patterns: [/결과\s*보고서/i] },
  { category: '강의자료', patterns: [/강의\s*자료/i, /lecture/i] },
  { category: '견적서', patterns: [/견적서/i, /quotation/i, /estimate/i] },
  { category: '결과물', patterns: [/결과물/i, /deliverable/i, /output/i] },
  { category: '계약서', patterns: [/계약서/i, /contract/i, /agreement/i] },
  { category: '협약서', patterns: [/협약서/i, /mou/i, /memorandum/i] },
  { category: '공문', patterns: [/공문/i, /공문서/i, /official\s*letter/i] },
  { category: '매출전표', patterns: [/매출전표/i, /카드\s*매출\s*전표/i] },
  { category: '보도자료', patterns: [/보도자료/i, /press\s*release/i] },
  { category: '표준재무제표증명', patterns: [/표준\s*재무\s*제표\s*증명/i, /재무\s*제표\s*증명/i] },
  { category: '비용지급확인서', patterns: [/비용\s*지급\s*확인서/i] },
  { category: '사업자등록증', patterns: [/사업자\s*등록증?/i, /business\s*registration/i] },
  { category: '사용계획서', patterns: [/사용\s*계획서/i] },
  { category: '세금계산서', patterns: [/세금\s*계산서/i, /tax\s*invoice/i, /invoice/i] },
  { category: '신분증 사본', patterns: [/신분증\s*사본/i, /id\s*copy/i, /identity/i] },
  { category: '심사자료', patterns: [/심사\s*자료/i, /review\s*material/i] },
  { category: '영수증', patterns: [/영수증/i, /receipt/i] },
  { category: '우버 인증 내역', patterns: [/우버\s*인증\s*내역/i, /uber/i] },
  { category: '운영계획', patterns: [/운영\s*계획/i] },
  { category: '원천세 내역', patterns: [/원천세\s*내역/i, /withholding/i] },
  { category: '이력서', patterns: [/이력서/i, /resume/i, /cv/i] },
  { category: '이체확인증', patterns: [/이체\s*확인증/i, /transfer\s*confirmation/i] },
  { category: '입금확인증', patterns: [/입금\s*확인증/i, /deposit\s*confirmation/i] },
  { category: '입금확인서', patterns: [/입금\s*확인서/i, /송금\s*확인/i, /deposit/i] },
  { category: '재단 메일', patterns: [/재단\s*메일/i, /foundation\s*mail/i, /email/i] },
  { category: '정산규정', patterns: [/정산\s*규정/i, /policy/i] },
  { category: '지출결의', patterns: [/지출\s*결의/i, /품의서/i] },
  { category: '진행개요', patterns: [/진행\s*개요/i, /overview/i] },
  { category: '청구내역서', patterns: [/청구\s*내역서/i, /billing\s*statement/i] },
  { category: '청구서', patterns: [/청구서/i, /bill/i, /claim/i] },
  { category: '출장신청서', patterns: [/출장\s*신청서/i, /travel\s*request/i] },
  { category: '통장사본', patterns: [/통장\s*사본/i, /bank\s*copy/i] },
  { category: '해외송금영수증', patterns: [/해외\s*송금\s*영수증/i, /wire\s*receipt/i, /swift/i] },
  { category: '해외이용내역서', patterns: [/해외\s*이용\s*내역서/i, /overseas\s*usage/i] },
  { category: '행사계획안', patterns: [/행사\s*계획안/i, /event\s*plan/i] },
  { category: '회의록', patterns: [/회의록/i, /minutes/i] },
  { category: '참석자명단', patterns: [/참석자\s*명단/i, /출석부/i, /attendance/i] },
  { category: '거래명세서', patterns: [/거래\s*명세/i, /statement/i] },
  { category: '사진', patterns: [/사진/i, /photo/i, /image/i] },
];

export function inferEvidenceCategoryFromFileName(fileName: string, fallback = '기타'): string {
  const normalized = normalizeEvidenceFileName(fileName);
  if (!normalized) return fallback;
  const matched = CATEGORY_PATTERNS.find((entry) => entry.patterns.some((pattern) => pattern.test(normalized)));
  return matched?.category || fallback;
}

export function inferEvidenceCategoryFromDocumentText(documentText: string, fallback = '기타'): string {
  const normalized = String(documentText || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return fallback;
  if (
    (/표준\s*재무\s*제표\s*증명/i.test(normalized) || /재무\s*제표\s*증명/i.test(normalized))
    && /사업자\s*등록\s*번호/i.test(normalized)
    && /(업태|종목)/i.test(normalized)
  ) {
    return '표준재무제표증명';
  }
  const matched = CATEGORY_PATTERNS.find((entry) => entry.patterns.some((pattern) => pattern.test(normalized)));
  return matched?.category || fallback;
}

export function suggestEvidenceUploadFileName(input: {
  originalFileName: string;
  category?: string;
  transaction?: Pick<Transaction, 'dateTime' | 'budgetCategory' | 'budgetSubCategory' | 'counterparty' | 'memo'>;
}): string {
  const { stem, extension } = splitFileName(input.originalFileName);
  const inferredCategory = input.category || inferEvidenceCategoryFromFileName(input.originalFileName);
  const dateToken = formatDriveDateToken(input.transaction?.dateTime);
  const budgetToken = normalizeSegment(input.transaction?.budgetCategory || input.transaction?.counterparty || '', '');
  const subBudgetToken = normalizeSegment(input.transaction?.budgetSubCategory || input.transaction?.memo || '', '');
  const categoryToken = normalizeSegment(inferredCategory, '기타');
  let originalToken = sanitizeFileStem(stem, '');
  for (const prefix of [dateToken, budgetToken, subBudgetToken, categoryToken]) {
    if (prefix && originalToken.startsWith(`${prefix}_`)) {
      originalToken = originalToken.slice(prefix.length + 1);
    }
  }
  const nextTokens = Array.from(new Set(
    [dateToken, budgetToken, subBudgetToken, categoryToken]
      .filter((token) => token && token !== 'undated'),
  ));
  if (originalToken && !nextTokens.includes(originalToken) && originalToken !== categoryToken) {
    nextTokens.push(originalToken);
  }
  const finalStem = nextTokens.filter(Boolean).join('_') || sanitizeFileStem(stem, '증빙자료');
  return `${finalStem}${extension}`;
}

export function buildEvidenceCompletedDesc(evidences: Evidence[]): string {
  const categories = evidences
    .map((evidence) => evidence.category || evidence.parserCategory || inferEvidenceCategoryFromFileName(evidence.fileName))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(categories)].join(', ');
}
