#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

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

const baseUrl = readText(
  readArg('base-url'),
  process.env.JVM_WEEKLY_SMOKE_URL,
  process.env.JVM_WEEKLY_API_BASE_URL,
).replace(/\/$/, '');
const serviceToken = readText(
  readArg('service-token'),
  process.env.JVM_WEEKLY_INTERNAL_API_TOKEN,
  process.env.WEEKLY_API_INTERNAL_TOKEN,
);
const identityToken = readText(
  readArg('identity-token'),
  process.env.JVM_WEEKLY_SMOKE_ID_TOKEN,
  process.env.JVM_WEEKLY_ID_TOKEN,
);
const requireIdentityToken = process.argv.includes('--require-identity-token')
  || String(process.env.JVM_WEEKLY_REQUIRE_ID_TOKEN || '').trim().toLowerCase() === 'true';
const tenantId = readText(readArg('tenant-id'), process.env.JVM_WEEKLY_SMOKE_TENANT_ID, 'stage-smoke');
const actorId = readText(readArg('actor-id'), process.env.JVM_WEEKLY_SMOKE_ACTOR_ID, 'stage-smoke-finance');
const actorRole = readText(readArg('actor-role'), process.env.JVM_WEEKLY_SMOKE_ACTOR_ROLE, 'finance');
const actorEmail = readText(readArg('actor-email'), process.env.JVM_WEEKLY_SMOKE_ACTOR_EMAIL, 'stage-smoke@example.invalid');
const runId = readText(readArg('run-id'), process.env.JVM_WEEKLY_SMOKE_RUN_ID, randomUUID().slice(0, 12));
const projectId = readText(readArg('project-id'), process.env.JVM_WEEKLY_SMOKE_PROJECT_ID, `stage-smoke-${runId}`);
const sheetKey = readText(readArg('sheet-key'), process.env.JVM_WEEKLY_SMOKE_SHEET_KEY, 'default');

if (!baseUrl) {
  console.error('[smoke-jvm-weekly-api] --base-url or JVM_WEEKLY_SMOKE_URL is required');
  process.exit(1);
}
if (!serviceToken && !identityToken) {
  console.error('[smoke-jvm-weekly-api] --service-token/JVM_WEEKLY_INTERNAL_API_TOKEN or --identity-token/JVM_WEEKLY_SMOKE_ID_TOKEN is required for command smoke');
  process.exit(1);
}
if (requireIdentityToken && !identityToken) {
  console.error('[smoke-jvm-weekly-api] --require-identity-token requires --identity-token/JVM_WEEKLY_SMOKE_ID_TOKEN');
  process.exit(1);
}
if (requireIdentityToken && serviceToken) {
  console.error('[smoke-jvm-weekly-api] --require-identity-token forbids service token fallback');
  process.exit(1);
}

let sessionCookie = '';

function headers(extra = {}) {
  return {
    'content-type': 'application/json',
    ...(serviceToken ? { 'x-inner-platform-service-token': serviceToken } : {}),
    ...(!serviceToken && sessionCookie ? { cookie: sessionCookie } : {}),
    'x-tenant-id': tenantId,
    'x-actor-id': actorId,
    'x-actor-role': actorRole,
    'x-actor-email': actorEmail,
    ...(identityToken && !sessionCookie ? { authorization: `Bearer ${identityToken}` } : {}),
    ...extra,
  };
}

function readSetCookie(response) {
  const getSetCookie = response.headers.getSetCookie?.();
  if (Array.isArray(getSetCookie) && getSetCookie.length > 0) {
    return getSetCookie[0].split(';')[0];
  }
  const header = response.headers.get('set-cookie') || '';
  return header.split(';')[0].trim();
}

async function requestJson(method, path, body) {
  const requestId = `smoke-${method.toLowerCase()}-${runId}-${randomUUID().slice(0, 8)}`;
  const requestHeaders = headers({
    'x-request-id': requestId,
    ...(method !== 'GET' && body?.idempotencyKey ? { 'idempotency-key': body.idempotencyKey } : {}),
  });
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
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
  if (!response.ok) {
    console.error('[smoke-jvm-weekly-api] request failed', JSON.stringify({
      method,
      path,
      status: response.status,
      payload,
    }, null, 2));
    process.exit(1);
  }
  return payload;
}

async function createSessionCookie() {
  if (!identityToken || serviceToken) return;
  const response = await fetch(`${baseUrl}/api/v1/auth/session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': `session-${runId}`,
    },
    body: JSON.stringify({ idToken: identityToken }),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error('[smoke-jvm-weekly-api] session creation failed', JSON.stringify({
      status: response.status,
      payload: text,
    }, null, 2));
    process.exit(1);
  }
  sessionCookie = readSetCookie(response);
  if (!sessionCookie) {
    console.error('[smoke-jvm-weekly-api] session creation did not return a Set-Cookie header');
    process.exit(1);
  }
}

function assert(condition, message, details = {}) {
  if (condition) return;
  console.error('[smoke-jvm-weekly-api] assertion failed', JSON.stringify({ message, ...details }, null, 2));
  process.exit(1);
}

const pathPrefix = `/api/v1/weekly-expenses/${encodeURIComponent(projectId)}/sheets/${encodeURIComponent(sheetKey)}`;

await requestJson('GET', '/api/v1/health');
await createSessionCookie();

const patch = await requestJson('POST', `${pathPrefix}/commands/cell-patch`, {
  idempotencyKey: `smoke-cell-patch-${runId}`,
  sheetName: 'Stage Smoke',
  cells: [
    { rowIndex: 0, columnIndex: 2, rawValue: '2026-06-01', userEdited: true },
    { rowIndex: 0, columnIndex: 3, rawValue: '2026-06-W1', userEdited: true },
    { rowIndex: 0, columnIndex: 8, rawValue: '사업비', userEdited: true },
    { rowIndex: 0, columnIndex: 13, rawValue: '1000', userEdited: true },
  ],
});
assert(patch.commandName === 'weeklyExpense.cell.patch', 'cell patch command name mismatch', { commandName: patch.commandName });
assert(Number(patch.sheetVersion) >= 0, 'cell patch did not return sheet version', { sheetVersion: patch.sheetVersion });
assert(Array.isArray(patch.actualDelta) && patch.actualDelta.some((line) => Number(line.amount) === 1000), 'cell patch did not calculate actual delta', { actualDelta: patch.actualDelta });

const copy = await requestJson('POST', `${pathPrefix}/commands/copy`, {
  idempotencyKey: `smoke-copy-${runId}`,
  expectedSheetVersion: patch.sheetVersion,
  startRow: 0,
  startColumn: 3,
  endRow: 0,
  endColumn: 13,
  depth: 'DEEP',
});
assert(copy.commandName === 'weeklyExpense.cells.copy', 'copy command name mismatch', { commandName: copy.commandName });
assert(copy.clipboard?.rowCount === 1 && copy.clipboard?.columnCount === 11, 'copy did not return rectangular clipboard', { clipboard: copy.clipboard });

const paste = await requestJson('POST', `${pathPrefix}/commands/paste`, {
  idempotencyKey: `smoke-paste-${runId}`,
  expectedSheetVersion: patch.sheetVersion,
  sheetName: 'Stage Smoke',
  anchorRow: 1,
  anchorColumn: 3,
  rowCount: 1,
  columnCount: 11,
  depth: 'SHALLOW',
  cells: Array.from({ length: 11 }, (_, relativeColumn) => ({
    relativeRow: 0,
    relativeColumn,
    rawValue: relativeColumn === 0
      ? '2026-06-W1'
      : relativeColumn === 5
        ? '사업비'
        : relativeColumn === 10
          ? '2000'
          : '',
  })),
});
assert(paste.commandName === 'weeklyExpense.cells.paste', 'paste command name mismatch', { commandName: paste.commandName });
assert(Array.isArray(paste.actualDelta) && paste.actualDelta.some((line) => Number(line.amount) >= 3000), 'paste did not recalculate aggregate actual delta', { actualDelta: paste.actualDelta });

const cut = await requestJson('POST', `${pathPrefix}/commands/cut`, {
  idempotencyKey: `smoke-cut-${runId}`,
  expectedSheetVersion: paste.sheetVersion,
  startRow: 1,
  startColumn: 3,
  endRow: 1,
  endColumn: 13,
  depth: 'DEEP',
});
assert(cut.commandName === 'weeklyExpense.cells.cut', 'cut command name mismatch', { commandName: cut.commandName });
assert(cut.clipboard?.rowCount === 1 && cut.clipboard?.columnCount === 11, 'cut did not return rectangular clipboard', { clipboard: cut.clipboard });

const rowInsert = await requestJson('POST', `${pathPrefix}/commands/row-insert`, {
  idempotencyKey: `smoke-row-insert-${runId}`,
  expectedSheetVersion: cut.sheetVersion,
  sheetName: 'Stage Smoke',
  startRow: 2,
  rowCount: 1,
});
assert(rowInsert.commandName === 'weeklyExpense.row.insert', 'row insert command name mismatch', { commandName: rowInsert.commandName });
assert(Number(rowInsert.affectedRowCount) === 1, 'row insert affected row count mismatch', rowInsert);
const insertedRowVersion = rowInsert.rowVersions?.find((row) => Number(row.rowIndex) === 2)?.rowVersion;
assert(Number.isInteger(Number(insertedRowVersion)), 'row insert did not return inserted row version', { rowVersions: rowInsert.rowVersions });

const rowDelete = await requestJson('POST', `${pathPrefix}/commands/row-delete`, {
  idempotencyKey: `smoke-row-delete-${runId}`,
  expectedSheetVersion: rowInsert.sheetVersion,
  startRow: 2,
  rowCount: 1,
  expectedRowVersions: [
    { rowIndex: 2, rowVersion: Number(insertedRowVersion) },
  ],
});
assert(rowDelete.commandName === 'weeklyExpense.row.delete', 'row delete command name mismatch', { commandName: rowDelete.commandName });
assert(Number(rowDelete.affectedRowCount) === 1, 'row delete affected row count mismatch', rowDelete);

const bankImport = await requestJson('POST', `/api/v1/weekly-expenses/${encodeURIComponent(projectId)}/bank-statements/import-batch`, {
  idempotencyKey: `smoke-bank-import-${runId}`,
  uploadName: `stage-smoke-bank-${runId}.xlsx`,
  columns: ['거래일시', '지급처', '적요', '금액', '잔액'],
  lines: [
    {
      lineIndex: 0,
      sourceLineKey: `smoke-bank-line-${runId}`,
      transactionDate: '2026-06-02',
      counterparty: 'Stage Smoke Vendor',
      memo: 'stage smoke selected apply',
      signedAmount: -500,
      balanceAfter: 9500,
      rawCells: ['2026-06-02', 'Stage Smoke Vendor', 'stage smoke selected apply', '-500', '9500'],
    },
  ],
});
assert(bankImport.commandName === 'weeklyExpense.bankStatement.importBatch', 'bank import command name mismatch', { commandName: bankImport.commandName });
assert(Number(bankImport.stagedLineCount) === 1, 'bank import did not stage one line', bankImport);

const importLines = await requestJson('GET', `/api/v1/weekly-expenses/${encodeURIComponent(projectId)}/bank-statements/import-lines?status=staged`);
const importLineId = importLines.lines?.find((line) => line.sourceLineKey === `smoke-bank-line-${runId}`)?.id || '';
assert(importLineId, 'staged bank import line not listed', importLines);

const bankApply = await requestJson('POST', `/api/v1/weekly-expenses/${encodeURIComponent(projectId)}/bank-statements/apply-items`, {
  idempotencyKey: `smoke-bank-apply-${runId}`,
  expectedSheetVersion: rowDelete.sheetVersion,
  sheetKey,
  sheetName: 'Stage Smoke',
  items: [
    {
      importLineId,
      cells: [
        { columnIndex: 3, rawValue: '2026-06-W1', userEdited: true },
        { columnIndex: 5, rawValue: '운영비', userEdited: true },
        { columnIndex: 6, rawValue: '검증', userEdited: true },
        { columnIndex: 8, rawValue: '사업비', userEdited: true },
      ],
    },
  ],
});
assert(bankApply.commandName === 'weeklyExpense.bankStatement.applyItems', 'bank apply command name mismatch', { commandName: bankApply.commandName });
assert(Number(bankApply.appliedLineCount) === 1, 'bank apply did not apply one selected line', bankApply);

const projection = await requestJson('POST', `/api/v1/cashflow/${encodeURIComponent(projectId)}/projection`, {
  idempotencyKey: `smoke-projection-${runId}`,
  lines: [
    {
      yearMonth: '2026-06',
      weekNo: 1,
      cashflowLine: 'DIRECT_COST_OUT',
      amount: 3000,
    },
  ],
});
assert(projection.commandName === 'weeklyExpense.projection.upsert', 'projection command name mismatch', { commandName: projection.commandName });

const submit = await requestJson('POST', `/api/v1/weekly-expenses/${encodeURIComponent(projectId)}/submit`, {
  idempotencyKey: `smoke-submit-${runId}`,
  yearMonth: '2026-06',
  weekNo: 1,
});
assert(submit.commandName === 'weeklyExpense.submitWeek' && submit.state === 'submitted', 'submit command failed', submit);

const close = await requestJson('POST', `/api/v1/weekly-expenses/${encodeURIComponent(projectId)}/close`, {
  idempotencyKey: `smoke-close-${runId}`,
  yearMonth: '2026-06',
  weekNo: 1,
});
assert(close.commandName === 'weeklyExpense.closeWeek' && close.state === 'closed', 'close command failed', close);

const statuses = await requestJson('GET', `/api/v1/weekly-expenses/${encodeURIComponent(projectId)}/statuses`);
assert(statuses.statuses?.[0]?.state === 'closed', 'weekly status read state mismatch', statuses);
assert(statuses.statuses?.[0]?.pmSubmitted === true, 'weekly status read submitted flag mismatch', statuses);
assert(statuses.statuses?.[0]?.adminClosed === true, 'weekly status read closed flag mismatch', statuses);

const cashflow = await requestJson('GET', `/api/v1/cashflow/${encodeURIComponent(projectId)}`);
const projectionHasSmoke = cashflow.projection?.some((line) => line.yearMonth === '2026-06' && Number(line.amount) === 3000);
const actualHasSmoke = cashflow.actual?.some((line) => line.yearMonth === '2026-06' && Number(line.amount) >= 1000);
assert(projectionHasSmoke, 'cashflow read model did not include projection', { projection: cashflow.projection });
assert(actualHasSmoke, 'cashflow read model did not include actual', { actual: cashflow.actual });

const auditExport = await requestJson('POST', `/api/v1/weekly-expenses/${encodeURIComponent(projectId)}/audit-export`, {
  idempotencyKey: `smoke-audit-export-${runId}`,
  format: 'CSV',
  includeAuditSummary: true,
});
assert(auditExport.commandName === 'weeklyExpense.auditExport.create', 'audit export command name mismatch', { commandName: auditExport.commandName });
assert(Number(auditExport.projectionLineCount) >= 1, 'audit export missing projection lines', auditExport);
assert(Number(auditExport.actualLineCount) >= 1, 'audit export missing actual lines', auditExport);
assert(String(auditExport.content || '').includes('projection'), 'audit export content missing projection section');

console.log(JSON.stringify({
  ok: true,
  projectId,
  sheetKey,
  sheetVersion: bankApply.sheetVersion,
  projectionLineCount: auditExport.projectionLineCount,
  actualLineCount: auditExport.actualLineCount,
  auditEventCount: auditExport.auditEventCount,
}, null, 2));
