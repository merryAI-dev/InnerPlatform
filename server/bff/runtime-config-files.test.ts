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

  it('hard-rejects non-demo Firebase projects before starting emulators', () => {
    const script = readRepoFile('scripts/test_bff_integration.sh');
    const guard = script.indexOf('case "$PROJECT_ID" in');
    const firstRun = script.indexOf('run_emulator_suite firestore');

    expect(guard).toBeGreaterThan(-1);
    expect(script).toContain('demo-?*)');
    expect(guard).toBeLessThan(firstRun);
  });

  it('isolates Firebase and npm credentials behind a temporary HOME', () => {
    const script = readRepoFile('scripts/test_bff_integration.sh');

    expect(script).toContain('ORIGINAL_EMULATORS_PATH="${FIREBASE_EMULATORS_PATH:-$HOME/.cache/firebase/emulators}"');
    expect(script).toContain('TMP_HOME="$(mktemp -d "${TMPDIR:-/tmp}/bff-emulator-home.XXXXXX")"');
    expect(script).toContain('HOME="$TMP_HOME"');
    expect(script).not.toContain('HOME="$HOME"');
    expect(script).toContain('FIREBASE_EMULATORS_PATH="$ORIGINAL_EMULATORS_PATH"');
    expect(script).toContain('rm -rf "$TMP_HOME"');
  });

  it('disables the emulator UI in the generated config', () => {
    const script = readRepoFile('scripts/test_bff_integration.sh');

    expect(script).toContain('cfg.emulators.ui={enabled:false};');
  });

  it('starts Firebase emulators with a credential-free environment allowlist', () => {
    const script = readRepoFile('scripts/test_bff_integration.sh');

    expect(script).toMatch(/env -i \\\n\s+HOME="\$TMP_HOME" \\\n\s+PATH="\$PATH"/);
    expect(script).toContain('JAVA_TOOL_OPTIONS="$JAVA_TOOL_OPTIONS"');
    expect(script).toContain('FIREBASE_PROJECT_ID="$PROJECT_ID"');
  });
});
