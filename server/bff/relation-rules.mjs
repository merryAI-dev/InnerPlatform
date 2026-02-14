import fs from 'node:fs';
import path from 'node:path';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeChangedFields(value) {
  if (value === '*') return ['*'];
  const fields = toArray(value)
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
  return fields.length ? fields : ['*'];
}

function normalizeAffects(value) {
  return toArray(value)
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizeRule(input) {
  if (!input || typeof input !== 'object') return null;

  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const enabled = input.enabled !== false;
  const when = input.when && typeof input.when === 'object' ? input.when : {};
  const entityType = normalizeText(when.entityType) || '*';
  const changedFields = normalizeChangedFields(when.changedFields);
  const affects = normalizeAffects(input.affects);

  if (!id || !affects.length) return null;

  return {
    id,
    enabled,
    when: {
      entityType,
      changedFields,
    },
    affects,
  };
}

function ruleMatches(rule, input) {
  const targetEntityType = normalizeText(input.entityType);
  const changedFields = Array.isArray(input.changedFields)
    ? input.changedFields.map((field) => String(field).trim()).filter(Boolean)
    : [];

  if (!rule.enabled) return false;
  if (rule.when.entityType !== '*' && rule.when.entityType !== targetEntityType) return false;
  if (rule.when.changedFields.includes('*')) return true;

  if (!changedFields.length) return false;
  return changedFields.some((field) => rule.when.changedFields.includes(field));
}

function unique(values) {
  return Array.from(new Set(values));
}

export function resolveRelationRulesPolicyPath(env = process.env) {
  const configured = String(env.RELATION_RULES_PATH || '').trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }
  return path.resolve(process.cwd(), 'policies/relation-rules.json');
}

export function loadRulesFromPolicyFile(policyPath = resolveRelationRulesPolicyPath()) {
  const raw = fs.readFileSync(policyPath, 'utf8');
  const parsed = JSON.parse(raw);
  const candidates = Array.isArray(parsed.rules) ? parsed.rules : [];
  return candidates
    .map(normalizeRule)
    .filter(Boolean);
}

export async function loadTenantRelationRules(db, tenantId) {
  const snap = await db.collection(`orgs/${tenantId}/relation_rules`).get();
  if (snap.empty) return [];
  return snap.docs
    .map((doc) => normalizeRule({ id: doc.id, ...doc.data() }))
    .filter(Boolean);
}

export async function resolveRelationRules({
  db,
  tenantId,
  policyPath,
}) {
  const tenantRules = await loadTenantRelationRules(db, tenantId);
  if (tenantRules.length) return tenantRules;
  return loadRulesFromPolicyFile(policyPath);
}

export function resolveAffectedViews(rules, input) {
  const affects = [];
  for (const rule of rules || []) {
    if (!ruleMatches(rule, input)) continue;
    affects.push(...rule.affects);
  }
  return unique(affects);
}
