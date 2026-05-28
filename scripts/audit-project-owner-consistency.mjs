#!/usr/bin/env node
import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';

function readFlag(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function includesProject(member, projectId) {
  const rootIds = Array.isArray(member?.projectIds) ? member.projectIds : [];
  const profileIds = Array.isArray(member?.portalProfile?.projectIds) ? member.portalProfile.projectIds : [];
  return rootIds.includes(projectId) || profileIds.includes(projectId)
    || member?.projectId === projectId || member?.portalProfile?.projectId === projectId;
}

async function readCollection(db, path) {
  const snap = await db.collection(path).get();
  return snap.docs.map((doc) => ({ docId: doc.id, ...doc.data() }));
}

function buildRows({ projects, requests, legacyRequests, members }) {
  const activeProjects = projects.filter((project) => !project.trashedAt);
  const membersByUid = new Map();
  members.forEach((member) => {
    if (member.uid) membersByUid.set(member.uid, member);
    membersByUid.set(member.docId, member);
  });

  const allRequests = [...requests, ...legacyRequests.map((request) => ({ ...request, legacyCollection: true }))];
  const requestByProject = new Map();
  allRequests.forEach((request) => {
    if (!request.approvedProjectId) return;
    const current = requestByProject.get(request.approvedProjectId);
    if (!current || String(request.requestedAt || '').localeCompare(String(current.requestedAt || '')) > 0) {
      requestByProject.set(request.approvedProjectId, request);
    }
  });
  const projectById = new Map(activeProjects.map((project) => [project.id || project.docId, project]));

  const hiddenPending = [];
  allRequests
    .filter((request) => request.status === 'PENDING' && request.approvedProjectId)
    .forEach((request) => {
      const project = projectById.get(request.approvedProjectId);
      const hidden = !project
        || project.trashedAt
        || project.registrationSource !== 'pm_portal'
        || project.executiveReviewStatus !== 'PENDING';
      if (!hidden) return;
      hiddenPending.push({
        check: 'hidden-pending',
        projectId: request.approvedProjectId,
        projectName: project?.name || request.payload?.name || '',
        requestId: request.id || request.docId,
        requestStatus: request.status,
        registrationSource: project?.registrationSource || '',
        executiveReviewStatus: project?.executiveReviewStatus || '',
        reason: !project ? 'linked project missing' : 'pending request is hidden by project fields',
      });
    });

  const missingRegisteredBy = [];
  const assignmentMismatch = [];
  const legacyManagerMismatch = [];

  activeProjects.forEach((project) => {
    const projectId = project.id || project.docId;
    const request = requestByProject.get(projectId);
    const registeredById = normalizeText(project.registeredById);
    const registeredByName = normalizeText(project.registeredByName);
    const registeredByEmail = normalizeText(project.registeredByEmail);
    const managerId = normalizeText(project.managerId);
    const managerName = normalizeText(project.managerName);

    if (project.registrationSource === 'pm_portal' && (!registeredById || !registeredByName || !registeredByEmail)) {
      missingRegisteredBy.push({
        check: 'missing-registered-by',
        projectId,
        projectName: project.name || '',
        requestId: request?.id || request?.docId || '',
        requestStatus: request?.status || '',
        registeredById,
        registeredByName,
        registeredByEmail,
        managerId,
        managerName,
      });
    }

    if (registeredById) {
      const member = membersByUid.get(registeredById);
      if (!member || !includesProject(member, projectId) || (registeredByName && compactText(member.name) !== compactText(registeredByName))) {
        assignmentMismatch.push({
          check: 'assignment-mismatch',
          projectId,
          projectName: project.name || '',
          registeredById,
          registeredByName,
          memberName: member?.name || '',
          memberEmail: member?.email || '',
          memberHasProject: member ? includesProject(member, projectId) : false,
        });
      }
    }

    if (!registeredById && managerId) {
      const member = membersByUid.get(managerId);
      if (member && managerName && compactText(member.name) !== compactText(managerName)) {
        legacyManagerMismatch.push({
          check: 'legacy-manager-mismatch',
          projectId,
          projectName: project.name || '',
          managerId,
          managerName,
          memberName: member.name || '',
          memberEmail: member.email || '',
          requestId: request?.id || request?.docId || '',
          requestStatus: request?.status || '',
        });
      }
    }
  });

  return {
    hiddenPending,
    missingRegisteredBy,
    assignmentMismatch,
    legacyManagerMismatch,
  };
}

function filterRows(groups, only) {
  if (!only) return groups;
  return Object.fromEntries(Object.entries(groups).map(([key, rows]) => [
    key,
    rows.filter((row) => row.check === only),
  ]));
}

function printTable(groups) {
  Object.entries(groups).forEach(([key, rows]) => {
    console.log(`\n## ${key} (${rows.length})`);
    if (rows.length === 0) return;
    console.table(rows);
  });
}

const orgId = readFlag('--org', process.env.BFF_TENANT_ID || process.env.VITE_DEFAULT_ORG_ID || 'mysc');
const firebaseProjectId = readFlag('--firebase-project', readFlag('--project', resolveProjectId()));
const format = readFlag('--format', 'table');
const only = readFlag('--only', '');
const failOnIssues = hasFlag('--fail-on-issues');

const db = createFirestoreDb({ projectId: firebaseProjectId });
const [projects, requests, legacyRequests, members] = await Promise.all([
  readCollection(db, `orgs/${orgId}/projects`),
  readCollection(db, `orgs/${orgId}/project_requests`),
  readCollection(db, `orgs/${orgId}/projectRequests`).catch(() => []),
  readCollection(db, `orgs/${orgId}/members`),
]);

const groups = filterRows(buildRows({ projects, requests, legacyRequests, members }), only);
const issueCount = Object.values(groups).reduce((sum, rows) => sum + rows.length, 0);

if (format === 'json') {
  console.log(JSON.stringify({ orgId, firebaseProjectId, issueCount, groups }, null, 2));
} else if (format === 'ndjson') {
  Object.values(groups).flat().forEach((row) => console.log(JSON.stringify(row)));
} else {
  console.log(`Project owner consistency audit: org=${orgId}, firebaseProject=${firebaseProjectId}, issues=${issueCount}`);
  printTable(groups);
}

if (failOnIssues && issueCount > 0) {
  process.exitCode = 1;
}
