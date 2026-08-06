import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');
const vercelConfig = JSON.parse(readFileSync(resolve(repoRoot, 'vercel.json'), 'utf8'));

const VERCEL_OWNED_WORKERS = new Map([
  ['/api/internal/workers/work-queue/run', '15 2 * * *'],
  ['/api/internal/workers/outbox/run', '30 2 * * *'],
  ['/api/internal/workers/payroll/run', '45 2 * * *'],
  ['/api/internal/workers/cashflow-sheet-sync/run', '30 0 * * 4'],
]);

describe('scheduler ownership config', () => {
  it('keeps every Vercel cron on the documented Vercel-owned worker set', () => {
    const cronPaths = new Map((vercelConfig.crons || []).map((cron: { path: string; schedule: string }) => [
      cron.path,
      cron.schedule,
    ]));

    expect(cronPaths).toEqual(VERCEL_OWNED_WORKERS);
  });

  it('rewrites every Vercel-owned worker route into the BFF function', () => {
    const rewrites = new Map((vercelConfig.rewrites || []).map((rewrite: { source: string; destination: string }) => [
      rewrite.source,
      rewrite.destination,
    ]));

    for (const workerPath of VERCEL_OWNED_WORKERS.keys()) {
      expect(rewrites.get(workerPath)).toBe(`/api/bff?__path=${workerPath}`);
    }
  });

  it('allows the cashflow sheet sync enough runtime to finish every connected project', () => {
    expect(vercelConfig.functions?.['api/bff.js']?.maxDuration).toBeGreaterThanOrEqual(300);
  });
});
