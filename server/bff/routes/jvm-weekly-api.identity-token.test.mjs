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

function monthCloseCalendarFor(yearMonth) {
  const year = Number(String(yearMonth).slice(0, 4));
  return Array.from({ length: 12 }, (_unused, monthIndex) => {
    const month = monthIndex + 1;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const isoAtKstMidnight = (day) => new Date(Date.UTC(nextYear, nextMonth - 1, day) - 9 * 60 * 60 * 1000).toISOString();
    return {
      yearMonth: `${year}-${String(month).padStart(2, '0')}`,
      closeDeadline: `${nextYear}-${String(nextMonth).padStart(2, '0')}-10`,
      closeDeadlineAt: isoAtKstMidnight(11),
      approverDeadlineAt: isoAtKstMidnight(14),
    };
  });
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
  const commandCapabilities = Object.fromEntries([
    'SUBMIT_MONTH_CLOSE', 'WITHDRAW_MONTH_CLOSE', 'APPROVE_MONTH_CLOSE', 'REJECT_MONTH_CLOSE',
    'REQUEST_MONTH_REOPEN', 'APPROVE_MONTH_REOPEN', 'REJECT_MONTH_REOPEN', 'CANCEL_ACTIVE_CYCLE',
  ].map((command) => [command, { allowed: false, reasonCode: 'BUSINESS_STATE_NOT_ELIGIBLE' }]));
  commandCapabilities.SUBMIT_MONTH_CLOSE = { allowed: true, reasonCode: '' };
  return {
    monthClose,
    latestRun: monthClose,
    monthStatusEvidence: {
      authority: 'CUMULATIVE_CLOSE_HEAD',
      authorityAvailability: 'AVAILABLE',
      operationalStatus: 'CLOSED',
      latestRunStatus: 'CLOSED',
      closedThrough: '2026-06',
      issueCode: null,
    },
    cumulativeClose: {
      availability: 'AVAILABLE',
      status: 'CLOSED',
      fromMonth: '2023-01',
      closedThrough: '2026-06',
      rootHash: `sha256:${'a'.repeat(64)}`,
      headRevision: 1,
    },
    operationalCycle: {
      cycleYearMonth: '2026-06',
      targetYearMonth: '2026-05',
      closeDeadline: '2026-06-10',
      closeEligible: false,
      late: false,
    },
    settlementStatuses: {
      projectId: 'project-a',
      yearMonth: '2026-06',
      items: ['MONTH', 'WEEK_1', 'WEEK_2', 'WEEK_3', 'WEEK_4', 'WEEK_5'].map((period) => ({
        period, status: 'WAITING_FOR_UPDATE', revision: 0,
        submittedAt: '', submittedBy: '', approvedAt: '', approvedBy: '',
        deadlineAt: '2026-06-10T15:00:00.000Z',
        approverDeadlineAt: '2026-06-13T15:00:00.000Z',
      })),
    },
    settlementCycle: {
      cycleYearMonth: '2026-06', weeklyYearMonth: '2026-06', monthCloseTargetYearMonth: '2026-05',
      closeDeadline: '2026-06-10', businessState: 'NOT_REQUESTED', health: 'OK', workflowRevision: 0,
      monthCloseSettlement: null, provenance: null, supersededAttempt: null, commandCapabilities,
    },
    monthCloseCalendar: monthCloseCalendarFor('2026-06'),
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
