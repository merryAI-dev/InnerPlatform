import { describe, expect, it } from 'vitest';
import {
  composeSettlementNote,
  deriveSettlementAmounts,
  getBankDescriptionView,
  getBankReconciliationViewPolicy,
  getPaymentMethodLabel,
  getPaymentMethodOptions,
  getSettlementProgressLabel,
  normalizePaymentMethod,
  normalizeSettlementProgress,
  parseSettlementNote,
  resolveTransactionMemo,
} from './settlement-ledger.helpers';

describe('settlement-ledger helpers', () => {
  it('normalizes legacy and enhanced payment labels', () => {
    expect(normalizePaymentMethod('BANK_TRANSFER')).toBe('TRANSFER');
    expect(normalizePaymentMethod('법인카드(뒷번호1)')).toBe('CORP_CARD_1');
    expect(normalizePaymentMethod('사업비카드')).toBe('CORP_CARD_1');
    expect(normalizePaymentMethod('개인법인카드')).toBe('CORP_CARD_2');
    expect(normalizePaymentMethod('CHECK')).toBe('OTHER');
  });

  it('returns enhanced labels by default and legacy labels on demand', () => {
    expect(getPaymentMethodLabel('CORP_CARD_1')).toBe('사업비카드');
    expect(getPaymentMethodLabel('CORP_CARD_2', true)).toBe('법인카드(뒷번호2)');
    expect(getPaymentMethodOptions().map((entry) => entry.label)).toContain('개인법인카드');
  });

  it('derives supply amount from gross and vat', () => {
    expect(
      deriveSettlementAmounts({
        direction: 'OUT',
        amounts: { bankAmount: 1100, expenseAmount: 1100, vatIn: 100 },
      }),
    ).toMatchObject({
      bankAmount: 1100,
      expenseAmount: 1100,
      vatIn: 100,
      supplyAmount: 1000,
    });

    expect(
      deriveSettlementAmounts({
        direction: 'OUT',
        amounts: { bankAmount: 1000, expenseAmount: 1000, vatIn: 0 },
      }),
    ).toMatchObject({
      supplyAmount: 1000,
    });
  });

  it('flags impossible or inconsistent settlement amounts', () => {
    const negative = deriveSettlementAmounts({
      direction: 'OUT',
      amounts: { bankAmount: 1000, expenseAmount: 1000, vatIn: 1500 },
    });
    expect(negative.warnings.map((warning) => warning.code)).toContain('NEGATIVE_SUPPLY_AMOUNT');

    const mismatch = deriveSettlementAmounts({
      direction: 'OUT',
      amounts: { bankAmount: 1200, expenseAmount: 1000, vatIn: 0 },
    });
    expect(mismatch.warnings.map((warning) => warning.code)).toContain('BANK_AMOUNT_MISMATCH');
  });

  it('maps legacy progress text to enum', () => {
    expect(normalizeSettlementProgress('완료')).toBe('COMPLETE');
    expect(normalizeSettlementProgress('미완료')).toBe('INCOMPLETE');
    expect(normalizeSettlementProgress('')).toBe('INCOMPLETE');
    expect(getSettlementProgressLabel('COMPLETE')).toBe('완료');
  });

  it('parses and composes settlement status inside note text', () => {
    expect(parseSettlementNote('[완료] 증빙 확인').progress).toBe('COMPLETE');
    expect(parseSettlementNote('[완료] 증빙 확인').note).toBe('증빙 확인');
    expect(parseSettlementNote('내용 기재 상태: 미완료 | 추가 정리').progress).toBe('INCOMPLETE');
    expect(parseSettlementNote('일반 메모').note).toBe('일반 메모');
    expect(composeSettlementNote('COMPLETE', '증빙 확인')).toBe('[완료] 증빙 확인');
    expect(composeSettlementNote('INCOMPLETE', '추가 정리')).toBe('[미완료] 추가 정리');
    expect(composeSettlementNote('INCOMPLETE', '')).toBe('');
  });

  it('keeps bank memo separate from internal memo', () => {
    expect(resolveTransactionMemo({ memo: '기존 메모', bankMemo: '은행 적요' })).toEqual({
      internalMemo: '기존 메모',
      bankMemo: '은행 적요',
    });
  });

  it('returns role-specific bank reconciliation columns', () => {
    expect(getBankReconciliationViewPolicy('finance').visibleColumns).toContain('bankDescription');
    expect(getBankReconciliationViewPolicy('pm').visibleColumns).not.toContain('bankDescription');
    expect(getBankReconciliationViewPolicy('finance', 'HANA').profileLabel).toBe('하나은행 빠른조회');
    expect(getBankReconciliationViewPolicy('finance', 'HANA').availableActions).toContain('열 메뉴');
    expect(getBankReconciliationViewPolicy('pm', 'SHINHAN').visibleFieldLabels).not.toContain('내용');
  });

  it('masks bank descriptions for non-privileged roles', () => {
    expect(getBankDescriptionView('은행 원문 적요', 'finance')).toEqual({
      text: '은행 원문 적요',
      restricted: false,
    });
    expect(getBankDescriptionView('은행 원문 적요', 'pm')).toEqual({
      text: '권한 필요',
      restricted: true,
    });
  });
});
