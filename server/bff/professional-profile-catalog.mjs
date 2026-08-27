import catalog from '../../policies/professional-profile-catalog.json' with { type: 'json' };

function assertUnique(values, field) {
  if (new Set(values).size !== values.length) {
    throw new Error(`professional profile catalog has duplicate ${field}`);
  }
}

function validateCatalog(value) {
  if (value?.catalogVersion !== 1) {
    throw new Error('professional profile catalogVersion must be 1');
  }
  if (!Array.isArray(value.educationAttainments) || value.educationAttainments.length === 0) {
    throw new Error('professional profile educationAttainments are required');
  }
  assertUnique(value.educationAttainments.map(({ code }) => code), 'education code');
  assertUnique(value.educationAttainments.map(({ label }) => label), 'education label');
  assertUnique(value.educationAttainments.map(({ rank }) => rank), 'education rank');

  if (!Array.isArray(value.englishTests) || value.englishTests.length === 0) {
    throw new Error('professional profile englishTests are required');
  }
  assertUnique(value.englishTests.map(({ code }) => code), 'English test code');
  assertUnique(value.englishTests.flatMap(({ scales }) => scales.map(({ code }) => code)), 'English scale code');
  if (value.englishTests.some(({ scales }) => (
    !Array.isArray(scales)
    || scales.length === 0
    || scales.some(({ label }) => typeof label !== 'string' || !label.trim())
  ))) {
    throw new Error('professional profile English scale labels are required');
  }

  if (!Array.isArray(value.educationRegions) || value.educationRegions.length === 0) {
    throw new Error('professional profile educationRegions are required');
  }
  assertUnique(value.educationRegions.map(({ code }) => code), 'education region code');
  assertUnique(value.educationRegions.map(({ label }) => label), 'education region label');
  if (value.educationRegions.some(({ label }) => typeof label !== 'string' || !label.trim())) {
    throw new Error('professional profile educationRegion labels are required');
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const validatedCatalog = deepFreeze(validateCatalog(catalog));

export function getProfessionalProfileCatalog() {
  return validatedCatalog;
}
