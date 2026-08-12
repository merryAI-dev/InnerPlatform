import {
  asyncHandler, assertActorRoleAllowed, createHttpError, createMutatingRoute, ROUTE_ROLES, readOptionalText,
} from '../bff-utils.mjs';
import { buildParticipationDashboardSnapshot, buildParticipationRule, buildProjectParticipationSnapshot, selectParticipationDashboardYear } from '../participation-dashboard.mjs';

export function mountParticipationDashboardRoutes(app, { db, now, idempotencyService } = {}) {
  app.get('/api/v1/participation-dashboard', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read participation dashboard');
    if (!db) throw createHttpError(503, '참여율 대시보드를 읽을 수 없습니다.', 'firestore_unconfigured');
    const tenantId = readOptionalText(req.context?.tenantId);
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');
    const [projectsSnap, entriesSnap, rulesSnap] = await Promise.all([
      db.collection(`orgs/${tenantId}/projects`).get(),
      db.collection(`orgs/${tenantId}/partEntries`).get(),
      db.collection(`orgs/${tenantId}/participation_rules`).get(),
    ]);
    const snapshot = buildParticipationDashboardSnapshot({
      projects: projectsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
      entries: entriesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
      rules: rulesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
      generatedAt: new Date().toISOString(),
    });
    res.status(200).json(selectParticipationDashboardYear(snapshot, req.query.year));
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

  app.post('/api/v1/participation-dashboard/rules/:ruleId', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'save participation rule alias');
    if (!db) throw createHttpError(503, '참여율 규칙을 저장할 수 없습니다.', 'firestore_unconfigured');
    const tenantId = readOptionalText(req.context?.tenantId);
    const ruleId = readOptionalText(req.params.ruleId);
    const alias = readOptionalText(req.body?.alias);
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');
    if (!ruleId || !alias || alias.length > 80) throw createHttpError(422, '규칙 별칭은 1~80자로 입력해 주세요.', 'invalid_participation_rule_alias');
    const projectsSnap = await db.collection(`orgs/${tenantId}/projects`).get();
    const project = projectsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
      .find((candidate) => buildParticipationRule(candidate).id === ruleId);
    if (!project) throw createHttpError(404, '프로젝트에서 생성된 규칙을 찾을 수 없습니다.', 'participation_rule_not_found');
    const rule = buildParticipationRule(project);
    await db.doc(`orgs/${tenantId}/participation_rules/${ruleId}`).set({
      ...rule,
      alias,
      tenantId,
      updatedAt: now ? now() : new Date().toISOString(),
      updatedBy: readOptionalText(req.context?.actorId),
    }, { merge: true });
    return { status: 200, body: { ...rule, alias, isSaved: true } };
  }));
}
