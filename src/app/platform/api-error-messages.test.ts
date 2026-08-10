import { describe, expect, it } from 'vitest';

import { resolveApiErrorPresentation } from './api-error-messages';

const cases = [
  ['cashflow_sheet_apply_in_progress', 'wait'],
  ['cashflow_sheet_operation_uncertain', 'retry'],
  ['cashflow_month_close_request_conflict', 'contact'],
  ['cashflow_month_close_approver_required', 'contact'],
  ['cashflow_month_close_self_approval_forbidden', 'contact'],
  ['cashflow_sheet_mirror_revision_conflict', 'contact'],
  ['jvm_weekly_api_identity_token_unavailable', 'contact'],
  ['jvm_weekly_api_token_unconfigured', 'contact'],
  ['jvm_weekly_api_internal_error', 'retry'],
  ['cashflow_month_close_route_timeout', 'retry'],
  ['cashflow_month_close_reconciliation_pending', 'wait'],
  ['internal_error', 'retry'],
  ['forbidden', 'contact'],
] as const;

describe('resolveApiErrorPresentation', () => {
  it.each(cases)('maps %s to %s guidance', (code, resolution) => {
    const result = resolveApiErrorPresentation(code, 500);
    expect(result.resolution).toBe(resolution);
    expect(result.guide).not.toBe('');
    expect(result.guide).not.toContain(code);
    expect(result.guide).not.toMatch(/[a-z_]{8,}/);
  });

  it('keeps the approved guides reviewable as a snapshot', () => {
    expect(Object.fromEntries(cases.map(([code]) => [code, resolveApiErrorPresentation(code, 500)])))
      .toMatchSnapshot();
  });

  it('falls back by status without throwing for hostile inputs', () => {
    expect(resolveApiErrorPresentation('unknown_code', 503).resolution).toBe('retry');
    expect(resolveApiErrorPresentation('unknown_code', 422).resolution).toBe('contact');
    expect(resolveApiErrorPresentation('', 500)).toMatchObject({ resolution: 'retry' });

    for (const code of [null, undefined, 500, {}, []]) {
      expect(() => resolveApiErrorPresentation(code as never, 500)).not.toThrow();
    }
    for (const status of [Number.NaN, -1, 999, undefined]) {
      expect(() => resolveApiErrorPresentation('', status as never)).not.toThrow();
    }
    for (const code of ['__proto__', 'constructor', 'toString', '<script>alert(1)</script>', 'x'.repeat(100_000)]) {
      expect(resolveApiErrorPresentation(code, 422)).toMatchObject({ resolution: 'contact' });
    }
  });

  it('returns fresh values and stays deterministic across 1,000 calls', () => {
    const first = resolveApiErrorPresentation('internal_error', 500);
    first.guide = 'mutated';
    const expected = resolveApiErrorPresentation('internal_error', 500);
    for (let index = 0; index < 1_000; index += 1) {
      expect(resolveApiErrorPresentation('internal_error', 500)).toEqual(expected);
    }
  });

  it('never tells contact cases to retry', () => {
    for (const [code, resolution] of cases) {
      const { guide } = resolveApiErrorPresentation(code, 500);
      if (resolution === 'contact') expect(guide).not.toMatch(/다시\s*시도|재시도/);
    }
  });
});
