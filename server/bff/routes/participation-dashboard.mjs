import {
  asyncHandler, assertActorRoleAllowed, createHttpError, createMutatingRoute, ROUTE_ROLES, readOptionalText,
} from '../bff-utils.mjs';
import { buildParticipationDashboardSnapshot, buildProjectParticipationSnapshot, selectParticipationDashboardYear } from '../participation-dashboard.mjs';
import { analyzeParticipationSheet } from '../participation-sheet-ingest.mjs';
import {
  PARTICIPATION_CELL_RANGE, PARTICIPATION_FORMAT_RANGE, PARTICIPATION_HEADER_RANGE,
  PARTICIPATION_META_RANGE, PARTICIPATION_PERIOD_RANGE, PARTICIPATION_SHEET_TAB,
  toParticipationSheetInput,
} from '../participation-sheet-ranges.mjs';

/** 캐시플로우 시트 연동과 같은 방식으로 서비스 계정 주소를 얻는다. */
function resolveSystemAccountEmail(googleSheetsService) {
  if (typeof googleSheetsService?.getServiceAccountEmail === 'function') {
    return readOptionalText(googleSheetsService.getServiceAccountEmail());
  }
  return readOptionalText(googleSheetsService?.serviceAccountEmail);
}

/**
 * 시트 읽기 실패를 사람이 읽을 한 가지 코드로 정규화한다.
 * 권한·쿼터·삭제는 원인이 다르지만 사람이 할 일은 같다 - 공유를 확인하고 다시 시도한다.
 *
 * 가장 흔한 원인은 공유 누락이라 **누구에게 공유해야 하는지**를 함께 적는다. 주소를 모르면
 * 사람은 무엇을 고쳐야 할지 알 수 없고, "잠시 후 다시 시도" 만 되풀이하게 된다.
 */
function participationSheetUnreachable(error, systemAccountEmail = '') {
  const detail = readOptionalText(error?.message) || '시트를 읽지 못했습니다.';
  const share = systemAccountEmail
    ? ` 시트를 ${systemAccountEmail} 에 보기 권한으로 공유했는지 확인해 주세요.`
    : ' 시트 공유 권한을 확인해 주세요.';
  const missingTab = /참여율|Unable to parse range|not found/i.test(detail)
    ? ' 표준양식의 "참여율" 탭이 있는지도 확인해 주세요.'
    : '';
  return createHttpError(
    502,
    `참여율 시트를 읽지 못했습니다.${share}${missingTab} (${detail})`,
    'participation_sheet_unreachable',
  );
}

/** 다섯 범위를 함께 읽는다. 한 번에 읽어야 사람이 그 사이 고쳐도 한 장면으로 남는다. */
async function readParticipationSheet(googleSheetsService, sheetLink) {
  const readRange = (rangeA1) => googleSheetsService.getSheetValues({
    spreadsheetId: sheetLink,
    sheetName: PARTICIPATION_SHEET_TAB,
    rangeA1,
  });
  try {
    const [format, period, header, meta, cells] = await Promise.all([
      readRange(PARTICIPATION_FORMAT_RANGE),
      readRange(PARTICIPATION_PERIOD_RANGE),
      readRange(PARTICIPATION_HEADER_RANGE),
      readRange(PARTICIPATION_META_RANGE),
      readRange(PARTICIPATION_CELL_RANGE),
    ]);
    return { format, period, header, meta, cells };
  } catch (error) {
    throw participationSheetUnreachable(error, resolveSystemAccountEmail(googleSheetsService));
  }
}

/**
 * 화면이 그대로 그릴 수 있는 모양. 참여행(entries)은 반영 단계의 재료라 돌려주지 않는다.
 * personId·기본투입률은 등록/수정 화면이 명단을 채우는 데 쓴다.
 */
function participationPreviewBody(analysis, extra = {}) {
  return {
    ok: analysis.ok,
    summary: analysis.summary,
    blocking: analysis.blocking,
    months: analysis.parsed.months,
    rows: analysis.rows.map((row) => ({
      rowIndex: row.rowIndex,
      nickname: row.nickname,
      name: row.name,
      role: row.role,
      stintStart: row.stintStart,
      stintEnd: row.stintEnd,
      baseRate: row.baseRate,
      personId: row.personId || '',
      linkState: row.linkState,
      monthlyRates: row.monthlyRates,
    })),
    missing: analysis.missing,
    candidates: analysis.candidates,
    ...extra,
  };
}

export function mountParticipationDashboardRoutes(app, { db, now, googleSheetsService, idempotencyService } = {}) {
  app.get('/api/v1/participation-dashboard', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read participation dashboard');
    if (!db) throw createHttpError(503, '참여율 대시보드를 읽을 수 없습니다.', 'firestore_unconfigured');
    const tenantId = readOptionalText(req.context?.tenantId);
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');
    const [projectsSnap, entriesSnap, peopleSnap, rulesSnap] = await Promise.all([
      db.collection(`orgs/${tenantId}/projects`).get(),
      db.collection(`orgs/${tenantId}/partEntries`).get(),
      db.collection(`orgs/${tenantId}/persons`).get(),
      db.collection(`orgs/${tenantId}/participation_rules`).get(),
    ]);
    const snapshot = buildParticipationDashboardSnapshot({
      projects: projectsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
      entries: entriesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
      people: peopleSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
      rules: rulesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
      generatedAt: new Date().toISOString(),
    });
    res.status(200).json({
      ...selectParticipationDashboardYear(snapshot, req.query.year, req.query.ruleId),
      projects: projectsSnap.docs.map((doc) => {
        const project = doc.data() || {};
        return { id: doc.id, name: readOptionalText(project.name) || doc.id, clientOrg: readOptionalText(project.clientOrg) };
      }).sort((left, right) => left.name.localeCompare(right.name, 'ko')),
    });
  }));

  app.get('/api/v1/participation-dashboard/projects/:projectId', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read project participation dashboard');
    if (!db) throw createHttpError(503, '프로젝트 참여인력을 읽을 수 없습니다.', 'firestore_unconfigured');
    const tenantId = readOptionalText(req.context?.tenantId);
    const projectId = readOptionalText(req.params.projectId);
    if (!tenantId || !projectId) throw createHttpError(400, 'tenantId and projectId are required.', 'participation_project_required');
    const [projectSnap, entriesSnap] = await Promise.all([
      db.doc(`orgs/${tenantId}/projects/${projectId}`).get(),
      db.collection(`orgs/${tenantId}/partEntries`).get(),
    ]);
    if (!projectSnap.exists) throw createHttpError(404, '프로젝트를 찾을 수 없습니다.', 'participation_project_not_found');
    const entries = entriesSnap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
      .filter((entry) => readOptionalText(entry.projectId) === projectId);
    res.status(200).json(buildProjectParticipationSnapshot({ project: { id: projectSnap.id, ...(projectSnap.data() || {}) }, entries }));
  }));

  /*
   * 시트를 공유해야 할 상대. 사업마다 화면에 보여 준다.
   *
   * 서비스 계정은 전사 하나지만, 공유는 사업마다 새로 만든 시트에 대해 매번 해야 한다.
   * 그래서 주소를 오류가 난 뒤에 알려주면 늦다 - 링크를 넣는 그 자리에 있어야 한다.
   */
  app.get('/api/v1/participation-dashboard/system-account', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read participation sheet system account');
    const systemAccountEmail = resolveSystemAccountEmail(googleSheetsService);
    res.status(200).json({
      systemAccountEmail,
      configured: Boolean(systemAccountEmail),
    });
  }));

  /*
   * 참여율 시트 검증. 읽기 전용이고 아무것도 쓰지 않는다.
   *
   * 시트가 사람 손에서 채워지는 동안 "제대로 채워졌나" 를 플랫폼에서 볼 수 있어야 한다.
   * 반영(apply)은 이 화면에서 사람이 확인한 뒤의 일이다.
   */
  app.get('/api/v1/participation-dashboard/projects/:projectId/sheet-preview', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'preview participation sheet');
    if (!db) throw createHttpError(503, '참여율 시트를 확인할 수 없습니다.', 'firestore_unconfigured');
    const tenantId = readOptionalText(req.context?.tenantId);
    const projectId = readOptionalText(req.params.projectId);
    if (!tenantId || !projectId) throw createHttpError(400, 'tenantId and projectId are required.', 'participation_project_required');
    if (!googleSheetsService?.getSheetValues) {
      throw createHttpError(503, 'Google Sheets 연동이 설정되지 않았습니다.', 'google_sheets_unconfigured');
    }

    const projectSnap = await db.doc(`orgs/${tenantId}/projects/${projectId}`).get();
    if (!projectSnap.exists) throw createHttpError(404, '프로젝트를 찾을 수 없습니다.', 'participation_project_not_found');
    const project = { id: projectSnap.id, ...(projectSnap.data() || {}) };
    const sheetLink = readOptionalText(project.participationSheetLink);
    if (!sheetLink) {
      throw createHttpError(
        400,
        '이 사업에 참여율 시트 링크가 없습니다. 사업 등록·수정에서 먼저 저장해 주세요.',
        'participation_sheet_link_missing',
      );
    }

    const sheetValues = await readParticipationSheet(googleSheetsService, sheetLink);
    const peopleSnap = await db.collection(`orgs/${tenantId}/persons`).get();
    const analysis = analyzeParticipationSheet({
      sheet: toParticipationSheetInput(sheetValues),
      project,
      people: peopleSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
      tenantId,
      projectId,
    });

    res.status(200).json(participationPreviewBody(analysis, {
      projectId,
      projectName: readOptionalText(project.name) || projectId,
      sheetLink,
      checkedAt: now ? now() : new Date().toISOString(),
    }));
  }));

  /*
   * 저장 전에도 확인할 수 있는 경로. 등록 중에는 사업 문서가 아직 없고, 수정 중에는 화면의
   * 링크가 저장본과 다를 수 있다. 그래서 링크와 계약 기간을 요청에 담아 받는다.
   * 읽기만 하므로 GET 과 같은 권한이고 아무것도 쓰지 않는다.
   */
  app.post('/api/v1/participation-dashboard/sheet-preview', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'preview participation sheet by link');
    if (!db) throw createHttpError(503, '참여율 시트를 확인할 수 없습니다.', 'firestore_unconfigured');
    const tenantId = readOptionalText(req.context?.tenantId);
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');
    if (!googleSheetsService?.getSheetValues) {
      throw createHttpError(503, 'Google Sheets 연동이 설정되지 않았습니다.', 'google_sheets_unconfigured');
    }
    const sheetLink = readOptionalText(req.body?.sheetLink);
    if (!sheetLink) {
      throw createHttpError(400, '참여율 시트 링크를 입력해 주세요.', 'participation_sheet_link_missing');
    }

    const sheetValues = await readParticipationSheet(googleSheetsService, sheetLink);
    const peopleSnap = await db.collection(`orgs/${tenantId}/persons`).get();
    const analysis = analyzeParticipationSheet({
      sheet: toParticipationSheetInput(sheetValues),
      // 계약 기간은 화면의 초안 값이다. 저장된 사업이 아직 없을 수 있다.
      project: {
        contractStart: readOptionalText(req.body?.contractStart),
        contractEnd: readOptionalText(req.body?.contractEnd),
      },
      people: peopleSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
      tenantId,
      projectId: readOptionalText(req.body?.projectId),
    });

    res.status(200).json(participationPreviewBody(analysis, {
      sheetLink,
      checkedAt: now ? now() : new Date().toISOString(),
    }));
  }));

  app.post('/api/v1/participation-dashboard/rules', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'save participation rule');
    if (!db) throw createHttpError(503, '참여율 규칙을 저장할 수 없습니다.', 'firestore_unconfigured');
    const tenantId = readOptionalText(req.context?.tenantId);
    const alias = readOptionalText(req.body?.alias);
    const requestedId = readOptionalText(req.body?.id);
    const clientOrgs = [...new Set((Array.isArray(req.body?.clientOrgs) ? req.body.clientOrgs : []).map(readOptionalText).filter(Boolean))];
    const settlementSystems = [...new Set((Array.isArray(req.body?.settlementSystems) ? req.body.settlementSystems : []).map(readOptionalText).filter(Boolean))];
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');
    if (!alias || alias.length > 80) throw createHttpError(422, '규칙명은 1~80자로 입력해 주세요.', 'invalid_participation_rule_alias');
    if (clientOrgs.length > 4 || settlementSystems.length > 4) throw createHttpError(422, '계약 대상과 정산 시스템은 각각 최대 4개까지 선택할 수 있습니다.', 'invalid_participation_rule_filter');
    const projectsSnap = await db.collection(`orgs/${tenantId}/projects`).get();
    const projects = projectsSnap.docs.map((doc) => doc.data() || {});
    const validClientOrgs = new Set(projects.map((project) => readOptionalText(project.clientOrg)).filter(Boolean));
    const validSettlementSystems = new Set(projects.map((project) => readOptionalText(project.settlementSystem) || 'NONE'));
    if (clientOrgs.some((value) => !validClientOrgs.has(value)) || settlementSystems.some((value) => !validSettlementSystems.has(value))) throw createHttpError(422, '규칙 조건에 사용할 수 없는 값이 포함되어 있습니다.', 'invalid_participation_rule_filter');
    const ruleId = requestedId || `participation-rule-${crypto.randomUUID()}`;
    if (!/^participation-rule-[a-zA-Z0-9-]{1,80}$/.test(ruleId)) throw createHttpError(422, '규칙 식별자가 올바르지 않습니다.', 'invalid_participation_rule_id');
    const rule = { id: ruleId, alias, clientOrgs, settlementSystems, kind: 'USER_DEFINED' };
    await db.doc(`orgs/${tenantId}/participation_rules/${ruleId}`).set({
      ...rule,
      tenantId,
      updatedAt: now ? now() : new Date().toISOString(),
      updatedBy: readOptionalText(req.context?.actorId),
    }, { merge: true });
    return { status: 200, body: rule };
  }));
}
