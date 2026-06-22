import cashflowPolicyData from '../../src/app/policies/cashflow-policy.json' with { type: 'json' };
import {
  findFinanceWeekForDate,
  getMonthFinanceWeeks,
  getYearFinanceWeeks,
} from '../../src/app/platform/cashflow-week-core.mjs';
import { CASHFLOW_ALL_LINES, CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from './cashflow-policy.mjs';

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
const PROJECTION_CHANGE_ALERT_THRESHOLD_AMOUNT = 10_000_000;
const CASHFLOW_WEEKS_COLLECTION_ID = 'cashflow_weeks';
const WEEKLY_SUBMISSION_STATUS_COLLECTION_ID = 'weekly_submission_status';

function buildAmountChanges({ mode, amounts, existingData }) {
  const normalizedAmounts = normalizeAmounts(amounts);
  const existingModeAmounts = normalizeAmounts(existingData?.[mode] || {});
  return Object.entries(normalizedAmounts)
    .map(([lineId, afterAmount]) => {
      const beforeHadValue = Object.prototype.hasOwnProperty.call(existingData?.[mode] || {}, lineId);
      const beforeAmount = Number(existingModeAmounts[lineId] || 0);
      return {
        mode,
        lineId,
        beforeAmount,
        afterAmount,
        beforeHadValue,
        afterHadValue: true,
      };
    })
    .filter((change) => !change.beforeHadValue || change.beforeAmount !== change.afterAmount);
}

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

function parseYearMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month, yearMonth: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}` };
}

export function getMonthCashflowWeeks(yearMonth) {
  return getMonthFinanceWeeks(yearMonth);
}

function getYearCashflowWeeks(year) {
  return getYearFinanceWeeks(year);
}

function findWeekForDate(dateStr, weeks) {
  return findFinanceWeekForDate(dateStr, weeks);
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
  return getMonthCashflowWeeks(`${year}-${String(month).padStart(2, '0')}`).find((week) => week.weekNo === weekNo);
}

function parseDateIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (compact) {
    return `${compact[1]}-${String(Number.parseInt(compact[2], 10)).padStart(2, '0')}-${String(Number.parseInt(compact[3], 10)).padStart(2, '0')}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
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

function computeCashflowTotals(amounts) {
  const normalized = normalizeAmounts(amounts);
  const totalIn = CASHFLOW_IN_LINES.reduce((sum, lineId) => sum + (Number(normalized[lineId]) || 0), 0);
  const totalOut = CASHFLOW_OUT_LINES.reduce((sum, lineId) => sum + (Number(normalized[lineId]) || 0), 0);
  return { totalIn, totalOut, net: totalIn - totalOut };
}

function parseDateOnlyUtc(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return Date.UTC(year, month - 1, day);
}

function buildProjectionChangeAlert({ previousProjection, nextProjection, weekStart, now, actorId, actorName }) {
  const previous = normalizeAmounts(previousProjection || {});
  const next = normalizeAmounts(nextProjection || {});
  if (Object.keys(previous).length === 0) return null;

  const nowDate = parseDateOnlyUtc(now);
  const weekStartDate = parseDateOnlyUtc(weekStart);
  if (nowDate === null || weekStartDate === null) return null;
  const daysBeforeWeekStart = Math.floor((weekStartDate - nowDate) / (24 * 60 * 60 * 1000));
  if (daysBeforeWeekStart < 0 || daysBeforeWeekStart > 7) return null;

  const lineIds = new Set([...Object.keys(previous), ...Object.keys(next)]);
  let totalAbsDelta = 0;
  let netDelta = 0;
  let largestLineId;
  let largestLineDelta = 0;
  let previousAmount;
  let nextAmount;
  for (const lineId of lineIds) {
    const before = Number(previous[lineId] || 0);
    const after = Number(next[lineId] || 0);
    const delta = after - before;
    const absDelta = Math.abs(delta);
    totalAbsDelta += absDelta;
    netDelta += delta;
    if (absDelta > largestLineDelta) {
      largestLineDelta = absDelta;
      largestLineId = lineId;
      previousAmount = before;
      nextAmount = after;
    }
  }

  if (totalAbsDelta < PROJECTION_CHANGE_ALERT_THRESHOLD_AMOUNT && largestLineDelta < PROJECTION_CHANGE_ALERT_THRESHOLD_AMOUNT) {
    return null;
  }

  return {
    triggered: true,
    reason: 'near_week_large_projection_change',
    changedAt: now,
    changedByUid: actorId,
    changedByName: actorName,
    daysBeforeWeekStart,
    thresholdAmount: PROJECTION_CHANGE_ALERT_THRESHOLD_AMOUNT,
    totalAbsDelta,
    netDelta,
    largestLineId,
    largestLineDelta,
    previousAmount,
    nextAmount,
  };
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
  const nextModeAmounts = {
    ...existingModeAmounts,
    ...normalizedAmounts,
  };
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
    [`${mode}Totals`]: computeCashflowTotals(nextModeAmounts),
  };
  if (Object.keys(normalizedAmounts).length > 0) {
    patch[mode] = nextModeAmounts;
    if (mode === 'projection') {
      patch.projectionUpdated = true;
      patch.projectionUpdatedAt = now;
      patch.projectionUpdatedByUid = actorId;
      patch.projectionUpdatedByName = actorName;
      patch.projectionChangeAlert = buildProjectionChangeAlert({
        previousProjection: existingModeAmounts,
        nextProjection: nextModeAmounts,
        weekStart: week.weekStart,
        now,
        actorId,
        actorName,
      });
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

function buildSheetWeekFallback(yearMonth, weekNo) {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return null;
  return {
    yearMonth: parsed.yearMonth,
    weekNo,
    weekStart: '',
    weekEnd: '',
    label: `${parsed.year % 100}-${parsed.month}-${weekNo}`,
    sheetOnly: true,
  };
}

export async function upsertCashflowWeekAmounts({
  db,
  tenantId,
  actorId,
  actorName,
  projectId,
  mode,
  yearMonth,
  weekNo,
  amounts,
  now,
  allowSheetWeek = false,
}) {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) {
    const error = new Error('Invalid yearMonth');
    error.statusCode = 400;
    throw error;
  }
  const canonicalWeek = getMonthCashflowWeeks(parsed.yearMonth).find((week) => week.weekNo === weekNo);
  const targetWeek = canonicalWeek || (allowSheetWeek ? buildSheetWeekFallback(parsed.yearMonth, weekNo) : null);
  if (!targetWeek) {
    const error = new Error('Invalid cashflow week');
    error.statusCode = 400;
    throw error;
  }

  const weekRef = db.doc(`orgs/${tenantId}/${CASHFLOW_WEEKS_COLLECTION_ID}/${resolveWeekDocId(projectId, targetWeek.yearMonth, targetWeek.weekNo)}`);
  const statusRef = canonicalWeek
    ? db.doc(`orgs/${tenantId}/${WEEKLY_SUBMISSION_STATUS_COLLECTION_ID}/${resolveWeekDocId(projectId, targetWeek.yearMonth, targetWeek.weekNo)}`)
    : null;
  const statusPatch = canonicalWeek
    ? buildStatusPatch({ tenantId, actorId, actorName, projectId, week: targetWeek, mode, now })
    : null;
  let amountChanges = [];

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(weekRef);
    const existingData = snap.exists ? snap.data() : undefined;
    amountChanges = buildAmountChanges({ mode, amounts, existingData });
    const patch = buildWeekPatch({
      tenantId,
      actorId,
      actorName,
      projectId,
      mode,
      week: targetWeek,
      amounts,
      now,
      existingData,
    });
    tx.set(weekRef, {
      ...(snap.exists ? {} : { createdAt: now, pmSubmitted: false, adminClosed: false }),
      ...patch,
      ...(canonicalWeek ? {} : { sheetWeekSource: 'cashflow-sheet-lab' }),
    }, { merge: true });
    if (statusRef && statusPatch) tx.set(statusRef, statusPatch, { merge: true });
  });

  return {
    projectId,
    yearMonth: targetWeek.yearMonth,
    weekNo: targetWeek.weekNo,
    weekStart: targetWeek.weekStart,
    weekEnd: targetWeek.weekEnd,
    mode,
    amountChanges,
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
    const weekRef = db.doc(`orgs/${tenantId}/${CASHFLOW_WEEKS_COLLECTION_ID}/${resolveWeekDocId(projectId, week.yearMonth, week.weekNo)}`);
    const statusRef = db.doc(`orgs/${tenantId}/${WEEKLY_SUBMISSION_STATUS_COLLECTION_ID}/${resolveWeekDocId(projectId, week.yearMonth, week.weekNo)}`);
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
