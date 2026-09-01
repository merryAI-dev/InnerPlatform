import { createHash } from 'node:crypto';
import { getProfessionalProfileCatalog } from './professional-profile-catalog.mjs';

const PROFILE_SCHEMA_VERSION = 1;
const PROFILE_SOURCE = 'PEOPLE_MANUAL';
const TEXT_MAX_LENGTH = 80;
// 증빙 경로는 사람이 쓰는 글자가 아니라 서버가 만든 저장 키다.
// orgs/{tenant}/person-hr-evidence/{personId}/{evidenceId}-{파일명} 만 해도 80자를 넘는다.
const EVIDENCE_PATH_MAX_LENGTH = 512;
const EVIDENCE_NAME_MAX_LENGTH = 200;
const EVIDENCE_CONTENT_TYPE_MAX_LENGTH = 128;
const EVIDENCE_ROOT_SEGMENT = 'person-hr-evidence/';
const ARRAY_LIMITS = Object.freeze({
  educationRecords: 10,
  englishEvidence: 10,
  certifications: 20,
});

const catalog = getProfessionalProfileCatalog();
const educationByCode = new Map(catalog.educationAttainments.map((entry) => [entry.code, entry]));
const englishTestByCode = new Map(catalog.englishTests.map((entry) => [entry.code, entry]));
const educationRegionByCode = new Map(catalog.educationRegions.map((entry) => [entry.code, entry]));
// 249개 ISO 국가 코드로 저장하던 시절의 값. 국내/해외 둘만 가리면 되므로 옮겨 읽는다.
const ENGLISH_SPEAKING_COUNTRY_CODES = new Set(['US', 'GB', 'AU', 'CA', 'NZ', 'IE']);

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

function boundedText(value, field, max) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid(field, 'must be text');
  const normalized = value.trim();
  if (!normalized) return null;
  if (textLength(normalized) > max) {
    invalid(field, `must be at most ${max} characters`);
  }
  return normalized;
}

function optionalText(value, field) {
  return boundedText(value, field, TEXT_MAX_LENGTH);
}

/**
 * 증빙 경로. 길이를 넉넉히 두는 대신 어디를 가리키는지는 좁힌다 —
 * 증빙 보관함 밖을 가리키는 경로는 저장하지 않는다.
 */
function normalizeEvidencePath(value, field) {
  const path = boundedText(value, field, EVIDENCE_PATH_MAX_LENGTH);
  if (!path) return null;
  if (!path.includes(EVIDENCE_ROOT_SEGMENT) || path.includes('..')) {
    invalid(field, 'must point inside the person evidence store');
  }
  return path;
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

/**
 * 학교가 국내인지 해외인지. 영미권을 따로 가리는 것은 어학 능력을 함께 읽기 때문이다.
 *
 * 예전에는 249개 ISO 국가 코드로 저장했다. 그때 값이 들어오면 옮겨 읽는다 —
 * 이미 적어 둔 학력이 저장 한 번에 사라지지 않게.
 */
function normalizeEducationRegion(value, field) {
  const normalized = optionalText(value, field);
  if (normalized === null) return null;
  const code = normalized.toUpperCase();
  if (educationRegionByCode.has(code)) return code;
  if (/^[A-Z]{2}$/.test(code)) {
    if (code === 'KR') return 'DOMESTIC';
    return ENGLISH_SPEAKING_COUNTRY_CODES.has(code) ? 'OVERSEAS_ENGLISH' : 'OVERSEAS_OTHER';
  }
  invalid(field, 'must be one of DOMESTIC, OVERSEAS_ENGLISH, OVERSEAS_OTHER');
  return null;
}


/** 입학·학위취득 년도. 사람이 기억으로 적는 값이라 연도까지만 받는다. */
function normalizeYear(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{4}$/.test(text.trim())) invalid(field, 'must be a 4-digit year');
  const year = Number(text.trim());
  if (year < 1900 || year > 2100) invalid(field, 'must be between 1900 and 2100');
  return String(year);
}

/** 자격증 취득일·증빙 일자. 일 단위까지 기억하지 못하는 경우가 많아 YYYY-MM 으로 받는다. */
function normalizeMonth(value, field) {
  const normalized = optionalText(value, field);
  if (normalized === null) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalized)) invalid(field, 'must use YYYY-MM');
  return normalized;
}


/**
 * 증빙 참조. 파일 자체는 스토리지에 있고 프로필에는 가리키는 표만 남는다.
 * 경로(path)는 서버가 evidenceId 로 만든 값만 저장한다 - 브라우저가 준 경로는 쓰지 않는다.
 */
function normalizeEvidenceRef(value, field) {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) invalid(field, 'must be an object');
  const evidenceId = optionalText(value.evidenceId, `${field}.evidenceId`);
  const path = normalizeEvidencePath(value.path, `${field}.path`);
  if (!evidenceId || !path) invalid(field, 'requires evidenceId and path');
  const size = Number(value.size);
  return {
    evidenceId,
    path,
    name: boundedText(value.name, `${field}.name`, EVIDENCE_NAME_MAX_LENGTH) || evidenceId,
    size: Number.isSafeInteger(size) && size >= 0 ? size : 0,
    contentType: boundedText(value.contentType, `${field}.contentType`, EVIDENCE_CONTENT_TYPE_MAX_LENGTH) || 'application/octet-stream',
    uploadedAt: optionalText(value.uploadedAt, `${field}.uploadedAt`),
  };
}

/** 프로필 어디에든 붙어 있는 증빙 경로를 모은다. 저장할 때 사라진 파일을 지우는 데 쓴다. */
export function collectProfileEvidencePaths(profile) {
  if (!isRecord(profile)) return [];
  const paths = [];
  const push = (evidence) => {
    const path = readEvidencePath(evidence);
    if (path) paths.push(path);
  };
  (Array.isArray(profile.educationRecords) ? profile.educationRecords : []).forEach((record) => push(record?.evidence));
  (Array.isArray(profile.englishEvidence) ? profile.englishEvidence : []).forEach((record) => push(record?.evidence));
  (Array.isArray(profile.certifications) ? profile.certifications : []).forEach((record) => push(record?.evidence));
  return [...new Set(paths)];
}

function readEvidencePath(evidence) {
  return isRecord(evidence) && typeof evidence.path === 'string' && evidence.path.trim()
    ? evidence.path.trim()
    : '';
}

function normalizeEducationRecord(value, index) {
  const field = `educationRecords[${index}]`;
  if (!isRecord(value)) invalid(field, 'must be an object');
  const attainmentCode = requiredCode(value.attainmentCode, `${field}.attainmentCode`);
  if (!educationByCode.has(attainmentCode)) invalid(`${field}.attainmentCode`, 'is not in the catalog');
  const admissionYear = normalizeYear(value.admissionYear, `${field}.admissionYear`);
  const degreeYear = normalizeYear(value.degreeYear, `${field}.degreeYear`);
  if (admissionYear && degreeYear && admissionYear > degreeYear) {
    invalid(`${field}.degreeYear`, 'must not be earlier than admissionYear');
  }
  return {
    attainmentCode,
    institutionName: optionalText(value.institutionName, `${field}.institutionName`),
    regionCode: normalizeEducationRegion(value.regionCode ?? value.countryCode, `${field}.regionCode`),
    major: optionalText(value.major, `${field}.major`),
    admissionYear,
    degreeYear,
    evidence: normalizeEvidenceRef(value.evidence, `${field}.evidence`),
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
    evidence: normalizeEvidenceRef(value.evidence, `${field}.evidence`),
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
    acquiredAt: normalizeMonth(value.acquiredAt, `${field}.acquiredAt`),
    evidence: normalizeEvidenceRef(value.evidence, `${field}.evidence`),
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
      regionCode: record.regionCode,
      major: record.major,
      admissionYear: record.admissionYear,
      degreeYear: record.degreeYear,
      evidence: record.evidence,
    })),
    englishEvidence: profile.englishEvidence.map((evidence) => ({
      testCode: evidence.testCode,
      scaleCode: evidence.scaleCode,
      resultValue: evidence.resultValue,
      otherTestName: evidence.otherTestName,
      testedAt: evidence.testedAt,
      evidence: evidence.evidence,
    })),
    certifications: profile.certifications.map((certification) => ({
      key: certification.key,
      label: certification.label,
      acquiredAt: certification.acquiredAt,
      evidence: certification.evidence,
    })),
    provenance: {
      source: profile.provenance.source,
      revision: profile.provenance.revision,
      updatedAt: serializeTimestamp(profile.provenance.updatedAt),
      updatedBy: profile.provenance.updatedBy,
    },
  };
}

/**
 * 최종학력 한 줄. 학교보다 **학과(전공)** 를 앞세운다 - 사람을 고를 때 무엇을 전공했는지가
 * 어느 학교를 나왔는지보다 먼저 읽혀야 한다. 전공이 없으면 학교로 대신한다.
 */
function formatEducation(record) {
  if (!record) return '';
  const label = educationByCode.get(record.attainmentCode).label;
  const detail = record.major || record.institutionName;
  return detail ? `${label} · ${detail}` : label;
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
    ({ regionCode }) => regionCode === 'OVERSEAS_ENGLISH' || regionCode === 'OVERSEAS_OTHER',
  );
  if (hasOverseasEducation) englishFacets.push('OVERSEAS_EDUCATION');
  if (englishFacets.length === 0) englishFacets.push('__MISSING__');

  const englishDisplayParts = profile.englishEvidence.map(formatEnglishEvidence);
  if (hasOverseasEducation) englishDisplayParts.push('해외 대학');

  return {
    highestEducationCode: highestEducation?.attainmentCode ?? null,
    // 학위취득년도는 졸업증에 찍힌 해다. KOICA 제안서가 '학위 취득 후 경력 몇 년'을 보므로
    // 최고 학력의 취득년도를 따로 꺼내 둔다 - 화면이 학력 목록을 다시 뒤지지 않게.
    highestDegreeYear: highestEducation?.degreeYear ?? null,
    highestEducationInstitution: highestEducation?.institutionName ?? null,
    highestEducationMajor: highestEducation?.major ?? null,
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
