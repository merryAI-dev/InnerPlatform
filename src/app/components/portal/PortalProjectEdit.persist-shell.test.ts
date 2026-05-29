import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalProjectEdit.tsx'), 'utf8');

describe('PortalProjectEdit persistence shell', () => {
  it('patches the portal project snapshot after a successful save', () => {
    expect(source).toContain('patchProjectSnapshot');
    expect(source).toContain('const savedProject = await persistProject');
    expect(source).toContain('if (savedProject) patchProjectSnapshot(savedProject)');
  });
});
