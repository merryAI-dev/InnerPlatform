import {
  asyncHandler,
  createHttpError,
  ensureDocumentExists,
  readOptionalText,
} from '../bff-utils.mjs';
import { CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from '../cashflow-policy.mjs';

const CASHFLOW_WEEKS_COLLECTION_ID = 'cashflow_weeks';
const CASHFLOW_LABOR_RISK_SNAPSHOTS_COLLECTION_ID = 'cashflow_labor_risk_snapshots';
const LABOR_LINE_ID = 'MYSC_LABOR_OUT';

function normalizeRole(value) {
  const normalized = readOptionalText(value).toLowerCase();
  return normalized === 'viewer' ? 'pm' : normalized;
}

function isWorkspaceUser(context, workspaceEmailDomain = 'mysc.co.kr') {
  const email = readOptionalText(context?.actorEmail).toLowerCase();
  const domain = readOptionalText(workspaceEmailDomain).replace(/^@+/, '').toLowerCase();
  return Boolean(domain) && email.endsWith(`@${domain}`);
}

function assertCashflowLaborRiskAccess(req, workspaceEmailDomain = 'mysc.co.kr') {
  const actorRole = normalizeRole(req.context?.actorRole);
  if (isWorkspaceUser(req.context, workspaceEmailDomain)) return;
  if (['admin', 'finance_admin', 'finance', 'pm', 'workspace_user'].includes(actorRole)) return;
  throw createHttpError(403, 'Workspace access is required to read cashflow labor risk.', 'forbidden');
}

function projectDocPath(tenantId, projectId) {
  return `orgs/${tenantId}/projects/${projectId}`;
}

function cashflowWeeksCollectionPath(tenantId) {
  return `orgs/${tenantId}/${CASHFLOW_WEEKS_COLLECTION_ID}`;
}

function cashflowLaborRiskSnapshotDocPath(tenantId, projectId) {
  return `orgs/${tenantId}/${CASHFLOW_LABOR_RISK_SNAPSHOTS_COLLECTION_ID}/${projectId}`;
}

function toAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function sumLines(sheet = {}, lineIds = []) {
  return lineIds.reduce((sum, lineId) => sum + toAmount(sheet?.[lineId]), 0);
}

function sumNet(sheet = {}) {
  return sumLines(sheet, CASHFLOW_IN_LINES) - sumLines(sheet, CASHFLOW_OUT_LINES);
}

function getSeoulDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addMonths(yearMonth, offset) {
  const year = Number.parseInt(String(yearMonth).slice(0, 4), 10);
  const month = Number.parseInt(String(yearMonth).slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return '';
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function weekSortKey(week) {
  const yearMonth = readOptionalText(week?.yearMonth);
  const weekNo = Number(week?.weekNo);
  if (!/^\d{4}-\d{2}$/.test(yearMonth) || !Number.isFinite(weekNo)) return '';
  return `${yearMonth}:${String(weekNo).padStart(2, '0')}`;
}

function formatWeekLabel(week) {
  const yearMonth = readOptionalText(week?.yearMonth);
  const weekNo = Number(week?.weekNo);
  const year = Number.parseInt(yearMonth.slice(2, 4), 10);
  const month = Number.parseInt(yearMonth.slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(weekNo)) return '';
  return `${year}-${month}-${weekNo}`;
}

function formatWeekRange(week) {
  const weekStart = readOptionalText(week?.weekStart);
  const weekEnd = readOptionalText(week?.weekEnd);
  if (!weekStart || !weekEnd) return '';
  return `${weekStart} ~ ${weekEnd}`;
}

function toWeekSummary(week) {
  if (!week) return null;
  return {
    yearMonth: readOptionalText(week.yearMonth),
    weekNo: Number(week.weekNo) || 0,
    label: formatWeekLabel(week),
    weekStart: readOptionalText(week.weekStart),
    weekEnd: readOptionalText(week.weekEnd),
    weekRange: formatWeekRange(week),
  };
}

function normalizeActiveWeeks(project = {}, todayYearMonth) {
  const activeWeeks = Array.isArray(project?.cashflowSheetLab?.activeWeeks)
    ? project.cashflowSheetLab.activeWeeks
    : [];
  const normalized = activeWeeks
    .map((week) => ({
      yearMonth: readOptionalText(week?.yearMonth),
      weekNo: Number(week?.weekNo),
      weekStart: readOptionalText(week?.weekStart),
      weekEnd: readOptionalText(week?.weekEnd),
    }))
    .filter((week) => /^\d{4}-\d{2}$/.test(week.yearMonth) && Number.isFinite(week.weekNo));

  if (normalized.length > 0) {
    return normalized.sort((a, b) => weekSortKey(a).localeCompare(weekSortKey(b)));
  }

  const year = Number.parseInt(todayYearMonth.slice(0, 4), 10);
  return Array.from({ length: 12 }, (_, index) => ({
    yearMonth: `${year}-${String(index + 1).padStart(2, '0')}`,
    weekNo: 1,
    weekStart: '',
    weekEnd: '',
  }));
}

function normalizeWeekDoc(doc) {
  return {
    id: readOptionalText(doc?.id),
    projectId: readOptionalText(doc?.projectId),
    yearMonth: readOptionalText(doc?.yearMonth),
    weekNo: Number(doc?.weekNo),
    weekStart: readOptionalText(doc?.weekStart),
    weekEnd: readOptionalText(doc?.weekEnd),
    projection: doc?.projection && typeof doc.projection === 'object' ? doc.projection : {},
    actual: doc?.actual && typeof doc.actual === 'object' ? doc.actual : {},
  };
}

async function readCashflowWeeks({ db, tenantId, projectId, startYearMonth, endYearMonth }) {
  const collection = db.collection(cashflowWeeksCollectionPath(tenantId));
  const snap = await collection
    .where('yearMonth', '>=', startYearMonth)
    .where('yearMonth', '<=', endYearMonth)
    .get();
  return snap.docs
    .map((doc) => normalizeWeekDoc({ id: doc.id, ...doc.data() }))
    .filter((week) => week.projectId === projectId)
    .sort((a, b) => weekSortKey(a).localeCompare(weekSortKey(b)));
}

function mergeActiveWeeksWithDocs(activeWeeks, docs) {
  const byKey = new Map();
  for (const week of activeWeeks) {
    byKey.set(weekSortKey(week), {
      ...week,
      projection: {},
      actual: {},
    });
  }
  for (const week of docs) {
    const key = weekSortKey(week);
    byKey.set(key, {
      ...(byKey.get(key) || {}),
      ...week,
      projection: week.projection || {},
      actual: week.actual || {},
    });
  }
  return Array.from(byKey.values())
    .filter((week) => weekSortKey(week))
    .sort((a, b) => weekSortKey(a).localeCompare(weekSortKey(b)));
}

function monthLabel(yearMonth) {
  const year = Number.parseInt(String(yearMonth).slice(0, 4), 10);
  const month = Number.parseInt(String(yearMonth).slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return yearMonth;
  return `${year}년 ${month}월`;
}

function sumLaborByMonth(weeks, mode) {
  const byMonth = new Map();
  for (const week of weeks) {
    const yearMonth = readOptionalText(week.yearMonth);
    if (!yearMonth) continue;
    byMonth.set(yearMonth, (byMonth.get(yearMonth) || 0) + toAmount(week?.[mode]?.[LABOR_LINE_ID]));
  }
  return byMonth;
}

function buildLaborProjectionCoverageMonths(weeks, projectionLaborByMonth, fromYearMonth) {
  const yearMonths = Array.from(new Set(
    weeks
      .map((week) => readOptionalText(week.yearMonth))
      .filter((yearMonth) => yearMonth >= fromYearMonth),
  )).sort();

  return yearMonths.map((yearMonth) => {
    const projectionAmount = projectionLaborByMonth.get(yearMonth) || 0;
    const laborWeeks = weeks
      .filter((week) => week.yearMonth === yearMonth && toAmount(week?.projection?.[LABOR_LINE_ID]) > 0)
      .map((week) => ({
        ...toWeekSummary(week),
        amount: toAmount(week.projection?.[LABOR_LINE_ID]),
      }));
    return {
      yearMonth,
      label: monthLabel(yearMonth),
      isWritten: projectionAmount > 0,
      status: projectionAmount > 0 ? 'written' : 'missing',
      projectionAmount,
      laborWeeks,
    };
  });
}

export function buildCashflowLaborRisk(projectId, project, weekDocs, options = {}) {
  const todayIso = readOptionalText(options.todayIso) || getSeoulDateIso();
  const todayYearMonth = todayIso.slice(0, 7);
  const previousYearMonth = addMonths(todayYearMonth, -1);
  const activeWeeks = normalizeActiveWeeks(project, todayYearMonth);
  const startYearMonth = activeWeeks[0]?.yearMonth || `${todayIso.slice(0, 4)}-01`;
  const endYearMonth = activeWeeks.at(-1)?.yearMonth || `${todayIso.slice(0, 4)}-12`;
  const weeks = mergeActiveWeeksWithDocs(activeWeeks, weekDocs);
  const actualLaborByMonth = sumLaborByMonth(weeks, 'actual');
  const projectionLaborByMonth = sumLaborByMonth(weeks, 'projection');
  const nextYearMonth = addMonths(todayYearMonth, 1);

  const lastMonthActualLaborAmount = actualLaborByMonth.get(previousYearMonth) || 0;
  const latestActualLaborMonth = Array.from(actualLaborByMonth.entries())
    .filter(([yearMonth, amount]) => yearMonth <= todayYearMonth && amount > 0)
    .sort(([a], [b]) => b.localeCompare(a))[0] || null;
  const referenceActualLaborAmount = lastMonthActualLaborAmount || latestActualLaborMonth?.[1] || 0;

  let currentBalance = 0;
  let currentWeek = null;
  for (const week of weeks) {
    const weekStart = readOptionalText(week.weekStart);
    const includeActual = weekStart ? weekStart <= todayIso : readOptionalText(week.yearMonth) < todayYearMonth;
    if (!includeActual) continue;
    currentBalance += sumNet(week.actual);
    currentWeek = week;
  }

  let runningBalance = currentBalance;
  let shortage = null;
  for (const week of weeks) {
    const weekStart = readOptionalText(week.weekStart);
    const isFuture = weekStart ? weekStart > todayIso : readOptionalText(week.yearMonth) > todayYearMonth;
    if (!isFuture) continue;
    runningBalance += sumNet(week.projection);
    if (!shortage && runningBalance < 0) {
      shortage = {
        week,
        projectedBalance: runningBalance,
        shortageAmount: Math.abs(runningBalance),
      };
    }
  }

  const projectionCoverageMonths = buildLaborProjectionCoverageMonths(weeks, projectionLaborByMonth, todayYearMonth);
  const nextMonthProjection = projectionCoverageMonths.find((month) => month.yearMonth === nextYearMonth) || {
    yearMonth: nextYearMonth,
    label: monthLabel(nextYearMonth),
    isWritten: false,
    status: 'missing',
    projectionAmount: 0,
    laborWeeks: [],
  };
  const missingProjectionMonths = referenceActualLaborAmount > 0
    ? projectionCoverageMonths
      .filter((month) => !month.isWritten)
      .map((month) => ({
        yearMonth: month.yearMonth,
        label: month.label,
        referenceActualAmount: referenceActualLaborAmount,
        weeks: weeks
          .filter((week) => week.yearMonth === month.yearMonth)
          .map((week) => toWeekSummary(week)),
      }))
    : [];

  const nextProjectionLaborWeek = weeks.find((week) => {
    const weekStart = readOptionalText(week.weekStart);
    const isFuture = weekStart ? weekStart > todayIso : readOptionalText(week.yearMonth) >= todayYearMonth;
    return isFuture && toAmount(week?.projection?.[LABOR_LINE_ID]) > 0;
  }) || null;

  const status = shortage ? 'danger' : missingProjectionMonths.length > 0 ? 'warning' : 'ok';
  const reliable = missingProjectionMonths.length === 0;
  const nextLaborAmount = nextProjectionLaborWeek
    ? toAmount(nextProjectionLaborWeek.projection?.[LABOR_LINE_ID])
    : nextMonthProjection.projectionAmount || referenceActualLaborAmount;
  const balanceAfterNextLabor = currentBalance - nextLaborAmount;
  const okMessage = nextLaborAmount > 0
    ? `지난달 Actual 인건비 ${lastMonthActualLaborAmount.toLocaleString('ko-KR')}원, 오늘 기준 Actual 잔액 ${currentBalance.toLocaleString('ko-KR')}원입니다. 다음 인건비 ${nextLaborAmount.toLocaleString('ko-KR')}원이 나가도 예상 잔액은 ${balanceAfterNextLabor.toLocaleString('ko-KR')}원이므로 인건비 부족은 없습니다.`
    : `오늘 기준 Actual 잔액은 ${currentBalance.toLocaleString('ko-KR')}원입니다. 현재 저장된 Projection 기준으로 확인된 잔액 부족 시점은 없습니다.`;
  const message = shortage
    ? `Projection 기준 ${formatWeekLabel(shortage.week)}에 잔액 부족이 예상됩니다.`
    : missingProjectionMonths.length > 0
      ? '미래 월 Projection에 MYSC 인건비가 산입되지 않은 구간이 있어 잔액 예측을 먼저 확인해야 합니다.'
      : okMessage;

  return {
    projectId,
    asOfDate: todayIso,
    snapshotKind: 'cashflow_labor_risk',
    range: {
      startYearMonth,
      endYearMonth,
      weekCount: weeks.length,
    },
    current: {
      balance: currentBalance,
      week: toWeekSummary(currentWeek),
    },
    labor: {
      lastMonth: {
        yearMonth: previousYearMonth,
        label: monthLabel(previousYearMonth),
        actualAmount: lastMonthActualLaborAmount,
      },
      latestActualMonth: latestActualLaborMonth ? {
        yearMonth: latestActualLaborMonth[0],
        label: monthLabel(latestActualLaborMonth[0]),
        actualAmount: latestActualLaborMonth[1],
      } : null,
      referenceActualAmount: referenceActualLaborAmount,
      nextProjection: nextProjectionLaborWeek ? {
        ...toWeekSummary(nextProjectionLaborWeek),
        amount: toAmount(nextProjectionLaborWeek.projection?.[LABOR_LINE_ID]),
      } : null,
      nextMonthProjection,
      projectionCoverageMonths,
      missingProjectionMonths,
      balanceAfterNextLabor,
    },
    shortage: {
      status,
      reliable,
      week: shortage ? toWeekSummary(shortage.week) : null,
      projectedBalance: shortage?.projectedBalance ?? null,
      shortageAmount: shortage?.shortageAmount ?? 0,
      message,
      actions: status === 'ok' ? [] : [
        'Projection에 MYSC 인건비가 월별로 반영됐는지 확인',
        '선입금 또는 지출 조정 필요 여부 확인',
      ],
    },
  };
}

async function persistCashflowLaborRiskSnapshot({ db, tenantId, projectId, risk, context, nowIso }) {
  const snapshotPath = cashflowLaborRiskSnapshotDocPath(tenantId, projectId);
  await db.doc(snapshotPath).set({
    ...risk,
    tenantId,
    projectId,
    updatedAt: nowIso,
    updatedBy: {
      uid: readOptionalText(context?.actorId),
      email: readOptionalText(context?.actorEmail),
      role: readOptionalText(context?.actorRole),
    },
  }, { merge: true });
  return snapshotPath;
}

export function mountCashflowLaborRiskRoutes(app, { db, now } = {}) {
  app.get('/api/v1/projects/:projectId/cashflow-labor-risk', asyncHandler(async (req, res) => {
    assertCashflowLaborRiskAccess(req);
    if (!db) {
      throw createHttpError(503, '인건비 위험 정보를 읽을 수 없습니다. 담당자에게 문의해 주세요.', 'firestore_unconfigured');
    }

    const tenantId = readOptionalText(req.context?.tenantId);
    const projectId = readOptionalText(req.params.projectId);
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');
    if (!projectId) throw createHttpError(400, 'projectId is required.', 'project_required');

    const project = await ensureDocumentExists(db, projectDocPath(tenantId, projectId), `Project not found: ${projectId}`);
    const todayIso = getSeoulDateIso(now ? new Date(now()) : new Date());
    const activeWeeks = normalizeActiveWeeks(project, todayIso.slice(0, 7));
    const startYearMonth = activeWeeks[0]?.yearMonth || `${todayIso.slice(0, 4)}-01`;
    const endYearMonth = activeWeeks.at(-1)?.yearMonth || `${todayIso.slice(0, 4)}-12`;
    const weekDocs = await readCashflowWeeks({
      db,
      tenantId,
      projectId,
      startYearMonth,
      endYearMonth,
    });

    const risk = buildCashflowLaborRisk(projectId, project, weekDocs, { todayIso });
    const snapshotPath = await persistCashflowLaborRiskSnapshot({
      db,
      tenantId,
      projectId,
      risk,
      context: req.context,
      nowIso: now ? now() : new Date().toISOString(),
    });

    res.status(200).json({
      ...risk,
      snapshot: {
        persisted: true,
        path: snapshotPath,
      },
    });
  }));
}
