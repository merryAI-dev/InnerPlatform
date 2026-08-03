import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  AXR_MONTH_CLOSE_QA_PROJECT_ID,
  AXR_MONTH_CLOSE_QA_PROJECT_NAME,
  AXR_MONTH_CLOSE_QA_ENABLED,
  mountAxrMonthCloseQaRoutes,
  resolveAxrMonthCloseQaActions,
} from './axr-month-close-qa.mjs';

function createApp({ enabled = true, role = 'admin', documents = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = { tenantId: 'tenant-a', actorId: 'actor-a', actorRole: role };
    next();
  });
  const db = {
    doc(path) {
      return { get: async () => ({ exists: Object.hasOwn(documents, path), data: () => documents[path] }) };
    },
  };
  mountAxrMonthCloseQaRoutes(app, { db, enabled });
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code, message: error.message }));
  return app;
}

describe('AXR month-close QA server policy', () => {
  it('keeps the temporary live QA enable flag explicit in the removable server file', () => {
    expect(AXR_MONTH_CLOSE_QA_ENABLED).toBe(true);
  });

  it('keeps in-flight requests read-only and uses existing audited transitions', () => {
    expect(resolveAxrMonthCloseQaActions({ requestStatus: 'PENDING', closeStatus: 'OPEN', isDesignatedApprover: true, role: 'finance' })).toEqual(['APPROVE_REQUEST', 'REJECT_REQUEST', 'REFRESH']);
    expect(resolveAxrMonthCloseQaActions({ requestStatus: 'PENDING', closeStatus: 'OPEN', isDesignatedApprover: false, role: 'admin' })).toEqual(['REFRESH']);
    expect(resolveAxrMonthCloseQaActions({ requestStatus: 'APPROVING', closeStatus: 'OPEN', isDesignatedApprover: true, role: 'admin' })).toEqual(['REFRESH']);
    expect(resolveAxrMonthCloseQaActions({ requestStatus: 'UNCERTAIN', closeStatus: 'OPEN', isDesignatedApprover: true, role: 'admin' })).toEqual(['REFRESH']);
    expect(resolveAxrMonthCloseQaActions({ requestStatus: null, closeStatus: 'CLOSED', isDesignatedApprover: false, role: 'finance' })).toEqual(['REQUEST_REOPEN', 'REFRESH']);
    expect(resolveAxrMonthCloseQaActions({ requestStatus: null, closeStatus: 'REOPEN_REQUESTED', isDesignatedApprover: false, role: 'admin' })).toEqual(['APPROVE_REOPEN', 'REJECT_REOPEN', 'REFRESH']);
  });

  it('keeps the target identifier explicit and removable', () => {
    expect(AXR_MONTH_CLOSE_QA_PROJECT_ID).toBe('p1773817948751');
  });

  it('returns controls only for the exact project and derives actions from persisted state', async () => {
    const projectId = AXR_MONTH_CLOSE_QA_PROJECT_ID;
    const requestId = `${projectId}-2026-07`;
    const response = await request(createApp({ documents: {
      [`orgs/tenant-a/projects/${projectId}`]: { name: AXR_MONTH_CLOSE_QA_PROJECT_NAME, executiveApproverId: 'actor-a' },
      [`orgs/tenant-a/cashflow_month_close_requests/${requestId}`]: { status: 'PENDING', revision: 2, manifestHash: 'sha256:manifest', approverUid: 'actor-a' },
      [`orgs/tenant-a/monthly_closes/${requestId}`]: { status: 'OPEN', revision: 4 },
      [`orgs/tenant-a/cashflow_cumulative_close_heads/${projectId}`]: { closedThrough: '2026-06', revision: 3, rootHash: 'sha256:root' },
    } })).get(`/api/v1/qa/axr-month-close/${projectId}/control?yearMonth=2026-07`);
    expect(response.status).toBe(200);
    expect(response.body.allowedActions).toEqual(['APPROVE_REQUEST', 'REJECT_REQUEST', 'REFRESH']);
    expect(response.body.confirmationToken).toBe(`${AXR_MONTH_CLOSE_QA_PROJECT_NAME} / 2026-07 / r4`);
  });

  it('fails closed when disabled, unauthorized, or given a lookalike project', async () => {
    const path = `/api/v1/qa/axr-month-close/${AXR_MONTH_CLOSE_QA_PROJECT_ID}/control?yearMonth=2026-07`;
    expect((await request(createApp({ enabled: false })).get(path)).status).toBe(404);
    expect((await request(createApp({ role: 'pm' })).get(path)).status).toBe(403);
    expect((await request(createApp({ documents: {
      [`orgs/tenant-a/projects/${AXR_MONTH_CLOSE_QA_PROJECT_ID}`]: { name: `${AXR_MONTH_CLOSE_QA_PROJECT_NAME} 복사본` },
    } })).get(path)).status).toBe(404);
    expect((await request(createApp({ role: 'finance', documents: {
      [`orgs/tenant-a/projects/${AXR_MONTH_CLOSE_QA_PROJECT_ID}`]: { name: `${AXR_MONTH_CLOSE_QA_PROJECT_NAME} ` },
    } })).get(path)).status).toBe(404);
    expect((await request(createApp({ role: 'admin', documents: {
      [`orgs/tenant-a/projects/${AXR_MONTH_CLOSE_QA_PROJECT_ID}`]: { name: ` ${AXR_MONTH_CLOSE_QA_PROJECT_NAME}` },
    } })).get(path)).status).toBe(404);
  });
});
