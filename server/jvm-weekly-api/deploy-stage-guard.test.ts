import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');
const deployScript = resolve(repoRoot, 'scripts/deploy_jvm_weekly_api_cloud_run.sh');
const smokeScript = resolve(repoRoot, 'scripts/smoke_jvm_weekly_api.mjs');
const tokenScript = resolve(repoRoot, 'scripts/create_firebase_smoke_id_token.mjs');

function runIfPresent(command: string, args: string[], env: NodeJS.ProcessEnv) {
  if (!existsSync(args[0])) return { status: null, output: '' };
  const result = spawnSync(command, args, { cwd: repoRoot, env, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function commandStubs() {
  const root = mkdtempSync(resolve(tmpdir(), 'jvm-stage-guard-'));
  const marker = resolve(root, 'network-command-called');
  for (const command of ['mvn', 'docker', 'gcloud', 'node']) {
    const path = resolve(root, command);
    writeFileSync(path, '#!/usr/bin/env bash\nprintf "%s\\n" "$0 $*" >> "$COMMAND_MARKER"\nexit 91\n');
    chmodSync(path, 0o755);
  }
  return { root, marker };
}

describe('Stage-only JVM deploy guards', () => {
  it.each([
    { GOOGLE_CLOUD_PROJECT: 'inner-platform-live-20260316' },
    { GOOGLE_CLOUD_PROJECT: 'inner-platform-qa-20260310', SERVICE_NAME: 'innerplatform-jvm-weekly-api' },
    {
      GOOGLE_CLOUD_PROJECT: 'inner-platform-qa-20260310',
      SERVICE_NAME: 'innerplatform-jvm-weekly-api-lease-stage',
      JVM_WEEKLY_SMOKE_URL: 'https://innerplatform-jvm-weekly-api.run.app',
    },
    {
      GOOGLE_CLOUD_PROJECT: 'inner-platform-qa-20260310',
      FIREBASE_PROJECT_ID: 'inner-platform-live-20260316',
    },
    {
      GOOGLE_CLOUD_PROJECT: 'inner-platform-qa-20260310',
      JVM_WEEKLY_API_BASE_URL: 'https://innerplatform-jvm-weekly-api.run.app',
    },
    {
      GOOGLE_CLOUD_PROJECT: '',
      FIREBASE_PROJECT_ID: 'inner-platform-qa-20260310',
    },
  ])('rejects unsafe deploy environment before external commands: %o', (unsafe) => {
    const stubs = commandStubs();
    const result = runIfPresent('/bin/bash', [deployScript], {
      ...process.env,
      PATH: `${stubs.root}:${process.env.PATH || ''}`,
      COMMAND_MARKER: stubs.marker,
      JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'mysc-bmp-14173451',
      JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID: 'mysc-bmp-14173451',
      JVM_WEEKLY_ALLOWED_ORIGINS: 'https://inner-platform-internal-stage-merryai-devs-projects.vercel.app',
      ...unsafe,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Stage-only JVM deploy');
    expect(existsSync(stubs.marker) ? readFileSync(stubs.marker, 'utf8') : '').toBe('');
  }, 20_000);

  it.each([
    ['deploy', 'https://innerplatform-jvm-weekly-api.run.app'],
    ['lease', 'https://inner-platform.vercel.app'],
  ])('rejects Live smoke target before fetch in %s mode', (mode, url) => {
    const result = runIfPresent(process.execPath, [smokeScript, `--mode=${mode}`, `--base-url=${url}`], process.env);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Stage-only JVM smoke rejected target');
  }, 20_000);

  it('rejects a non-Stage Firebase auth project before sign-in fetch', () => {
    const result = runIfPresent(process.execPath, [tokenScript], {
      ...process.env,
      JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID: 'inner-platform-live-20260316',
      FIREBASE_WEB_API_KEY: 'not-used',
      JVM_WEEKLY_SMOKE_EMAIL: 'not-used@example.com',
      JVM_WEEKLY_SMOKE_PASSWORD: 'not-used',
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Stage-only Firebase smoke auth requires mysc-bmp-14173451');
  }, 20_000);

  it('rejects a non-QA lease project before any Stage BFF request', () => {
    const stubs = commandStubs();
    const fetchStub = resolve(stubs.root, 'block-fetch.mjs');
    writeFileSync(fetchStub, [
      "import { appendFileSync } from 'node:fs';",
      "globalThis.fetch = async () => { appendFileSync(process.env.COMMAND_MARKER, 'fetch\\n'); throw new Error('fetch blocked'); };",
    ].join('\n'));
    const result = runIfPresent(process.execPath, [
      smokeScript,
      '--mode=lease',
      '--base-url=https://inner-platform-internal-stage-merryai-devs-projects.vercel.app',
      '--identity-token=not-used',
      '--tenant-id=qa-smoke',
      '--actor-id=qa-smoke-user',
      '--project-id=p1773994485543',
    ], {
      ...process.env,
      COMMAND_MARKER: stubs.marker,
      NODE_OPTIONS: `--import=${fetchStub}`,
      JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID: 'mysc-bmp-14173451',
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Stage lease smoke project ID must start with qa-lease-');
    expect(existsSync(stubs.marker) ? readFileSync(stubs.marker, 'utf8') : '').toBe('');
  }, 20_000);
});
