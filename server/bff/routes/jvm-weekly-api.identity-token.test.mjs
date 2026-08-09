// 라이브 프로덕션이 실제로 타는 토큰 경로(분기 A: 서비스 계정 발급 + 캐시)를 라우트
// 레벨에서 통과시킨다. 다른 라우트 테스트들은 resolver 주입(분기 B)이나 메타데이터
// 서버(분기 C)로 흘러서, 이 경로는 단위 테스트로만 덮여 있었다 - 라우트가 캐시를
// 실제로 재사용하는지(month-close 읽기 한 번 = JVM 두 호출 = 발급 한 번)는 여기서만 본다.
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const getIdTokenClient = vi.fn();

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn(() => ({ getIdTokenClient })),
}));

const { mountJvmWeeklyApiRoutes } = await import('./jvm-weekly-api.mjs');
const { __clearIdentityTokenCachesForTest } = await import('../java-weekly-auth.mjs');

function liveJwt() {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
    sub: 'route-level',
  })).toString('base64url');
  return `h.${payload}.s`;
}

function monthDashboardSource() {
  const monthClose = {
    ok: true,
    projectId: 'project-a',
    yearMonth: '2026-06',
    status: 'CLOSED',
    revision: 1,
    reopenCount: 0,
    projectWarningCount: 0,
    snapshot: {},
  };
  return {
    monthClose,
    snapshotCompatibility: { status: 'LEGACY_EVIDENCE_ONLY', missingEvidence: ['OPENING_BALANCES', 'LEDGER_WEEKS'] },
    projectionActualSummary: {
      projectId: 'project-a',
      fromMonth: '2026-01',
      comparisonAsOfWeek: { yearMonth: '2026-06', weekNo: 1 },
      settlementDifferenceAmount: 0,
      settlementMatches: true,
    },
  };
}

describe('JVM weekly routes over the credential identity token path', () => {
  it('mints one identity token for the whole month-close read fan-out', async () => {
    __clearIdentityTokenCachesForTest();
    const token = liveJwt();
    const fetchIdToken = vi.fn(async () => token);
    getIdTokenClient.mockResolvedValue({ idTokenProvider: { fetchIdToken } });

    const jvmAuthHeaders = [];
    const fetchImpl = vi.fn(async (url, init) => {
      jvmAuthHeaders.push(init.headers.authorization || init.headers.Authorization);
      if (String(url).includes('/weekly-update-compliance')) {
        return new Response(JSON.stringify({ items: [], nextCursor: '', onTimeCount: 0, missedCount: 0 }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(monthDashboardSource()), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.context = {
        tenantId: 'tenant-a', actorId: 'auditor-1', actorRole: 'auditor',
        actorEmail: 'auditor@example.com', requestId: 'req-idt',
        idempotencyKey: req.header('idempotency-key') || undefined,
      };
      next();
    });
    mountJvmWeeklyApiRoutes(app, {
      idempotencyService: {
        async reserve() { return { replayed: false }; },
        async complete() {}, async fail() {},
      },
      fetchImpl,
      env: {
        JVM_WEEKLY_API_BASE_URL: 'http://jvm-weekly.local',
        JVM_WEEKLY_INTERNAL_API_TOKEN: 'service-token',
        JVM_WEEKLY_API_ID_TOKEN_AUDIENCE: 'https://jvm-weekly.audience',
        JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'bff@live.iam', private_key: 'k' }),
      },
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => expect(response.body.status).toBe('CLOSED'));

    // JVM 호출은 dashboard-source + compliance 두 번, 발급은 한 번이어야 한다.
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fetchIdToken).toHaveBeenCalledTimes(1);
    expect(jvmAuthHeaders.every((header) => header === `Bearer ${token}`)).toBe(true);

    // 두 번째 요청도 캐시를 쓴다. 발급 횟수는 그대로다.
    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200);
    expect(fetchIdToken).toHaveBeenCalledTimes(1);
  });
});
