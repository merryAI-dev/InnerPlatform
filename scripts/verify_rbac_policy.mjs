#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function fail(errors) {
  for (const error of errors) {
    // eslint-disable-next-line no-console
    console.error(`[policy-verify] ${error}`);
  }
  process.exit(1);
}

function ensureUnique(values, label, errors) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`${label} has duplicate value: ${value}`);
    }
    seen.add(value);
  }
}

const policyPath = path.resolve(process.cwd(), process.argv[2] || 'policies/rbac-policy.json');
if (!fs.existsSync(policyPath)) {
  fail([`policy file not found: ${policyPath}`]);
}

const raw = fs.readFileSync(policyPath, 'utf8');
let policy;
try {
  policy = JSON.parse(raw);
} catch (error) {
  fail([`invalid JSON: ${error instanceof Error ? error.message : String(error)}`]);
}

const errors = [];
const roles = Array.isArray(policy.roles) ? policy.roles.map((v) => String(v).trim().toLowerCase()).filter(Boolean) : [];
const permissions = Array.isArray(policy.permissions) ? policy.permissions.map((v) => String(v).trim()).filter(Boolean) : [];
const roleChangeRules = policy.roleChangeRules && typeof policy.roleChangeRules === 'object' ? policy.roleChangeRules : null;

if (!Number.isInteger(policy.version)) {
  errors.push('version must be an integer');
}

if (roles.length === 0) {
  errors.push('roles must include at least one role');
}
ensureUnique(roles, 'roles', errors);

if (permissions.length === 0) {
  errors.push('permissions must include at least one permission');
}
ensureUnique(permissions, 'permissions', errors);

if (!roleChangeRules) {
  errors.push('roleChangeRules must be an object');
} else {
  for (const [actorRoleRaw, targetsRaw] of Object.entries(roleChangeRules)) {
    const actorRole = String(actorRoleRaw).trim().toLowerCase();
    if (!roles.includes(actorRole)) {
      errors.push(`roleChangeRules contains unknown actor role: ${actorRoleRaw}`);
      continue;
    }
    if (!Array.isArray(targetsRaw) || targetsRaw.length === 0) {
      errors.push(`roleChangeRules.${actorRoleRaw} must be a non-empty array`);
      continue;
    }
    const targets = targetsRaw.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
    ensureUnique(targets, `roleChangeRules.${actorRoleRaw}`, errors);
    for (const target of targets) {
      if (!roles.includes(target)) {
        errors.push(`roleChangeRules.${actorRoleRaw} includes unknown target role: ${target}`);
      }
    }
  }
}

if (errors.length > 0) {
  fail(errors);
}

// eslint-disable-next-line no-console
console.log(`[policy-verify] ok: ${policyPath}`);
