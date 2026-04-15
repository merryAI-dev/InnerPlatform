import {
  asyncHandler,
  assertActorRoleAllowed,
  createHttpError,
  normalizeRole,
  readOptionalText,
  ROUTE_ROLES,
} from '../bff-utils.mjs';
import { parseWithSchema, portalSessionProjectSchema } from '../schemas.mjs';

function readLooseProjectId(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return readOptionalText(value.id);
  return '';
}

function normalizeProjectIds(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => readLooseProjectId(value))
      .filter(Boolean),
  ));
}

function resolvePrimaryProjectId(projectIds, preferredProjectId) {
  const preferred = readOptionalText(preferredProjectId);
  if (preferred && projectIds.includes(preferred)) return preferred;
  return projectIds[0] || '';
}

function canReadAllPortalProjects(role) {
  return normalizeRole(role) === 'admin' || normalizeRole(role) === 'finance';
}

function normalizePortalEntryProject(projectDoc) {
  const project = projectDoc && typeof projectDoc === 'object' ? projectDoc : {};
  const id = readOptionalText(project.id);
  return {
    id,
    name: readOptionalText(project.name) || id,
    status: readOptionalText(project.status) || 'CONTRACT_PENDING',
    clientOrg: readOptionalText(project.clientOrg),
    managerName: readOptionalText(project.managerName),
    department: readOptionalText(project.department),
    type: readOptionalText(project.type) || undefined,
  };
}

export function resolvePortalEntryRegistrationState({ role, memberExists, projectIds }) {
  if (canReadAllPortalProjects(role)) return 'registered';
  if (memberExists && Array.isArray(projectIds) && projectIds.length > 0) return 'registered';
  return 'unregistered';
}

export function resolvePortalEntryMemberAccess(member) {
  const candidate = member && typeof member === 'object' ? member : {};
  const portalProfile = candidate.portalProfile && typeof candidate.portalProfile === 'object'
    ? candidate.portalProfile
    : {};
  const projectIds = normalizeProjectIds([
    ...(Array.isArray(candidate.projectIds) ? candidate.projectIds : []),
    candidate.projectId,
    ...(Array.isArray(portalProfile.projectIds) ? portalProfile.projectIds : []),
    portalProfile.projectId,
  ]);
  return {
    projectIds,
    activeProjectId: resolvePrimaryProjectId(projectIds, portalProfile.projectId || candidate.projectId),
  };
}

export function selectPortalEntryProjects({ role, actorId, memberProjectIds, projects }) {
  const memberProjectIdSet = new Set(normalizeProjectIds(memberProjectIds));
  const allProjects = (Array.isArray(projects) ? projects : [])
    .filter((project) => !readOptionalText(project?.trashedAt))
    .map((project) => ({
      raw: project,
      normalized: normalizePortalEntryProject(project),
    }))
    .filter((project) => project.normalized.id);

  const visibleProjects = canReadAllPortalProjects(role)
    ? allProjects
    : allProjects.filter((project) => (
      memberProjectIdSet.has(project.normalized.id)
      || readOptionalText(project.raw?.managerId) === readOptionalText(actorId)
    ));

  const dedupedProjects = Array.from(
    new Map(visibleProjects.map((project) => [project.normalized.id, project.normalized])).values(),
  ).sort((left, right) => left.name.localeCompare(right.name, 'ko'));

  return {
    projects: dedupedProjects,
    priorityProjectIds: canReadAllPortalProjects(role)
      ? []
      : Array.from(new Set(
        visibleProjects
          .filter((project) => (
            memberProjectIdSet.has(project.normalized.id)
            || readOptionalText(project.raw?.managerId) === readOptionalText(actorId)
          ))
          .map((project) => project.normalized.id),
      )),
  };
}

async function listPortalEntryProjects({ db, tenantId, actorId, role, memberProjectIds }) {
  const projectsCollection = db.collection(`orgs/${tenantId}/projects`);

  if (canReadAllPortalProjects(role)) {
    const snapshot = await projectsCollection.get();
    return selectPortalEntryProjects({
      role,
      actorId,
      memberProjectIds,
      projects: snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
    });
  }

  const memberIds = normalizeProjectIds(memberProjectIds);
  const [managedSnapshot, ...memberSnapshots] = await Promise.all([
    projectsCollection.where('managerId', '==', actorId).get(),
    ...memberIds.map((projectId) => projectsCollection.doc(projectId).get()),
  ]);

  return selectPortalEntryProjects({
    role,
    actorId,
    memberProjectIds: memberIds,
    projects: [
      ...managedSnapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
      ...memberSnapshots
        .filter((doc) => doc.exists)
        .map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
    ],
  });
}

export function mountPortalEntryRoutes(app, { db, createMutatingRoute, idempotencyService }) {
  app.get('/api/v1/portal/entry-context', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read portal entry context');
    const { tenantId, actorId, actorRole } = req.context;
    const memberSnapshot = await db.doc(`orgs/${tenantId}/members/${actorId}`).get();
    const member = memberSnapshot.exists ? (memberSnapshot.data() || {}) : null;
    const memberAccess = resolvePortalEntryMemberAccess(member);
    const role = normalizeRole(readOptionalText(member?.role) || actorRole || 'pm');
    const projectList = await listPortalEntryProjects({
      db,
      tenantId,
      actorId,
      role,
      memberProjectIds: memberAccess.projectIds,
    });

    res.status(200).json({
      registrationState: resolvePortalEntryRegistrationState({
        role,
        memberExists: memberSnapshot.exists,
        projectIds: memberAccess.projectIds,
      }),
      activeProjectId: memberAccess.activeProjectId,
      priorityProjectIds: projectList.priorityProjectIds,
      projects: projectList.projects,
    });
  }));

  app.post('/api/v1/portal/session-project', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'switch portal session project');
    const { tenantId, actorId, actorRole } = req.context;
    const { projectId } = parseWithSchema(
      portalSessionProjectSchema,
      req.body,
      'Invalid portal session project payload',
    );
    const targetProjectId = readOptionalText(projectId);
    const memberSnapshot = await db.doc(`orgs/${tenantId}/members/${actorId}`).get();
    const member = memberSnapshot.exists ? (memberSnapshot.data() || {}) : null;
    const memberAccess = resolvePortalEntryMemberAccess(member);
    const role = normalizeRole(readOptionalText(member?.role) || actorRole || 'pm');
    const projectSnapshot = await db.doc(`orgs/${tenantId}/projects/${targetProjectId}`).get();

    if (!projectSnapshot.exists || readOptionalText(projectSnapshot.data()?.trashedAt)) {
      throw createHttpError(404, '선택한 사업을 찾을 수 없습니다.', 'project_not_found');
    }

    const project = { id: projectSnapshot.id, ...(projectSnapshot.data() || {}) };
    const allowed = canReadAllPortalProjects(role)
      || memberAccess.projectIds.includes(targetProjectId)
      || readOptionalText(project.managerId) === readOptionalText(actorId);

    if (!allowed) {
      throw createHttpError(403, '선택 가능한 사업이 아닙니다.', 'project_forbidden');
    }

    return {
      status: 200,
      body: {
        ok: true,
        activeProjectId: targetProjectId,
      },
    };
  }));
}
