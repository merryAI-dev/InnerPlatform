import {
  LEGACY_PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
  SETTLEMENT_PROGRESS_LABELS,
  type Direction,
  type PaymentMethod,
  type SettlementProgress,
  type TransactionAmounts,
  type UserRole,
} from '../data/types';
import {
  getBankCsvProfileMeta,
  type BankCsvProfileId,
} from './bank-reconciliation';

export interface PaymentMethodOption {
  value: PaymentMethod;
  label: string;
}

export interface SettlementAmountWarning {
  code: 'NEGATIVE_SUPPLY_AMOUNT' | 'BANK_AMOUNT_MISMATCH';
  message: string;
}

export interface DerivedSettlementAmounts {
  bankAmount: number;
  depositAmount: number;
  expenseAmount: number;
  vatIn: number;
  supplyAmount: number;
  warnings: SettlementAmountWarning[];
}

export interface BankReconciliationViewPolicy {
  profileId: BankCsvProfileId;
  profileLabel: string;
  roleLabel: string;
  showRoleNotice: boolean;
  availableActions: string[];
  visibleFieldLabels: string[];
  visibleColumns: Array<
    | 'status'
    | 'confidence'
    | 'bankDate'
    | 'bankDescription'
    | 'bankAmount'
    | 'systemDate'
    | 'project'
    | 'counterparty'
    | 'internalMemo'
    | 'systemAmount'
  >;
}

export interface BankDescriptionView {
  text: string;
  restricted: boolean;
}

const PAYMENT_METHOD_LOOKUP = new Map<string, PaymentMethod>();
const ALL_PAYMENT_LABEL_MAPS = [LEGACY_PAYMENT_METHOD_LABELS, PAYMENT_METHOD_LABELS];

for (const labelMap of ALL_PAYMENT_LABEL_MAPS) {
  for (const [method, label] of Object.entries(labelMap)) {
    PAYMENT_METHOD_LOOKUP.set(label.trim().toLowerCase(), method as PaymentMethod);
  }
}

for (const [alias, method] of Object.entries({
  bank_transfer: 'TRANSFER',
  transfer: 'TRANSFER',
  card: 'CORP_CARD_1',
  corp_card_1: 'CORP_CARD_1',
  corp_card_2: 'CORP_CARD_2',
  cash: 'OTHER',
  check: 'OTHER',
  '법인카드': 'CORP_CARD_2',
  '사업비카드': 'CORP_CARD_1',
  '개인법인카드': 'CORP_CARD_2',
  '뒷번호1': 'CORP_CARD_1',
  '뒷번호2': 'CORP_CARD_2',
})) {
  PAYMENT_METHOD_LOOKUP.set(alias, method as PaymentMethod);
}

function toSafeAmount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.trunc(value as number) : 0;
}

export function getPaymentMethodOptions(useLegacyLabels = false): PaymentMethodOption[] {
  const labels = useLegacyLabels ? LEGACY_PAYMENT_METHOD_LABELS : PAYMENT_METHOD_LABELS;
  return (Object.entries(labels) as [PaymentMethod, string][])
    .map(([value, label]) => ({ value, label }));
}

export function getPaymentMethodLabel(
  method: string | undefined,
  useLegacyLabels = false,
): string {
  if (!method) return '';
  const labels = useLegacyLabels ? LEGACY_PAYMENT_METHOD_LABELS : PAYMENT_METHOD_LABELS;
  return labels[method as PaymentMethod] || method;
}

export function normalizePaymentMethod(value: string | undefined): PaymentMethod | '' {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (PAYMENT_METHOD_LOOKUP.has(normalized)) {
    return PAYMENT_METHOD_LOOKUP.get(normalized) || '';
  }
  if (/법인카드.*1|사업비카드|뒷번호1|card.?1/.test(normalized)) return 'CORP_CARD_1';
  if (/법인카드.*2|개인법인카드|뒷번호2|card.?2/.test(normalized)) return 'CORP_CARD_2';
  if (/법인카드|카드|card/.test(normalized)) return 'CORP_CARD_1';
  if (/계좌|이체|bank/.test(normalized)) return 'TRANSFER';
  if (/현금|수표|check|cash/.test(normalized)) return 'OTHER';
  return 'OTHER';
}

export function normalizeSettlementProgress(value: string | undefined): SettlementProgress {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'INCOMPLETE';
  if (normalized === 'complete' || normalized === 'completed' || normalized === '완료') return 'COMPLETE';
  if (normalized === 'incomplete' || normalized === 'pending' || normalized === '미완료') return 'INCOMPLETE';
  if (normalized.includes('완료') && !normalized.includes('미완료')) return 'COMPLETE';
  return 'INCOMPLETE';
}

export function getSettlementProgressLabel(progress: SettlementProgress | undefined): string {
  return SETTLEMENT_PROGRESS_LABELS[progress || 'INCOMPLETE'];
}

export function deriveSettlementAmounts(input: {
  direction?: Direction;
  amounts?: Partial<TransactionAmounts> | null;
}): DerivedSettlementAmounts {
  const direction = input.direction || 'OUT';
  const source = input.amounts || {};
  const bankAmount = toSafeAmount(source.bankAmount);
  const depositAmount = direction === 'IN' ? toSafeAmount(source.depositAmount || bankAmount) : 0;
  const expenseAmount = direction === 'OUT'
    ? toSafeAmount(source.expenseAmount || bankAmount)
    : 0;
  const vatIn = direction === 'OUT' ? toSafeAmount(source.vatIn) : 0;
  const supplyBase = direction === 'OUT' ? expenseAmount : depositAmount;
  const supplyAmount = direction === 'OUT'
    ? toSafeAmount(source.supplyAmount ?? (supplyBase - vatIn))
    : 0;
  const warnings: SettlementAmountWarning[] = [];

  if (direction === 'OUT') {
    if (supplyAmount < 0) {
      warnings.push({
        code: 'NEGATIVE_SUPPLY_AMOUNT',
        message: '매입부가세가 출금 금액보다 클 수 없습니다.',
      });
    }
    if (expenseAmount > 0 && bankAmount > 0 && expenseAmount !== bankAmount) {
      warnings.push({
        code: 'BANK_AMOUNT_MISMATCH',
        message: '통장 금액과 사업비 사용액이 다릅니다. 영수증 기준으로 확인해 주세요.',
      });
    }
  }

  return {
    bankAmount,
    depositAmount,
    expenseAmount,
    vatIn,
    supplyAmount: Math.max(0, supplyAmount),
    warnings,
  };
}

export function resolveTransactionMemo(input: {
  memo?: string;
  internalMemo?: string;
  bankMemo?: string;
}): { internalMemo: string; bankMemo: string } {
  return {
    internalMemo: input.internalMemo || input.memo || '',
    bankMemo: input.bankMemo || '',
  };
}

export function getBankReconciliationViewPolicy(
  role: UserRole | undefined,
  profileId: BankCsvProfileId = 'GENERIC',
): BankReconciliationViewPolicy {
  const normalizedRole = role || 'viewer';
  const privileged = normalizedRole === 'admin'
    || normalizedRole === 'tenant_admin'
    || normalizedRole === 'finance'
    || normalizedRole === 'auditor'
    || normalizedRole === 'support'
    || normalizedRole === 'security';
  const profile = getBankCsvProfileMeta(profileId);
  const visibleFieldLabels = privileged
    ? profile.fieldLabels
    : profile.fieldLabels.filter((label) => !/(적요|내용)/.test(label));
  const availableActions = privileged
    ? [profile.quickViewLabel, profile.actionMenuLabel, '원문 적요 확인']
    : [profile.quickViewLabel, '마스킹 적요 확인'];

  return {
    profileId,
    profileLabel: profile.label,
    roleLabel: privileged ? '도담/재경팀 기준' : '사업팀 기준',
    showRoleNotice: true,
    availableActions,
    visibleFieldLabels,
    visibleColumns: privileged
      ? ['status', 'confidence', 'bankDate', 'bankDescription', 'bankAmount', 'systemDate', 'project', 'counterparty', 'internalMemo', 'systemAmount']
      : ['status', 'confidence', 'bankDate', 'bankAmount', 'systemDate', 'project', 'counterparty', 'internalMemo', 'systemAmount'],
  };
}

export function getBankDescriptionView(
  description: string | undefined,
  role: UserRole | undefined,
  profileId: BankCsvProfileId = 'GENERIC',
): BankDescriptionView {
  const value = String(description || '').trim();
  if (!value) {
    return { text: '-', restricted: false };
  }
  const policy = getBankReconciliationViewPolicy(role, profileId);
  const canViewRaw = policy.visibleColumns.includes('bankDescription');
  if (canViewRaw) {
    return { text: value, restricted: false };
  }
  return {
    text: '권한 필요',
    restricted: true,
  };
}
