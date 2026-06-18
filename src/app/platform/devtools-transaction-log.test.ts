import { describe, expect, it } from 'vitest';

import {
  clearDevtoolsLogs,
  getDevtoolsLogs,
  recordDevtoolsLog,
  sanitizeDevtoolsValue,
  summarizeAmountMap,
} from './devtools-transaction-log';

describe('devtools transaction log', () => {
  it('stores bounded developer-facing transaction logs', () => {
    clearDevtoolsLogs();

    recordDevtoolsLog({
      kind: 'cashflow_transaction',
      phase: 'start',
      operation: 'cashflow.week.upsert',
      transport: 'bff',
      tenantId: 'mysc',
      actorId: 'u001',
      projectId: 'p001',
      yearMonth: '2026-06',
      weekNo: 2,
      mode: 'projection',
      summary: summarizeAmountMap({ SALES_IN: 1000, DIRECT_COST_OUT: 0 }),
    });

    expect(getDevtoolsLogs()).toEqual([
      expect.objectContaining({
        kind: 'cashflow_transaction',
        phase: 'start',
        operation: 'cashflow.week.upsert',
        transport: 'bff',
        projectId: 'p001',
        mode: 'projection',
        summary: expect.objectContaining({
          lineCount: 2,
          nonZeroLineCount: 1,
          changedLineIds: ['SALES_IN', 'DIRECT_COST_OUT'],
          nonZeroLineIds: ['SALES_IN'],
        }),
      }),
    ]);
  });

  it('redacts tokens, emails, and binary payload fields before exposing logs', () => {
    const sanitized = sanitizeDevtoolsValue({
      idToken: 'firebase-token',
      googleAccessToken: 'google-token',
      email: 'person@mysc.co.kr',
      nested: {
        contentBase64: 'a'.repeat(1000),
        safe: 'visible',
      },
    });

    expect(sanitized).toEqual({
      idToken: '[redacted]',
      googleAccessToken: '[redacted]',
      email: '[redacted]',
      nested: {
        contentBase64: '[redacted]',
        safe: 'visible',
      },
    });
  });
});
