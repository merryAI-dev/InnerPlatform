import { describe, expect, it } from 'vitest';

import {
  clearDevtoolsLogs,
  formatDevtoolsConsoleLabel,
  getDevtoolsLogs,
  recordDevtoolsLog,
  sanitizeDevtoolsValue,
  summarizeAmountMap,
  toDevtoolsError,
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

  it('drops sensitive text embedded inside an error message and keeps only safe diagnostics', () => {
    const error = Object.assign(new Error('owner=person@mysc.co.kr token eyJhbGciOiJIUzI1NiJ9 amount=2300000 expectedDepositAmount: 9999 raw cell value=협력사A/8500'), {
      status: 503,
      requestId: 'req_123',
      body: { code: 'jvm_weekly_api_unreachable' },
    });
    const sanitized = toDevtoolsError(error);

    expect(sanitized.message).not.toContain('person@mysc.co.kr');
    expect(sanitized.message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(sanitized.message).not.toContain('2300000');
    expect(sanitized.message).not.toContain('9999');
    expect(sanitized.message).not.toContain('협력사A');
    expect(sanitized).toMatchObject({
      name: 'Error',
      message: '[jvm_weekly_api_unreachable] Request failed',
      status: 503,
      requestId: 'req_123',
    });
  });

  it('redacts response messages and financial fields in a transaction summary', () => {
    const sanitized = sanitizeDevtoolsValue({
      responseMessage: 'expectedDepositAmount: 9999, raw cell value=협력사A/8500',
      expectedDepositAmount: 9999,
      sourceCell: 'B12:C12',
      status: 503,
    });

    expect(sanitized).toEqual({
      responseMessage: '[redacted]',
      expectedDepositAmount: '[redacted]',
      sourceCell: '[redacted]',
      status: 503,
    });
  });

  it('does not treat a token-shaped body.error as a safe diagnostic code', () => {
    const sanitized = toDevtoolsError({
      name: 'PlatformApiError',
      status: 403,
      body: { error: 'sk_live_1234567890' },
    });

    expect(sanitized.message).toBe('Request failed');
    expect(sanitized.message).not.toContain('sk_live_1234567890');
  });

  it('shows elapsed time in the collapsed console label', () => {
    expect(formatDevtoolsConsoleLabel({
      id: 'log_1',
      ts: '2026-07-21T00:00:00.000Z',
      kind: 'cashflow_transaction',
      phase: 'success',
      operation: 'cashflow.sheet_lab.overwrite.sheet_values.ok',
      durationMs: 12_345,
    })).toBe('[MYSCube:cashflow_transaction] success cashflow.sheet_lab.overwrite.sheet_values.ok 12345ms');
  });
});
