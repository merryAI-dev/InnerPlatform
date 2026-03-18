import { describe, expect, it } from 'vitest';
import { buildWauPingPayload, shouldPingWau } from './wau-tracker';

describe('wau-tracker', () => {
  it('builds payload with all required fields', () => {
    const payload = buildWauPingPayload({
      uid: 'u001',
      email: 'test@mysc.co.kr',
      role: 'pm',
      orgId: 'mysc',
    });
    expect(payload.uid).toBe('u001');
    expect(payload.email).toBe('test@mysc.co.kr');
    expect(payload.role).toBe('pm');
    expect(payload.orgId).toBe('mysc');
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('shouldPingWau returns false in non-browser environment', () => {
    // typeof window === 'undefined' in node → returns false
    expect(shouldPingWau()).toBe(false);
  });
});
