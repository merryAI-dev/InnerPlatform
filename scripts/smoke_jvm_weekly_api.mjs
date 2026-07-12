#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

const DEPLOY_MODE = 'deploy';
const LEASE_MODE = 'lease';
const STAGE_JVM_SERVICE = 'innerplatform-jvm-weekly-api-lease-stage';
const STAGE_BFF_HOST = 'inner-platform-internal-stage-merryai-devs-projects.vercel.app';
const STAGE_AUTH_PROJECT_ID = 'mysc-bmp-14173451';

function readArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

function readText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function requiredText(value, label) {
  const text = readText(value);
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function stageBaseUrl(raw, mode) {
  let url;
  try {
    url = new URL(requiredText(raw, 'Stage smoke base URL'));
  } catch {
    throw new Error('Stage-only JVM smoke rejected target: invalid URL');
  }
  const cleanPath = url.pathname === '' || url.pathname === '/';
  const clean = url.protocol === 'https:'
    && !url.username
    && !url.password
    && cleanPath
    && !url.search
    && !url.hash;
  const allowedHost = mode === DEPLOY_MODE
    ? url.hostname.startsWith(STAGE_JVM_SERVICE) && url.hostname.endsWith('.run.app')
    : mode === LEASE_MODE && url.hostname === STAGE_BFF_HOST;
  if (!clean || !allowedHost) {
    throw new Error(`Stage-only JVM smoke rejected target for ${mode} mode`);
  }
  return url.origin;
}

function safeId(value, label) {
  const text = requiredText(value, label);
  if (text === '.' || text === '..' || text.includes('/') || text.length > 512) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function responseCode(payload) {
  return readText(payload?.error, payload?.code);
}

async function requestJson(baseUrl, {
  method = 'GET',
  path,
  headers = {},
  body,
  expectedStatuses = [200],
}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    redirect: 'error',
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`Stage smoke request failed: ${method} ${path} returned ${response.status} (${responseCode(payload) || 'unknown'})`);
  }
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runDeploySmoke(baseUrl) {
  const health = await requestJson(baseUrl, { path: '/api/v1/health' });
  assert(health.payload?.ok === true, 'Stage JVM health response is not healthy');
  assert(health.payload?.service === 'jvm-weekly-api', 'Stage JVM health service identity is invalid');

  const authProbe = await requestJson(baseUrl, {
    path: '/api/v1/cashflow/__stage_auth_fail_closed_probe__',
    expectedStatuses: [401, 403],
  });
  assert([401, 403].includes(authProbe.status), 'Stage JVM protected route did not fail closed');
  console.log(JSON.stringify({ ok: true, mode: DEPLOY_MODE, health: true, authFailClosed: true }, null, 2));
}

function actorHeaders({ identityToken, tenantId, actorId, actorRole, actorEmail }) {
  return {
    authorization: `Bearer ${identityToken}`,
    'content-type': 'application/json',
    origin: `https://${STAGE_BFF_HOST}`,
    'x-tenant-id': tenantId,
    'x-actor-id': actorId,
    'x-actor-role': actorRole,
    ...(actorEmail ? { 'x-actor-email': actorEmail } : {}),
  };
}

function commandHeaders(base, sessionId, idempotencyKey, ownership, finalize = false) {
  return {
    ...base,
    'x-edit-session-id': sessionId,
    'idempotency-key': idempotencyKey,
    ...(ownership ? {
      'x-edit-lease-id': ownership.leaseId,
      'x-edit-fence': String(ownership.fence),
    } : {}),
    ...(finalize ? { 'x-edit-finalize': 'true' } : {}),
  };
}

function ownership(payload) {
  assert(payload?.state === 'ACTIVE' && payload?.canEdit === true, 'Stage lease acquisition did not return ownership');
  assert(readText(payload.leaseId), 'Stage lease ID is missing');
  assert(Number.isSafeInteger(payload.fence) && payload.fence > 0, 'Stage lease fence is invalid');
  return { leaseId: payload.leaseId, fence: payload.fence };
}

async function releaseLease(baseUrl, headers, projectId, sessionId, lease, runId) {
  if (!lease) return;
  await requestJson(baseUrl, {
    method: 'POST',
    path: `/api/v1/edit-leases/cashflow/${encodeURIComponent(projectId)}/release`,
    headers: commandHeaders(headers, sessionId, `stage-smoke-release-${runId}-${randomUUID()}`, lease),
    expectedStatuses: [200, 409, 410, 423],
  }).catch(() => undefined);
}

async function runLeaseSmoke(baseUrl) {
  const authProjectId = readText(process.env.JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID);
  if (authProjectId !== STAGE_AUTH_PROJECT_ID) {
    throw new Error(`Stage lease smoke requires Firebase Auth project ${STAGE_AUTH_PROJECT_ID}`);
  }
  const identityToken = requiredText(
    readArg('identity-token') || process.env.JVM_WEEKLY_SMOKE_ID_TOKEN,
    'Stage smoke identity token',
  );
  const tenantId = safeId(readArg('tenant-id') || process.env.JVM_WEEKLY_SMOKE_TENANT_ID, 'Stage smoke tenant ID');
  const actorId = safeId(readArg('actor-id') || process.env.JVM_WEEKLY_SMOKE_ACTOR_ID, 'Stage smoke actor ID');
  const projectId = safeId(readArg('project-id') || process.env.JVM_WEEKLY_SMOKE_PROJECT_ID, 'Stage smoke project ID');
  if (!projectId.startsWith('qa-lease-')) {
    throw new Error('Stage lease smoke project ID must start with qa-lease-');
  }
  const actorRole = readText(readArg('actor-role'), process.env.JVM_WEEKLY_SMOKE_ACTOR_ROLE, 'pm');
  const actorEmail = readText(readArg('actor-email'), process.env.JVM_WEEKLY_SMOKE_ACTOR_EMAIL);
  const yearMonth = readText(readArg('year-month'), process.env.JVM_WEEKLY_SMOKE_YEAR_MONTH, new Date().toISOString().slice(0, 7));
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)) throw new Error('Stage smoke year-month is invalid');

  const runId = readText(readArg('run-id'), process.env.JVM_WEEKLY_SMOKE_RUN_ID, randomUUID().slice(0, 12));
  const sessionA = `stage-smoke-a-${runId}`;
  const sessionB = `stage-smoke-b-${runId}`;
  const headers = actorHeaders({ identityToken, tenantId, actorId, actorRole, actorEmail });
  const leasePath = `/api/v1/edit-leases/cashflow/${encodeURIComponent(projectId)}`;
  const draftPath = `/api/v1/cashflow-edit-drafts/${encodeURIComponent(projectId)}`;
  let leaseA;
  let leaseB;
  let finalized = false;

  try {
    const acquired = await requestJson(baseUrl, {
      method: 'POST',
      path: `${leasePath}/acquire`,
      headers: commandHeaders(headers, sessionA, `stage-smoke-acquire-a-${runId}`),
    });
    leaseA = ownership(acquired.payload);

    const opened = await requestJson(baseUrl, {
      method: 'POST',
      path: `${draftPath}/open`,
      headers: commandHeaders(headers, sessionA, `stage-smoke-draft-open-${runId}`, leaseA),
      body: { baseSnapshot: {}, payload: {} },
    });
    const openedRevision = Number(opened.payload?.draft?.draftRevision);
    assert(Number.isSafeInteger(openedRevision), 'Stage private draft revision is invalid');

    const saved = await requestJson(baseUrl, {
      method: 'PATCH',
      path: draftPath,
      headers: commandHeaders(headers, sessionA, `stage-smoke-draft-save-${runId}`, leaseA),
      body: {
        expectedDraftRevision: openedRevision,
        payload: { smokeRunId: runId, yearMonth, projectionAmount: 1 },
      },
    });
    const savedRevision = Number(saved.payload?.draft?.draftRevision);
    assert(savedRevision === openedRevision + 1, 'Stage private draft did not advance its revision');

    const conflict = await requestJson(baseUrl, {
      method: 'POST',
      path: `${leasePath}/acquire`,
      headers: commandHeaders(headers, sessionB, `stage-smoke-acquire-b-conflict-${runId}`),
      expectedStatuses: [200, 423],
    });
    if (conflict.status === 200) leaseB = ownership(conflict.payload);
    assert(conflict.status === 423 && responseCode(conflict.payload) === 'edit_lease_held', 'Second Stage session did not receive edit_lease_held');

    await requestJson(baseUrl, {
      method: 'POST',
      path: `/api/v1/cashflow/${encodeURIComponent(projectId)}/projection`,
      headers: commandHeaders(headers, sessionA, `stage-smoke-final-${runId}`, leaseA, true),
      body: {
        lines: [{ yearMonth, weekNo: 1, cashflowLine: 'SALES_IN', amount: 1 }],
      },
    });
    finalized = true;

    const completed = await requestJson(baseUrl, {
      method: 'POST',
      path: `${draftPath}/complete`,
      headers: commandHeaders(headers, sessionA, `stage-smoke-draft-complete-${runId}`, leaseA),
      body: { expectedDraftRevision: savedRevision },
    });
    assert(completed.payload?.status === 'SUBMITTED', 'Stage private draft did not complete after final save');

    const reacquired = await requestJson(baseUrl, {
      method: 'POST',
      path: `${leasePath}/acquire`,
      headers: commandHeaders(headers, sessionB, `stage-smoke-acquire-b-after-final-${runId}`),
    });
    leaseB = ownership(reacquired.payload);
    await releaseLease(baseUrl, headers, projectId, sessionB, leaseB, runId);
    leaseB = null;

    console.log(JSON.stringify({
      ok: true,
      mode: LEASE_MODE,
      projectId,
      privateDraftSaved: true,
      secondSessionBlocked: true,
      finalLeaseReleased: true,
    }, null, 2));
  } finally {
    await releaseLease(baseUrl, headers, projectId, sessionB, leaseB, runId);
    if (!finalized) await releaseLease(baseUrl, headers, projectId, sessionA, leaseA, runId);
  }
}

async function main() {
  const mode = readText(readArg('mode'), process.env.JVM_WEEKLY_SMOKE_MODE, DEPLOY_MODE);
  if (![DEPLOY_MODE, LEASE_MODE].includes(mode)) throw new Error('Stage JVM smoke mode must be deploy or lease');
  const rawBaseUrl = readText(readArg('base-url'), process.env.JVM_WEEKLY_SMOKE_URL, process.env.JVM_WEEKLY_API_BASE_URL);
  const baseUrl = stageBaseUrl(rawBaseUrl, mode);
  if (mode === DEPLOY_MODE) await runDeploySmoke(baseUrl);
  else await runLeaseSmoke(baseUrl);
}

main().catch((error) => {
  console.error(`[smoke-jvm-weekly-api] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
