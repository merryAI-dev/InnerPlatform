import {
  asyncHandler,
  assertActorRoleAllowed,
  createHttpError,
  readOptionalText,
  ROUTE_ROLES,
} from '../bff-utils.mjs';
import { GoogleAuth } from 'google-auth-library';
import {
  buildCashflowProjectionActualComparison,
  resolveCashflowComparisonAsOf,
} from '../cashflow-comparison.mjs';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from '../cashflow-policy.mjs';
import { stableStringify } from '../utils.mjs';
import { getMonthFinanceWeeks } from '../../../src/app/platform/cashflow-week-core.mjs';

const CASHFLOW_MANAGEMENT_CHECK_IDS = [
  'labor-transfer',
  'profit-vat-after-deposit',
  'negative-projection-balance',
  'future-prepay-over-million',
];

function resolveJavaWeeklyApiBaseUrl(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiBaseUrl)
    || readOptionalText(env.JVM_WEEKLY_API_BASE_URL)
    || readOptionalText(env.WEEKLY_API_BASE_URL);
}

function resolveJavaWeeklyApiServiceToken(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiServiceToken)
    || readOptionalText(env.JVM_WEEKLY_INTERNAL_API_TOKEN)
    || readOptionalText(env.WEEKLY_API_INTERNAL_TOKEN);
}

function resolveJavaWeeklyApiIdTokenAudience(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiIdTokenAudience)
    || readOptionalText(env.JVM_WEEKLY_API_ID_TOKEN_AUDIENCE)
    || readOptionalText(env.WEEKLY_API_ID_TOKEN_AUDIENCE);
}

function resolveJavaWeeklyApiServiceAccountJson(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiServiceAccountJson)
    || readOptionalText(env.JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON)
    || readOptionalText(env.WEEKLY_API_SERVICE_ACCOUNT_JSON);
}

function resolveJavaWeeklyAuthMode(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyAuthMode)
    || readOptionalText(env.JVM_WEEKLY_AUTH_MODE)
    || readOptionalText(env.WEEKLY_AUTH_MODE)
    || 'strict';
}

function resolveJavaWeeklyWorkspaceEmailDomain(options = {}, env = process.env) {
  const raw = readOptionalText(options.jvmWeeklyWorkspaceEmailDomain)
    || readOptionalText(env.JVM_WEEKLY_WORKSPACE_EMAIL_DOMAIN)
    || readOptionalText(env.WEEKLY_WORKSPACE_EMAIL_DOMAIN)
    || 'mysc.co.kr';
  return raw.replace(/^@+/, '').toLowerCase();
}

function resolveJavaWeeklyFirestoreProjectId(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyFirestoreProjectId)
    || readOptionalText(env.JVM_WEEKLY_FIRESTORE_PROJECT_ID)
    || readOptionalText(env.WEEKLY_FIRESTORE_PROJECT_ID);
}

function resolveBffDataProjectId(env = process.env) {
  return readOptionalText(env.FIREBASE_PROJECT_ID)
    || readOptionalText(env.VITE_FIREBASE_PROJECT_ID)
    || readOptionalText(env.GCLOUD_PROJECT)
    || readOptionalText(env.GOOGLE_CLOUD_PROJECT);
}

function isWorkspaceAuthMode(authMode) {
  const normalized = readOptionalText(authMode).toLowerCase();
  return normalized === 'internal_saas_workspace' || normalized === 'workspace';
}

async function fetchCredentialIdentityToken(audience, serviceAccountJson) {
  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    throw createHttpError(503, 'JVM weekly API invoker credential is invalid.', 'jvm_weekly_api_identity_token_unavailable');
  }
  try {
    const auth = new GoogleAuth({ credentials });
    const client = await auth.getIdTokenClient(audience);
    const authorization = readOptionalText((await client.getRequestHeaders()).Authorization);
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('Missing identity token');
    return token;
  } catch {
    throw createHttpError(503, 'JVM weekly API identity token could not be resolved.', 'jvm_weekly_api_identity_token_unavailable');
  }
}

async function fetchGoogleIdentityToken(fetchImpl, audience, serviceAccountJson, resolveIdentityToken) {
  if (!audience) return '';
  if (serviceAccountJson) {
    if (typeof resolveIdentityToken === 'function') {
      const token = await resolveIdentityToken({ audience, serviceAccountJson });
      if (!readOptionalText(token)) {
        throw createHttpError(503, 'JVM weekly API identity token could not be resolved.', 'jvm_weekly_api_identity_token_unavailable');
      }
      return String(token).trim();
    }
    return fetchCredentialIdentityToken(audience, serviceAccountJson);
  }
  const tokenUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`;
  const response = await fetchImpl(tokenUrl, {
    method: 'GET',
    headers: { 'Metadata-Flavor': 'Google' },
  });
  const token = await response.text();
  if (!response.ok || !readOptionalText(token)) {
    throw createHttpError(503, 'JVM weekly API identity token could not be resolved.', 'jvm_weekly_api_identity_token_unavailable');
  }
  return token.trim();
}

async function buildTrustedHeaders({
  fetchImpl,
  context,
  serviceToken,
  idTokenAudience,
  serviceAccountJson,
  resolveIdentityToken,
  authMode,
  workspaceEmailDomain,
  editSession,
  dataProjectId,
}) {
  if (!serviceToken) {
    throw createHttpError(503, 'JVM weekly API service token is not configured.', 'jvm_weekly_api_token_unconfigured');
  }
  const actorRole = isWorkspaceAuthMode(authMode) && isWorkspaceUser(context, workspaceEmailDomain) ? 'workspace_user' : context.actorRole || '';
  const headers = {
    'content-type': 'application/json',
    'x-inner-platform-service-token': serviceToken,
    'x-tenant-id': context.tenantId,
    'x-actor-id': context.actorId,
    'x-actor-role': actorRole,
  };
  if (context.actorEmail) {
    headers['x-actor-email'] = context.actorEmail;
  }
  if (context.actorName) {
    headers['x-actor-name'] = encodeURIComponent(context.actorName);
  }
  if (dataProjectId) headers['x-data-project-id'] = dataProjectId;
  if (editSession) {
    headers['x-edit-session-id'] = editSession.sessionId;
    headers['x-edit-lease-id'] = editSession.leaseId;
    headers['x-edit-fence'] = String(editSession.fence);
    if (editSession.finalize === true) headers['x-edit-finalize'] = 'true';
  }
  const identityToken = await fetchGoogleIdentityToken(fetchImpl, idTokenAudience, serviceAccountJson, resolveIdentityToken);
  if (identityToken) {
    headers.authorization = `Bearer ${identityToken}`;
  }
  return headers;
}

function readJavaError(status, payload) {
  const message = readOptionalText(payload?.message) || readOptionalText(payload?.error) || `Java weekly API request failed with ${status}`;
  const code = readOptionalText(payload?.code) || readOptionalText(payload?.error) || 'java_weekly_api_error';
  const error = createHttpError(status, message, code);
  if (Number.isSafeInteger(payload?.expectedWriteCount)) {
    error.details = { expectedWriteCount: payload.expectedWriteCount };
  }
  return error;
}

async function proxyJavaWeeklyJson({
  fetchImpl,
  baseUrl,
  serviceToken,
  idTokenAudience,
  serviceAccountJson,
  resolveIdentityToken,
  authMode,
  workspaceEmailDomain,
  context,
  method,
  path,
  body,
  editSession,
  dataProjectId,
}) {
  if (!baseUrl) {
    throw createHttpError(503, 'JVM weekly API base URL is not configured.', 'jvm_weekly_api_unconfigured');
  }
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: await buildTrustedHeaders({
      fetchImpl,
      context,
      serviceToken,
      idTokenAudience,
      serviceAccountJson,
      resolveIdentityToken,
      authMode,
      workspaceEmailDomain,
      editSession,
      dataProjectId,
    }),
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    throw readJavaError(response.status, payload);
  }
  return payload;
}

function commandBody(req) {
  const body = {
    ...(req.body && typeof req.body === 'object' ? req.body : {}),
    idempotencyKey: req.context.idempotencyKey,
  };
  delete body.actor;
  delete body.tenantId;
  delete body.actorRole;
  delete body.dataProjectId;
  delete body.sourceSheetKey;
  return body;
}

function privateCashflowDraftId(projectId, actorId) {
  return `v1_${Buffer.from(JSON.stringify(['cashflow', projectId, actorId]), 'utf8').toString('base64url')}`;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parseAuditMetadata(value) {
  try {
    return objectValue(JSON.parse(readOptionalText(value) || '{}')) || {};
  } catch {
    return {};
  }
}

async function readCashflowActivityDocuments(db, tenantId, collectionId, projectId) {
  if (!db?.collection) return [];
  const snap = await db.collection(`orgs/${tenantId}/${collectionId}`)
    .where('projectId', '==', projectId)
    .limit(200)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

async function readCashflowActivity(db, tenantId, projectId) {
  const [refreshRuns, monthlyAudits, legacyEvents] = await Promise.all([
    readCashflowActivityDocuments(db, tenantId, 'cashflow_sheet_refresh_runs', projectId),
    readCashflowActivityDocuments(db, tenantId, 'weekly_api_audit_events', projectId),
    readCashflowActivityDocuments(db, tenantId, 'cashflow_events', projectId),
  ]);
  const refreshEvents = refreshRuns
    .filter((run) => readOptionalText(run.status) === 'COMPLETED' && readOptionalText(run.response?.status) === 'FRESH')
    .map((run) => ({
      id: `sheet-refresh:${run.id}`,
      projectId,
      runId: readOptionalText(run.idempotencyKey) || run.id,
      type: 'sheet_refresh',
      source: 'google_sheet_refresh',
      actorUid: readOptionalText(run.createdBy?.uid),
      actorName: readOptionalText(run.createdBy?.name),
      actorEmail: readOptionalText(run.createdBy?.email),
      createdAt: readOptionalText(run.completedAt) || readOptionalText(run.createdAt),
      sheetName: readOptionalText(run.response?.selectedSheetName),
    }));
  const closeEvents = monthlyAudits
    .filter((audit) => readOptionalText(audit.commandName).startsWith('cashflowMonth.'))
    .map((audit) => {
      const metadata = parseAuditMetadata(audit.metadataJson);
      return {
        id: `month-close:${audit.id}`,
        projectId,
        runId: readOptionalText(audit.idempotencyKey) || audit.id,
        type: 'month_close',
        source: 'month_close',
        yearMonth: readOptionalText(metadata.yearMonth),
        status: readOptionalText(metadata.status),
        actorUid: readOptionalText(audit.actorId),
        actorEmail: readOptionalText(metadata.actorEmail),
        actorName: readOptionalText(metadata.actorName),
        createdAt: readOptionalText(audit.createdAt),
      };
    });
  return [...legacyEvents, ...refreshEvents, ...closeEvents]
    .filter((event) => readOptionalText(event.createdAt))
    .sort((left, right) => readOptionalText(right.createdAt).localeCompare(readOptionalText(left.createdAt)))
    .slice(0, 200);
}

function safeAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : 0;
}

function normalizeMonthCloseCell(cell, yearMonth) {
  const value = objectValue(cell);
  if (!value) return null;
  const mode = readOptionalText(value.mode).toLowerCase();
  const weekNo = Number(value.weekNo);
  const cashflowLine = readOptionalText(value.cashflowLine) || readOptionalText(value.lineId);
  const cellState = readOptionalText(value.cellState) || readOptionalText(value.state);
  if (
    !['projection', 'actual'].includes(mode)
    || !Number.isSafeInteger(weekNo)
    || weekNo < 1
    || weekNo > 5
    || !CASHFLOW_ALL_LINES.includes(cashflowLine)
    || !['VALUE', 'EMPTY'].includes(cellState)
    || (readOptionalText(value.yearMonth) && readOptionalText(value.yearMonth) !== yearMonth)
  ) return null;
  const amount = cellState === 'VALUE' ? Number(value.amount) : null;
  if (cellState === 'VALUE' && !Number.isSafeInteger(amount)) return null;
  return {
    mode,
    weekNo,
    cashflowLine,
    cellState,
    amount,
    sourceCell: readOptionalText(value.sourceCell) || null,
    sourceLabel: readOptionalText(value.sourceLabel) || null,
  };
}

function normalizeMonthCloseCells(cells, yearMonth) {
  return (Array.isArray(cells) ? cells : [])
    .map((cell) => normalizeMonthCloseCell(cell, yearMonth))
    .filter(Boolean);
}

function completeMonthCloseCells(cells) {
  if (cells.length !== CASHFLOW_ALL_LINES.length * 2 * 5) return false;
  const keys = new Set(cells.map((cell) => `${cell.mode}:${cell.weekNo}:${cell.cashflowLine}`));
  return keys.size === CASHFLOW_ALL_LINES.length * 2 * 5;
}

function sumSafe(values) {
  let total = 0;
  for (const value of values) {
    const next = total + safeAmount(value);
    if (!Number.isSafeInteger(next)) return null;
    total = next;
  }
  return total;
}

function buildMonthModeReadModel(cells, mode) {
  const rowTotals = Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [lineId, 0]));
  let runningIn = 0;
  let runningOut = 0;
  const weeks = Array.from({ length: 5 }, (_, index) => {
    const weekNo = index + 1;
    const amounts = Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => {
      const cell = cells.find((candidate) => (
        candidate.mode === mode && candidate.weekNo === weekNo && candidate.cashflowLine === lineId
      ));
      return [lineId, cell?.cellState === 'VALUE' ? safeAmount(cell.amount) : 0];
    }));
    for (const lineId of CASHFLOW_ALL_LINES) rowTotals[lineId] += amounts[lineId];
    const weekIn = sumSafe(CASHFLOW_IN_LINES.map((lineId) => amounts[lineId]));
    const weekOut = sumSafe(CASHFLOW_OUT_LINES.map((lineId) => amounts[lineId]));
    if (weekIn === null || weekOut === null) return null;
    runningIn += weekIn;
    runningOut += weekOut;
    return { weekNo, amounts, totalIn: weekIn, totalOut: weekOut, net: runningIn - runningOut, weekIn, weekOut };
  });
  if (weeks.some((week) => week === null) || !Number.isSafeInteger(runningIn) || !Number.isSafeInteger(runningOut)) {
    return null;
  }
  return {
    rowTotals,
    weeks,
    monthTotals: { totalIn: runningIn, totalOut: runningOut, net: runningIn - runningOut },
  };
}

function monthWeeksFromCells(cells, yearMonth) {
  const modes = {
    projection: buildMonthModeReadModel(cells, 'projection'),
    actual: buildMonthModeReadModel(cells, 'actual'),
  };
  return Array.from({ length: 5 }, (_, index) => {
    const weekNo = index + 1;
    const financeWeek = getMonthFinanceWeeks(yearMonth).find((week) => week.weekNo === weekNo) || {};
    return {
      yearMonth,
      weekNo,
      weekStart: financeWeek.weekStart || '',
      weekEnd: financeWeek.weekEnd || '',
      projection: modes.projection?.weeks?.find((week) => week.weekNo === weekNo)?.amounts || {},
      actual: modes.actual?.weeks?.find((week) => week.weekNo === weekNo)?.amounts || {},
    };
  });
}

function canonicalPinnedSheetWeeks(pinnedSheetCells) {
  const cellsByMonth = new Map();
  for (const sourceCell of Array.isArray(pinnedSheetCells) ? pinnedSheetCells : []) {
    const source = objectValue(sourceCell);
    const yearMonth = readOptionalText(source?.yearMonth);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)) continue;
    const cell = normalizeMonthCloseCell(source, yearMonth);
    if (!cell) continue;
    const monthCells = cellsByMonth.get(yearMonth) || [];
    monthCells.push(cell);
    cellsByMonth.set(yearMonth, monthCells);
  }
  return [...cellsByMonth.entries()]
    .filter(([, monthCells]) => completeMonthCloseCells(monthCells))
    .flatMap(([yearMonth, monthCells]) => monthWeeksFromCells(monthCells, yearMonth))
    .sort((left, right) => cashflowRangeSortKey(left) - cashflowRangeSortKey(right));
}

function canonicalCashflowWeeks(cashflow, cells, yearMonth, pinnedSheetCells) {
  const pinnedWeeks = canonicalPinnedSheetWeeks(pinnedSheetCells);
  if (pinnedWeeks.length > 0) {
    const byKey = new Map(pinnedWeeks.map((week) => [`${week.yearMonth}:${week.weekNo}`, week]));
    if (completeMonthCloseCells(cells)) {
      for (const week of monthWeeksFromCells(cells, yearMonth)) byKey.set(`${yearMonth}:${week.weekNo}`, week);
    }
    return [...byKey.values()].sort((left, right) => cashflowRangeSortKey(left) - cashflowRangeSortKey(right));
  }
  const byKey = new Map();
  for (const month of Array.isArray(cashflow?.readModel?.months) ? cashflow.readModel.months : []) {
    const monthKey = readOptionalText(month?.yearMonth);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(monthKey)) continue;
    const financeWeeks = getMonthFinanceWeeks(monthKey);
    for (let weekNo = 1; weekNo <= 5; weekNo += 1) {
      const financeWeek = financeWeeks.find((week) => week.weekNo === weekNo) || {};
      byKey.set(`${monthKey}:${weekNo}`, {
        yearMonth: monthKey,
        weekNo,
        weekStart: financeWeek.weekStart || '',
        weekEnd: financeWeek.weekEnd || '',
        projection: month?.projection?.weeks?.find((week) => Number(week?.weekNo) === weekNo)?.amounts || {},
        actual: month?.actual?.weeks?.find((week) => Number(week?.weekNo) === weekNo)?.amounts || {},
      });
    }
  }
  if (completeMonthCloseCells(cells)) {
    for (const week of monthWeeksFromCells(cells, yearMonth)) byKey.set(`${yearMonth}:${week.weekNo}`, week);
  }
  return [...byKey.values()].sort((left, right) => (
    cashflowRangeSortKey(left) - cashflowRangeSortKey(right)
  ));
}

function cashflowCellKey(yearMonth, cell) {
  return `${yearMonth}:${cell.mode}:${cell.weekNo}:${cell.cashflowLine}`;
}

function canonicalCashflowCellStates(cells, yearMonth, pinnedSheetCells) {
  const byKey = new Map();
  for (const sourceCell of Array.isArray(pinnedSheetCells) ? pinnedSheetCells : []) {
    const source = objectValue(sourceCell);
    const sourceYearMonth = readOptionalText(source?.yearMonth);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(sourceYearMonth)) continue;
    const cell = normalizeMonthCloseCell(source, sourceYearMonth);
    if (cell) byKey.set(cashflowCellKey(sourceYearMonth, cell), cell);
  }
  for (const cell of Array.isArray(cells) ? cells : []) {
    if (cell) byKey.set(cashflowCellKey(yearMonth, cell), cell);
  }
  return byKey;
}

function managementCheck(id, status, title, detail, findings = []) {
  return findings.length > 0 ? { id, status, title, detail, findings } : { id, status, title, detail };
}

function laborTransferCheck(weeks, cellStates, yearMonth, asOfKey) {
  const yearMonths = [...new Set([yearMonth, ...weeks.map((week) => readOptionalText(week.yearMonth))])].sort();
  const warnings = [];
  const reviews = [];
  for (const yearMonth of yearMonths) {
    if (cashflowRangeSortKey({ yearMonth, weekNo: 3 }) > asOfKey) continue;
    const projection = cellStates.get(`${yearMonth}:projection:3:MYSC_LABOR_OUT`);
    if (!projection || projection.cellState === 'EMPTY') {
      warnings.push(`${yearMonth} 3주차 · Projection 인건비 미기입`);
      continue;
    }
    const plannedAmount = safeAmount(projection.amount);
    if (plannedAmount === 0) {
      reviews.push(`${yearMonth} 3주차 · Projection 0원 입력 · 이관 대상 없음 확인 필요`);
      continue;
    }
    const actual = cellStates.get(`${yearMonth}:actual:3:MYSC_LABOR_OUT`);
    if (!actual || actual.cellState === 'EMPTY') {
      warnings.push(`${yearMonth} 3주차 · 예정 ${plannedAmount.toLocaleString('ko-KR')}원 · Actual 인건비 미기입`);
      continue;
    }
    const actualAmount = safeAmount(actual.amount);
    if (actualAmount === 0) {
      warnings.push(`${yearMonth} 3주차 · 예정 ${plannedAmount.toLocaleString('ko-KR')}원 · 실제 0원 · 실제 미이관`);
    } else if (actualAmount < plannedAmount) {
      warnings.push(`${yearMonth} 3주차 · 예정 ${plannedAmount.toLocaleString('ko-KR')}원 · 실제 ${actualAmount.toLocaleString('ko-KR')}원 · 일부 이관`);
    }
  }
  const findings = warnings.length > 0 ? warnings : reviews;
  return managementCheck(
    'labor-transfer',
    warnings.length > 0 ? 'WARNING' : reviews.length > 0 ? 'REVIEW_REQUIRED' : 'OK',
    'MYSC 인건비 이관',
    findings.length > 0 ? findings.join(', ') : '기준일까지 모든 3주차 인건비 이관을 확인했습니다.',
    findings,
  );
}

function profitVatAfterDepositCheck(weeks, deposits, asOfKey) {
  const byKey = new Map(weeks.map((week, index) => [`${week.yearMonth}:${week.weekNo}`, { week, index }]));
  const due = [];
  for (const deposit of Array.isArray(deposits) ? deposits : []) {
    if (!readOptionalText(deposit?.actualDepositDate) || safeAmount(deposit?.actualDepositAmount) <= 0) continue;
    const key = `${readOptionalText(deposit.yearMonth)}:${Number(deposit.weekNo)}`;
    const current = byKey.get(key);
    const candidate = current ? weeks[current.index + 1] : null;
    const calendarGapMs = candidate && current?.week?.weekEnd && candidate.weekStart
      ? Date.parse(`${candidate.weekStart}T00:00:00Z`) - Date.parse(`${current.week.weekEnd}T00:00:00Z`)
      : Number.POSITIVE_INFINITY;
    const target = candidate && calendarGapMs <= 8 * 86_400_000 ? candidate : null;
    if (!target) {
      due.push(`${readOptionalText(deposit.yearMonth)} ${Number(deposit.weekNo)}주차 입금의 다음 주차 원장 없음`);
      continue;
    }
    const targetKey = cashflowRangeSortKey(target);
    const missing = [
      safeAmount(target.actual?.MYSC_PROFIT_OUT) > 0 ? null : 'MYSC 수익',
      safeAmount(target.actual?.SALES_VAT_OUT) > 0 ? null : '매출부가세',
    ].filter(Boolean);
    if (targetKey <= asOfKey && missing.length > 0) due.push(`${target.yearMonth} ${target.weekNo}주차 ${missing.join('·')}`);
  }
  const actualDeposits = (Array.isArray(deposits) ? deposits : []).filter((row) => (
    readOptionalText(row?.actualDepositDate) && safeAmount(row?.actualDepositAmount) > 0
  ));
  if (actualDeposits.length === 0) {
    return managementCheck('profit-vat-after-deposit', 'REVIEW_REQUIRED', '입금 후 MYSC 수익·매출부가세 이관', '실제 입금 확인 건이 없습니다. 해당 없음 여부를 사람이 확인해 주세요.');
  }
  return managementCheck(
    'profit-vat-after-deposit',
    due.length > 0 ? 'WARNING' : 'OK',
    '입금 후 MYSC 수익·매출부가세 이관',
    due.length > 0 ? `다음 주차까지 미이관: ${due.join(', ')}` : '실제 입금 건의 다음 주차 이관을 확인했습니다.',
    due,
  );
}

function negativeProjectionCheck(weeks) {
  let balance = 0;
  let prepay = 0;
  const findings = [];
  for (const week of weeks) {
    const totalIn = sumSafe(CASHFLOW_IN_LINES.map((lineId) => week.projection?.[lineId])) || 0;
    const totalOut = sumSafe(CASHFLOW_OUT_LINES.map((lineId) => week.projection?.[lineId])) || 0;
    balance += totalIn - totalOut;
    prepay += safeAmount(week.projection?.MYSC_PREPAY_IN);
    if (balance < 0) {
      findings.push(`${week.yearMonth} ${week.weekNo}주차 · ${balance.toLocaleString('ko-KR')}원${prepay > 0 ? '' : ' · MYSC 선입금 Projection 없음'}`);
    }
  }
  if (findings.length > 0) {
    return managementCheck(
      'negative-projection-balance',
      'WARNING',
      'Projection 잔액 마이너스',
      `${findings.length}개 주차에서 마이너스 · 최초 ${findings[0]}`,
      findings,
    );
  }
  return managementCheck('negative-projection-balance', 'OK', 'Projection 잔액 마이너스', 'Projection 누적 잔액이 0원 이상입니다.');
}

function futurePrepayCheck(weeks, asOfKey) {
  const occurrences = weeks.filter((week) => (
    cashflowRangeSortKey(week) > asOfKey && safeAmount(week.projection?.MYSC_PREPAY_IN) > 1_000_000
  ));
  return managementCheck(
    'future-prepay-over-million',
    occurrences.length > 0 ? 'WARNING' : 'OK',
    '금주 이후 선입금 요청 100만원 초과',
    occurrences.length > 0
      ? occurrences.map((week) => `${week.yearMonth} ${week.weekNo}주차 ${safeAmount(week.projection?.MYSC_PREPAY_IN).toLocaleString('ko-KR')}원`).join(', ')
      : '금주 이후 100만원 초과 요청이 없습니다.',
    occurrences.map((week) => `${week.yearMonth} ${week.weekNo}주차 · ${safeAmount(week.projection?.MYSC_PREPAY_IN).toLocaleString('ko-KR')}원`),
  );
}

export function buildCashflowManagementChecks({ cashflow, cells, yearMonth, depositScheduleRows, comparisonBoundary, pinnedSheetCells }) {
  const weeks = canonicalCashflowWeeks(cashflow, cells, yearMonth, pinnedSheetCells);
  const cellStates = canonicalCashflowCellStates(cells, yearMonth, pinnedSheetCells);
  const asOfKey = cashflowRangeSortKey(comparisonBoundary?.asOfWeek || { yearMonth, weekNo: 5 });
  const deposits = (Array.isArray(depositScheduleRows) ? depositScheduleRows : []).map((row) => ({
    ...row,
    yearMonth: /^20\d{2}-(0[1-9]|1[0-2])$/.test(readOptionalText(row?.yearMonth)) ? row.yearMonth : yearMonth,
  }));
  return [
    laborTransferCheck(weeks, cellStates, yearMonth, asOfKey),
    profitVatAfterDepositCheck(weeks, deposits, asOfKey),
    negativeProjectionCheck(weeks),
    futurePrepayCheck(weeks, asOfKey),
  ];
}

function validManagementConfirmations(confirmations) {
  const byId = new Map();
  for (const item of Array.isArray(confirmations) ? confirmations : []) {
    const checkId = readOptionalText(item?.checkId);
    const decision = readOptionalText(item?.decision).toUpperCase();
    if (!CASHFLOW_MANAGEMENT_CHECK_IDS.includes(checkId) || !['CONFIRMED', 'NOT_APPLICABLE'].includes(decision)) continue;
    byId.set(checkId, { checkId, decision });
  }
  return byId;
}

function completeManagementConfirmations(confirmations) {
  return validManagementConfirmations(confirmations).size === CASHFLOW_MANAGEMENT_CHECK_IDS.length;
}

function matchingManagementChecks(expected, actual) {
  const select = (items) => (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: readOptionalText(item?.id),
      status: readOptionalText(item?.status),
      title: readOptionalText(item?.title),
      detail: readOptionalText(item?.detail),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return select(expected).length === CASHFLOW_MANAGEMENT_CHECK_IDS.length
    && stableStringify(select(expected)) === stableStringify(select(actual));
}

function actualWrittenProgressPercent(cells, yearMonth, comparisonBoundary) {
  const asOfYearMonth = readOptionalText(comparisonBoundary?.asOfWeek?.yearMonth);
  const asOfWeekNo = Number(comparisonBoundary?.asOfWeek?.weekNo);
  const targetWeekCount = yearMonth < asOfYearMonth ? 5 : yearMonth === asOfYearMonth ? Math.max(0, Math.min(5, asOfWeekNo)) : 0;
  if (targetWeekCount === 0) return 0;
  const target = cells.filter((cell) => cell.mode === 'actual' && cell.weekNo <= targetWeekCount);
  if (target.length === 0) return 0;
  return Math.round((target.filter((cell) => cell.cellState === 'VALUE').length / target.length) * 10_000) / 100;
}

function postCloseAdjustment(close, currentSnapshot) {
  const previous = objectValue(close?.previousSnapshot);
  if (!previous || Object.keys(previous).length === 0) return null;
  const amounts = (snapshot) => {
    const result = new Map();
    for (const week of Array.isArray(snapshot?.weeklyTotals) ? snapshot.weeklyTotals : []) {
      const weekNo = Number(week?.weekNo);
      for (const mode of ['projection', 'actual']) {
        const values = objectValue(week?.[mode]) || {};
        for (const lineId of CASHFLOW_ALL_LINES) result.set(`${mode}:${weekNo}:${lineId}`, safeAmount(values[lineId]));
      }
    }
    return result;
  };
  const before = amounts(previous);
  const after = amounts(currentSnapshot);
  const changes = [...after.entries()].flatMap(([key, afterAmount]) => {
    const beforeAmount = before.get(key) || 0;
    if (beforeAmount === afterAmount) return [];
    const [mode, weekNo, cashflowLine] = key.split(':');
    return [{ mode, weekNo: Number(weekNo), cashflowLine, beforeAmount, afterAmount }];
  });
  const reopenContext = objectValue(currentSnapshot?.reopenContext) || {};
  const request = objectValue(reopenContext.request) || {};
  const decision = objectValue(reopenContext.decision) || {};
  return {
    reason: readOptionalText(request.reason) || readOptionalText(decision.reason) || '재오픈 후 조정',
    changedCount: changes.length,
    changes: changes.slice(0, 200),
  };
}

function parseCashflowRangeBoundary(value, fieldName) {
  const normalized = readOptionalText(value);
  if (!normalized) return null;
  const match = /^(\d{4}-(?:0[1-9]|1[0-2])):([1-5])$/.exec(normalized);
  if (!match) {
    throw createHttpError(
      400,
      `${fieldName} must use YYYY-MM:week format.`,
      'cashflow_range_invalid',
    );
  }
  return {
    yearMonth: match[1],
    weekNo: Number(match[2]),
  };
}

function cashflowRangeSortKey(boundary) {
  return Number(boundary.yearMonth.replace('-', '')) * 10 + Number(boundary.weekNo);
}

function cashflowReadModelBoundaries(months) {
  const boundaries = [];
  for (const month of Array.isArray(months) ? months : []) {
    const yearMonth = readOptionalText(month?.yearMonth);
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(yearMonth)) continue;
    const weekNumbers = new Set();
    for (const mode of ['projection', 'actual']) {
      for (const week of Array.isArray(month?.[mode]?.weeks) ? month[mode].weeks : []) {
        const weekNo = Number(week?.weekNo);
        if (Number.isSafeInteger(weekNo) && weekNo >= 1 && weekNo <= 5) weekNumbers.add(weekNo);
      }
    }
    for (const weekNo of weekNumbers) boundaries.push({ yearMonth, weekNo });
  }
  return boundaries.sort((left, right) => cashflowRangeSortKey(left) - cashflowRangeSortKey(right));
}

function resolveCashflowReadModelRange({ months, rawStart, rawEnd, comparisonBoundary }) {
  const knownBoundaries = cashflowReadModelBoundaries(months);
  const fallbackYearMonth = readOptionalText(comparisonBoundary?.asOfWeek?.yearMonth);
  const start = parseCashflowRangeBoundary(rawStart, 'rangeStart')
    || knownBoundaries[0]
    || { yearMonth: fallbackYearMonth, weekNo: 1 };
  const end = parseCashflowRangeBoundary(rawEnd, 'rangeEnd')
    || knownBoundaries.at(-1)
    || { yearMonth: fallbackYearMonth, weekNo: 5 };
  if (!start.yearMonth || !end.yearMonth || cashflowRangeSortKey(start) > cashflowRangeSortKey(end)) {
    throw createHttpError(400, 'rangeStart must be before or equal to rangeEnd.', 'cashflow_range_invalid');
  }
  return { start, end };
}

function buildCashflowRangeTotals(months, mode, range) {
  const startKey = cashflowRangeSortKey(range.start);
  const endKey = cashflowRangeSortKey(range.end);
  const rowTotals = Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [lineId, 0]));
  let totalIn = 0;
  let totalOut = 0;
  for (const month of Array.isArray(months) ? months : []) {
    const yearMonth = readOptionalText(month?.yearMonth);
    for (const week of Array.isArray(month?.[mode]?.weeks) ? month[mode].weeks : []) {
      const weekNo = Number(week?.weekNo);
      if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(yearMonth) || !Number.isSafeInteger(weekNo)) continue;
      const sortKey = cashflowRangeSortKey({ yearMonth, weekNo });
      if (sortKey < startKey || sortKey > endKey) continue;
      const amounts = week?.amounts && typeof week.amounts === 'object' ? week.amounts : {};
      for (const lineId of CASHFLOW_ALL_LINES) {
        const next = rowTotals[lineId] + safeAmount(amounts[lineId]);
        if (!Number.isSafeInteger(next)) {
          throw createHttpError(502, 'JVM cashflow range totals are unsafe.', 'jvm_weekly_cashflow_totals_invalid');
        }
        rowTotals[lineId] = next;
      }
      const weekIn = sumSafe(CASHFLOW_IN_LINES.map((lineId) => amounts[lineId]));
      const weekOut = sumSafe(CASHFLOW_OUT_LINES.map((lineId) => amounts[lineId]));
      if (weekIn === null || weekOut === null) {
        throw createHttpError(502, 'JVM cashflow range totals are unsafe.', 'jvm_weekly_cashflow_totals_invalid');
      }
      totalIn += weekIn;
      totalOut += weekOut;
      if (!Number.isSafeInteger(totalIn) || !Number.isSafeInteger(totalOut)) {
        throw createHttpError(502, 'JVM cashflow range totals are unsafe.', 'jvm_weekly_cashflow_totals_invalid');
      }
    }
  }
  const net = totalIn - totalOut;
  if (!Number.isSafeInteger(net)) {
    throw createHttpError(502, 'JVM cashflow range totals are unsafe.', 'jvm_weekly_cashflow_totals_invalid');
  }
  return { rowTotals, totalIn, totalOut, net };
}

function differenceTotals(projection, actual) {
  return {
    totalIn: projection.totalIn - actual.totalIn,
    totalOut: projection.totalOut - actual.totalOut,
    balance: projection.balance - actual.balance,
  };
}

function dashboardTotals(mode) {
  return {
    totalIn: mode?.monthTotals?.totalIn || 0,
    totalOut: mode?.monthTotals?.totalOut || 0,
    balance: mode?.monthTotals?.net || 0,
    rowTotals: mode?.rowTotals || {},
    weeks: mode?.weeks || [],
  };
}

function validConfirmationKeys(confirmations) {
  const keys = new Set();
  for (const confirmation of Array.isArray(confirmations) ? confirmations : []) {
    const mode = readOptionalText(confirmation?.mode).toLowerCase();
    const weekNo = Number(confirmation?.weekNo);
    const cashflowLine = readOptionalText(confirmation?.cashflowLine);
    const decision = readOptionalText(confirmation?.decision).toUpperCase();
    if (
      !['projection', 'actual'].includes(mode)
      || !Number.isSafeInteger(weekNo)
      || weekNo < 1
      || weekNo > 5
      || !CASHFLOW_ALL_LINES.includes(cashflowLine)
      || !['CONFIRMED', 'NOT_APPLICABLE'].includes(decision)
    ) continue;
    keys.add(`${mode}:${weekNo}:${cashflowLine}`);
  }
  return keys;
}

function completeMonthCloseConfirmations(confirmations) {
  const expectedCount = CASHFLOW_ALL_LINES.length * 2 * 5;
  return Array.isArray(confirmations)
    && confirmations.length === expectedCount
    && validConfirmationKeys(confirmations).size === expectedCount;
}

function closeSnapshotCells(snapshot, yearMonth) {
  return (Array.isArray(snapshot?.weeklyTotals) ? snapshot.weeklyTotals : []).flatMap((week) => (
    ['projection', 'actual'].flatMap((mode) => CASHFLOW_ALL_LINES.map((cashflowLine) => {
      const amounts = objectValue(week?.[mode]) || {};
      const hasValue = Object.hasOwn(amounts, cashflowLine);
      return normalizeMonthCloseCell({
        mode,
        weekNo: week?.weekNo,
        cashflowLine,
        cellState: hasValue ? 'VALUE' : 'EMPTY',
        ...(hasValue ? { amount: amounts[cashflowLine] } : {}),
      }, yearMonth);
    }))
  )).filter(Boolean);
}

function normalizedMetadataText(value) {
  return readOptionalText(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function projectSheetWarnings(project, metadata) {
  const warnings = [];
  const businessType = normalizedMetadataText(metadata?.businessType?.value);
  const accountType = normalizedMetadataText(metadata?.accountType?.value);
  const settlementStatus = normalizedMetadataText(metadata?.settlementStatus?.value);
  const settlementType = readOptionalText(project?.settlementType).toUpperCase();
  const basis = normalizedMetadataText(project?.basis);
  if (!businessType) {
    warnings.push({ code: 'SHEET_BUSINESS_TYPE_MISSING', message: '시트의 사업 구분을 확인해 주세요.' });
  } else if (
    (settlementType !== 'NONE' && !businessType.includes(settlementType.toLowerCase()))
    || (basis && basis !== 'none' && !businessType.includes(basis))
  ) {
    warnings.push({ code: 'PROJECT_SHEET_BUSINESS_TYPE_MISMATCH', message: '프로젝트 등록 정보와 시트의 사업 구분이 다릅니다.' });
  }
  if (!accountType) {
    warnings.push({ code: 'SHEET_ACCOUNT_TYPE_MISSING', message: '시트의 전용계좌사업 여부를 확인해 주세요.' });
  } else if ((project?.accountType === 'DEDICATED') !== accountType.includes('전용계좌')) {
    warnings.push({ code: 'PROJECT_SHEET_ACCOUNT_TYPE_MISMATCH', message: '프로젝트 등록 정보와 시트의 계좌 구분이 다릅니다.' });
  }
  const expectsSettlement = settlementType !== 'NONE';
  if (!settlementStatus) {
    warnings.push({ code: 'SHEET_SETTLEMENT_STATUS_MISSING', message: '시트의 정산 여부를 확인해 주세요.' });
  } else if (expectsSettlement !== settlementStatus.includes('정산진행')) {
    warnings.push({ code: 'PROJECT_SHEET_SETTLEMENT_STATUS_MISMATCH', message: '프로젝트 등록 정보와 시트의 정산 여부가 다릅니다.' });
  }
  return warnings;
}

function projectMetadata(project) {
  const settlementType = readOptionalText(project?.settlementType).toUpperCase();
  const basis = readOptionalText(project?.basis);
  return {
    businessType: [settlementType && settlementType !== 'NONE' ? settlementType : '', basis && basis !== 'NONE' ? basis : '']
      .filter(Boolean).join(' · ') || '미정',
    accountType: project?.accountType === 'DEDICATED' ? '전용계좌사업' : project?.accountType ? '운영계좌사업' : '미정',
    settlementStatus: !settlementType ? '미정' : settlementType !== 'NONE' ? '정산진행' : '정산없음',
  };
}

function addIsoDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function thursdayDeadlineMs(week) {
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addIsoDays(week.weekStart, offset);
    if (date > week.weekEnd) break;
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 4) {
      return Date.parse(`${addIsoDays(date, 1)}T00:00:00+09:00`);
    }
  }
  return Date.parse(`${addIsoDays(week.weekEnd, 1)}T00:00:00+09:00`);
}

function monthsBetween(startYearMonth, endYearMonth) {
  const result = [];
  let cursor = new Date(`${startYearMonth}-01T00:00:00Z`);
  const end = new Date(`${endYearMonth}-01T00:00:00Z`);
  while (cursor <= end && result.length < 240) {
    result.push(cursor.toISOString().slice(0, 7));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return result;
}

async function readCashflowDeadlineSummary({ db, tenantId, projectId, comparisonBoundary }) {
  if (!db?.collection) return { trackingStartedAt: null, missedCount: 0, completedCount: 0, current: null };
  const snap = await db.collection(`orgs/${tenantId}/cashflow_sheet_stage_runs`)
    .where('projectId', '==', projectId)
    .limit(500)
    .get();
  const runs = snap.docs.map((doc) => doc.data() || {})
    .filter((run) => run.status === 'APPLIED' || (run.status === 'READY' && safeAmount(run.stagedLineCount) === 0))
    .map((run) => readOptionalText(run.appliedAt) || readOptionalText(run.createdAt))
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort();
  if (runs.length === 0) return { trackingStartedAt: null, missedCount: 0, completedCount: 0, current: null };
  const trackingStartedAt = runs[0];
  const asOfDate = readOptionalText(comparisonBoundary?.asOfDate);
  const startYearMonth = trackingStartedAt.slice(0, 7);
  const endYearMonth = asOfDate.slice(0, 7);
  const asOfMs = Date.parse(`${asOfDate}T23:59:59+09:00`);
  const weeks = monthsBetween(startYearMonth, endYearMonth).flatMap(getMonthFinanceWeeks)
    .filter((week) => Date.parse(`${week.weekEnd}T23:59:59+09:00`) >= Date.parse(trackingStartedAt));
  let missedCount = 0;
  let completedCount = 0;
  let current = null;
  for (const week of weeks) {
    const deadlineMs = thursdayDeadlineMs(week);
    const startMs = Date.parse(`${week.weekStart}T00:00:00+09:00`);
    const completedAt = runs.find((value) => {
      const time = Date.parse(value);
      return time >= startMs && time <= deadlineMs;
    }) || null;
    const deadlinePassed = asOfMs >= deadlineMs;
    if (deadlinePassed && completedAt) completedCount += 1;
    if (deadlinePassed && !completedAt) missedCount += 1;
    if (week.yearMonth === comparisonBoundary?.asOfWeek?.yearMonth && week.weekNo === comparisonBoundary?.asOfWeek?.weekNo) {
      current = {
        yearMonth: week.yearMonth,
        weekNo: week.weekNo,
        deadline: new Date(deadlineMs).toISOString(),
        completedAt,
        status: completedAt ? 'COMPLETED' : deadlinePassed ? 'MISSED' : 'PENDING',
      };
    }
  }
  return { trackingStartedAt, missedCount, completedCount, current };
}

function sheetControlBlockers(sheetFacts) {
  if (!objectValue(sheetFacts)) {
    return [{ code: 'SHEET_FACTS_MISSING', message: '시트 검증값이 없습니다. 시트값을 다시 불러와 주세요.' }];
  }
  const blockers = [];
  if (Array.isArray(sheetFacts.issues) && sheetFacts.issues.length > 0) {
    blockers.push({ code: 'SHEET_VALUE_INVALID', message: '시트의 날짜 또는 금액 형식을 확인해 주세요.', details: sheetFacts.issues });
  }
  const controls = objectValue(sheetFacts.controlTotals);
  const projectionRows = Array.isArray(controls?.projection) ? controls.projection : [];
  const actualRows = Array.isArray(controls?.actual) ? controls.actual : [];
  const rows = [...projectionRows, ...actualRows];
  if (projectionRows.length !== 19 || actualRows.length !== 19) {
    blockers.push({
      code: 'SHEET_CONTROL_TOTAL_INCOMPLETE',
      message: 'Projection/Actual BO control total이 불완전합니다. 시트값을 다시 불러와 주세요.',
    });
  }
  const comparableRows = rows.filter((row) => typeof row?.matches === 'boolean');
  const depositComparable = typeof controls?.deposit?.matches === 'boolean';
  if ((depositComparable && controls.deposit.matches !== true) || comparableRows.some((row) => row.matches !== true)) {
    blockers.push({
      code: 'SHEET_CONTROL_TOTAL_MISMATCH',
      message: '전체 주차 합계와 시트 BO control total이 다릅니다.',
      details: {
        deposit: controls?.deposit || null,
        rows: rows.filter((row) => row?.matches !== true),
      },
    });
  }
  return blockers;
}

function sourceDepositRows(sheetFacts, yearMonth) {
  return (Array.isArray(sheetFacts?.depositScheduleRows) ? sheetFacts.depositScheduleRows : [])
    .filter((row) => readOptionalText(row?.yearMonth) === yearMonth)
    .sort((left, right) => Number(left?.weekNo) - Number(right?.weekNo));
}

function matchingDepositSchedule(sourceRows, draftRows) {
  if (sourceRows.length !== 5 || !Array.isArray(draftRows) || draftRows.length !== 5) return false;
  const sourceByWeek = new Map(sourceRows.map((row) => [Number(row?.weekNo), row]));
  return draftRows.every((row) => {
    const source = sourceByWeek.get(Number(row?.weekNo));
    if (!source) return false;
    const sourceAmount = source.expectedDepositAmount == null ? null : Number(source.expectedDepositAmount);
    const draftAmount = row?.expectedDepositAmount == null ? null : Number(row.expectedDepositAmount);
    return readOptionalText(row?.taxInvoiceIssuedDate) === readOptionalText(source?.taxInvoiceIssuedDate)
      && readOptionalText(row?.expectedDepositDate) === readOptionalText(source?.expectedDepositDate)
      && sourceAmount === draftAmount;
  });
}

function assertCloseableSheetFacts(mirror, yearMonth, closeInput) {
  const facts = objectValue(mirror?.sheetFacts);
  const blockers = sheetControlBlockers(facts);
  if (blockers.length > 0) {
    throw createHttpError(409, blockers[0].message, blockers[0].code.toLowerCase());
  }
  if (!matchingDepositSchedule(sourceDepositRows(facts, yearMonth), closeInput?.depositScheduleRows)) {
    throw createHttpError(
      409,
      '시트 입금 일정과 임시저장 값이 다릅니다. 시트값을 다시 불러와 주세요.',
      'cashflow_month_close_deposit_source_conflict',
    );
  }
}

async function readDocument(db, path) {
  if (!db?.doc) return null;
  const snapshot = await db.doc(path).get();
  return snapshot.exists ? snapshot.data() || {} : null;
}

async function composeCashflowMonthDashboard({ db, req, projectId, yearMonth, close, cashflow, comparisonBoundary }) {
  const closedSnapshot = ['CLOSED', 'REOPEN_REQUESTED'].includes(readOptionalText(close?.status))
    ? objectValue(close?.snapshot) || {}
    : null;
  const tenantId = readOptionalText(req.context?.tenantId);
  const actorId = readOptionalText(req.context?.actorId);
  const draftId = privateCashflowDraftId(projectId, actorId);
  const [projectDocument, mirror, draft] = closedSnapshot ? [null, null, null] : await Promise.all([
    readDocument(db, `orgs/${tenantId}/projects/${projectId}`),
    readDocument(db, `orgs/${tenantId}/cashflow_sheet_mirrors/${projectId}`),
    readDocument(db, `orgs/${tenantId}/privateEditDrafts/${draftId}`),
  ]);
  const project = closedSnapshot?.project || projectDocument || {};
  const sheetFacts = closedSnapshot?.sheetFacts || mirror?.sheetFacts || null;
  const draftInput = objectValue(draft?.payload)?.monthClose;
  const draftMatches = Boolean(
    draftInput
    && draft?.tenantId === tenantId
    && draft?.ownerUid === actorId
    && draft?.resourceType === 'cashflow'
    && draft?.resourceId === projectId
    && draft?.status === 'ACTIVE'
    && draftInput.yearMonth === yearMonth
  );
  const draftSourceMatches = draftMatches
    && draftInput.sourceRevision === mirror?.sourceRevision
    && draftInput.targetRevision === mirror?.targetRevisionAtFetch;
  const mirrorCells = normalizeMonthCloseCells(mirror?.cells, yearMonth);
  const draftCells = normalizeMonthCloseCells(draftInput?.cells, yearMonth);
  const cells = closedSnapshot
    ? closeSnapshotCells(closedSnapshot, yearMonth)
    : (draftSourceMatches && completeMonthCloseCells(draftCells) ? draftCells : mirrorCells);
  const projectionMode = buildMonthModeReadModel(cells, 'projection');
  const actualMode = buildMonthModeReadModel(cells, 'actual');
  const projection = dashboardTotals(projectionMode);
  const actual = dashboardTotals(actualMode);
  const difference = differenceTotals(projection, actual);
  const comparison = projectionMode && actualMode
    ? buildCashflowProjectionActualComparison({
      projectId,
      readModel: { months: [{ yearMonth, projection: projectionMode, actual: actualMode }] },
    }, comparisonBoundary).months[0] || null
    : null;
  const confirmations = closedSnapshot?.confirmations || (draftMatches ? draftInput?.confirmations : []) || [];
  const managementConfirmations = closedSnapshot?.managementConfirmations
    || (draftMatches ? draftInput?.managementConfirmations : [])
    || [];
  const sourceRows = sourceDepositRows(sheetFacts, yearMonth);
  const depositScheduleRows = closedSnapshot?.depositScheduleRows
    || (draftSourceMatches ? draftInput?.depositScheduleRows : sourceRows)
    || [];
  const managementChecks = Array.isArray(closedSnapshot?.managementChecks)
    ? closedSnapshot.managementChecks
    : buildCashflowManagementChecks({
      project,
      cashflow,
      cells,
      yearMonth,
      depositScheduleRows: sheetFacts?.depositScheduleRows || depositScheduleRows,
      comparisonBoundary,
      pinnedSheetCells: mirror?.cells,
    });
  const deadlineSummary = closedSnapshot?.deadlineSummary || await readCashflowDeadlineSummary({
    db,
    tenantId,
    projectId,
    comparisonBoundary,
  });
  const blockers = [];
  if (readOptionalText(close?.status) !== 'OPEN') {
    blockers.push({ code: 'MONTH_NOT_OPEN', message: '결산 또는 재오픈 검토 중인 월은 수정할 수 없습니다.' });
  } else {
    if (close?.closeEligible === false) {
      blockers.push({ code: 'MONTH_NOT_ENDED', message: '대상 월이 끝난 뒤 월 결산할 수 있습니다.' });
    }
    if (!projectDocument) blockers.push({ code: 'PROJECT_NOT_FOUND', message: '프로젝트 등록 정보를 찾을 수 없습니다.' });
    if (!mirror) blockers.push({ code: 'SHEET_SOURCE_REQUIRED', message: '먼저 시트값을 불러와 주세요.' });
    else if (mirror.status !== 'FRESH') blockers.push({ code: 'SHEET_SOURCE_STALE', message: '시트값을 다시 불러와 주세요.' });
    else if ((mirror.projectId && mirror.projectId !== projectId) || !mirror.yearMonths?.includes(yearMonth)) {
      blockers.push({ code: 'SHEET_SOURCE_SCOPE_MISMATCH', message: '고정한 시트값의 프로젝트 또는 월이 다릅니다.' });
    }
    blockers.push(...sheetControlBlockers(sheetFacts));
    if (!completeMonthCloseCells(cells)) blockers.push({ code: 'SHEET_MONTH_INCOMPLETE', message: '선택한 월의 160개 캐시플로우 값을 다시 불러와 주세요.' });
    if (!projectionMode || !actualMode) blockers.push({ code: 'AMOUNT_OUT_OF_RANGE', message: '지원 범위를 넘는 금액이 있습니다.' });
    if (!draftMatches) blockers.push({ code: 'DRAFT_REQUIRED', message: '월 결산 임시저장을 먼저 완료해 주세요.' });
    else if (!draftSourceMatches) blockers.push({ code: 'DRAFT_SOURCE_STALE', message: '임시저장과 현재 시트값이 다릅니다.' });
    if (!matchingDepositSchedule(sourceRows, draftInput?.depositScheduleRows)) {
      blockers.push({ code: 'DEPOSIT_SCHEDULE_INCOMPLETE', message: '시트 입금 일정 5주를 확인해 주세요.' });
    }
    if (!completeMonthCloseConfirmations(confirmations)) {
      blockers.push({ code: 'CONFIRMATIONS_INCOMPLETE', message: '모든 캐시플로우 항목을 확인 또는 해당 없음으로 판정해 주세요.' });
    }
    if (!completeManagementConfirmations(managementConfirmations)) {
      blockers.push({ code: 'MANAGEMENT_CONFIRMATIONS_INCOMPLETE', message: '주요 관리 항목 4개를 모두 확인 또는 해당 없음으로 판정해 주세요.' });
    }
  }
  const contractAmount = safeAmount(project?.contractAmount);
  const rawProjectionProgressPercent = contractAmount === 0
    ? 100
    : Math.round((projection.totalIn / contractAmount) * 10_000) / 100;
  const projectionProgressPercent = Math.max(0, Math.min(100, rawProjectionProgressPercent));
  const requiredCellConfirmationCount = CASHFLOW_ALL_LINES.length * 2 * 5;
  const requiredManagementConfirmationCount = CASHFLOW_MANAGEMENT_CHECK_IDS.length;
  const confirmationProgressPercent = Math.round(
    Math.min(
      1,
      (validConfirmationKeys(confirmations).size + validManagementConfirmations(managementConfirmations).size)
        / (requiredCellConfirmationCount + requiredManagementConfirmationCount),
    ) * 10_000,
  ) / 100;
  const source = closedSnapshot ? {
    kind: 'MONTH_CLOSE_SNAPSHOT',
    status: readOptionalText(close?.status),
    sourceRevision: readOptionalText(closedSnapshot?.sourceFingerprint),
    targetRevision: readOptionalText(closedSnapshot?.targetRevision),
    capturedAt: readOptionalText(closedSnapshot?.sourceReadAt),
  } : {
    kind: 'PINNED_MIRROR',
    status: readOptionalText(mirror?.status) || 'EMPTY',
    sourceRevision: readOptionalText(mirror?.sourceRevision),
    targetRevision: readOptionalText(mirror?.targetRevisionAtFetch),
    capturedAt: readOptionalText(mirror?.capturedAt),
  };
  return {
    source,
    project,
    projectMetadata: projectMetadata(project),
    sheetMetadata: sheetFacts?.metadata || {},
    sheetControlTotals: {
      deposit: objectValue(sheetFacts?.controlTotals?.deposit) || null,
      unpaid: objectValue(sheetFacts?.controlTotals?.unpaid) || null,
    },
    sheetDepositScheduleRows: sourceRows,
    depositScheduleRows,
    cells,
    confirmations,
    managementChecks,
    managementConfirmations,
    deadlineSummary,
    postCloseAdjustment: closedSnapshot ? postCloseAdjustment(close, closedSnapshot) : null,
    draftRevision: draftMatches && Number.isSafeInteger(Number(draft?.draftRevision)) ? Number(draft.draftRevision) : null,
    totals: { projection, actual, difference },
    comparison,
    summary: {
      projectionProgressPercent,
      actualProgressPercent: actualWrittenProgressPercent(cells, yearMonth, comparisonBoundary),
      confirmationProgressPercent,
      comparisonMatches: Boolean(comparison) && comparison.weeks.every((week) => week.net === 0 && week.totalIn === 0 && week.totalOut === 0),
      comparisonAsOfDate: comparisonBoundary.asOfDate,
      comparisonAsOfWeek: comparisonBoundary.asOfWeek,
      evaluatedBusinessDate: readOptionalText(close?.evaluatedBusinessDate) || null,
      closeDeadline: readOptionalText(close?.closeDeadline) || null,
      late: Boolean(close?.late),
    },
    validation: {
      canClose: readOptionalText(close?.status) === 'OPEN' && blockers.length === 0,
      blockers,
      warnings: closedSnapshot ? [] : projectSheetWarnings(project, sheetFacts?.metadata),
    },
    canonical: cashflow?.readModel || null,
  };
}

async function composeCashflowMonthCloseBody({ db, req, projectId, cashflow, comparisonBoundary }) {
  if (!db?.doc) {
    throw createHttpError(503, 'Cashflow month close source storage is unavailable.', 'cashflow_month_close_source_unavailable');
  }
  const tenantId = readOptionalText(req.context?.tenantId);
  const actorId = readOptionalText(req.context?.actorId);
  const requested = commandBody(req);
  const yearMonth = readOptionalText(requested.yearMonth);
  const expectedRevision = Number(requested.expectedRevision);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw createHttpError(400, 'Cashflow month close scope is invalid.', 'cashflow_month_close_request_invalid');
  }

  const [draftSnap, mirrorSnap, projectSnap] = await Promise.all([
    db.doc(`orgs/${tenantId}/privateEditDrafts/${privateCashflowDraftId(projectId, actorId)}`).get(),
    db.doc(`orgs/${tenantId}/cashflow_sheet_mirrors/${projectId}`).get(),
    db.doc(`orgs/${tenantId}/projects/${projectId}`).get(),
  ]);
  if (!draftSnap.exists) {
    throw createHttpError(409, 'Save a private cashflow draft before closing the month.', 'cashflow_month_close_draft_required');
  }
  const draft = draftSnap.data() || {};
  const draftRevision = Number(draft.draftRevision);
  const closeInput = objectValue(objectValue(draft.payload)?.monthClose);
  const submittedRequest = objectValue(draft.monthCloseSubmission);
  if (
    draft.tenantId === tenantId
    && draft.ownerUid === actorId
    && draft.resourceType === 'cashflow'
    && draft.resourceId === projectId
    && draft.status === 'SUBMITTED'
    && readOptionalText(submittedRequest?.idempotencyKey) === requested.idempotencyKey
    && readOptionalText(submittedRequest?.yearMonth) === yearMonth
    && Number(submittedRequest?.expectedRevision) === expectedRevision
    && Number.isSafeInteger(Number(submittedRequest?.expectedDraftRevision))
    && Number(submittedRequest.expectedDraftRevision) >= 0
    && /^sha256:[a-f0-9]{64}$/.test(readOptionalText(submittedRequest?.sourceRevision))
    && /^sha256:[a-f0-9]{64}$/.test(readOptionalText(submittedRequest?.targetRevision))
    && Array.isArray(submittedRequest?.depositScheduleRows)
    && Array.isArray(submittedRequest?.cells)
    && Array.isArray(submittedRequest?.confirmations)
    && Array.isArray(submittedRequest?.managementChecks)
    && Array.isArray(submittedRequest?.managementConfirmations)
  ) {
    return {
      idempotencyKey: requested.idempotencyKey,
      yearMonth,
      expectedRevision,
      expectedDraftRevision: Number(submittedRequest.expectedDraftRevision),
      sourceRevision: submittedRequest.sourceRevision,
      targetRevision: submittedRequest.targetRevision,
      depositScheduleRows: submittedRequest.depositScheduleRows,
      cells: submittedRequest.cells,
      confirmations: submittedRequest.confirmations,
      managementChecks: submittedRequest.managementChecks,
      managementConfirmations: submittedRequest.managementConfirmations,
      deadlineSummary: submittedRequest.deadlineSummary || null,
    };
  }
  if (
    draft.tenantId !== tenantId
    || draft.ownerUid !== actorId
    || draft.resourceType !== 'cashflow'
    || draft.resourceId !== projectId
    || draft.status !== 'ACTIVE'
    || !Number.isSafeInteger(draftRevision)
    || draftRevision < 0
    || !closeInput
    || closeInput.yearMonth !== yearMonth
  ) {
    throw createHttpError(409, 'The latest private draft cannot be used for this month close.', 'cashflow_month_close_draft_conflict');
  }
  if (!mirrorSnap.exists) {
    throw createHttpError(409, 'Refresh and pin the cashflow sheet before closing the month.', 'cashflow_month_close_source_required');
  }
  const mirror = mirrorSnap.data() || {};
  if (
    mirror.status !== 'FRESH'
    || (mirror.projectId && mirror.projectId !== projectId)
    || mirror.sourceRevision !== closeInput.sourceRevision
    || mirror.targetRevisionAtFetch !== closeInput.targetRevision
    || !Array.isArray(mirror.yearMonths)
    || !mirror.yearMonths.includes(yearMonth)
    || !readOptionalText(mirror.capturedAt)
  ) {
    throw createHttpError(409, 'The pinned cashflow source changed. Refresh it before closing.', 'cashflow_month_close_source_conflict');
  }
  assertCloseableSheetFacts(mirror, yearMonth, closeInput);
  const project = projectSnap.exists ? projectSnap.data() || {} : {};
  const normalizedCells = normalizeMonthCloseCells(closeInput.cells, yearMonth);
  const managementChecks = buildCashflowManagementChecks({
    project,
    cashflow,
    cells: normalizedCells,
    yearMonth,
    depositScheduleRows: closeInput.depositScheduleRows,
    comparisonBoundary,
    pinnedSheetCells: mirror.cells,
  });
  if (!matchingManagementChecks(managementChecks, closeInput.managementChecks)) {
    throw createHttpError(409, '주요 관리 항목 판정이 변경되었습니다. 다시 확인해 주세요.', 'cashflow_management_checks_stale');
  }
  if (!completeManagementConfirmations(closeInput.managementConfirmations)) {
    throw createHttpError(409, '주요 관리 항목 4개를 모두 확인해 주세요.', 'cashflow_management_confirmations_incomplete');
  }
  const deadlineSummary = await readCashflowDeadlineSummary({ db, tenantId, projectId, comparisonBoundary });

  return {
    idempotencyKey: requested.idempotencyKey,
    yearMonth,
    expectedRevision,
    expectedDraftRevision: draftRevision,
    sourceRevision: closeInput.sourceRevision,
    targetRevision: closeInput.targetRevision,
    depositScheduleRows: closeInput.depositScheduleRows,
    cells: closeInput.cells,
    confirmations: closeInput.confirmations,
    managementChecks,
    managementConfirmations: [...validManagementConfirmations(closeInput.managementConfirmations).values()],
    deadlineSummary,
  };
}

function readCashflowEditSession(req) {
  const sessionId = readOptionalText(req.header('x-edit-session-id'));
  const leaseId = readOptionalText(req.header('x-edit-lease-id'));
  const fenceText = readOptionalText(req.header('x-edit-fence'));
  const fence = /^[1-9]\d*$/.test(fenceText) ? Number(fenceText) : Number.NaN;
  if (!sessionId || !leaseId || !Number.isSafeInteger(fence)) {
    throw createHttpError(400, 'Cashflow edit lease headers are required.', 'cashflow_edit_lease_request_invalid');
  }
  const finalizeText = readOptionalText(req.header('x-edit-finalize'));
  if (finalizeText && finalizeText !== 'true') {
    throw createHttpError(400, 'x-edit-finalize must be true when present.', 'cashflow_edit_lease_request_invalid');
  }
  return { sessionId, leaseId, fence, ...(finalizeText === 'true' ? { finalize: true } : {}) };
}

function createJavaMutatingProxyRoute(routeHandler) {
  return asyncHandler(async (req, res) => {
    const result = await routeHandler(req, res);
    const status = result?.status ?? 200;
    const body = result?.body ?? null;
    res.status(status).json(body);
  });
}

function isWorkspaceUser(context, workspaceEmailDomain) {
  const email = readOptionalText(context?.actorEmail).toLowerCase();
  const domain = readOptionalText(workspaceEmailDomain).replace(/^@+/, '').toLowerCase();
  return Boolean(domain) && email.endsWith(`@${domain}`);
}

function assertWeeklyWorkspaceOrRoleAllowed(req, allowedRoles, action, authMode, workspaceEmailDomain) {
  if (isWorkspaceAuthMode(authMode) && isWorkspaceUser(req.context, workspaceEmailDomain)) return;
  assertActorRoleAllowed(req, allowedRoles, action);
}

export function mountJvmWeeklyApiRoutes(app, {
  db,
  env = process.env,
  fetchImpl = globalThis.fetch,
  jvmWeeklyApiBaseUrl,
  jvmWeeklyApiServiceToken,
  jvmWeeklyApiIdTokenAudience,
  jvmWeeklyApiServiceAccountJson,
  jvmWeeklyApiIdentityTokenResolver,
  jvmWeeklyAuthMode,
  jvmWeeklyWorkspaceEmailDomain,
  jvmWeeklyFirestoreProjectId,
  now = () => new Date(),
} = {}) {
  const baseUrl = resolveJavaWeeklyApiBaseUrl({ jvmWeeklyApiBaseUrl }, env);
  const serviceToken = resolveJavaWeeklyApiServiceToken({ jvmWeeklyApiServiceToken }, env);
  const idTokenAudience = resolveJavaWeeklyApiIdTokenAudience({ jvmWeeklyApiIdTokenAudience }, env);
  const serviceAccountJson = resolveJavaWeeklyApiServiceAccountJson({ jvmWeeklyApiServiceAccountJson }, env);
  const authMode = resolveJavaWeeklyAuthMode({ jvmWeeklyAuthMode }, env);
  const workspaceEmailDomain = resolveJavaWeeklyWorkspaceEmailDomain({ jvmWeeklyWorkspaceEmailDomain }, env);
  const firestoreProjectId = resolveJavaWeeklyFirestoreProjectId({ jvmWeeklyFirestoreProjectId }, env);
  const bffDataProjectId = resolveBffDataProjectId(env);
  const editLeasesEnabled = readOptionalText(env.BFF_EDIT_LEASES_ENABLED).toLowerCase() === 'true';

  function proxyJavaWeeklyRequest(options) {
    return proxyJavaWeeklyJson({
      fetchImpl,
      baseUrl,
      serviceToken,
      idTokenAudience,
      serviceAccountJson,
      resolveIdentityToken: jvmWeeklyApiIdentityTokenResolver,
      authMode,
      workspaceEmailDomain,
      ...options,
    });
  }

  async function proxyMutation(req, path, body, {
    cashflowWrite = false,
    requireEditLease = cashflowWrite,
    requireFinalize = false,
  } = {}) {
    let editSession;
    let dataProjectId;
    if (cashflowWrite) {
      if (readOptionalText(env.BFF_DEPLOY_ENV).toLowerCase() !== 'stage') {
        throw createHttpError(503, 'Cashflow writes are restricted to Stage.', 'unsafe_bff_runtime');
      }
      const liveProjectId = readOptionalText(env.BFF_LIVE_FIREBASE_PROJECT_ID) || 'inner-platform-live-20260316';
      if (!bffDataProjectId || !firestoreProjectId || bffDataProjectId !== firestoreProjectId) {
        throw createHttpError(503, 'BFF and JVM cashflow data projects do not match.', 'jvm_weekly_data_project_mismatch');
      }
      if (bffDataProjectId === liveProjectId) {
        throw createHttpError(503, 'Cashflow Stage writes cannot target the Live data project.', 'unsafe_bff_runtime');
      }
      if (requireEditLease) {
        if (!editLeasesEnabled) {
          throw createHttpError(503, 'Cashflow writes require the Stage edit-lease runtime.', 'cashflow_edit_leases_disabled');
        }
        editSession = readCashflowEditSession(req);
        if (requireFinalize && editSession.finalize !== true) {
          throw createHttpError(400, 'Cashflow month close requires x-edit-finalize: true.', 'cashflow_edit_finalize_required');
        }
      }
      dataProjectId = bffDataProjectId;
    }
    return proxyJavaWeeklyRequest({
      context: req.context,
      method: 'POST',
      path,
      body,
      editSession,
      dataProjectId,
    });
  }

  app.get('/api/v1/weekly-expenses/:projectId/sheets', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read weekly expense sheets', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/weekly-expenses/${projectId}/sheets`,
    });
    res.status(200).json(result);
  }));

  app.get('/api/v1/weekly-expenses/:projectId/sheets/:sheetKey', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read weekly expense sheet', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
    const result = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}`,
    });
    res.status(200).json(result);
  }));

  app.post('/api/v1/weekly-expenses/:projectId/sheets/:sheetKey/save-draft', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'save weekly expense draft', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
    const result = await proxyMutation(
      req,
      `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}/save-draft`,
      commandBody(req),
      { cashflowWrite: true },
    );
    return { status: 200, body: result };
  }));

  app.post('/api/v1/weekly-expenses/:projectId/bank-statements/import-batch', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'import weekly expense bank statement batch', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(
      req,
      `/api/v1/weekly-expenses/${projectId}/bank-statements/import-batch`,
      commandBody(req),
      { cashflowWrite: true },
    );
    return { status: 200, body: result };
  }));

  app.get('/api/v1/weekly-expenses/:projectId/bank-statements/import-lines', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read weekly expense bank statement import lines', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const status = readOptionalText(req.query.status);
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const result = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/weekly-expenses/${projectId}/bank-statements/import-lines${query}`,
    });
    res.status(200).json(result);
  }));

  app.post('/api/v1/weekly-expenses/:projectId/bank-statements/apply-items', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'apply weekly expense bank statement items', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(
      req,
      `/api/v1/weekly-expenses/${projectId}/bank-statements/apply-items`,
      commandBody(req),
      { cashflowWrite: true },
    );
    return { status: 200, body: result };
  }));

  for (const command of ['cell-patch', 'copy', 'paste', 'cut', 'row-insert', 'row-delete']) {
    app.post(`/api/v1/weekly-expenses/:projectId/sheets/:sheetKey/commands/${command}`, createJavaMutatingProxyRoute(async (req) => {
      assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, `run weekly expense ${command}`, authMode, workspaceEmailDomain);
      const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
      const sheetKey = encodeURIComponent(readOptionalText(req.params.sheetKey));
      const result = await proxyMutation(
        req,
        `/api/v1/weekly-expenses/${projectId}/sheets/${sheetKey}/commands/${command}`,
        commandBody(req),
        { cashflowWrite: true },
      );
      return { status: 200, body: result };
    }));
  }

  app.post('/api/v1/weekly-expenses/:projectId/submit', asyncHandler(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.writeCore, 'submit weekly expense week', authMode, workspaceEmailDomain);
    throw createHttpError(
      410,
      '주차 제출은 더 이상 사용하지 않습니다. 프로젝트별 월 결산을 이용해 주세요.',
      'weekly_close_disabled_use_month_close',
    );
  }));

  app.post('/api/v1/weekly-expenses/:projectId/close', asyncHandler(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance'], 'close weekly expense week', authMode, workspaceEmailDomain);
    throw createHttpError(
      410,
      '주차 결산은 더 이상 사용하지 않습니다. 프로젝트별 월 결산을 이용해 주세요.',
      'weekly_close_disabled_use_month_close',
    );
  }));

  app.post('/api/v1/weekly-expenses/:projectId/audit-export', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance'], 'create weekly expense audit export', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(req, `/api/v1/weekly-expenses/${projectId}/audit-export`, commandBody(req));
    return { status: 200, body: result };
  }));

  app.post('/api/v1/cashflow/:projectId/projection', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance', 'pm'], 'write Java weekly projection', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(
      req,
      `/api/v1/cashflow/${projectId}/projection`,
      commandBody(req),
      { cashflowWrite: true },
    );
    if (readOptionalText(result?.projectId) !== readOptionalText(req.params.projectId)) {
      throw createHttpError(502, 'JVM cashflow response project does not match the request.', 'jvm_weekly_project_mismatch');
    }
    return { status: 200, body: result };
  }));

  app.post('/api/v1/cashflow-metadata/:projectId/variance', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(
      req,
      ['admin', 'finance', 'pm', 'tenant_admin'],
      'update cashflow variance metadata',
      authMode,
      workspaceEmailDomain,
    );
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(
      req,
      `/api/v1/cashflow/${projectId}/variance`,
      commandBody(req),
      { cashflowWrite: true },
    );
    return { status: 200, body: result };
  }));

  app.get('/api/v1/cashflow/:projectId/activity', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read cashflow activity', authMode, workspaceEmailDomain);
    const projectId = readOptionalText(req.params.projectId);
    res.status(200).json({
      projectId,
      events: await readCashflowActivity(db, readOptionalText(req.context?.tenantId), projectId),
    });
  }));

  app.get('/api/v1/cashflow/:projectId/month-close', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read cashflow month close', authMode, workspaceEmailDomain);
    const rawProjectId = readOptionalText(req.params.projectId);
    const projectId = encodeURIComponent(rawProjectId);
    const yearMonth = readOptionalText(req.query.yearMonth);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      throw createHttpError(400, 'Cashflow month close yearMonth must use YYYY-MM.', 'cashflow_month_close_request_invalid');
    }
    const comparisonBoundary = resolveCashflowComparisonAsOf('', now());
    const source = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/cashflow/${projectId}/month-close/dashboard-source?yearMonth=${encodeURIComponent(yearMonth)}`,
    });
    const result = objectValue(source?.monthClose);
    const cashflow = objectValue(source?.cashflow);
    if (readOptionalText(result?.projectId) !== rawProjectId || readOptionalText(result?.yearMonth) !== yearMonth) {
      throw createHttpError(502, 'JVM cashflow month response scope does not match the request.', 'jvm_weekly_project_mismatch');
    }
    if (db?.doc && readOptionalText(result?.status) === 'OPEN' && !cashflow) {
      throw createHttpError(502, 'JVM cashflow month source is incomplete.', 'jvm_weekly_response_invalid');
    }
    if (cashflow && readOptionalText(cashflow?.projectId) !== rawProjectId) {
      throw createHttpError(502, 'JVM cashflow response project does not match the request.', 'jvm_weekly_project_mismatch');
    }
    const dashboard = await composeCashflowMonthDashboard({
      db,
      req,
      projectId: rawProjectId,
      yearMonth,
      close: result,
      cashflow,
      comparisonBoundary,
    });
    res.status(200).json({ ...result, dashboard });
  }));

  app.post('/api/v1/cashflow/:projectId/month-close', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['pm'], 'close cashflow month', authMode, workspaceEmailDomain);
    if (readCashflowEditSession(req).finalize !== true) {
      throw createHttpError(400, 'Cashflow month close requires x-edit-finalize: true.', 'cashflow_edit_finalize_required');
    }
    const rawProjectId = readOptionalText(req.params.projectId);
    const projectId = encodeURIComponent(rawProjectId);
    const comparisonBoundary = resolveCashflowComparisonAsOf('', now());
    const cashflow = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/cashflow/${projectId}`,
    });
    const closeBody = await composeCashflowMonthCloseBody({
      db,
      req,
      projectId: rawProjectId,
      cashflow,
      comparisonBoundary,
    });
    const result = await proxyMutation(
      req,
      `/api/v1/cashflow/${projectId}/month-close`,
      closeBody,
      { cashflowWrite: true, requireFinalize: true },
    );
    return { status: 200, body: result };
  }));

  app.post('/api/v1/cashflow/:projectId/month-close/reopen-request', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['pm'], 'request cashflow month reopen', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(
      req,
      `/api/v1/cashflow/${projectId}/month-close/reopen-request`,
      commandBody(req),
      { cashflowWrite: true, requireEditLease: false },
    );
    return { status: 200, body: result };
  }));

  app.post('/api/v1/cashflow/:projectId/month-close/reopen-decision', createJavaMutatingProxyRoute(async (req) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ['admin', 'finance'], 'decide cashflow month reopen', authMode, workspaceEmailDomain);
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyMutation(
      req,
      `/api/v1/cashflow/${projectId}/month-close/reopen-decision`,
      commandBody(req),
      { cashflowWrite: true, requireEditLease: false },
    );
    return { status: 200, body: result };
  }));

  app.get('/api/v1/cashflow/:projectId', asyncHandler(async (req, res) => {
    assertWeeklyWorkspaceOrRoleAllowed(req, ROUTE_ROLES.readCore, 'read Java weekly cashflow snapshot', authMode, workspaceEmailDomain);
    let comparisonBoundary;
    try {
      comparisonBoundary = resolveCashflowComparisonAsOf(readOptionalText(req.query.asOf), now());
    } catch {
      throw createHttpError(400, 'Cashflow comparison asOf must be a valid YYYY-MM-DD date.', 'cashflow_comparison_as_of_invalid');
    }
    const requestedRangeStart = parseCashflowRangeBoundary(req.query.rangeStart, 'rangeStart');
    const requestedRangeEnd = parseCashflowRangeBoundary(req.query.rangeEnd, 'rangeEnd');
    if (
      requestedRangeStart
      && requestedRangeEnd
      && cashflowRangeSortKey(requestedRangeStart) > cashflowRangeSortKey(requestedRangeEnd)
    ) {
      throw createHttpError(400, 'rangeStart must be before or equal to rangeEnd.', 'cashflow_range_invalid');
    }
    const projectId = encodeURIComponent(readOptionalText(req.params.projectId));
    const result = await proxyJavaWeeklyRequest({
      context: req.context,
      method: 'GET',
      path: `/api/v1/cashflow/${projectId}`,
    });
    if (readOptionalText(result?.projectId) !== readOptionalText(req.params.projectId)) {
      throw createHttpError(502, 'JVM cashflow response project does not match the request.', 'jvm_weekly_project_mismatch');
    }
    const comparison = buildCashflowProjectionActualComparison(result, comparisonBoundary);
    const comparisonByMonth = new Map(comparison.months.map((month) => [month.yearMonth, month]));
    const sourceMonths = Array.isArray(result?.readModel?.months) ? result.readModel.months : [];
    const range = resolveCashflowReadModelRange({
      months: sourceMonths,
      rawStart: req.query.rangeStart,
      rawEnd: req.query.rangeEnd,
      comparisonBoundary,
    });
    res.status(200).json({
      ...result,
      readModel: {
        ...(result?.readModel || {}),
        range: {
          ...range,
          projection: buildCashflowRangeTotals(sourceMonths, 'projection', range),
          actual: buildCashflowRangeTotals(sourceMonths, 'actual', range),
        },
        months: sourceMonths.map((month) => {
          const monthComparison = comparisonByMonth.get(String(month?.yearMonth || ''));
          return {
            ...month,
            comparison: monthComparison || {
              yearMonth: String(month?.yearMonth || ''),
              weeks: [],
              rowTotals: {},
              totalIn: 0,
              totalOut: 0,
              net: 0,
              totals: {
                projection: { totalIn: 0, totalOut: 0, balance: 0 },
                actual: { totalIn: 0, totalOut: 0, balance: 0 },
                difference: { totalIn: 0, totalOut: 0, balance: 0 },
              },
            },
          };
        }),
      },
      comparison,
    });
  }));
}
