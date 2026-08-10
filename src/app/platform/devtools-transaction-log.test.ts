import { describe, expect, it } from 'vitest';

import {
  clearDevtoolsLogs,
  formatDevtoolsConsoleLabel,
  getDevtoolsLogs,
  recordDevtoolsLog,
  sanitizeDevtoolsValue,
  summarizeAmountMap,
  toDevtoolsError,
  toSafeDiagnosticCode,
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

  it('exports a cashflow-only trace without tenant, actor, or project identifiers', () => {
    clearDevtoolsLogs();
    recordDevtoolsLog({
      kind: 'cashflow_transaction', phase: 'success', operation: '/api/v1/cashflow/project-secret/month-close',
      tenantId: 'tenant-secret', actorId: 'actor-secret', projectId: 'project-secret',
      path: '/api/v1/cashflow/project-secret/month-close',
      summary: { projectCount: 61 },
    });
    const trace = (globalThis as typeof globalThis & {
      __MYSCUBE_DEVTOOLS__?: { cashflowTrace: () => unknown[] };
    }).__MYSCUBE_DEVTOOLS__?.cashflowTrace();

    expect(trace).toEqual([expect.objectContaining({ operation: 'cashflow.request', summary: { projectCount: 61 } })]);
    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain('tenant-secret');
    expect(serialized).not.toContain('actor-secret');
    expect(serialized).not.toContain('project-secret');
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

  it('carries the BFF diagnostic code and wording into the developer log', () => {
    // BFF 오류 응답은 { error, message, requestId } 형태다. 사용자 화면에는 문구만 보이고
    // 코드는 여기에만 남는다.
    const sanitized = toDevtoolsError({
      name: 'PlatformApiError',
      status: 503,
      requestId: 'req-42',
      body: {
        error: 'jvm_weekly_api_unreachable',
        message: '저장을 처리하는 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
    });

    expect(sanitized).toEqual({
      name: 'PlatformApiError',
      message: '[jvm_weekly_api_unreachable] 저장을 처리하는 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      status: 503,
      requestId: 'req-42',
    });
  });

  it('still reads a code from body.code so older callers keep working', () => {
    expect(toDevtoolsError({ body: { code: 'cashflow_month_closed' } })?.message)
      .toBe('[cashflow_month_closed] Request failed');
  });

  it('keeps the wording even when the code is rejected as unsafe', () => {
    const sanitized = toDevtoolsError({
      status: 503,
      body: { error: 'sk_live_9999', message: '서버 연결 정보가 설정되지 않았습니다. 담당자에게 문의해 주세요.' },
    });

    expect(sanitized?.message).toBe('서버 연결 정보가 설정되지 않았습니다. 담당자에게 문의해 주세요.');
    expect(sanitized?.message).not.toContain('sk_live');
  });

  it('masks sensitive text that a server message interpolated', () => {
    const sanitized = toDevtoolsError({
      status: 400,
      body: { error: 'request_error', message: 'person@mysc.co.kr 님의 요청을 처리할 수 없습니다.' },
    });

    expect(sanitized?.message).not.toContain('person@mysc.co.kr');
  });

  it('accepts auth-related codes, which the old word blocklist silently dropped', () => {
    expect(toSafeDiagnosticCode('jvm_weekly_api_token_unconfigured')).toBe('jvm_weekly_api_token_unconfigured');
    expect(toSafeDiagnosticCode('jvm_weekly_api_identity_token_unavailable')).toBe('jvm_weekly_api_identity_token_unavailable');
    expect(toSafeDiagnosticCode('auth_admin_unavailable')).toBe('auth_admin_unavailable');
  });

  it('still refuses anything that does not look like a code, which is what protects values', () => {
    // 실제 비밀값은 숫자·대문자·특수문자를 포함하므로 모양 검사에서 걸린다.
    expect(toSafeDiagnosticCode('sk_live_1234567890')).toBeUndefined();
    expect(toSafeDiagnosticCode('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc')).toBeUndefined();
    expect(toSafeDiagnosticCode('AKIAIOSFODNN7EXAMPLE')).toBeUndefined();
    expect(toSafeDiagnosticCode('ghp_16C7e42F292c6912E7710c838347Ae178B4a')).toBeUndefined();
    expect(toSafeDiagnosticCode('Bearer abc123')).toBeUndefined();
    expect(toSafeDiagnosticCode('single')).toBeUndefined();
    expect(toSafeDiagnosticCode('')).toBeUndefined();
    expect(toSafeDiagnosticCode(undefined)).toBeUndefined();
  });

  it('bounds the length so a long lowercase blob cannot ride through', () => {
    expect(toSafeDiagnosticCode(`${'a'.repeat(60)}_code`)).toBeUndefined();
    expect(toSafeDiagnosticCode('a_b_c_d_e_f_g_h_i')).toBeUndefined();
  });
});
