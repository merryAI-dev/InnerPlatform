import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');
const vercelConfig = JSON.parse(readFileSync(resolve(repoRoot, 'vercel.json'), 'utf8'));

const VERCEL_OWNED_WORKERS = new Set([
  '/api/internal/workers/work-queue/run',
  '/api/internal/workers/outbox/run',
  '/api/internal/workers/payroll/run',
]);

describe('scheduler ownership config', () => {
  it('keeps every Vercel cron on the documented Vercel-owned worker set', () => {
    const cronPaths = new Set((vercelConfig.crons || []).map((cron: { path: string }) => cron.path));

    expect(cronPaths).toEqual(VERCEL_OWNED_WORKERS);
  });

  it('rewrites every Vercel-owned worker route into the BFF function', () => {
    const rewrites = new Map((vercelConfig.rewrites || []).map((rewrite: { source: string; destination: string }) => [
      rewrite.source,
      rewrite.destination,
    ]));

    for (const workerPath of VERCEL_OWNED_WORKERS) {
      expect(rewrites.get(workerPath)).toBe(`/api/bff?__path=${workerPath}`);
    }
  });
});
