import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const statusBarSource = readFileSync(
  resolve(import.meta.dirname, 'StatusBar.tsx'),
  'utf8',
);

describe('StatusBar shell contract', () => {
  it('hides LAB-only operational counters by default', () => {
    expect(statusBarSource).toContain('useShellLabEnabled');
    expect(statusBarSource).toContain('shouldShowShellRoute');
    expect(statusBarSource).toContain('showPendingApproval');
    expect(statusBarSource).toContain('showMissingEvidence');
    expect(statusBarSource).toContain('showParticipationRisk');
    expect(statusBarSource).toContain("'admin', 'quick-action'");
  });
});
