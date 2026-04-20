import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  readOptionalText,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { cashflowWeekUpsertSchema, parseWithSchema } from '../schemas.mjs';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatIsoDate(year, month, day) {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

function addDaysUtc(isoDate, deltaDays) {
  const [yearRaw, monthRaw, dayRaw] = String(isoDate).split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
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
  const [yearRaw, monthRaw, dayRaw] = String(isoDate).split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  const delta = -((dayOfWeekUtc(year, month, day) - 3 + 7) % 7);
  return addDaysUtc(isoDate, delta);
}

function countDaysInMonthForWeek(weekStart, year, month) {
  let count = 0;
  for (let index = 0; index < 7; index += 1) {
    const date = addDaysUtc(weekStart, index);
    const [yyRaw, mmRaw] = String(date).split('-');
    if (Number.parseInt(yyRaw, 10) === year && Number.parseInt(mmRaw, 10) === month) {
      count += 1;
    }
  }
  return count;
}

function getMonthMondayWeeks(yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(String(yearMonth || ''))) {
    return [];
  }
  const [yearRaw, monthRaw] = String(yearMonth).split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return [];
  }

  const firstDay = formatIsoDate(year, month, 1);
  const lastDay = formatIsoDate(year, month, daysInMonthUtc(year, month));
  let weekStart = startOfWeekWednesday(firstDay);
  let weekNo = 0;
  const weeks = [];

  while (weekStart <= lastDay) {
    if (countDaysInMonthForWeek(weekStart, year, month) >= 4) {
      weekNo += 1;
      weeks.push({
        yearMonth,
        weekNo,
        weekStart,
        weekEnd: addDaysUtc(weekStart, 6),
      });
    }
    weekStart = addDaysUtc(weekStart, 7);
  }

  return weeks;
}

function resolveWeekBounds(yearMonth, weekNo) {
  return getMonthMondayWeeks(yearMonth).find((week) => week.weekNo === weekNo) || null;
}

function readCurrentVersion(current) {
  return Number.isInteger(current?.version) && current.version > 0 ? current.version : 0;
}

function normalizeCashflowWeekAmounts(amounts) {
  return Object.fromEntries(
    Object.entries(amounts && typeof amounts === 'object' ? amounts : {})
      .map(([key, value]) => [String(key || '').trim(), Number(value)])
      .filter(([key, value]) => key && Number.isFinite(value)),
  );
}

function buildCashflowWeekDocument({
  current,
  tenantId,
  projectId,
  yearMonth,
  weekNo,
  mode,
  amounts,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  const weekBounds = resolveWeekBounds(yearMonth, weekNo);
  if (!weekBounds) {
    throw createHttpError(400, `Invalid cashflow week: ${yearMonth} w${weekNo}`, 'invalid_cashflow_week');
  }

  const currentModeAmounts = currentValue[mode] && typeof currentValue[mode] === 'object'
    ? currentValue[mode]
    : {};

  return stripUndefinedDeep({
    ...currentValue,
    id: `${projectId}-${yearMonth}-w${weekNo}`,
    tenantId,
    projectId,
    yearMonth,
    weekNo,
    weekStart: readOptionalText(currentValue.weekStart) || weekBounds.weekStart,
    weekEnd: readOptionalText(currentValue.weekEnd) || weekBounds.weekEnd,
    [mode]: {
      ...currentModeAmounts,
      ...amounts,
    },
    pmSubmitted: Boolean(currentValue.pmSubmitted),
    adminClosed: Boolean(currentValue.adminClosed),
    updatedAt: timestamp,
    updatedByUid: actorId,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    version: readCurrentVersion(currentValue) + 1,
  });
}

export function mountCashflowWeekUpsertCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/cashflow/weeks/upsert', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'upsert cashflow week');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(cashflowWeekUpsertSchema, req.body, 'Invalid cashflow week upsert payload');
    const normalizedAmounts = normalizeCashflowWeekAmounts(parsed.amounts);
    const updatedLineCount = Object.keys(normalizedAmounts).length;

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      const cashflowWeekId = `${parsed.projectId}-${parsed.yearMonth}-w${parsed.weekNo}`;
      const cashflowWeekRef = db.doc(`orgs/${tenantId}/cashflowWeeks/${cashflowWeekId}`);
      const cashflowWeekSnapshot = await tx.get(cashflowWeekRef);
      const cashflowWeekDocument = buildCashflowWeekDocument({
        current: cashflowWeekSnapshot.exists ? (cashflowWeekSnapshot.data() || {}) : null,
        tenantId,
        projectId: parsed.projectId,
        yearMonth: parsed.yearMonth,
        weekNo: parsed.weekNo,
        mode: parsed.mode,
        amounts: normalizedAmounts,
        actorId,
        timestamp,
      });
      tx.set(cashflowWeekRef, cashflowWeekDocument, { merge: true });

      return { cashflowWeek: cashflowWeekDocument };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'cashflow_week',
        entityId: result.cashflowWeek.id,
        action: 'UPSERT',
        actorId,
        actorRole,
        requestId,
        details: `주간 캐시플로 ${parsed.mode} 업데이트: ${parsed.projectId} ${parsed.yearMonth} ${parsed.weekNo}주차`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          yearMonth: parsed.yearMonth,
          weekNo: parsed.weekNo,
          mode: parsed.mode,
          updatedLineCount,
          version: result.cashflowWeek.version,
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        cashflowWeek: result.cashflowWeek,
        summary: {
          mode: parsed.mode,
          updatedLineCount,
        },
      },
    };
  }));
}
