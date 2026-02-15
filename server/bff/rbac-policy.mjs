import fs from 'node:fs';
import path from 'node:path';

function uniqueList(values) {
  return Array.from(new Set(values));
}

function normalizeRole(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizePermission(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function resolvePolicyPath(env = process.env) {
  const configured = String(env.RBAC_POLICY_PATH || '').trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }
  return path.resolve(process.cwd(), 'policies/rbac-policy.json');
}

export function loadRbacPolicy(policyPath = resolvePolicyPath()) {
  const raw = fs.readFileSync(policyPath, 'utf8');
  const parsed = JSON.parse(raw);

  const roles = uniqueList((Array.isArray(parsed.roles) ? parsed.roles : []).map(normalizeRole).filter(Boolean));
  const permissions = uniqueList((Array.isArray(parsed.permissions) ? parsed.permissions : []).map(normalizePermission).filter(Boolean));

  const rolePermissionsRaw = parsed.rolePermissions && typeof parsed.rolePermissions === 'object'
    ? parsed.rolePermissions
    : {};
  const rolePermissions = {};
  for (const [roleRaw, permsRaw] of Object.entries(rolePermissionsRaw)) {
    const role = normalizeRole(roleRaw);
    if (!role) continue;
    rolePermissions[role] = uniqueList((Array.isArray(permsRaw) ? permsRaw : []).map(normalizePermission).filter(Boolean));
  }

  return {
    version: Number.isInteger(parsed.version) ? parsed.version : 1,
    defaultRole: normalizeRole(parsed.defaultRole) || undefined,
    roles,
    permissions,
    rolePermissions,
    roleChangeRules: parsed.roleChangeRules && typeof parsed.roleChangeRules === 'object'
      ? parsed.roleChangeRules
      : {},
  };
}

export function actorHasPermission(policy, { actorRole, permission }) {
  const role = normalizeRole(actorRole);
  const normalizedPermission = normalizePermission(permission);
  if (!role || !normalizedPermission) return false;
  const rolePermissions = policy?.rolePermissions?.[role];
  if (!Array.isArray(rolePermissions)) return false;
  return rolePermissions.includes(normalizedPermission);
}

export function canActorAssignRole(policy, { actorRole, targetRole }) {
  const from = normalizeRole(actorRole);
  const to = normalizeRole(targetRole);
  if (!from || !to) return false;

  const rules = policy.roleChangeRules || {};
  const allowedTargets = Array.isArray(rules[from]) ? rules[from].map(normalizeRole) : [];
  return allowedTargets.includes(to);
}
