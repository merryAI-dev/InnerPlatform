import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');
const LIVE_WORKER_DISABLED_ENV = {
  ...process.env,
  BFF_DEPLOY_ENV: 'live',
  FIREBASE_PROJECT_ID: 'inner-platform-live-20260316',
  BFF_ALLOWED_ORIGINS: 'https://myscube.myscguard.app',
  BFF_WORKERS_ENABLED: 'false',
  FIRESTORE_EMULATOR_HOST: '',
};

function runWorker(scriptPath: string) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: LIVE_WORKER_DISABLED_ENV,
    encoding: 'utf8',
    timeout: 15000,
  });
}

describe('standalone BFF workers', () => {
  it.each([
    ['outbox worker', 'server/bff/outbox-worker.mjs'],
    ['work queue worker', 'server/bff/work-queue-worker.mjs'],
    ['idempotency cleanup worker', 'server/bff/cleanup_idempotency.mjs'],
  ])('blocks %s when live scheduling is disabled before doing work', (_name, scriptPath) => {
    const result = runWorker(scriptPath);
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain('Unsafe BFF runtime configuration');
    expect(output).toContain('worker scheduling is disabled');
  });
});
