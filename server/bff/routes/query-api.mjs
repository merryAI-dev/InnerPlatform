import {
  asyncHandler,
  buildListResponse,
  createHttpError,
  ensureDocumentExists,
  parseCursor,
  parseLimit,
  readOptionalText,
} from '../bff-utils.mjs';
import { CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from '../cashflow-policy.mjs';

const CASHFLOW_WEEKS_COLLECTION_ID = 'cashflow_weeks';
const PROJECTS_COLLECTION_ID = 'projects';

function normalizeRole(value) {
  const normalized = readOptionalText(value).toLowerCase();
  return normalized === 'viewer' ? 'pm' : normalized;
}

function isWorkspaceUser(context, workspaceEmailDomain = 'mysc.co.kr') {
  const email = readOptionalText(context?.actorEmail).toLowerCase();
  const domain = readOptionalText(workspaceEmailDomain).replace(/^@+/, '').toLowerCase();
  return Boolean(domain) && email.endsWith(`@${domain}`);
}

function assertQueryApiAccess(req) {
  const actorRole = normalizeRole(req.context?.actorRole);
  if (isWorkspaceUser(req.context)) return;
  if (['admin', 'finance_admin', 'finance', 'pm', 'workspace_user'].includes(actorRole)) return;
  throw createHttpError(403, 'Workspace access is required to use query api.', 'forbidden');
}

function projectDocPath(tenantId, projectId) {
  return `orgs/${tenantId}/projects/${projectId}`;
}

function projectsCollectionPath(tenantId) {
  return `orgs/${tenantId}/${PROJECTS_COLLECTION_ID}`;
}

function cashflowWeeksCollectionPath(tenantId) {
  return `orgs/${tenantId}/${CASHFLOW_WEEKS_COLLECTION_ID}`;
}

function parseYearMonth(value, fallback) {
  const text = readOptionalText(value) || fallback;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    throw createHttpError(400, `Invalid yearMonth: ${text}`, 'invalid_query');
  }
  return text;
}

function resolveCashflowQuery(req) {
  const startYearMonth = parseYearMonth(req.query.startYearMonth, `${new Date().getUTCFullYear()}-01`);
  const endYearMonth = parseYearMonth(req.query.endYearMonth, `${startYearMonth.slice(0, 4)}-12`);
  if (startYearMonth > endYearMonth) {
    throw createHttpError(400, 'startYearMonth must be before or equal to endYearMonth.', 'invalid_query');
  }

  const mode = readOptionalText(req.query.mode) || 'all';
  if (!['all', 'projection', 'actual'].includes(mode)) {
    throw createHttpError(400, 'mode must be all, projection, or actual.', 'invalid_query');
  }

  return { startYearMonth, endYearMonth, mode };
}

function toAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function sumLines(amounts = {}, lineIds = []) {
  return lineIds.reduce((sum, lineId) => sum + toAmount(amounts[lineId]), 0);
}

function summarizeMode(weeks, mode) {
  let totalIn = 0;
  let totalOut = 0;
  for (const week of weeks) {
    totalIn += sumLines(week?.[mode], CASHFLOW_IN_LINES);
    totalOut += sumLines(week?.[mode], CASHFLOW_OUT_LINES);
  }
  return { totalIn, totalOut, net: totalIn - totalOut };
}

function normalizeWeek(doc) {
  return {
    id: readOptionalText(doc?.id),
    projectId: readOptionalText(doc?.projectId),
    yearMonth: readOptionalText(doc?.yearMonth),
    weekNo: Number(doc?.weekNo) || 0,
    projection: doc?.projection && typeof doc.projection === 'object' ? doc.projection : {},
    actual: doc?.actual && typeof doc.actual === 'object' ? doc.actual : {},
  };
}

async function readProjectCashflowWeeks({ db, tenantId, projectId, startYearMonth, endYearMonth }) {
  const snap = await db.collection(cashflowWeeksCollectionPath(tenantId))
    .where('projectId', '==', projectId)
    .get();
  return snap.docs
    .map((doc) => normalizeWeek({ id: doc.id, ...doc.data() }))
    .filter((week) => week.yearMonth >= startYearMonth && week.yearMonth <= endYearMonth)
    .sort((a, b) => `${a.yearMonth}:${a.weekNo}`.localeCompare(`${b.yearMonth}:${b.weekNo}`));
}

export function buildCashflowSummary({ projectId, project, weeks, startYearMonth, endYearMonth, requestedMode = 'all' }) {
  return {
    projectId,
    projectName: readOptionalText(project?.name) || projectId,
    requestedMode,
    range: {
      startYearMonth,
      endYearMonth,
      weekCount: weeks.length,
    },
    modes: {
      projection: summarizeMode(weeks, 'projection'),
      actual: summarizeMode(weeks, 'actual'),
    },
  };
}

function toCashflowWeekResponse(week, mode) {
  const base = {
    id: week.id,
    projectId: week.projectId,
    yearMonth: week.yearMonth,
    weekNo: week.weekNo,
  };
  if (mode === 'projection') return { ...base, projection: week.projection };
  if (mode === 'actual') return { ...base, actual: week.actual };
  return { ...base, projection: week.projection, actual: week.actual };
}

function querySource(now, readModel = CASHFLOW_WEEKS_COLLECTION_ID) {
  return {
    readModel,
    freshnessCheckedAt: now ? now() : new Date().toISOString(),
  };
}

function toProjectResponse(project) {
  return {
    id: readOptionalText(project.id),
    name: readOptionalText(project.name),
    status: readOptionalText(project.status),
    department: readOptionalText(project.department),
    managerId: readOptionalText(project.managerId),
  };
}

function matchesProjectFilters(project, filters) {
  if (filters.status && readOptionalText(project.status) !== filters.status) return false;
  if (filters.department && readOptionalText(project.department) !== filters.department) return false;
  if (filters.managerId && readOptionalText(project.managerId) !== filters.managerId) return false;
  if (!filters.query) return true;
  const haystack = [
    project.id,
    project.name,
    project.shortName,
    project.clientOrg,
    project.department,
    project.managerName,
  ].map((value) => readOptionalText(value).toLowerCase()).join(' ');
  return haystack.includes(filters.query);
}

export function mountQueryApiRoutes(app, { db, now } = {}) {
  app.get('/api/v1/query/projects', asyncHandler(async (req, res) => {
    assertQueryApiAccess(req);
    if (!db) throw createHttpError(503, 'Firestore is required for query api.', 'firestore_unconfigured');

    const tenantId = readOptionalText(req.context?.tenantId);
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');

    const limit = parseLimit(req.query.pageSize ?? req.query.limit, 50, 200);
    const cursor = parseCursor(req.query.cursor);
    const filters = {
      query: readOptionalText(req.query.query).toLowerCase(),
      status: readOptionalText(req.query.status),
      department: readOptionalText(req.query.department),
      managerId: readOptionalText(req.query.managerId),
    };

    const snap = await db.collection(projectsCollectionPath(tenantId)).get();
    const projects = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((project) => !project.trashedAt)
      .filter((project) => !cursor || String(project.id) > cursor)
      .filter((project) => matchesProjectFilters(project, filters))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .slice(0, limit)
      .map(toProjectResponse);

    res.status(200).json({
      ...buildListResponse(projects, limit),
      source: querySource(now, PROJECTS_COLLECTION_ID),
    });
  }));

  app.get('/api/v1/query/projects/:projectId/cashflow-summary', asyncHandler(async (req, res) => {
    assertQueryApiAccess(req);
    if (!db) throw createHttpError(503, 'Firestore is required for query api.', 'firestore_unconfigured');

    const tenantId = readOptionalText(req.context?.tenantId);
    const projectId = readOptionalText(req.params.projectId);
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');
    if (!projectId) throw createHttpError(400, 'projectId is required.', 'project_required');

    const { startYearMonth, endYearMonth, mode } = resolveCashflowQuery(req);

    const project = await ensureDocumentExists(db, projectDocPath(tenantId, projectId), `Project not found: ${projectId}`);
    const weeks = await readProjectCashflowWeeks({ db, tenantId, projectId, startYearMonth, endYearMonth });

    res.status(200).json({
      data: buildCashflowSummary({ projectId, project, weeks, startYearMonth, endYearMonth, requestedMode: mode }),
      source: querySource(now),
    });
  }));

  app.get('/api/v1/query/projects/:projectId/cashflow-weeks', asyncHandler(async (req, res) => {
    assertQueryApiAccess(req);
    if (!db) throw createHttpError(503, 'Firestore is required for query api.', 'firestore_unconfigured');

    const tenantId = readOptionalText(req.context?.tenantId);
    const projectId = readOptionalText(req.params.projectId);
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');
    if (!projectId) throw createHttpError(400, 'projectId is required.', 'project_required');

    const { startYearMonth, endYearMonth, mode } = resolveCashflowQuery(req);
    await ensureDocumentExists(db, projectDocPath(tenantId, projectId), `Project not found: ${projectId}`);
    const weeks = await readProjectCashflowWeeks({ db, tenantId, projectId, startYearMonth, endYearMonth });

    res.status(200).json({
      items: weeks.map((week) => toCashflowWeekResponse(week, mode)),
      count: weeks.length,
      nextCursor: null,
      source: querySource(now),
    });
  }));
}
