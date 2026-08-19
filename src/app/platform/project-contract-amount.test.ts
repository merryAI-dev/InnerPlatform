import { describe, expect, it } from 'vitest';
import {
  CONTRACT_AMOUNT_ITEM_FIELDS,
  deriveContractAmountFromItems,
  formatStoredProjectAmount,
  formatProjectAmountInput,
  hasExplicitProjectAmountInput,
  hasNonNegativeProjectAmountInput,
  hasStoredProjectAmount,
  hasStoredProjectContractAmount,
  parseProjectAmountInput,
} from './project-contract-amount';

describe('project-contract-amount', () => {
  it('distinguishes blank input from explicit zero', () => {
    expect(hasExplicitProjectAmountInput('')).toBe(false);
    expect(hasExplicitProjectAmountInput('0')).toBe(true);
    expect(hasNonNegativeProjectAmountInput('0')).toBe(true);
  });

  it('parses comma-separated numeric input', () => {
    expect(parseProjectAmountInput('1,234,567')).toBe(1234567);
    expect(formatProjectAmountInput(0, true)).toBe('0');
  });

  it('rejects invalid or negative values for non-negative checks', () => {
    expect(hasExplicitProjectAmountInput('abc')).toBe(false);
    expect(hasNonNegativeProjectAmountInput('-1')).toBe(false);
  });

  it('treats stored zero amounts as filled values', () => {
    expect(hasStoredProjectContractAmount({ contractAmount: 0 } as any)).toBe(true);
    expect(hasStoredProjectContractAmount({})).toBe(false);
  });

  it('treats flagged blank amounts as missing even when the stored number is zero', () => {
    expect(hasStoredProjectAmount(0, false)).toBe(false);
    expect(hasStoredProjectContractAmount({
      contractAmount: 0,
      financialInputFlags: { contractAmount: false },
    } as any)).toBe(false);
    expect(formatStoredProjectAmount(0, false)).toBe('-');
  });
});

describe('deriveContractAmountFromItems', () => {
  it('sums the four items that make up a contract amount', () => {
    expect(deriveContractAmountFromItems({
      salesVatAmount: 12_000,
      totalRevenueAmount: 90_000,
      totalActualCost: 13_000,
      supportAmount: 5_000,
    })).toBe(120_000);
  });

  it('treats a missing or non-numeric item as zero rather than NaN', () => {
    // 실비(원가)는 2026-08 프로덕션 69건 전부 비어 있다. 빈 항목이 합계를 통째로
    // NaN 으로 만들면 계약금액이 화면에서 사라진다.
    expect(deriveContractAmountFromItems({ totalRevenueAmount: 90_000 })).toBe(90_000);
    expect(deriveContractAmountFromItems({
      salesVatAmount: Number.NaN,
      totalRevenueAmount: 90_000,
    })).toBe(90_000);
    expect(deriveContractAmountFromItems({})).toBe(0);
  });

  it('ignores the contract amount itself so the derivation cannot feed on its own output', () => {
    expect(CONTRACT_AMOUNT_ITEM_FIELDS).not.toContain('contractAmount');
    expect(deriveContractAmountFromItems({
      contractAmount: 999_999,
      totalRevenueAmount: 10_000,
    } as Parameters<typeof deriveContractAmountFromItems>[0])).toBe(10_000);
  });
});
