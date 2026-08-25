import { createHash } from 'node:crypto';
import { getProfessionalProfileCatalog } from './professional-profile-catalog.mjs';

const PROFILE_SCHEMA_VERSION = 1;
const PROFILE_SOURCE = 'PEOPLE_MANUAL';
const TEXT_MAX_LENGTH = 80;
const ARRAY_LIMITS = Object.freeze({
  educationRecords: 10,
  englishEvidence: 10,
  certifications: 20,
});

const catalog = getProfessionalProfileCatalog();
const educationByCode = new Map(catalog.educationAttainments.map((entry) => [entry.code, entry]));
const englishTestByCode = new Map(catalog.englishTests.map((entry) => [entry.code, entry]));
const countryCodes = new Set(catalog.countryCodes);

function invalid(field, message) {
  const error = new Error(`${field}: ${message}`);
  error.code = 'professional_profile_invalid';
  error.field = field;
  throw error;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textLength(value) {
  return Array.from(value).length;
}

function optionalText(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid(field, 'must be text');
  const normalized = value.trim();
  if (!normalized) return null;
  if (textLength(normalized) > TEXT_MAX_LENGTH) {
    invalid(field, `must be at most ${TEXT_MAX_LENGTH} characters`);
  }
  return normalized;
}

function requiredCode(value, field) {
  if (typeof value !== 'string' || !value.trim()) invalid(field, 'is required');
  return value.trim().toUpperCase();
}

function boundedArray(value, field) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) invalid(field, 'must be an array');
  if (value.length > ARRAY_LIMITS[field]) {
    invalid(field, `maximum is ${ARRAY_LIMITS[field]}`);
  }
  return value;
}

function normalizeCountryCode(value, field) {
  const normalized = optionalText(value, field);
  if (normalized === null) return null;
  const code = normalized.toUpperCase();
  if (!countryCodes.has(code)) invalid(field, 'must be an ISO 3166-1 alpha-2 country code');
  return code;
}

function normalizeEducationRecord(value, index) {
  const field = `educationRecords[${index}]`;
  if (!isRecord(value)) invalid(field, 'must be an object');
  const attainmentCode = requiredCode(value.attainmentCode, `${field}.attainmentCode`);
  if (!educationByCode.has(attainmentCode)) invalid(`${field}.attainmentCode`, 'is not in the catalog');
  return {
    attainmentCode,
    institutionName: optionalText(value.institutionName, `${field}.institutionName`),
    countryCode: normalizeCountryCode(value.countryCode, `${field}.countryCode`),
    major: optionalText(value.major, `${field}.major`),
  };
}

function normalizeNumberResult(value, scale, field) {
  const normalized = optionalText(value, field);
  if (normalized === null || !/^\d+(?:\.\d+)?$/.test(normalized)) {
    invalid(field, 'must be a numeric text value');
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < scale.min || number > scale.max) {
    invalid(field, `must be between ${scale.min} and ${scale.max}`);
  }
  const steps = (number - scale.min) / scale.step;
  if (Math.abs(steps - Math.round(steps)) > 1e-9) {
    invalid(field, `must use ${scale.step} increments`);
  }
  return String(number);
}

function normalizeEnglishResult(value, scale, field) {
  if (scale.resultType === 'NUMBER') return normalizeNumberResult(value, scale, field);
  if (scale.resultType === 'GRADE') {
    const grade = requiredCode(value, field);
    if (!scale.allowedValues.includes(grade)) invalid(field, 'is not an allowed grade');
    return grade;
  }
  if (scale.resultType === 'TEXT') {
    const text = optionalText(value, field);
    if (text === null) invalid(field, 'is required');
    return text;
  }
  invalid(field, 'uses an unsupported result type');
}

function normalizeTestedAt(value, field) {
  const normalized = optionalText(value, field);
  if (normalized === null) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalized)) invalid(field, 'must use YYYY-MM');
  return normalized;
}

function normalizeEnglishEvidence(value, index) {
  const field = `englishEvidence[${index}]`;
  if (!isRecord(value)) invalid(field, 'must be an object');
  const testCode = requiredCode(value.testCode, `${field}.testCode`);
  const test = englishTestByCode.get(testCode);
  if (!test) invalid(`${field}.testCode`, 'is not in the catalog');

  const scaleCode = requiredCode(value.scaleCode, `${field}.scaleCode`);
  const scale = test.scales.find(({ code }) => code === scaleCode);
  if (!scale) invalid(`${field}.scaleCode`, `does not belong to ${testCode}`);

  const otherTestName = optionalText(value.otherTestName, `${field}.otherTestName`);
  if (testCode === 'OTHER' && otherTestName === null) {
    invalid(`${field}.otherTestName`, 'is required for OTHER');
  }
  if (testCode !== 'OTHER' && otherTestName !== null) {
    invalid(`${field}.otherTestName`, 'is only allowed for OTHER');
  }

  return {
    testCode,
    scaleCode,
    resultValue: normalizeEnglishResult(value.resultValue, scale, `${field}.resultValue`),
    otherTestName,
    testedAt: normalizeTestedAt(value.testedAt, `${field}.testedAt`),
  };
}

function normalizeCertification(value, index) {
  const field = `certifications[${index}]`;
  if (!isRecord(value)) invalid(field, 'must be an object');
  if (typeof value.label !== 'string') invalid(`${field}.label`, 'is required');
  const label = value.label.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!label) invalid(`${field}.label`, 'is required');
  if (textLength(label) > TEXT_MAX_LENGTH) {
    invalid(`${field}.label`, `must be at most ${TEXT_MAX_LENGTH} characters`);
  }
  return {
    key: label.toLocaleLowerCase('ko-KR'),
    label,
  };
}

function normalizeCertifications(values) {
  const seen = new Set();
  const certifications = [];
  values.forEach((value, index) => {
    const certification = normalizeCertification(value, index);
    if (seen.has(certification.key)) return;
    seen.add(certification.key);
    certifications.push(certification);
  });
  return certifications;
}

export function normalizeProfessionalProfileInput(input) {
  const value = input === null || input === undefined ? {} : input;
  if (!isRecord(value)) invalid('profile', 'must be an object');
  const educationRecords = boundedArray(value.educationRecords, 'educationRecords');
  const englishEvidence = boundedArray(value.englishEvidence, 'englishEvidence');
  const certifications = boundedArray(value.certifications, 'certifications');
  return {
    educationRecords: educationRecords.map(normalizeEducationRecord),
    englishEvidence: englishEvidence.map(normalizeEnglishEvidence),
    certifications: normalizeCertifications(certifications),
  };
}

function normalizeStoredTimestamp(value, field) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) invalid(field, 'must be a valid timestamp');
    return value;
  }
  if (typeof value === 'string') {
    if (Number.isNaN(Date.parse(value))) invalid(field, 'must be a valid timestamp');
    return value;
  }
  if (isRecord(value) && typeof value.toDate === 'function') {
    const date = value.toDate();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) invalid(field, 'must be a valid timestamp');
    return value;
  }
  invalid(field, 'must be a valid timestamp');
}

function normalizeProvenance(value) {
  if (!isRecord(value)) invalid('provenance', 'is required');
  if (value.source !== PROFILE_SOURCE) invalid('provenance.source', `must be ${PROFILE_SOURCE}`);
  if (!Number.isInteger(value.revision) || value.revision < 0) {
    invalid('provenance.revision', 'must be a non-negative integer');
  }
  return {
    source: PROFILE_SOURCE,
    revision: value.revision,
    updatedAt: normalizeStoredTimestamp(value.updatedAt, 'provenance.updatedAt'),
    updatedBy: optionalText(value.updatedBy, 'provenance.updatedBy'),
  };
}

function emptyStoredProfile() {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    educationRecords: [],
    englishEvidence: [],
    certifications: [],
    provenance: {
      source: PROFILE_SOURCE,
      revision: 0,
      updatedAt: null,
      updatedBy: null,
    },
  };
}

export function normalizeStoredProfessionalProfile(value) {
  if (value === null || value === undefined) return emptyStoredProfile();
  if (!isRecord(value)) invalid('storedProfile', 'must be an object');
  if (value.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    invalid('schemaVersion', `must be ${PROFILE_SCHEMA_VERSION}`);
  }
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    ...normalizeProfessionalProfileInput(value),
    provenance: normalizeProvenance(value.provenance),
  };
}

function serializeTimestamp(value) {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return new Date(value).toISOString();
  return value.toDate().toISOString();
}

export function serializeProfessionalProfile(value) {
  const profile = normalizeStoredProfessionalProfile(value);
  return {
    schemaVersion: profile.schemaVersion,
    educationRecords: profile.educationRecords.map((record) => ({
      attainmentCode: record.attainmentCode,
      institutionName: record.institutionName,
      countryCode: record.countryCode,
      major: record.major,
    })),
    englishEvidence: profile.englishEvidence.map((evidence) => ({
      testCode: evidence.testCode,
      scaleCode: evidence.scaleCode,
      resultValue: evidence.resultValue,
      otherTestName: evidence.otherTestName,
      testedAt: evidence.testedAt,
    })),
    certifications: profile.certifications.map((certification) => ({
      key: certification.key,
      label: certification.label,
    })),
    provenance: {
      source: profile.provenance.source,
      revision: profile.provenance.revision,
      updatedAt: serializeTimestamp(profile.provenance.updatedAt),
      updatedBy: profile.provenance.updatedBy,
    },
  };
}

function formatEducation(record) {
  if (!record) return '';
  const label = educationByCode.get(record.attainmentCode).label;
  return record.institutionName ? `${label} · ${record.institutionName}` : label;
}

function formatEnglishEvidence(evidence) {
  const test = englishTestByCode.get(evidence.testCode);
  const label = evidence.testCode === 'OTHER' ? evidence.otherTestName : test.displayLabel;
  return `${label} ${evidence.resultValue}`;
}

export function deriveProfessionalProfileFacts(value) {
  const profile = normalizeProfessionalProfileInput(value);
  let highestEducation = null;
  let highestRank = Number.NEGATIVE_INFINITY;
  profile.educationRecords.forEach((record) => {
    const rank = educationByCode.get(record.attainmentCode).rank;
    if (rank > highestRank) {
      highestEducation = record;
      highestRank = rank;
    }
  });

  const englishFacets = [];
  const seenFacets = new Set();
  profile.englishEvidence.forEach(({ testCode }) => {
    if (seenFacets.has(testCode)) return;
    seenFacets.add(testCode);
    englishFacets.push(testCode);
  });
  const hasOverseasEducation = profile.educationRecords.some(
    ({ countryCode }) => countryCode !== null && countryCode !== 'KR',
  );
  if (hasOverseasEducation) englishFacets.push('OVERSEAS_EDUCATION');
  if (englishFacets.length === 0) englishFacets.push('__MISSING__');

  const englishDisplayParts = profile.englishEvidence.map(formatEnglishEvidence);
  if (hasOverseasEducation) englishDisplayParts.push('해외 대학');

  return {
    highestEducationCode: highestEducation?.attainmentCode ?? null,
    englishFacets,
    highestEducationDisplayText: formatEducation(highestEducation),
    englishEvidenceDisplayText: englishDisplayParts.join(' · '),
    certificationsDisplayText: profile.certifications.map(({ label }) => label).join(' · '),
    certificationKeys: profile.certifications.map(({ key }) => key),
  };
}

function requiredIdentity(value, field) {
  if (typeof value !== 'string' || !value.trim()) invalid(field, 'is required');
  return value.trim();
}

export function buildProfessionalProfileRagFingerprint({
  tenantId,
  personId,
  profile,
  catalogVersion = catalog.catalogVersion,
} = {}) {
  const normalized = normalizeProfessionalProfileInput(profile);
  const schemaVersion = profile?.schemaVersion ?? PROFILE_SCHEMA_VERSION;
  const profileRevision = profile?.provenance?.revision ?? 0;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) invalid('schemaVersion', 'must be a positive integer');
  if (!Number.isInteger(profileRevision) || profileRevision < 0) {
    invalid('provenance.revision', 'must be a non-negative integer');
  }
  if (!Number.isInteger(catalogVersion) || catalogVersion < 1) {
    invalid('catalogVersion', 'must be a positive integer');
  }
  const payload = {
    tenantId: requiredIdentity(tenantId, 'tenantId'),
    personId: requiredIdentity(personId, 'personId'),
    schemaVersion,
    profileRevision,
    catalogVersion,
    educationRecords: normalized.educationRecords,
    englishEvidence: normalized.englishEvidence,
    certifications: normalized.certifications,
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

export { getProfessionalProfileCatalog };
