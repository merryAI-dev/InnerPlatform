import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalSubmissionsPage.tsx'), 'utf8');

describe('PortalSubmissionsPage cashflow metadata lease', () => {
  it('keeps manual status correction project-scoped and read-only until a lease is acquired', () => {
    expect(source).toContain('useCashflowEditLease');
    expect(source).toContain('statusLeaseProjectId');
    expect(source).toContain('checkBeforeMutation');
    expect(source).toContain('EditLeaseDialogs');
    expect(source).toContain('수정 시작');
    expect(source).toContain('30분 연장');
  });
});
