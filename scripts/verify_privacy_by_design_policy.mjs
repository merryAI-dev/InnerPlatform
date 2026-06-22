#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const privacyPolicyPath = path.resolve(repoRoot, 'policies/privacy-by-design-policy.json');
const packsPath = path.resolve(repoRoot, 'policies/security-observability-packs.json');
const auditRoutePath = path.resolve(repoRoot, 'server/bff/routes/audit.mjs');

function fail(errors) {
  for (const error of errors) console.error(`[pbd-verify] ${error}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function includesAny(values, candidates) {
  const set = new Set(values);
  return candidates.some((candidate) => set.has(candidate));
}

const errors = [];

for (const requiredPath of [privacyPolicyPath, packsPath]) {
  if (!fs.existsSync(requiredPath)) errors.push(`missing policy file: ${path.relative(repoRoot, requiredPath)}`);
}
if (errors.length) fail(errors);

const privacyPolicy = readJson(privacyPolicyPath);
const packs = readJson(packsPath);
const controls = asObject(privacyPolicy.controls);
const observabilityControls = asObject(controls.observabilityPacks);
const maxIntervalSeconds = Number(observabilityControls.maxIntervalSeconds || 604800);
const maxRetentionDays = Number(observabilityControls.maxRetentionDays || 365);
const allowedModes = new Set(['differential', 'snapshot']);
const allowedPiiHandling = new Set(['none', 'hash', 'redact', 'encrypt']);

if (privacyPolicy.status !== 'approved') {
  errors.push('privacy-by-design policy must be approved before it can gate production controls');
}

if (!includesAny(asArray(privacyPolicy.sourceModel?.appliedPatterns), ['query_packs', 'differential_results'])) {
  errors.push('privacy-by-design policy must cite osquery query_packs and differential_results as applied patterns');
}

const packMap = asObject(packs.packs);
if (!Object.keys(packMap).length) errors.push('security-observability-packs must define at least one pack');

for (const [packName, pack] of Object.entries(packMap)) {
  if (!pack.purpose || typeof pack.purpose !== 'string') errors.push(`${packName} must define purpose`);
  if (!Array.isArray(pack.discovery)) errors.push(`${packName} must define discovery as an array`);
  const queries = asObject(pack.queries);
  if (!Object.keys(queries).length) errors.push(`${packName} must define queries`);

  for (const [queryName, query] of Object.entries(queries)) {
    const label = `${packName}.${queryName}`;
    const interval = Number(query.intervalSeconds);
    const retention = Number(query.retentionDays);
    const mode = String(query.collectionMode || '');
    const piiHandling = String(query.piiHandling || '');

    if (!Number.isInteger(interval) || interval <= 0 || interval > maxIntervalSeconds) {
      errors.push(`${label} intervalSeconds must be 1..${maxIntervalSeconds}`);
    }
    if (!allowedModes.has(mode)) errors.push(`${label} collectionMode must be differential or snapshot`);
    if (mode === 'snapshot' && !query.snapshotJustification) {
      errors.push(`${label} snapshot queries require snapshotJustification`);
    }
    if (!allowedPiiHandling.has(piiHandling)) errors.push(`${label} piiHandling must be one of ${[...allowedPiiHandling].join(', ')}`);
    if (query.rawPiiAllowed !== false) errors.push(`${label} rawPiiAllowed must be false`);
    if (!Number.isInteger(retention) || retention <= 0 || retention > maxRetentionDays) {
      errors.push(`${label} retentionDays must be 1..${maxRetentionDays}`);
    }
    if (!Array.isArray(query.fields) || query.fields.length === 0) {
      errors.push(`${label} must list minimized output fields`);
    }
    for (const field of asArray(query.fields)) {
      if (/email$/i.test(field) || /name$/i.test(field) || /phone$/i.test(field) || /address/i.test(field)) {
        errors.push(`${label} field '${field}' appears to be raw PII; use Hash/Redacted/Protected suffix`);
      }
      if (/token|secret|private.?key|api.?key/i.test(field)) {
        errors.push(`${label} field '${field}' must never be collected`);
      }
    }
  }
}

if (fs.existsSync(auditRoutePath)) {
  const auditRoute = fs.readFileSync(auditRoutePath, 'utf8');
  if (!auditRoute.includes('sanitizeAuditLogItem')) {
    errors.push('audit route must sanitize audit log items before returning them');
  }
  if (!/delete\s+item\.userEmailEnc/.test(auditRoute)) {
    errors.push('audit route must remove userEmailEnc from API responses');
  }
}

if (errors.length) fail(errors);

console.log(`[pbd-verify] ok: ${path.relative(repoRoot, privacyPolicyPath)}, ${path.relative(repoRoot, packsPath)}`);
