import { readOptionalText } from './bff-utils.mjs';

// 프로젝트 스코프 인가 판정. JVM WeeklyExpenseAuthorizationService.requireProjectAllowed
// 및 FirestoreWeeklyProjectAccessRepository 와 같은 규칙을 따른다.
//
// 순수 함수다 — 멤버 문서를 인자로 받고 조회는 호출부(서비스 계층)가 한다.
// 두 런타임의 판정이 갈리면 한쪽 경로만 뚫리므로 parity 테스트로 고정한다.

// 테넌트 전역으로 모든 프로젝트를 보는 역할. JVM TENANT_WIDE_PROJECT_ROLES 와 같아야 한다.
export const TENANT_WIDE_PROJECT_ROLES = Object.freeze([
  'admin',
  'finance',
  'auditor',
  'tenant_admin',
  'support',
  'security',
]);

function normalizedRole(role) {
  return readOptionalText(role).toLowerCase();
}

function addText(ids, value) {
  const text = readOptionalText(value);
  if (text) ids.add(text);
}

function addTextList(ids, value) {
  if (!Array.isArray(value)) return;
  for (const entry of value) addText(ids, entry);
}

// JVM FirestoreWeeklyProjectAccessRepository.projectIds 와 같은 필드 집합을 본다.
export function memberProjectIds(member) {
  const ids = new Set();
  addText(ids, member?.projectId);
  addTextList(ids, member?.projectIds);
  const profile = member?.portalProfile;
  if (profile && typeof profile === 'object') {
    addText(ids, profile.projectId);
    addTextList(ids, profile.projectIds);
  }
  return ids;
}

// JVM isActiveActorMember 와 같다 — 비활성 멤버는 스코프를 갖지 않고,
// uid 가 적힌 문서는 그 actor 의 것일 때만 인정한다.
export function isActiveActorMember(member, actorId) {
  if (!member || typeof member !== 'object') return false;
  if (readOptionalText(member.status).toUpperCase() !== 'ACTIVE') return false;
  const memberUid = readOptionalText(member.uid);
  return memberUid === '' || memberUid === readOptionalText(actorId);
}

export function hasProjectAccess({ members, actorId, projectId }) {
  const target = readOptionalText(projectId);
  if (!target) return false;
  for (const member of Array.isArray(members) ? members : []) {
    if (!isActiveActorMember(member, actorId)) continue;
    if (memberProjectIds(member).has(target)) return true;
  }
  return false;
}

// JVM requireProjectAllowed 의 스코프 판정 부분과 같은 순서다.
// 역할 게이트(COMMAND_ROLES)는 BFF 의 기존 assertWeeklyWorkspaceOrRoleAllowed 가 담당하므로
// 여기서는 프로젝트 스코프만 본다.
export function isProjectInActorScope({ role, members, actorId, projectId, workspaceUser = false }) {
  if (workspaceUser) return true;
  if (TENANT_WIDE_PROJECT_ROLES.includes(normalizedRole(role))) return true;
  return hasProjectAccess({ members, actorId, projectId });
}
