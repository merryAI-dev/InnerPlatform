#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const YEAR_MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const REQUEST_STATUS = /^(PENDING|PENDING_APPROVAL|APPROVED|REJECTED|WITHDRAWN|REOPEN_REQUESTED|REOPENED)$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function exactHttpsOrigin(value, name) {
  try {
    const url = new URL(text(value));
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error(`${name} must be an exact HTTPS origin.`);
  }
}

function previousYearMonth(value) {
  const [year, month] = value.split('-').map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
}

function positiveInteger(value, name) {
  const raw = text(String(value ?? ''));
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive integer.`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function validateSettlementCandidateCanaryOptions(source) {
  const expectedActions = text(source.expectedActions)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const options = {
    baseUrl: exactHttpsOrigin(source.baseUrl, 'baseUrl'),
    firebaseWebApiKey: text(source.firebaseWebApiKey),
    firebaseRefreshToken: text(source.firebaseRefreshToken),
    tenantId: text(source.tenantId),
    actorUid: text(source.actorUid),
    projectId: text(source.projectId),
    cycleYearMonth: text(source.cycleYearMonth),
    expectedRequestId: text(source.expectedRequestId),
    expectedStatus: text(source.expectedStatus),
    expectedWorkflowRevision: positiveInteger(
      source.expectedWorkflowRevision,
      'expectedWorkflowRevision',
    ),
    expectedEvidenceRevision: positiveInteger(
      source.expectedEvidenceRevision,
      'expectedEvidenceRevision',
    ),
    expectedTargetYearMonth: text(source.expectedTargetYearMonth),
    expectedActions: [...new Set(expectedActions)].sort(),
    protectionBypass: text(source.protectionBypass),
    canonicalOrigin: exactHttpsOrigin(source.canonicalOrigin, 'canonicalOrigin'),
  };
  if (!options.firebaseWebApiKey) throw new Error('firebaseWebApiKey is required.');
  if (!options.firebaseRefreshToken) throw new Error('firebaseRefreshToken is required.');
  if (![options.tenantId, options.actorUid, options.projectId].every((value) => SAFE_ID.test(value))) {
    throw new Error('tenantId, actorUid, and projectId must be exact safe IDs.');
  }
  if (!YEAR_MONTH.test(options.cycleYearMonth)) throw new Error('cycleYearMonth must use YYYY-MM.');
  if (!SAFE_ID.test(options.expectedRequestId)) throw new Error('expectedRequestId must be an exact safe ID.');
  if (!REQUEST_STATUS.test(options.expectedStatus)) throw new Error('expectedStatus is invalid.');
  if (!YEAR_MONTH.test(options.expectedTargetYearMonth)) {
    throw new Error('expectedTargetYearMonth must use YYYY-MM.');
  }
  if (options.expectedActions.length === 0
    || options.expectedActions.length !== expectedActions.length
    || !options.expectedActions.every((value) => SAFE_ID.test(value))) {
    throw new Error('expectedActions must be a unique comma-separated safe ID list.');
  }
  if (options.expectedRequestId !== `${options.projectId}-${options.cycleYearMonth}`) {
    throw new Error('expectedRequestId must equal projectId-cycleYearMonth.');
  }
  if (options.expectedTargetYearMonth !== previousYearMonth(options.cycleYearMonth)) {
    throw new Error('expectedTargetYearMonth must be the previous month of cycleYearMonth.');
  }
  if (!options.protectionBypass) throw new Error('protectionBypass is required.');
  return options;
}

async function readJson(response, label) {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`${label} failed with HTTP ${response.status}.`);
  }
  return body;
}

export async function mintFirebaseCanaryIdToken(options, fetchImpl = fetch) {
  const response = await fetchImpl(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(options.firebaseWebApiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: options.firebaseRefreshToken,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = await readJson(response, 'Firebase canary token exchange');
  if (text(body.user_id) !== options.actorUid || !text(body.id_token)) {
    throw new Error('Firebase canary token identity mismatch.');
  }
  return text(body.id_token);
}

function matchesFixedFixture(request, options) {
  return request !== null
    && text(request?.projectId) === options.projectId
    && text(request?.requestId) === options.expectedRequestId
    && text(request?.status) === options.expectedStatus
    && Number.isSafeInteger(request?.workflowRevision)
    && request.workflowRevision === options.expectedWorkflowRevision
    && Number.isSafeInteger(request?.evidenceRevision)
    && request.evidenceRevision === options.expectedEvidenceRevision
    && text(request?.monthCloseTargetYearMonth) === options.expectedTargetYearMonth
    && text(request?.cycleYearMonth) === options.cycleYearMonth
    && text(request?.documentType) === 'MONTHLY_CLOSE'
    && text(request?.contractVersion) === 'cashflow-cumulative-close-v2';
}

export async function verifyCashflowSettlementCandidate(source, dependencies = {}) {
  const options = validateSettlementCandidateCanaryOptions(source);
  const fetchImpl = dependencies.fetchImpl || fetch;
  const idToken = dependencies.mintIdToken
    ? await dependencies.mintIdToken(options)
    : await mintFirebaseCanaryIdToken(options, fetchImpl);
  if (!text(idToken)) throw new Error('Firebase canary ID token is empty.');
  const request = async (path, label) => {
    const response = await fetchImpl(`${options.baseUrl}${path}`, {
      headers: {
        authorization: `Bearer ${idToken}`,
        origin: options.canonicalOrigin,
        'x-tenant-id': options.tenantId,
        'x-vercel-protection-bypass': options.protectionBypass,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });
    return readJson(response, label);
  };
  const project = encodeURIComponent(options.projectId);
  const cycle = encodeURIComponent(options.cycleYearMonth);
  const detail = await request(
    `/api/v1/cashflow/${project}/month-close?yearMonth=${cycle}`,
    'Settlement detail canary',
  );
  if (text(detail.projectId) !== options.projectId
    || text(detail.yearMonth) !== options.cycleYearMonth
    || text(detail.settlementCycle?.cycleYearMonth) !== options.cycleYearMonth
    || text(detail.settlementCycle?.monthCloseTargetYearMonth) !== options.expectedTargetYearMonth
    || text(detail.settlementCycle?.health) !== 'OK'
    || !detail.actions || typeof detail.actions !== 'object' || Array.isArray(detail.actions)) {
    throw new Error('Settlement candidate canonical read is invalid.');
  }
  if (!matchesFixedFixture(detail.monthState ?? null, options)) {
    throw new Error('Settlement candidate does not match the fixed settlement fixture.');
  }
  const actionEntries = Object.entries(detail.actions)
    .filter(([name]) => name !== 'cumulativeScope');
  const actionDecisions = actionEntries.map(([, decision]) => decision);
  const actionNames = actionEntries.map(([name]) => name).sort();
  if (JSON.stringify(actionNames) !== JSON.stringify(options.expectedActions)
    || actionDecisions.some((decision) => (
    !decision
    || typeof decision !== 'object'
    || Array.isArray(decision)
    || typeof decision.enabled !== 'boolean'
  ))) {
    throw new Error('Settlement candidate actions are invalid.');
  }
  return {
    ok: true,
    projectId: options.projectId,
    cycleYearMonth: options.cycleYearMonth,
    requestPresent: detail.monthState !== null,
  };
}

function optionsFromEnv(env) {
  return {
    baseUrl: env.SETTLEMENT_CANARY_BASE_URL,
    firebaseWebApiKey: env.SETTLEMENT_CANARY_FIREBASE_WEB_API_KEY,
    firebaseRefreshToken: env.SETTLEMENT_CANARY_FIREBASE_REFRESH_TOKEN,
    tenantId: env.SETTLEMENT_CANARY_TENANT_ID,
    actorUid: env.SETTLEMENT_CANARY_ACTOR_UID,
    projectId: env.SETTLEMENT_CANARY_PROJECT_ID,
    cycleYearMonth: env.SETTLEMENT_CANARY_CYCLE_YEAR_MONTH,
    expectedRequestId: env.SETTLEMENT_CANARY_EXPECTED_REQUEST_ID,
    expectedStatus: env.SETTLEMENT_CANARY_EXPECTED_STATUS,
    expectedWorkflowRevision: env.SETTLEMENT_CANARY_EXPECTED_WORKFLOW_REVISION,
    expectedEvidenceRevision: env.SETTLEMENT_CANARY_EXPECTED_EVIDENCE_REVISION,
    expectedTargetYearMonth: env.SETTLEMENT_CANARY_EXPECTED_TARGET_YEAR_MONTH,
    expectedActions: env.SETTLEMENT_CANARY_EXPECTED_ACTIONS,
    protectionBypass: env.VERCEL_AUTOMATION_BYPASS_SECRET,
    canonicalOrigin: env.SETTLEMENT_CANARY_CANONICAL_ORIGIN,
  };
}

async function main() {
  const result = await verifyCashflowSettlementCandidate(optionsFromEnv(process.env));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}
