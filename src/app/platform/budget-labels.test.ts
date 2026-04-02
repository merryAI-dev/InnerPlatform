import { describe, expect, it } from 'vitest';
import { buildBudgetLabelKey, normalizeBudgetLabel } from './budget-labels';

describe('budget-labels', () => {
  it('strips numeric enumeration prefixes but keeps semantic numeric labels', () => {
    expect(normalizeBudgetLabel('1. 인건비')).toBe('인건비');
    expect(normalizeBudgetLabel('1.1 참여인력')).toBe('참여인력');
    expect(normalizeBudgetLabel('1-1 참여인력')).toBe('참여인력');
    expect(normalizeBudgetLabel('9월 인건비')).toBe('9월 인건비');
    expect(normalizeBudgetLabel('10월 인건비')).toBe('10월 인건비');
    expect(normalizeBudgetLabel('1월(27년) 인건비')).toBe('1월(27년) 인건비');
  });

  it('builds distinct keys for month-prefixed sub codes', () => {
    expect(buildBudgetLabelKey('1. 인건비', '9월 인건비')).toBe('인건비|9월 인건비');
    expect(buildBudgetLabelKey('1. 인건비', '10월 인건비')).toBe('인건비|10월 인건비');
    expect(buildBudgetLabelKey('1. 인건비', '9월 인건비'))
      .not.toBe(buildBudgetLabelKey('1. 인건비', '10월 인건비'));
  });
});
