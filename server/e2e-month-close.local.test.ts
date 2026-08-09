// 로컬 전용 end-to-end: BFF(인프로세스) -> 진짜 HTTP -> 로컬 JVM -> Firestore 에뮬레이터.
// AXR 프로젝트경비 실데이터를 에뮬레이터로 복사한 상태에서 돌린다. 라이브에는 쓰지 않는다.
// 실행: E2E_MONTH_CLOSE=1 FIRESTORE_EMULATOR_HOST=127.0.0.1:8571 npx vitest run e2e-month-close.local.test.ts
import express from 'express';
import { describe, expect, it } from 'vitest';
import { createFirestoreDb } from './bff/firestore.mjs';
// @ts-expect-error - JS 모듈
import { mountJvmWeeklyApiRoutes } from './bff/routes/jvm-weekly-api.mjs';
import { buildCashflowMonthCloseDraftInput } from '../src/app/components/cashflow/cashflow-month-close';

const TENANT = 'mysc';
const PROJECT = 'p1773817948751';
const JVM = 'http://127.0.0.1:8088';
const TOKEN = 'e2e-local-token';
const YEAR_MONTH = '2026-08';

const enabled = process.env.E2E_MONTH_CLOSE === '1';
if (enabled && !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('이 하네스는 Firestore 에뮬레이터에서만 돈다. FIRESTORE_EMULATOR_HOST 를 설정할 것.');
}

const runtimeEnv = {
  BFF_DEPLOY_ENV: 'live',
  BFF_EDIT_LEASES_ENABLED: 'true',
  BFF_LIVE_FIREBASE_PROJECT_ID: 'demo-axr-e2e',
  VITE_FIREBASE_PROJECT_ID: 'demo-axr-e2e',
  JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'demo-axr-e2e',
  JVM_WEEKLY_API_BASE_URL: JVM,
  JVM_WEEKLY_AUTH_MODE: 'internal_saas_workspace',
  JVM_WEEKLY_INTERNAL_API_TOKEN: TOKEN,
  JVM_WEEKLY_WORKSPACE_EMAIL_DOMAIN: 'mysc.co.kr',
};

function listen(actor: Record<string, string>, db: unknown) {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use((req: any, _res: unknown, next: () => void) => {
    req.context = {
      tenantId: TENANT,
      requestId: `req-${Math.random().toString(16).slice(2)}`,
      idempotencyKey: req.header('idempotency-key') || undefined,
      ...actor,
    };
    next();
  });
  mountJvmWeeklyApiRoutes(app, {
    idempotencyService: {
      async reserve() { return { replayed: false }; },
      async complete() {}, async fail() {},
    },
    fetchImpl: (url: string, init: RequestInit) => fetch(url, init),
    db,
    env: runtimeEnv,
    now: () => new Date('2026-09-10T00:00:00.000Z'),
  });
  return new Promise<{ server: any; base: string }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({
      server, base: `http://127.0.0.1:${(server.address() as any).port}`,
    }));
  });
}

async function call(base: string, method: string, path: string, options: { body?: unknown; key?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.key) headers['idempotency-key'] = options.key;
  const response = await fetch(`${base}${path}`, {
    method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep text */ }
  return { status: response.status, body };
}

describe.skipIf(!enabled)('AXR 프로젝트경비 월결산 end-to-end (BFF -> HTTP -> JVM -> Firestore emulator)', () => {
  it('확정하면 cumulative close head 가 생기고 시트가 잠긴다', async () => {
    const db: any = createFirestoreDb({ projectId: 'demo-axr-e2e' });
    const project = (await db.doc(`orgs/${TENANT}/projects/${PROJECT}`).get()).data();
    const approverUid = String(project.executiveApproverId);
    const approver = (await db.doc(`orgs/${TENANT}/members/${approverUid}`).get()).data();
    const members = await db.collection(`orgs/${TENANT}/members`).get();
    const requesterDoc = members.docs.find((d: any) => {
      const m = d.data() || {};
      return d.id !== approverUid && String(m.status).toUpperCase() === 'ACTIVE';
    });
    const requester = requesterDoc.data();
    // eslint-disable-next-line no-console
    console.log(`요청자 ${requester.name}/${requester.role}  승인자 ${approver.name}/${approver.role}`);

    const asRequester = await listen({
      actorId: requesterDoc.id, actorRole: requester.role || 'pm', actorEmail: requester.email,
    }, db);
    const asApprover = await listen({
      actorId: approverUid, actorRole: approver.role || 'admin', actorEmail: approver.email,
    }, db);

    try {
      const dashboard = await call(asRequester.base, 'GET',
        `/api/v1/cashflow/${PROJECT}/month-close?yearMonth=${YEAR_MONTH}`);
      expect(dashboard.status, JSON.stringify(dashboard.body).slice(0, 400)).toBe(200);
      expect(dashboard.body.status).toBe('OPEN');

      const mirror = (await db.doc(`orgs/${TENANT}/cashflow_sheet_mirrors/${PROJECT}`).get()).data();
      const closeInput = buildCashflowMonthCloseDraftInput({
        mirror: mirror as any,
        yearMonth: YEAR_MONTH,
        humanReviewed: true,
        // 화면이 입금일정 검토에서 만드는 것과 같은 5주차 행. 실데이터에 입금 예정/실적이
        // 없으므로 전부 '해당 없음' 이다.
        depositScheduleRows: [1, 2, 3, 4, 5].map((weekNo) => ({
          weekNo,
          taxInvoiceIssuedDate: '',
          expectedDepositDate: '',
          expectedDepositAmount: null,
          actualDepositDate: '',
          actualDepositAmount: null,
          actualSource: 'NOT_APPLICABLE' as const,
          decision: null,
        })),
        managementChecks: dashboard.body.dashboard?.managementChecks || [],
        deadlineSummary: dashboard.body.dashboard?.deadlineSummary
          || { trackingStartedAt: null, missedCount: 0, completedCount: 0, current: null },
      });

      const created = await call(asRequester.base, 'POST',
        `/api/v1/cashflow/${PROJECT}/month-close/requests`, {
          key: 'e2e-create',
          body: {
            contractVersion: 'cashflow-cumulative-close-v2',
            yearMonth: YEAR_MONTH,
            expectedRevision: dashboard.body.revision,
            expectedApproverUid: approverUid,
            expectedProjectVersion: project.version ?? 0,
            expectedOpeningBalances: dashboard.body.dashboard?.openingBalances,
            closeInput,
          },
        });
      expect(created.status, JSON.stringify(created.body).slice(0, 600)).toBe(202);
      expect(created.body.status).toBe('PENDING');
      // eslint-disable-next-line no-console
      console.log(`요청 생성: rev ${created.body.revision}, ${created.body.monthCount}개월, ${created.body.cellCount}셀`);

      const headBefore = await db.doc(`orgs/${TENANT}/cashflow_cumulative_close_heads/${PROJECT}`).get();
      expect(headBefore.exists).toBe(false);

      const approved = await call(asApprover.base, 'POST',
        `/api/v1/cashflow/${PROJECT}/month-close/requests/${PROJECT}-${YEAR_MONTH}/status-review`, {
          key: 'e2e-approve',
          body: {
            decision: 'APPROVE',
            expectedRevision: created.body.revision,
            expectedManifestHash: created.body.manifestHash,
          },
        });
      expect(approved.status, JSON.stringify(approved.body).slice(0, 800)).toBe(200);
      expect(approved.body.request.status).toBe('APPROVED');
      expect(approved.body.monthClose?.status).toBe('CLOSED');

      const headAfter = await db.doc(`orgs/${TENANT}/cashflow_cumulative_close_heads/${PROJECT}`).get();
      // eslint-disable-next-line no-console
      console.log('cumulative close head:', JSON.stringify(headAfter.data(), null, 2));
      expect(headAfter.exists).toBe(true);
      expect(headAfter.data().closedThrough).toBe('2026-07');
      expect(headAfter.data().status).toBe('CLOSED');
    } finally {
      asRequester.server.close();
      asApprover.server.close();
    }
  }, 180_000);
});
