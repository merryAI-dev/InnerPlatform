import { describe, expect, it } from 'vitest';

import { PlatformApiError } from './api-client';
import { resolveApiErrorMessage } from './api-error-message';
import { resolveApiErrorPresentation } from './api-error-messages';

describe('resolveApiErrorMessage', () => {
  it('prefers API body messages when available', () => {
    const error = new PlatformApiError('Bad Request', 400, 'req_1', {
      message: 'validation failed',
    });

    expect(resolveApiErrorMessage(error, 'fallback')).toBe('validation failed');
  });

  it('falls back to generic error messages', () => {
    expect(resolveApiErrorMessage(new Error('plain failure'), 'fallback')).toBe('plain failure');
  });

  it('returns the provided fallback for unknown values', () => {
    expect(resolveApiErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('gives formula mismatches an actionable guide instead of the generic 409 message', () => {
    expect(resolveApiErrorPresentation('cashflow_formula_mismatch_confirmation_required', 409)).toEqual({
      guide: '시트의 합계·잔액과 MYSCube 계산 결과가 달라요. 차이를 확인한 뒤 그대로 반영하거나 시트 값을 다시 가져와 주세요.',
      resolution: 'contact',
    });
  });
});
