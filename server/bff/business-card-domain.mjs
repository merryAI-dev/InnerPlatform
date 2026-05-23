import { randomUUID } from 'node:crypto';

const CONFIDENCE_VALUES = new Set(['high', 'medium', 'low']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_PATTERN = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
export const BUSINESS_CARD_NORMALIZATION_VERSION = 1;
export const BUSINESS_CARD_EXTRACTION_SCHEMA_VERSION = 1;

export function createBusinessCardImportId() {
  return `bcimp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function createContactId() {
  return `ct_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function readOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeConfidence(value) {
  return CONFIDENCE_VALUES.has(value) ? value : 'low';
}

export function buildExtractedField(value = '', confidence = 'low', evidence = '') {
  return {
    value: readOptionalText(value),
    confidence: normalizeConfidence(confidence),
    evidence: readOptionalText(evidence).slice(0, 2000),
  };
}

export function buildEmptyBusinessCardExtraction(warnings = []) {
  return {
    name: buildExtractedField(),
    organization: buildExtractedField(),
    department: buildExtractedField(),
    title: buildExtractedField(),
    role: buildExtractedField(),
    emails: [],
    phones: [],
    website: buildExtractedField(),
    address: buildExtractedField(),
    memo: buildExtractedField(),
    rawText: '',
    warnings: Array.isArray(warnings) ? warnings.map(readOptionalText).filter(Boolean).slice(0, 8) : [],
  };
}

export function normalizeEmail(value) {
  return readOptionalText(value).toLowerCase();
}

export function normalizePhone(value) {
  const text = readOptionalText(value);
  if (!text) return '';
  const hasPlus = text.startsWith('+');
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? `${hasPlus ? '+' : ''}${digits}` : '';
}

export function normalizeWebsite(value) {
  const text = readOptionalText(value);
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/.*)?$/.test(text)) return `https://${text}`;
  return text;
}

function normalizeListField(item, normalizer) {
  const raw = typeof item === 'string' ? { value: item } : (item && typeof item === 'object' ? item : {});
  const value = normalizer(raw.value);
  if (!value) return null;
  return {
    value,
    confidence: normalizeConfidence(raw.confidence),
    evidence: readOptionalText(raw.evidence || raw.value).slice(0, 2000),
  };
}

function normalizeStringArray(values, normalizer) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((item) => normalizeListField(item, normalizer))
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item.value)) return false;
      seen.add(item.value);
      return true;
    })
    .slice(0, 8);
}

export function normalizeBusinessCardExtraction(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    name: buildExtractedField(raw.name?.value ?? raw.name, raw.name?.confidence, raw.name?.evidence),
    organization: buildExtractedField(raw.organization?.value ?? raw.organization, raw.organization?.confidence, raw.organization?.evidence),
    department: buildExtractedField(raw.department?.value ?? raw.department, raw.department?.confidence, raw.department?.evidence),
    title: buildExtractedField(raw.title?.value ?? raw.title, raw.title?.confidence, raw.title?.evidence),
    role: buildExtractedField(raw.role?.value ?? raw.role, raw.role?.confidence, raw.role?.evidence),
    emails: normalizeStringArray(raw.emails, normalizeEmail),
    phones: normalizeStringArray(raw.phones, normalizePhone),
    website: buildExtractedField(normalizeWebsite(raw.website?.value ?? raw.website), raw.website?.confidence, raw.website?.evidence),
    address: buildExtractedField(raw.address?.value ?? raw.address, raw.address?.confidence, raw.address?.evidence),
    memo: buildExtractedField(raw.memo?.value ?? raw.memo, raw.memo?.confidence, raw.memo?.evidence),
    rawText: readOptionalText(raw.rawText).slice(0, 12000),
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(readOptionalText).filter(Boolean).slice(0, 8) : [],
  };
}

export function normalizeBusinessCardContactPayload(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const emails = Array.from(new Set((Array.isArray(raw.emails) ? raw.emails : []).map(normalizeEmail).filter((value) => EMAIL_PATTERN.test(value)))).slice(0, 8);
  const phones = Array.from(new Set((Array.isArray(raw.phones) ? raw.phones : []).map(normalizePhone).filter(Boolean))).slice(0, 8);
  const website = normalizeWebsite(raw.website);
  return {
    name: readOptionalText(raw.name).slice(0, 300),
    organization: readOptionalText(raw.organization).slice(0, 500),
    department: readOptionalText(raw.department).slice(0, 300),
    title: readOptionalText(raw.title).slice(0, 300),
    role: readOptionalText(raw.role).slice(0, 300),
    emails,
    phones,
    website: URL_PATTERN.test(website) ? website : '',
    address: readOptionalText(raw.address).slice(0, 1000),
    memo: readOptionalText(raw.memo).slice(0, 2000),
  };
}

export function assertConfirmableContact(contact) {
  if (!readOptionalText(contact?.name) && !readOptionalText(contact?.organization)) {
    const error = new Error('name or organization is required');
    error.statusCode = 400;
    error.code = 'contact_identity_required';
    throw error;
  }
  if (!Array.isArray(contact?.emails) || !Array.isArray(contact?.phones) || (contact.emails.length === 0 && contact.phones.length === 0)) {
    const error = new Error('email or phone is required');
    error.statusCode = 400;
    error.code = 'contact_method_required';
    throw error;
  }
}

function normalizeSearchValue(value) {
  return readOptionalText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.+-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addToken(tokens, value) {
  const normalized = normalizeSearchValue(value);
  if (!normalized) return;
  normalized.split(' ').filter(Boolean).forEach((token) => {
    if (token.length >= 2) tokens.add(token);
  });
  const compact = normalized.replace(/\s+/g, '');
  if (compact.length >= 2) tokens.add(compact);
}

function addEmailTokens(tokens, value) {
  const email = normalizeEmail(value);
  if (!email) return;
  addToken(tokens, email);
  const [localPart, domainPart] = email.split('@');
  addToken(tokens, localPart);
  addToken(tokens, domainPart);
  domainPart?.split('.').forEach((part) => addToken(tokens, part));
}

function addPhoneTokens(tokens, value) {
  const phone = normalizePhone(value);
  if (!phone) return;
  addToken(tokens, phone);
  const digits = phone.replace(/^\+/, '');
  addToken(tokens, digits);
  if (digits.length < 4) return;
  tokens.add(digits.slice(-4));
  for (let index = 0; index <= digits.length - 4; index += 1) {
    tokens.add(digits.slice(index, index + 4));
  }
}

function buildTrigrams(value, maxTokens = 40) {
  const compact = normalizeSearchValue(value).replace(/\s+/g, '');
  if (!compact) return [];
  if (compact.length <= 2) return [compact];
  const trigrams = new Set();
  for (let index = 0; index <= compact.length - 3; index += 1) {
    trigrams.add(compact.slice(index, index + 3));
  }
  return Array.from(trigrams).slice(0, maxTokens);
}

function buildQualitySummary(contact) {
  const hasIdentity = Boolean(readOptionalText(contact?.name) || readOptionalText(contact?.organization));
  const hasContactMethod = (contact?.emails || []).length > 0 || (contact?.phones || []).length > 0;
  const hasRoleContext = Boolean(readOptionalText(contact?.department) || readOptionalText(contact?.title) || readOptionalText(contact?.role));
  const score = [
    hasIdentity,
    hasContactMethod,
    Boolean(readOptionalText(contact?.organization)),
    hasRoleContext,
  ].filter(Boolean).length / 4;

  return {
    score: Number(score.toFixed(2)),
    status: hasIdentity && hasContactMethod ? 'ready' : 'needs_review',
    hasIdentity,
    hasContactMethod,
  };
}

export function buildContactSearchTokens(contact) {
  const tokens = new Set();
  [
    contact?.name,
    contact?.organization,
    contact?.department,
    contact?.title,
    contact?.role,
  ].forEach((value) => addToken(tokens, value));
  (contact?.emails || []).forEach((value) => addEmailTokens(tokens, value));
  (contact?.phones || []).forEach((value) => addPhoneTokens(tokens, value));
  return Array.from(tokens).slice(0, 80);
}

export function buildContactDerivedFields(contact) {
  const emailKeys = Array.from(new Set((contact?.emails || []).map(normalizeEmail).filter(Boolean))).slice(0, 8);
  const phoneKeys = Array.from(new Set((contact?.phones || []).map(normalizePhone).filter(Boolean))).slice(0, 8);
  const phoneDigits = phoneKeys.map((phone) => phone.replace(/^\+/, '')).filter(Boolean);

  return {
    normalizedName: normalizeSearchValue(contact?.name),
    normalizedOrganization: normalizeSearchValue(contact?.organization),
    primaryEmail: emailKeys[0] || '',
    primaryPhone: phoneKeys[0] || '',
    emailKeys,
    phoneKeys,
    phoneDigits,
    searchTokens: buildContactSearchTokens({ ...contact, emails: emailKeys, phones: phoneKeys }),
    nameTrigrams: buildTrigrams(contact?.name),
    organizationTrigrams: buildTrigrams(contact?.organization),
    quality: buildQualitySummary({ ...contact, emails: emailKeys, phones: phoneKeys }),
    normalizationVersion: BUSINESS_CARD_NORMALIZATION_VERSION,
    extractionSchemaVersion: BUSINESS_CARD_EXTRACTION_SCHEMA_VERSION,
  };
}

export function tokenizeContactSearchQuery(query) {
  return normalizeSearchValue(query)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 8);
}

function matchScore(query, values) {
  const q = normalizeSearchValue(query);
  if (!q) return 0;
  const haystacks = (Array.isArray(values) ? values : [values]).map(normalizeSearchValue).filter(Boolean);
  if (haystacks.some((value) => value === q)) return 1;
  if (haystacks.some((value) => value.startsWith(q))) return 0.8;
  if (haystacks.some((value) => value.includes(q))) return 0.5;
  return 0;
}

function aggregateMatchScore(query, values) {
  const q = normalizeSearchValue(query);
  if (!q) return 0;
  const tokenScores = tokenizeContactSearchQuery(q).map((token) => matchScore(token, values));
  return Math.max(matchScore(q, values), ...tokenScores, 0);
}

export function scoreContactSearchResult(contact, query, now = new Date()) {
  const normalizedQuery = readOptionalText(query);
  const updatedAt = new Date(readOptionalText(contact?.updatedAt || contact?.createdAt) || now);
  const daysSinceUpdated = Number.isFinite(updatedAt.getTime())
    ? Math.max(0, (now.getTime() - updatedAt.getTime()) / 86400000)
    : 365;
  const recencyBoost = 1 / (1 + daysSinceUpdated / 30);
  return (
    3.0 * aggregateMatchScore(normalizedQuery, contact?.name)
    + 2.5 * aggregateMatchScore(normalizedQuery, contact?.emails || [])
    + 2.0 * aggregateMatchScore(normalizedQuery, contact?.phones || [])
    + 1.5 * aggregateMatchScore(normalizedQuery, contact?.organization)
    + 1.0 * aggregateMatchScore(normalizedQuery, [contact?.title, contact?.role])
    + 0.2 * recencyBoost
  );
}
