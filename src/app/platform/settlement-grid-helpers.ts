import type { Transaction, TransactionState } from '../data/types';
import { getMonthMondayWeeks, type MonthMondayWeek } from './cashflow-weeks';

// ── Number formatting ──

export const fmt = (n: number | undefined) =>
  n != null && Number.isFinite(n) ? n.toLocaleString('ko-KR') : '';

// ── Method labels ──

export const METHOD_LABELS: Record<string, string> = {
  TRANSFER: '계좌이체',
  CORP_CARD_1: '사업비카드',
  CORP_CARD_2: '개인법인카드',
  OTHER: '기타',
};

export const METHOD_OPTIONS = Object.entries(METHOD_LABELS).map(([v, l]) => ({ value: v, label: l }));

export const CASHFLOW_IN_LINE_IDS = new Set([
  'MYSC_PREPAY_IN',
  'SALES_IN',
  'SALES_VAT_IN',
  'TEAM_SUPPORT_IN',
  'BANK_INTEREST_IN',
]);

// ── Budget label helpers ──

export function normalizeBudgetLabel(value: string): string {
  return String(value || '')
    .replace(/^\s*\d+(?:[.\-]\d+)?\s*/, '')
    .replace(/^[.\-]+\s*/, '')
    .trim();
}

export function formatBudgetCodeLabel(_index: number, name: string): string {
  const trimmed = String(name || '').trim();
  return trimmed || '비목 미입력';
}

export function formatSubCodeLabel(_codeIndex: number, _subIndex: number, name: string) {
  const trimmed = String(name || '').trim();
  return trimmed || '세목 미입력';
}

// ── Comment helpers ──

export function toFieldSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildCommentThreadKey(transactionId: string, fieldKey: string): string {
  return `${transactionId}::${fieldKey}`;
}

export function buildSheetRowCommentId(tempId: string): string {
  return `sheet-row:${tempId}`;
}

export function formatCommentTime(value: string): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '';
}

export function findLatestFieldEdit(
  transaction: Pick<Transaction, 'editHistory'> | undefined,
  field: string,
): NonNullable<Transaction['editHistory']>[number] | null {
  const history = transaction?.editHistory || [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry?.field === field) return entry;
  }
  return null;
}

export function buildTransactionEditHistoryEntries(
  existing: Transaction,
  updates: Partial<Transaction>,
  editedBy: string,
  editedAt: string,
): NonNullable<Transaction['editHistory']> {
  const entries: NonNullable<Transaction['editHistory']> = [];

  for (const [key, newValue] of Object.entries(updates)) {
    if (key === 'amounts' && newValue && typeof newValue === 'object') {
      const nextAmounts = newValue as Partial<Transaction['amounts']>;
      for (const [amountKey, amountValue] of Object.entries(nextAmounts)) {
        const previousAmount = existing.amounts?.[amountKey as keyof Transaction['amounts']];
        if (previousAmount !== amountValue) {
          entries.push({
            field: `amounts.${amountKey}`,
            before: previousAmount,
            after: amountValue,
            editedBy,
            editedAt,
          });
        }
      }
      continue;
    }

    const previousValue = (existing as unknown as Record<string, unknown>)[key];
    if (previousValue !== newValue) {
      entries.push({
        field: key,
        before: previousValue,
        after: newValue,
        editedBy,
        editedAt,
      });
    }
  }

  return entries;
}

// ── Grid constants ──

export const IMPORT_EDITOR_ROW_HEIGHT_ESTIMATE = 56;
export const IMPORT_EDITOR_WINDOW_OVERSCAN = 8;
export const IMPORT_EDITOR_WINDOW_THRESHOLD = 80;

// ── Method normalization ──

export function normalizeMethodValue(value: string | undefined): string {
  if (!value) return '';
  if (value === 'BANK_TRANSFER') return 'TRANSFER';
  if (value === 'CARD') return 'CORP_CARD_1';
  if (value === 'CASH' || value === 'CHECK') return 'OTHER';
  return value;
}

// ── Content status note ──

export function parseContentStatusNote(value: string): { status: '' | '미완료' | '완료'; text: string } {
  const trimmed = String(value || '').trim();
  const match = trimmed.match(/^\[(미완료|완료)\]\s*(.*)$/);
  if (!match) return { status: '', text: trimmed };
  return { status: match[1] as '미완료' | '완료', text: match[2] || '' };
}

export function composeContentStatusNote(status: '' | '미완료' | '완료', text: string): string {
  const body = String(text || '').trim();
  if (!status) return body;
  return body ? `[${status}] ${body}` : `[${status}]`;
}

// ── Quick expense templates ──

export interface QuickExpenseTemplate {
  id: string;
  label: string;
  methodLabel: string;
  cashflowLabel: string;
  counterparty: string;
  memo: string;
}

export const QUICK_EXPENSE_TEMPLATES: QuickExpenseTemplate[] = [
  { id: 'communication', label: '통신비', methodLabel: '계좌이체', cashflowLabel: '직접사업비', counterparty: '통신비', memo: '정기지출: 통신비' },
  { id: 'rent', label: '임차료', methodLabel: '계좌이체', cashflowLabel: '직접사업비', counterparty: '임차료', memo: '정기지출: 임차료' },
  { id: 'utility', label: '공과금', methodLabel: '계좌이체', cashflowLabel: '직접사업비', counterparty: '공과금', memo: '정기지출: 공과금' },
  { id: 'insurance', label: '보험료', methodLabel: '계좌이체', cashflowLabel: '직접사업비', counterparty: '보험료', memo: '정기지출: 보험료' },
];

// ── Evidence helpers ──

export function derivePendingEvidence(requiredDesc: string, completedDesc: string): string {
  const required = String(requiredDesc || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (required.length === 0) return '';
  const completed = String(completedDesc || '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  return required
    .filter((item) => !completed.some((done) => done.includes(item.toLowerCase())))
    .join(', ');
}

// ── Transaction state ──

export const TX_STATE_BADGE: Record<TransactionState, { label: string; cls: string }> = {
  DRAFT: { label: '작성중', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  SUBMITTED: { label: '제출', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  APPROVED: { label: '승인', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  REJECTED: { label: '반려', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

export function isEditable(state: TransactionState | undefined): boolean {
  return !state || state === 'DRAFT' || state === 'REJECTED';
}

// ── Week resolution ──

export function resolveWeekFromLabel(label: string, yearWeeks: MonthMondayWeek[]): MonthMondayWeek | undefined {
  const fromYear = yearWeeks.find((w) => w.label === label);
  if (fromYear) return fromYear;
  const m = label.match(/^(\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return undefined;
  const year = 2000 + Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const weekNo = Number.parseInt(m[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(weekNo)) return undefined;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  return getMonthMondayWeeks(yearMonth).find((w) => w.weekNo === weekNo);
}
