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

describe('Java weekly cashflow client', () => {
  it('forwards trusted edit-session context and never sends caller sourceSheetKey', async () => {
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
      sourceSheetKey: 'caller-controlled',
      editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 },
      lines: [{ mode: 'actual', yearMonth: '2026-07', weekNo: 1, cashflowLine: 'DIRECT_COST_OUT', amount: 1000 }],
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers).toMatchObject({
      'x-data-project-id': 'stage-data-project',
      'x-edit-session-id': 'session-a',
      'x-edit-lease-id': 'lease-a',
      'x-edit-fence': '7',
    });
    expect(JSON.parse(init.body)).toEqual({
      idempotencyKey: 'apply-1',
      lines: [{ mode: 'actual', yearMonth: '2026-07', weekNo: 1, cashflowLine: 'DIRECT_COST_OUT', amount: 1000 }],
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
      editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 },
      lines: [{ mode: 'projection', yearMonth: '2026-07', weekNo: 1, cashflowLine: 'SALES_IN', amount: 1000 }],
    })).rejects.toMatchObject({ statusCode: 503, code: 'jvm_weekly_data_project_mismatch' });
    expect(fetchImpl).not.toHaveBeenCalled();
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
      editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 },
      lines: [{ mode: 'projection', yearMonth: '2026-07', weekNo: 1, cashflowLine: 'SALES_IN', amount: 1000 }],
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
      editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 },
      lines: [{ mode: 'projection', yearMonth: '2026-07', weekNo: 1, cashflowLine: 'SALES_IN', amount: 1000 }],
    });

    expect(fetchImpl.mock.calls[0][1].headers['x-data-project-id']).toBe('stage-data-project');
  });

  it.each(['0', '-1', '01', '1e2', '1.0', '9007199254740992'])(
    'rejects non-canonical edit fence %s before network',
    async (fence) => {
      const fetchImpl = vi.fn();
      const client = createJavaWeeklyClient({ env: stageEnv(), fetchImpl });

      await expect(client.applyCashflowSheetLab({
        context,
        projectId: 'project-a',
        idempotencyKey: `apply-bad-fence-${fence}`,
        editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence },
        lines: [{ mode: 'projection', yearMonth: '2026-07', weekNo: 1, cashflowLine: 'SALES_IN', amount: 1000 }],
      })).rejects.toMatchObject({ statusCode: 400, code: 'cashflow_edit_lease_request_invalid' });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

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
      editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 },
      lines: [{ mode: 'projection', yearMonth: '2026-07', weekNo: 1, cashflowLine: 'SALES_IN', amount: 1000 }],
    })).rejects.toMatchObject({
      statusCode: 422,
      code: 'atomic_write_limit_exceeded',
      details: { expectedWriteCount: 501 },
    });
  });
});
