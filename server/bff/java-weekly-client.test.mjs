import { describe, expect, it, vi } from 'vitest';
import { createJavaWeeklyClient } from './java-weekly-client.mjs';

function stageEnv(overrides = {}) {
  return {
    BFF_DEPLOY_ENV: 'stage',
    BFF_EDIT_LEASES_ENABLED: 'true',
    FIREBASE_PROJECT_ID: 'stage-data-project',
    JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'stage-data-project',
    JVM_WEEKLY_API_BASE_URL: 'https://stage-jvm.example',
    JVM_WEEKLY_INTERNAL_API_TOKEN: 'service-token',
    ...overrides,
  };
}

const context = {
  tenantId: 'tenant-a',
  actorId: 'pm-1',
  actorRole: 'pm',
  actorEmail: 'pm@example.com',
};

const monthlyContract = {
  sourceRevision: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  targetRevision: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  yearMonth: '2026-07',
  cells: [{ mode: 'projection', weekNo: 1, cashflowLine: 'SALES_IN', cellState: 'VALUE', amount: 1000 }],
};

describe('Java weekly cashflow client', () => {
  it('forwards an annual total to the dedicated JVM authority endpoint', async () => {
    const fetchImpl = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, projectId: 'project-a', year: 2025 }),
      url,
      init,
    }));
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });
    await client.applyCashflowSheetAnnualTotal({
      context,
      projectId: 'project-a',
      idempotencyKey: 'annual-1',
      sourceRevision: monthlyContract.sourceRevision,
      year: 2025,
      expectedRevision: 3,
      cells: [{ mode: 'projection', cashflowLine: 'SALES_IN', cellState: 'VALUE', amount: 2300000 }],
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/api/v1/cashflow/project-a/sheet-lab/annual/apply');
    expect(JSON.parse(init.body)).toEqual({
      idempotencyKey: 'annual-1',
      sourceRevision: monthlyContract.sourceRevision,
      year: 2025,
      expectedRevision: 3,
      cells: [{ mode: 'projection', cashflowLine: 'SALES_IN', cellState: 'VALUE', amount: 2300000 }],
    });
  });

  it('forwards the pinned monthly contract without a cashflow edit lease', async () => {
    const fetchImpl = vi.fn(async (_url, init) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, projectId: 'project-a', sourceSheetKey: 'cashflow-sheet-lab' }),
      init,
    }));
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });

    await client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-1',
      sourceRevision: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      targetRevision: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      yearMonth: '2026-07',
      sourceSheetKey: 'caller-controlled',
      cells: [{ mode: 'actual', weekNo: 1, cashflowLine: 'DIRECT_COST_OUT', cellState: 'VALUE', amount: 1000 }],
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers).toMatchObject({ 'x-data-project-id': 'stage-data-project' });
    expect(init.headers['x-edit-session-id']).toBeUndefined();
    expect(init.headers['x-edit-lease-id']).toBeUndefined();
    expect(init.headers['x-edit-fence']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      idempotencyKey: 'apply-1',
      sourceRevision: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      targetRevision: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      yearMonth: '2026-07',
      cells: [{ mode: 'actual', weekNo: 1, cashflowLine: 'DIRECT_COST_OUT', cellState: 'VALUE', amount: 1000 }],
    });
  });

  it('fails before network when BFF and JVM data projects differ', async () => {
    const fetchImpl = vi.fn();
    const client = createJavaWeeklyClient({
      env: stageEnv({ JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'different-project' }),
      fetchImpl,
    });

    await expect(client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-2',
      ...monthlyContract,
      editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 },
    })).rejects.toMatchObject({ statusCode: 503, code: 'jvm_weekly_data_project_mismatch' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards the explicit initial-ledger overwrite flag only when requested', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, projectId: 'project-a' }),
    }));
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });

    await client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-overwrite-1',
      ...monthlyContract,
      replaceAllActualSources: true,
      editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 },
    });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      replaceAllActualSources: true,
    });
  });

  it('rejects a JVM response for another project', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, projectId: 'project-b' }),
    }));
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });

    await expect(client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-3',
      ...monthlyContract,
      editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 },
    })).rejects.toMatchObject({ statusCode: 502, code: 'jvm_weekly_project_mismatch' });
  });

  it('uses the frontend Firebase project id when it is the only Stage data-project source', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, projectId: 'project-a' }),
    }));
    const env = stageEnv({
      FIREBASE_PROJECT_ID: undefined,
      VITE_FIREBASE_PROJECT_ID: 'stage-data-project',
    });
    const client = createJavaWeeklyClient({ env, fetchImpl });

    await client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-vite-project',
      ...monthlyContract,
      editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 },
    });

    expect(fetchImpl.mock.calls[0][1].headers['x-data-project-id']).toBe('stage-data-project');
  });

  it('allows a sheet overwrite without a cashflow edit lease', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, projectId: 'project-a' }),
    }));
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });

    await client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-without-lease',
      ...monthlyContract,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('retries a transient JVM transport failure with the same request body', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, projectId: 'project-a' }),
      });
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });

    await client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-retry-1',
      ...monthlyContract,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].body).toBe(fetchImpl.mock.calls[0][1].body);
  });

  it('returns a clear retryable service error when JVM transport remains unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });

    await expect(client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-unreachable-1',
      ...monthlyContract,
    })).rejects.toMatchObject({ statusCode: 503, code: 'jvm_weekly_api_unreachable' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('preserves the JVM atomic write count on client errors', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({
        code: 'atomic_write_limit_exceeded',
        message: 'Cashflow apply requires 501 writes.',
        expectedWriteCount: 501,
      }),
    }));
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });

    await expect(client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-atomic-limit',
      ...monthlyContract,
      editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 },
    })).rejects.toMatchObject({
      statusCode: 422,
      code: 'atomic_write_limit_exceeded',
      details: { expectedWriteCount: 501 },
    });
  });
});
