import fs from 'node:fs';
import path from 'node:path';

function uniqueList(values) {
  return Array.from(new Set(values));
}

function normalizeRole(value) {
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

  return {
    version: Number.isInteger(parsed.version) ? parsed.version : 1,
    roles: uniqueList((Array.isArray(parsed.roles) ? parsed.roles : []).map(normalizeRole).filter(Boolean)),
    permissions: uniqueList((Array.isArray(parsed.permissions) ? parsed.permissions : []).map((v) => String(v).trim()).filter(Boolean)),
    roleChangeRules: parsed.roleChangeRules && typeof parsed.roleChangeRules === 'object'
      ? parsed.roleChangeRules
      : {},
  };
}

export function canActorAssignRole(policy, { actorRole, targetRole }) {
  const from = normalizeRole(actorRole);
  const to = normalizeRole(targetRole);
  if (!from || !to) return false;

  const rules = policy.roleChangeRules || {};
  const allowedTargets = Array.isArray(rules[from]) ? rules[from].map(normalizeRole) : [];
  return allowedTargets.includes(to);
}
