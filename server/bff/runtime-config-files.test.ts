import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('BFF runtime config files', () => {
  it('does not bake local deploy environment into the production Docker image', () => {
    const dockerfile = readRepoFile('server/bff/Dockerfile');

    expect(dockerfile).toContain('ENV NODE_ENV=production');
    expect(dockerfile).not.toMatch(/^ENV BFF_DEPLOY_ENV=local$/m);
    expect(dockerfile).toContain('ENV BFF_WORKERS_ENABLED=false');
    expect(dockerfile).toContain('ENV BFF_SCHEDULER_OWNER=disabled');
  });

  it('keeps Cloud Run deployment defaults stage-scoped with disabled workers and explicit origins', () => {
    const script = readRepoFile('scripts/deploy_bff_cloud_run.sh');

    expect(script).toContain('BFF_DEPLOY_ENV="${BFF_DEPLOY_ENV:-stage}"');
    expect(script).toContain('BFF_WORKERS_ENABLED="${BFF_WORKERS_ENABLED:-false}"');
    expect(script).toContain('BFF_SCHEDULER_OWNER="${BFF_SCHEDULER_OWNER:-disabled}"');
    expect(script).not.toContain('BFF_ALLOWED_ORIGINS="${BFF_ALLOWED_ORIGINS:-*}"');
  });

  it('keeps Cloud Build BFF deployment defaults stage-scoped with disabled workers', () => {
    const cloudBuild = readRepoFile('cloudbuild.bff.yaml');

    expect(cloudBuild).toContain('_DEPLOY_ENV: stage');
    expect(cloudBuild).toContain("_WORKERS_ENABLED: 'false'");
    expect(cloudBuild).toContain('_SCHEDULER_OWNER: disabled');
    expect(cloudBuild).not.toContain("_ALLOWED_ORIGINS: '*'");
  });

  it('caps emulator JVM heap under memory pressure while preserving an explicit caller override', () => {
    const script = readRepoFile('scripts/test_bff_integration.sh');

    expect(script).toContain('export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:--Xms32m -Xmx768m}"');
  });

  it('runs Firestore and Storage integration suites sequentially with one Vitest worker', () => {
    const script = readRepoFile('scripts/test_bff_integration.sh');
    const vitestConfig = readRepoFile('vitest.bff-integration.config.ts');
    const firestoreRun = script.indexOf('run_emulator_suite firestore');
    const storageRun = script.indexOf('run_emulator_suite auth,storage');

    expect(firestoreRun).toBeGreaterThan(-1);
    expect(storageRun).toBeGreaterThan(firestoreRun);
    expect(script).toContain('server/bff/storage-rules.integration.test.ts');
    expect(vitestConfig).toContain('maxWorkers: 1');
  });

  it('uses a macOS-compatible unique temp config name', () => {
    const script = readRepoFile('scripts/test_bff_integration.sh');

    expect(script).toContain('mktemp "$ROOT_DIR/.firebase-bff-integration.XXXXXX"');
    expect(script).not.toContain('.firebase-bff-integration-XXXX.json');
  });

  it('starts Firebase emulators with a credential-free environment allowlist', () => {
    const script = readRepoFile('scripts/test_bff_integration.sh');

    expect(script).toMatch(/env -i \\\n\s+HOME="\$HOME" \\\n\s+PATH="\$PATH"/);
    expect(script).toContain('JAVA_TOOL_OPTIONS="$JAVA_TOOL_OPTIONS"');
    expect(script).toContain('FIREBASE_PROJECT_ID="$PROJECT_ID"');
  });
});
