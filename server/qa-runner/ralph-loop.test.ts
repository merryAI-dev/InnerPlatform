import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildIssueFingerprint,
  createFileRalphLoopStore,
  getLatestRun,
  runRalphLoop,
} from './ralph-loop';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'innerplatform-qa-loop-'));
  tempDirs.push(dir);
  return { dir, store: createFileRalphLoopStore(dir) };
}

describe('ralph loop', () => {
  it('builds stable issue fingerprints', () => {
    const fingerprint = buildIssueFingerprint({
      id: 'qa-1',
      title: '지출구분 라벨 변경',
      body: '법인카드 명칭을 변경해야 합니다.',
      severity: 'high',
      surface: 'weekly-expense',
      labels: ['ux', 'p0'],
    });

    expect(fingerprint).toHaveLength(40);
    expect(fingerprint).toBe(buildIssueFingerprint({
      id: 'qa-2',
      title: '지출구분 라벨 변경',
      body: '법인카드 명칭을 변경해야 합니다.',
      severity: 'high',
      surface: 'weekly-expense',
      labels: ['ux', 'p0'],
    }));
  });

  it('caches planning state and records rollback on failed verification', async () => {
    const { dir, store } = await createTempStore();
    const classify = vi.fn(async () => ({ bucket: 'ux' }));
    const plan = vi.fn(async () => ({ steps: ['rename-payment-labels'] }));

    const first = await runRalphLoop({
      issue: {
        id: 'qa-1',
        title: '지출구분 라벨 변경',
        body: '법인카드를 사업비카드로 바꿔야 합니다.',
        severity: 'high',
        surface: 'weekly-expense',
        labels: ['ux', 'payments'],
      },
      repoSha: 'abc123',
      store,
      handlers: {
        classify,
        plan,
        execute: async () => ({ diff: ['src/app/data/types.ts'] }),
        verify: async () => ({
          ok: false,
          rollback: {
            reason: 'Playwright smoke failed',
            flagName: 'VITE_QA_P0_SETTLEMENT_V1',
            before: { enabled: true },
            after: { enabled: false },
          },
        }),
      },
    });

    expect(first.run.status).toBe('rolled_back');
    expect(first.rollback?.flagName).toBe('VITE_QA_P0_SETTLEMENT_V1');

    const second = await runRalphLoop({
      issue: {
        id: 'qa-2',
        title: '지출구분 라벨 변경',
        body: '법인카드를 사업비카드로 바꿔야 합니다.',
        severity: 'high',
        surface: 'weekly-expense',
        labels: ['ux', 'payments'],
      },
      repoSha: 'abc123',
      store,
      handlers: {
        classify,
        plan,
        execute: async () => ({ diff: [] }),
        verify: async () => ({ ok: true }),
      },
    });

    expect(classify).toHaveBeenCalledTimes(1);
    expect(plan).toHaveBeenCalledTimes(1);
    expect(second.run.status).toBe('verified');

    const latestRun = await getLatestRun(dir);
    expect(latestRun?.status).toBe('verified');
  });
});
