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
    const openingBalanceCells = [
      { year: 2025, mode: 'projection', cashflowLine: 'SALES_IN', cellState: 'VALUE', amount: 1000 },
    ];

    await client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-1',
      sourceRevision: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      targetRevision: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      yearMonth: '2026-07',
      sourceSheetKey: 'caller-controlled',
      cells: [{ mode: 'actual', weekNo: 1, cashflowLine: 'DIRECT_COST_OUT', cellState: 'VALUE', amount: 1000 }],
      openingBalanceCells,
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
      openingBalanceCells,
    });
  });

  it('forwards multiple months in one JVM batch request without a cashflow edit lease', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, projectId: 'project-a', months: [] }),
    }));
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });
    const months = [
      { yearMonth: '2026-07', cells: monthlyContract.cells },
      { yearMonth: '2026-08', cells: monthlyContract.cells },
    ];

    await client.applyCashflowSheetBatch({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-batch-1',
      sourceRevision: monthlyContract.sourceRevision,
      targetRevision: monthlyContract.targetRevision,
      months,
      replaceAllActualSources: true,
      settledWeekChangeConfirmation: {
        confirmationId: 'confirmation-a',
        targetRevision: monthlyContract.targetRevision,
        weeks: [{ yearMonth: '2026-07', weekNo: 3, completionRevision: 1 }],
      },
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/api/v1/cashflow/project-a/sheet-lab/batch/apply');
    expect(init.headers['x-edit-session-id']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      idempotencyKey: 'apply-batch-1',
      sourceRevision: monthlyContract.sourceRevision,
      targetRevision: monthlyContract.targetRevision,
      months,
      replaceAllActualSources: true,
      settledWeekChangeConfirmation: {
        confirmationId: 'confirmation-a',
        targetRevision: monthlyContract.targetRevision,
        weeks: [{ yearMonth: '2026-07', weekNo: 3, completionRevision: 1 }],
      },
    });
  });

  it('forwards a late closed-month change reason to the JVM batch authority', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, projectId: 'project-a', months: [] }),
    }));
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });

    await client.applyCashflowSheetBatch({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-batch-reason-1',
      sourceRevision: monthlyContract.sourceRevision,
      targetRevision: monthlyContract.targetRevision,
      months: [{ yearMonth: '2026-07', cells: monthlyContract.cells }],
      closedMonthChangeReason: '결산 후 실제 입금액 정정',
      acceptFormulaMismatches: true,
    });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      closedMonthChangeReason: '결산 후 실제 입금액 정정',
      acceptFormulaMismatches: true,
    });
  });

  it('waits once for a slow batch conflict instead of retrying and masking it as unreachable', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(() => new Promise((resolve) => {
        setTimeout(() => resolve({
          ok: false,
          status: 409,
          text: async () => JSON.stringify({ code: 'cashflow_revision_conflict', message: '원장 revision이 변경되었습니다.' }),
        }), 10);
      }));
      const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl, jvmWeeklyApiTimeoutMs: 5 });
      const request = client.applyCashflowSheetBatch({
        context,
        projectId: 'project-a',
        idempotencyKey: 'apply-batch-slow-conflict',
        sourceRevision: monthlyContract.sourceRevision,
        targetRevision: monthlyContract.targetRevision,
        months: [{ yearMonth: '2026-07', cells: monthlyContract.cells }],
      });
      const assertion = expect(request).rejects.toMatchObject({
        statusCode: 409,
        code: 'cashflow_revision_conflict',
      });

      await vi.advanceTimersByTimeAsync(11);
      await assertion;
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
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

  it('uses the Stage invoker credential instead of the GCP metadata server', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, projectId: 'project-a' }),
    }));
    const serviceAccountJson = JSON.stringify({ client_email: 'stage-invoker@example.iam.gserviceaccount.com' });
    const resolveIdentityToken = vi.fn(async () => 'stage-id-token');
    const client = createJavaWeeklyClient({
      env: stageEnv({
        JVM_WEEKLY_API_ID_TOKEN_AUDIENCE: 'https://stage-jvm.example',
        JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON: serviceAccountJson,
      }),
      fetchImpl,
      jvmWeeklyApiIdentityTokenResolver: resolveIdentityToken,
    });

    await client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-stage-invoker-1',
      ...monthlyContract,
    });

    expect(resolveIdentityToken).toHaveBeenCalledWith({
      audience: 'https://stage-jvm.example',
      serviceAccountJson,
      signal: expect.any(AbortSignal),
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer stage-id-token');
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

  it('aborts a hanging JVM request before the frontend timeout and returns the stable unreachable code', async () => {
    const fetchImpl = vi.fn(async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl, jvmWeeklyApiTimeoutMs: 5 });

    await expect(client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-timeout-1',
      ...monthlyContract,
    })).rejects.toMatchObject({ statusCode: 503, code: 'jvm_weekly_api_unreachable' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([, init]) => init.signal instanceof AbortSignal)).toBe(true);
  });

  it('times out a hanging identity-token resolver before the JVM fetch starts', async () => {
    const fetchImpl = vi.fn();
    const resolveIdentityToken = vi.fn(() => new Promise(() => {}));
    const client = createJavaWeeklyClient({
      env: stageEnv({
        JVM_WEEKLY_API_ID_TOKEN_AUDIENCE: 'https://stage-jvm.example',
        JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'stage-invoker@example.iam.gserviceaccount.com' }),
      }),
      fetchImpl,
      jvmWeeklyApiIdentityTokenResolver: resolveIdentityToken,
      jvmWeeklyApiTimeoutMs: 5,
    });

    await expect(client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-token-timeout-1',
      ...monthlyContract,
    })).rejects.toMatchObject({ statusCode: 503, code: 'jvm_weekly_api_unreachable' });
    expect(resolveIdentityToken.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(resolveIdentityToken.mock.calls.every(([input]) => input.signal instanceof AbortSignal)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes the attempt AbortSignal to a hanging metadata identity-token fetch', async () => {
    const fetchImpl = vi.fn(async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));
    const client = createJavaWeeklyClient({
      env: stageEnv({ JVM_WEEKLY_API_ID_TOKEN_AUDIENCE: 'https://stage-jvm.example' }),
      fetchImpl,
      jvmWeeklyApiTimeoutMs: 5,
    });

    await expect(client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-metadata-timeout-1',
      ...monthlyContract,
    })).rejects.toMatchObject({ statusCode: 503, code: 'jvm_weekly_api_unreachable' });
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchImpl.mock.calls.every(([, init]) => init.signal instanceof AbortSignal)).toBe(true);
    expect(fetchImpl.mock.calls.every(([url]) => String(url).includes('metadata.google.internal'))).toBe(true);
  });

  it('caps the configured timeout so two attempts stay within the 24-second total budget', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }));
      const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl, jvmWeeklyApiTimeoutMs: 30_000 });
      const requestPromise = client.applyCashflowSheetLab({
        context,
        projectId: 'project-a',
        idempotencyKey: 'apply-total-timeout-budget',
        ...monthlyContract,
      });
      const assertion = expect(requestPromise)
        .rejects.toMatchObject({ statusCode: 503, code: 'jvm_weekly_api_unreachable' });

      await vi.advanceTimersByTimeAsync(24_001);
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors an absolute caller deadline without retrying a timed-out mutation', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }));
      const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl, jvmWeeklyApiTimeoutMs: 12_000 });
      const requestPromise = client.requestJson({
        context,
        method: 'POST',
        path: '/api/v1/cashflow/project-a/month-close',
        body: { idempotencyKey: 'close-deadline-1' },
        deadlineAtMs: Date.now() + 20,
      });
      const assertion = expect(requestPromise).rejects.toMatchObject({
        statusCode: 504,
        code: 'cashflow_month_close_route_timeout',
      });

      await vi.advanceTimersByTimeAsync(21);
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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

  it('normalizes an unstructured Spring 500 response into a stable retryable BFF error', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ code: 'internal_error', error: 'Internal Server Error', message: 'unexpected failure' }),
    }));
    const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });

    await expect(client.applyCashflowSheetLab({
      context,
      projectId: 'project-a',
      idempotencyKey: 'apply-internal-error',
      ...monthlyContract,
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'jvm_weekly_api_internal_error',
      upstreamStatus: 500,
    });
  });
});
