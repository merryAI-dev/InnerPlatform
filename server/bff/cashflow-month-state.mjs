import { createHttpError, readOptionalText } from './bff-utils.mjs';

const LOCKED_STATUSES = new Set(['PENDING', 'APPROVED', 'REOPEN_REQUESTED', 'APPROVING', 'UNCERTAIN']);

function isYearMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function lockRange(record) {
  const scope = record?.scope && typeof record.scope === 'object' && !Array.isArray(record.scope)
    ? record.scope
    : {};
  const fromMonth = readOptionalText(scope.fromMonth) || readOptionalText(record?.fromMonth) || readOptionalText(record?.yearMonth);
  const throughMonth = readOptionalText(scope.throughMonth) || readOptionalText(record?.throughMonth) || readOptionalText(record?.yearMonth);
  return isYearMonth(fromMonth) && isYearMonth(throughMonth) && fromMonth <= throughMonth
    ? { fromMonth, throughMonth }
    : null;
}

export function cashflowMonthRequestCovers(record, { projectId, yearMonth }) {
  if (readOptionalText(record?.projectId) !== projectId) return false;
  const range = lockRange(record);
  return Boolean(range && yearMonth >= range.fromMonth && yearMonth <= range.throughMonth);
}

export function cashflowMonthLockFor(records, { projectId, yearMonth }) {
  for (const record of records) {
    if (!cashflowMonthRequestCovers(record, { projectId, yearMonth })) continue;
    const range = lockRange(record);
    const status = readOptionalText(record?.status).toUpperCase();
    if (LOCKED_STATUSES.has(status)) return { status, ...range, requestId: readOptionalText(record?.requestId) };
  }
  return null;
}

export async function assertCashflowMonthWritable({ db, transaction, tenantId, projectId, yearMonth }) {
  if (!isYearMonth(yearMonth)) {
    throw createHttpError(400, 'Cashflow month is invalid', 'cashflow_month_invalid');
  }
  const query = db.collection(`orgs/${tenantId}/cashflow_month_close_requests`)
    .where('projectId', '==', projectId);
  const snapshot = transaction ? await transaction.get(query) : await query.get();
  const lock = cashflowMonthLockFor(snapshot.docs.map((doc) => doc.data() || {}), { projectId, yearMonth });
  if (!lock) return;
  throw createHttpError(
    409,
    `${yearMonth} 월은 ${lock.status === 'PENDING' ? '결재 대기' : '월 결산'} 상태라 수정할 수 없습니다.`,
    'cashflow_month_locked',
  );
}

export function isCashflowMonthLockedStatus(status) {
  return LOCKED_STATUSES.has(readOptionalText(status).toUpperCase());
}
