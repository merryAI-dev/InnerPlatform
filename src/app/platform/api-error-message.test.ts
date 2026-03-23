import { describe, expect, it } from 'vitest';

import { PlatformApiError } from './api-client';
import { resolveApiErrorMessage } from './api-error-message';

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
});
