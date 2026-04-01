import { describe, expect, it } from 'vitest';
import {
  formatProjectAmountInput,
  hasExplicitProjectAmountInput,
  hasNonNegativeProjectAmountInput,
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
});
