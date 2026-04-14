import { asyncHandler, assertActorPermissionAllowed, createHttpError, readOptionalText } from '../bff-utils.mjs';
import { parseWithSchema, cashflowExportSchema } from '../schemas.mjs';
import { buildCashflowExportFileName, buildCashflowExportWorkbookBuffer, expandCashflowYearMonthRange } from '../cashflow-export.mjs';

function encodeContentDisposition(fileName) {
  const fallback = 'cashflow-export.xlsx';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function nextYearMonth(yearMonth) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(yearMonth || '').trim());
  if (!match) return '';
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return '';
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

export function mountCashflowExportRoutes(app, { db, rbacPolicy }) {
  app.post('/api/v1/cashflow-exports', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorPermissionAllowed(rbacPolicy, req, 'cashflow:export', 'export cashflow workbooks');

    const payload = parseWithSchema(cashflowExportSchema, req.body, 'Invalid cashflow export request');
    const yearMonths = expandCashflowYearMonthRange(payload.startYearMonth, payload.endYearMonth);
    if (yearMonths.length === 0) {
      throw createHttpError(400, '유효한 기간을 선택해 주세요.', 'invalid_year_month_range');
    }

    let projects = [];
    if (payload.scope === 'single') {
      const projectId = readOptionalText(payload.projectId);
      const snap = await db.doc(`orgs/${tenantId}/projects/${projectId}`).get();
      if (!snap.exists) {
        throw createHttpError(404, '프로젝트를 찾을 수 없습니다.', 'not_found');
      }
      projects = [{ id: snap.id, ...snap.data() }];
    } else {
      const snap = await db.collection(`orgs/${tenantId}/projects`).get();
      projects = snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((project) => !project.trashedAt);
    }

    if (payload.accountType) {
      projects = projects.filter((project) => project.accountType === payload.accountType);
    } else if (payload.basis) {
      projects = projects.filter((project) => project.basis === payload.basis);
    }

    if (projects.length === 0) {
      throw createHttpError(404, '추출할 프로젝트가 없습니다.', 'not_found');
    }

    const weekQuery = db.collection(`orgs/${tenantId}/cashflow_weeks`)
      .where('yearMonth', '>=', yearMonths[0])
      .where('yearMonth', '<=', yearMonths[yearMonths.length - 1]);
    const weekSnap = await weekQuery.get();
    const weeksByProject = new Map();
    for (const doc of weekSnap.docs) {
      const week = { id: doc.id, ...doc.data() };
      const bucket = weeksByProject.get(week.projectId) || [];
      bucket.push(week);
      weeksByProject.set(week.projectId, bucket);
    }

    const transactionProjectIds = new Set(projects.map((project) => project.id));
    const transactionYearMonths = new Set(yearMonths);
    const transactionsByProject = new Map();
    const txRangeStart = `${yearMonths[0]}-01`;
    const txRangeEndExclusive = `${nextYearMonth(yearMonths[yearMonths.length - 1])}-01`;
    let txQuery = db.collection(`orgs/${tenantId}/transactions`)
      .where('dateTime', '>=', txRangeStart)
      .where('dateTime', '<', txRangeEndExclusive);
    if (payload.scope === 'single' && projects[0]?.id) {
      txQuery = txQuery.where('projectId', '==', projects[0].id);
    }
    const txSnap = await txQuery.get();
    for (const doc of txSnap.docs) {
      const transaction = { id: doc.id, ...doc.data() };
      if (!transactionProjectIds.has(transaction.projectId)) continue;
      const transactionYearMonth = typeof transaction.dateTime === 'string' ? transaction.dateTime.slice(0, 7) : '';
      if (!transactionYearMonths.has(transactionYearMonth)) continue;
      const bucket = transactionsByProject.get(transaction.projectId) || [];
      bucket.push(transaction);
      transactionsByProject.set(transaction.projectId, bucket);
    }

    const exportProjects = projects.map((project) => ({
      id: project.id,
      name: project.name,
      shortName: project.shortName,
      weeks: weeksByProject.get(project.id) || [],
      transactions: transactionsByProject.get(project.id) || [],
    }));

    const buffer = await buildCashflowExportWorkbookBuffer({
      projects: exportProjects,
      yearMonths,
      variant: payload.variant,
    });
    const fileName = buildCashflowExportFileName({
      scope: payload.scope,
      projectName: exportProjects[0]?.name,
      yearMonths,
      variant: payload.variant,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', encodeContentDisposition(fileName));
    res.status(200).send(buffer);
  }));
}
