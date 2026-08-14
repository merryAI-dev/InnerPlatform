import {
  asyncHandler, assertActorRoleAllowed, createHttpError, createMutatingRoute, ROUTE_ROLES, readOptionalText,
} from '../bff-utils.mjs';
import { buildParticipationDashboardSnapshot, buildProjectParticipationSnapshot, selectParticipationDashboardYear } from '../participation-dashboard.mjs';

export function mountParticipationDashboardRoutes(app, { db, now, idempotencyService } = {}) {
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
