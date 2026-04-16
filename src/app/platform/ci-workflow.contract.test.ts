import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const workflowSource = readFileSync(
  resolve(import.meta.dirname, '../../../.github/workflows/ci.yml'),
  'utf8',
);

describe('ci workflow portal network gate contract', () => {
  it('uses the canonical portal network gate as the CI source of truth', () => {
    expect(workflowSource).toContain('npm run phase0:portal:network-gate -- --json-out artifacts/portal-network-gate.json');
    expect(workflowSource).toContain('actions/upload-artifact@v4');
    expect(workflowSource).toContain('portal-network-gate');
    expect(workflowSource).not.toContain('Detect portal network gate command');
    expect(workflowSource).not.toContain('phase0:portal:network-gate is not available in this branch yet');
    expect(workflowSource).not.toContain('Settlement targeted vitest matrix');
    expect(workflowSource).not.toContain('Settlement product flow Playwright');
    expect(workflowSource).not.toContain('Auth and projects critical flow Playwright');
  });
});
