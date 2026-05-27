import cashflowPolicyData from '../../src/app/policies/cashflow-policy.json' with { type: 'json' };
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES } from './cashflow-policy.mjs';

const SETTLEMENT_COLUMN_HEADERS = [
  '작성자',
  'No.',
  '거래일시',
  '해당 주차',
  '지출구분',
  '비목',
  '세목',
  '세세목',
  'cashflow항목',
  '통장잔액',
  '통장에 찍힌 입/출금액',
  '입금액(사업비,공급가액,은행이자)',
  '매입부가세 반환',
  '사업비 사용액',
  '매입부가세',
];

const COLUMN_INDEX = Object.fromEntries(SETTLEMENT_COLUMN_HEADERS.map((header, index) => [header, index]));
const CASHFLOW_IN_LINE_IDS = new Set(CASHFLOW_IN_LINES);
const LINE_BY_LABEL = new Map();

function normalizePolicyLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

for (const entry of cashflowPolicyData.lineEntries || []) {
  LINE_BY_LABEL.set(normalizePolicyLabel(entry.lineId), entry.lineId);
  LINE_BY_LABEL.set(normalizePolicyLabel(entry.label), entry.lineId);
  LINE_BY_LABEL.set(normalizePolicyLabel(entry.label).replace(/\s+/g, ''), entry.lineId);
  for (const alias of entry.aliases || []) {
    LINE_BY_LABEL.set(normalizePolicyLabel(alias), entry.lineId);
    LINE_BY_LABEL.set(normalizePolicyLabel(alias).replace(/\s+/g, ''), entry.lineId);
  }
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseYearMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month, yearMonth: `${String(year).padStart(4, '0')}-${pad2(month)}` };
}

function formatIsoDate(year, month, day) {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

function addDaysUtc(isoDate, deltaDays) {
  const [yRaw, mRaw, dRaw] = String(isoDate || '').split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const base = Date.UTC(year, month - 1, day);
  const next = new Date(base + deltaDays * 24 * 60 * 60 * 1000);
  return formatIsoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function dayOfWeekUtc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysInMonthUtc(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function startOfWeekWednesday(isoDate) {
  const [yRaw, mRaw, dRaw] = String(isoDate || '').split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const dow = dayOfWeekUtc(year, month, day);
  const delta = -((dow - 3 + 7) % 7);
  return addDaysUtc(isoDate, delta);
}

function countDaysInMonthForWeek(weekStart, year, month) {
  let count = 0;
  for (let i = 0; i < 7; i += 1) {
    const date = addDaysUtc(weekStart, i);
    const [yy, mm] = date.split('-');
    if (Number.parseInt(yy, 10) === year && Number.parseInt(mm, 10) === month) count += 1;
  }
  return count;
}

export function getMonthCashflowWeeks(yearMonth) {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return [];

  const { year, month } = parsed;
  const firstDay = formatIsoDate(year, month, 1);
  const lastDay = formatIsoDate(year, month, daysInMonthUtc(year, month));
  let weekStart = startOfWeekWednesday(firstDay);
  const weeks = [];
  const yy = year % 100;
  let weekNo = 0;

  while (weekStart <= lastDay) {
    const daysInMonth = countDaysInMonthForWeek(weekStart, year, month);
    if (daysInMonth >= 4) {
      weekNo += 1;
      weeks.push({
        yearMonth: parsed.yearMonth,
        weekNo,
        weekStart,
        weekEnd: addDaysUtc(weekStart, 6),
        label: `${yy}-${month}-${weekNo}`,
      });
    }
    weekStart = addDaysUtc(weekStart, 7);
  }

  return weeks;
}

function getYearCashflowWeeks(year) {
  const all = [];
  for (let month = 1; month <= 12; month += 1) {
    all.push(...getMonthCashflowWeeks(`${year}-${pad2(month)}`));
  }
  return all;
}

function findWeekForDate(dateStr, weeks) {
  if (!dateStr) return undefined;
  const direct = weeks.find((week) => dateStr >= week.weekStart && dateStr <= week.weekEnd);
  if (direct) return direct;

  const [yRaw, mRaw] = dateStr.split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return undefined;

  const current = getMonthCashflowWeeks(`${year}-${pad2(month)}`);
  const inCurrent = current.find((week) => dateStr >= week.weekStart && dateStr <= week.weekEnd);
  if (inCurrent) return inCurrent;

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prev = getMonthCashflowWeeks(`${prevYear}-${pad2(prevMonth)}`);
  const inPrev = prev.find((week) => dateStr >= week.weekStart && dateStr <= week.weekEnd);
  if (inPrev) return inPrev;

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return getMonthCashflowWeeks(`${nextYear}-${pad2(nextMonth)}`)
    .find((week) => dateStr >= week.weekStart && dateStr <= week.weekEnd);
}

function resolveWeekFromLabel(label, anchorWeeks) {
  const normalized = String(label || '').trim();
  if (!normalized) return undefined;
  const direct = anchorWeeks.find((week) => week.label === normalized);
  if (direct) return direct;

  const match = /^(\d{2})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (!match) return undefined;
  const year = 2000 + Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const weekNo = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(weekNo)) return undefined;
  return getMonthCashflowWeeks(`${year}-${pad2(month)}`).find((week) => week.weekNo === weekNo);
}

function parseDateIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (compact) {
    return `${compact[1]}-${pad2(Number.parseInt(compact[2], 10))}-${pad2(Number.parseInt(compact[3], 10))}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return formatIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function resolveWeekFromRow(row, anchorWeeks) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  const explicitLabel = String(cells[COLUMN_INDEX['해당 주차']] || '').trim();
  const fromLabel = resolveWeekFromLabel(explicitLabel, anchorWeeks);
  if (fromLabel) return fromLabel;

  const dateOnly = parseDateIso(cells[COLUMN_INDEX['거래일시']]);
  if (!dateOnly) return undefined;
  const dateYear = Number.parseInt(dateOnly.slice(0, 4), 10);
  const anchorYear = Number.parseInt(anchorWeeks[0]?.yearMonth?.slice(0, 4) || '', 10);
  return findWeekForDate(dateOnly, dateYear === anchorYear ? anchorWeeks : getYearCashflowWeeks(dateYear));
}

export function parseCashflowLineLabel(raw) {
  const normalized = normalizePolicyLabel(raw);
  if (!normalized) return undefined;
  return LINE_BY_LABEL.get(normalized) || LINE_BY_LABEL.get(normalized.replace(/\s+/g, ''));
}

function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const negativeByParens = /^\(.+\)$/.test(raw);
  const sanitized = raw.replace(/[,\s원₩$]/g, '').replace(/[()]/g, '');
  const parsed = Number.parseFloat(sanitized.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) return 0;
  const amount = Math.trunc(parsed);
  return negativeByParens ? -Math.abs(amount) : amount;
}

function rowAmount(row, header) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  return parseAmount(cells[COLUMN_INDEX[header]]);
}

function isBankImportedExpenseRow(row) {
  return String(row?.sourceTxId || '').startsWith('bank:') && row?.entryKind === 'EXPENSE';
}

function resolveActualLineAmounts(row) {
  const cells = Array.isArray(row?.cells) ? row.cells : [];
  const lineId = parseCashflowLineLabel(cells[COLUMN_INDEX['cashflow항목']]);
  if (!lineId) return {};

  const bankAmount = rowAmount(row, '통장에 찍힌 입/출금액');
  const expenseAmount = rowAmount(row, '사업비 사용액');
  const vatIn = rowAmount(row, '매입부가세');
  const depositAmount = rowAmount(row, '입금액(사업비,공급가액,은행이자)');
  const refundAmount = rowAmount(row, '매입부가세 반환');
  const isInflowLine = CASHFLOW_IN_LINE_IDS.has(lineId);
  const manualOutflowPending = isBankImportedExpenseRow(row) && (
    !lineId
    || (
      lineId === 'INPUT_VAT_OUT'
        ? vatIn <= 0
        : !isInflowLine && expenseAmount <= 0
    )
  );

  if (manualOutflowPending) return {};

  if (isInflowLine) {
    const outflowAdjustmentAmount = expenseAmount < 0
      ? expenseAmount
      : row?.entryKind === 'EXPENSE' && depositAmount <= 0 && refundAmount <= 0 && bankAmount > 0
        ? -bankAmount
        : 0;
    const inflowAmount = depositAmount > 0 ? depositAmount : refundAmount > 0 ? refundAmount : bankAmount;
    if (outflowAdjustmentAmount < 0) return { [lineId]: outflowAdjustmentAmount };
    return inflowAmount > 0 ? { [lineId]: inflowAmount } : {};
  }

  if (lineId === 'INPUT_VAT_OUT') {
    return vatIn > 0 ? { INPUT_VAT_OUT: vatIn } : {};
  }

  const amounts = {};
  const primaryOutAmount = expenseAmount > 0
    ? expenseAmount
    : depositAmount > 0 || refundAmount > 0
      ? 0
      : bankAmount;
  if (primaryOutAmount > 0) amounts[lineId] = primaryOutAmount;
  if (vatIn > 0) amounts.INPUT_VAT_OUT = (amounts.INPUT_VAT_OUT || 0) + vatIn;
  return amounts;
}

function normalizeAmounts(amounts) {
  const normalized = {};
  for (const lineId of CASHFLOW_ALL_LINES) {
    if (Object.prototype.hasOwnProperty.call(amounts || {}, lineId)) {
      normalized[lineId] = parseAmount(amounts[lineId]);
    }
  }
  return normalized;
}

function weekKey(week) {
  return `${week.yearMonth}:w${week.weekNo}`;
}

function parseWeekKey(key) {
  const match = /^(\d{4}-\d{2}):w(\d+)$/.exec(String(key || ''));
  if (!match) return undefined;
  const weekNo = Number.parseInt(match[2], 10);
  return getMonthCashflowWeeks(match[1]).find((week) => week.weekNo === weekNo);
}

export function buildCashflowActualSyncPlan({ rows, previousWeekKeys = [], anchorYear }) {
  const fallbackYear = Number.isFinite(anchorYear) ? anchorYear : new Date().getFullYear();
  const anchorWeeks = getYearCashflowWeeks(fallbackYear);
  const weekLabels = new Set();
  const byWeek = new Map();

  for (const row of rows || []) {
    const week = resolveWeekFromRow(row, anchorWeeks);
    if (!week) continue;
    const key = weekKey(week);
    weekLabels.add(key);
    const target = byWeek.get(key) || {};
    for (const [lineId, amount] of Object.entries(resolveActualLineAmounts(row))) {
      if (!amount) continue;
      target[lineId] = (target[lineId] || 0) + amount;
    }
    byWeek.set(key, target);
  }

  const payload = Array.from(weekLabels)
    .map((key) => {
      const week = parseWeekKey(key);
      return week ? { ...week, key, amounts: { ...(byWeek.get(key) || {}) } } : null;
    })
    .filter((week) => week && Object.keys(week.amounts || {}).length > 0)
    .filter(Boolean)
    .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth) || a.weekNo - b.weekNo);

  return {
    weeks: payload,
    clearedWeeks: [],
    weekKeys: payload.map((week) => week.key),
  };
}

function resolveWeekDocId(projectId, yearMonth, weekNo) {
  return `${projectId}-${yearMonth}-w${weekNo}`;
}

async function commitInChunks(db, mutations) {
  for (let offset = 0; offset < mutations.length; offset += 450) {
    const batch = db.batch();
    for (const mutation of mutations.slice(offset, offset + 450)) {
      mutation(batch);
    }
    await batch.commit();
  }
}

function buildWeekPatch({ tenantId, actorId, actorName, projectId, mode, week, amounts, now, existingData }) {
  const normalizedAmounts = normalizeAmounts(amounts);
  const existingModeAmounts = normalizeAmounts(existingData?.[mode] || {});
  const patch = {
    id: resolveWeekDocId(projectId, week.yearMonth, week.weekNo),
    tenantId,
    projectId,
    yearMonth: week.yearMonth,
    weekNo: week.weekNo,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    [`${mode}Source`]: mode === 'actual' ? 'expense_sheets_bff' : 'cashflow_input_bff',
    [`${mode}SyncedAt`]: now,
    updatedAt: now,
    updatedByUid: actorId,
    updatedByName: actorName,
  };
  if (Object.keys(normalizedAmounts).length > 0) {
    patch[mode] = {
      ...existingModeAmounts,
      ...normalizedAmounts,
    };
    if (mode === 'projection') {
      patch.projectionUpdated = true;
      patch.projectionUpdatedAt = now;
      patch.projectionUpdatedByUid = actorId;
      patch.projectionUpdatedByName = actorName;
    }
  }
  return patch;
}

function buildStatusPatch({ tenantId, actorId, actorName, projectId, week, mode, now, syncState }) {
  const id = resolveWeekDocId(projectId, week.yearMonth, week.weekNo);
  return {
    id,
    tenantId,
    projectId,
    yearMonth: week.yearMonth,
    weekNo: week.weekNo,
    ...(mode === 'projection'
      ? {
        projectionEdited: true,
        projectionUpdated: true,
        projectionUpdatedAt: now,
        projectionUpdatedByName: actorName,
      }
      : {
        expenseUpdated: true,
        expenseSyncState: syncState || 'synced',
        expenseReviewPendingCount: 0,
        expenseUpdatedAt: now,
        expenseUpdatedByName: actorName,
      }),
    updatedAt: now,
    updatedByUid: actorId,
    updatedByName: actorName,
  };
}

export async function upsertCashflowWeekAmounts({ db, tenantId, actorId, actorName, projectId, mode, yearMonth, weekNo, amounts, now }) {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) {
    const error = new Error('Invalid yearMonth');
    error.statusCode = 400;
    throw error;
  }
  const targetWeek = getMonthCashflowWeeks(parsed.yearMonth).find((week) => week.weekNo === weekNo);
  if (!targetWeek) {
    const error = new Error('Invalid cashflow week');
    error.statusCode = 400;
    throw error;
  }

  const weekRef = db.doc(`orgs/${tenantId}/cashflow_weeks/${resolveWeekDocId(projectId, targetWeek.yearMonth, targetWeek.weekNo)}`);
  const statusRef = db.doc(`orgs/${tenantId}/weekly_submission_status/${resolveWeekDocId(projectId, targetWeek.yearMonth, targetWeek.weekNo)}`);
  const statusPatch = buildStatusPatch({ tenantId, actorId, actorName, projectId, week: targetWeek, mode, now });

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(weekRef);
    const patch = buildWeekPatch({
      tenantId,
      actorId,
      actorName,
      projectId,
      mode,
      week: targetWeek,
      amounts,
      now,
      existingData: snap.exists ? snap.data() : undefined,
    });
    tx.set(weekRef, {
      ...(snap.exists ? {} : { createdAt: now, pmSubmitted: false, adminClosed: false }),
      ...patch,
    }, { merge: true });
    tx.set(statusRef, statusPatch, { merge: true });
  });

  return {
    projectId,
    yearMonth: targetWeek.yearMonth,
    weekNo: targetWeek.weekNo,
    weekStart: targetWeek.weekStart,
    weekEnd: targetWeek.weekEnd,
    mode,
    updatedAt: now,
  };
}

export async function syncProjectCashflowActualsFromExpenseSheets({ db, tenantId, actorId, actorName, projectId, now }) {
  const sheetsSnap = await db.collection(`orgs/${tenantId}/projects/${projectId}/expense_sheets`).get();
  const sheets = sheetsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((sheet) => !sheet.deletedAt && !sheet.trashedAt);
  const rows = sheets.flatMap((sheet) => Array.isArray(sheet.rows) ? sheet.rows : []);
  const stateRef = db.doc(`orgs/${tenantId}/cashflow_actual_sync_state/${projectId}`);
  const stateSnap = await stateRef.get().catch(() => null);
  const previousWeekKeys = Array.isArray(stateSnap?.data()?.weekKeys) ? stateSnap.data().weekKeys : [];
  if (rows.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_expense_sheet_rows',
      projectId,
      sourceRows: 0,
      sheetCount: sheets.length,
      upsertedWeeks: 0,
      clearedWeeks: 0,
      weeks: [],
      cleared: [],
      updatedAt: now,
    };
  }
  const plan = buildCashflowActualSyncPlan({
    rows,
    previousWeekKeys,
    anchorYear: new Date(now).getUTCFullYear(),
  });
  const writeWeeks = [...plan.weeks, ...plan.clearedWeeks];

  const mutations = [];
  for (const week of writeWeeks) {
    const weekRef = db.doc(`orgs/${tenantId}/cashflow_weeks/${resolveWeekDocId(projectId, week.yearMonth, week.weekNo)}`);
    const statusRef = db.doc(`orgs/${tenantId}/weekly_submission_status/${resolveWeekDocId(projectId, week.yearMonth, week.weekNo)}`);
    const existingSnap = await weekRef.get().catch(() => null);
    const patch = buildWeekPatch({
      tenantId,
      actorId,
      actorName,
      projectId,
      mode: 'actual',
      week,
      amounts: week.amounts,
      now,
      existingData: existingSnap?.exists ? existingSnap.data() : undefined,
    });
    const statusPatch = buildStatusPatch({
      tenantId,
      actorId,
      actorName,
      projectId,
      week,
      mode: 'actual',
      now,
      syncState: plan.clearedWeeks.some((cleared) => cleared.key === week.key) ? 'synced' : 'synced',
    });
    mutations.push((batch) => {
      batch.set(weekRef, {
        ...patch,
      }, { merge: true });
      batch.set(statusRef, statusPatch, { merge: true });
    });
  }
  mutations.push((batch) => {
    batch.set(stateRef, {
      id: projectId,
      tenantId,
      projectId,
      source: 'expense_sheets_bff',
      weekKeys: plan.weekKeys,
      rowCount: rows.length,
      sheetCount: sheets.length,
      updatedAt: now,
      updatedByUid: actorId,
      updatedByName: actorName,
    }, { merge: true });
  });

  await commitInChunks(db, mutations);

  return {
    ok: true,
    projectId,
    sourceRows: rows.length,
    sheetCount: sheets.length,
    upsertedWeeks: plan.weeks.length,
    clearedWeeks: plan.clearedWeeks.length,
    weeks: plan.weeks.map((week) => ({
      yearMonth: week.yearMonth,
      weekNo: week.weekNo,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      amounts: week.amounts,
    })),
    cleared: plan.clearedWeeks.map((week) => ({
      yearMonth: week.yearMonth,
      weekNo: week.weekNo,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      amounts: week.amounts,
    })),
    updatedAt: now,
  };
}
