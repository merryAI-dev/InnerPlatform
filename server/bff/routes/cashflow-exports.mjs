import { asyncHandler, assertActorPermissionAllowed, createHttpError, readOptionalText } from '../bff-utils.mjs';
import { parseWithSchema, cashflowExportSchema } from '../schemas.mjs';
import { buildCashflowExportFileName, buildCashflowExportWorkbookBuffer, expandCashflowYearMonthRange } from '../cashflow-export.mjs';

function encodeContentDisposition(fileName) {
  const fallback = 'cashflow-export.xlsx';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
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

    if (payload.basis) {
      projects = projects.filter((project) => project.basis === payload.basis);
    }

    if (projects.length === 0) {
      throw createHttpError(404, '추출할 프로젝트가 없습니다.', 'not_found');
    }

    const weekQuery = db.collection(`orgs/${tenantId}/cashflowWeeks`)
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

    const exportProjects = projects.map((project) => ({
      id: project.id,
      name: project.name,
      shortName: project.shortName,
      weeks: weeksByProject.get(project.id) || [],
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
