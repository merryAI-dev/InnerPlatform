import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitizeAuditLogItem } from './bff/routes/audit.mjs';

const repoRoot = resolve(__dirname, '..');

describe('privacy-by-design policy gate', () => {
  it('accepts osquery-inspired observability packs with minimized outputs', () => {
    const output = execFileSync('node', ['scripts/verify_privacy_by_design_policy.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    expect(output).toContain('[pbd-verify] ok');
  });

  it('documents the osquery source model and differential-first collection', () => {
    const policy = JSON.parse(readFileSync(resolve(repoRoot, 'policies/privacy-by-design-policy.json'), 'utf8'));
    const packs = JSON.parse(readFileSync(resolve(repoRoot, 'policies/security-observability-packs.json'), 'utf8'));

    expect(policy.sourceModel.repository).toBe('https://github.com/osquery/osquery');
    expect(policy.sourceModel.appliedPatterns).toContain('query_packs');
    expect(policy.sourceModel.appliedPatterns).toContain('differential_results');
    expect(packs.packs.github_security.queries.repository_visibility_drift.collectionMode).toBe('differential');
  });
});

describe('audit log privacy minimization', () => {
  it('does not expose encrypted actor email material in audit log API responses', () => {
    const item = sanitizeAuditLogItem({
      id: 'al_1',
      userId: 'u-1',
      userEmailEnc: 'enc:v1:key-2026:iv:tag:ciphertext',
      action: 'ROLE_CHANGE',
    });

    expect(item).not.toHaveProperty('userEmailEnc');
    expect(item).toMatchObject({
      userEmailProtected: true,
      userEmailKeyRef: 'key-2026',
    });
  });
});
