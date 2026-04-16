import { describe, expect, it } from 'vitest';
import type { PayrollReviewCandidate } from './types';
import {
  sanitizePayrollReviewCandidate,
  sanitizePayrollReviewCandidates,
} from './payroll-store';

describe('payroll-store review serialization', () => {
  it('removes undefined optional fields from review candidates before Firestore writes', () => {
    const candidate: PayrollReviewCandidate = {
      txId: 'tx-1',
      detectedFrom: 'rule_engine',
      signals: ['cashflow:LABOR_COST'],
      decision: 'PAYROLL',
      decidedAt: '2026-04-16T00:00:00.000Z',
      decidedByUid: 'user-1',
      decidedByName: undefined,
      note: undefined,
    };

    expect(sanitizePayrollReviewCandidate(candidate)).toEqual({
      txId: 'tx-1',
      detectedFrom: 'rule_engine',
      signals: ['cashflow:LABOR_COST'],
      decision: 'PAYROLL',
      decidedAt: '2026-04-16T00:00:00.000Z',
      decidedByUid: 'user-1',
    });
  });

  it('sanitizes candidate arrays without mutating decision state', () => {
    const candidates: PayrollReviewCandidate[] = [
      {
        txId: 'tx-1',
        detectedFrom: 'rule_engine',
        signals: ['cashflow:LABOR_COST'],
        decision: 'PAYROLL',
        decidedByUid: 'user-1',
      },
      {
        txId: 'tx-2',
        detectedFrom: 'rule_engine',
        signals: ['memo:급여'],
        decision: 'HOLD',
        note: undefined,
      },
    ];

    expect(sanitizePayrollReviewCandidates(candidates)).toEqual([
      {
        txId: 'tx-1',
        detectedFrom: 'rule_engine',
        signals: ['cashflow:LABOR_COST'],
        decision: 'PAYROLL',
        decidedByUid: 'user-1',
      },
      {
        txId: 'tx-2',
        detectedFrom: 'rule_engine',
        signals: ['memo:급여'],
        decision: 'HOLD',
      },
    ]);
  });
});
