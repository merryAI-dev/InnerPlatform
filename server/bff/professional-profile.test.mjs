import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

let subject = {};
try {
  subject = await import('./professional-profile.mjs');
} catch {
  // The first TDD run intentionally reaches this branch before the production entry exists.
}

function useExport(name) {
  expect(subject[name], `${name} must be exported by the production entry`).toBeTypeOf('function');
  return subject[name];
}

const EDUCATION_CODES = [
  'HIGH_SCHOOL_GRADUATED',
  'ASSOCIATE_GRADUATED',
  'BACHELOR_ENROLLED',
  'BACHELOR_GRADUATED',
  'MASTER_ENROLLED',
  'MASTER_COMPLETED',
  'MASTER_GRADUATED',
  'DOCTOR_ENROLLED',
  'DOCTOR_COMPLETED',
  'DOCTOR_GRADUATED',
  'OTHER',
];

const baseInput = () => ({
  educationRecords: [
    {
      attainmentCode: 'BACHELOR_GRADUATED',
      institutionName: ' 연세대학교 ',
      regionCode: ' domestic ',
      major: ' 경영학 ', admissionYear: null, degreeYear: null, evidence: null,
    },
    {
      attainmentCode: 'MASTER_GRADUATED',
      institutionName: ' University of Sussex ',
      regionCode: ' overseas_english ',
      major: ' Development Studies ', admissionYear: null, degreeYear: null, evidence: null,
    },
  ],
  englishEvidence: [
    {
      testCode: 'TOEIC',
      scaleCode: 'TOEIC_990',
      resultValue: '920',
      otherTestName: '  ',
      testedAt: '2026-06', evidence: null,
    },
    {
      testCode: 'TOEFL',
      scaleCode: 'TOEFL_IBT_120',
      resultValue: '105',
      otherTestName: null,
      testedAt: '2025-12', evidence: null,
    },
  ],
  certifications: [
    { label: ' ＰＭＰ ' },
    { label: 'pmp' },
    { label: 'ODA 전문가' },
  ],
});

describe('professional profile catalog', () => {
  it('loads the versioned catalog through the production entry with ordered unique options', () => {
    const getProfessionalProfileCatalog = useExport('getProfessionalProfileCatalog');
    const catalog = getProfessionalProfileCatalog();

    expect(catalog.catalogVersion).toBe(1);
    expect(catalog.educationAttainments.map(({ code }) => code)).toEqual(EDUCATION_CODES);
    expect(new Set(catalog.educationAttainments.map(({ code }) => code)).size)
      .toBe(catalog.educationAttainments.length);
    expect(new Set(catalog.educationAttainments.map(({ label }) => label)).size)
      .toBe(catalog.educationAttainments.length);
    expect(new Set(catalog.educationAttainments.map(({ rank }) => rank)).size)
      .toBe(catalog.educationAttainments.length);
    expect(Object.fromEntries(catalog.educationAttainments.map(({ code, rank }) => [code, rank])))
      .toEqual({
        HIGH_SCHOOL_GRADUATED: 10,
        ASSOCIATE_GRADUATED: 20,
        BACHELOR_ENROLLED: 30,
        BACHELOR_GRADUATED: 40,
        MASTER_ENROLLED: 50,
        MASTER_COMPLETED: 55,
        MASTER_GRADUATED: 60,
        DOCTOR_ENROLLED: 70,
        DOCTOR_COMPLETED: 75,
        DOCTOR_GRADUATED: 80,
        OTHER: 1,
      });

    const scales = catalog.englishTests.flatMap((test) => test.scales.map((scale) => ({
      testCode: test.code,
      scaleCode: scale.code,
      scaleLabel: scale.label,
    })));
    expect(scales).toEqual([
      { testCode: 'TOEIC', scaleCode: 'TOEIC_990', scaleLabel: '990점' },
      { testCode: 'TOEFL', scaleCode: 'TOEFL_IBT_120', scaleLabel: 'iBT 120점' },
      { testCode: 'OPIC', scaleCode: 'OPIC_GRADE', scaleLabel: '등급' },
      { testCode: 'IELTS', scaleCode: 'IELTS_9', scaleLabel: '9점' },
      { testCode: 'TEPS', scaleCode: 'TEPS_600', scaleLabel: '600점' },
      { testCode: 'OTHER', scaleCode: 'OTHER_TEXT', scaleLabel: '직접 입력' },
    ]);
    expect(catalog.englishTests.find(({ code }) => code === 'OPIC').scales[0].allowedValues)
      .toEqual(['NL', 'NM', 'NH', 'IL', 'IM1', 'IM2', 'IM3', 'IH', 'AL']);
    expect(catalog.educationRegions.map(({ code }) => code))
      .toEqual(['DOMESTIC', 'OVERSEAS_ENGLISH', 'OVERSEAS_OTHER']);
    expect(catalog.educationRegions.map(({ label }) => label))
      .toEqual(['국내', '해외(영미권)', '해외(기타)']);
  });

  it('loads policy JSON through a statically traceable module-relative import', async () => {
    const catalogModuleSource = await readFile(
      new URL('./professional-profile-catalog.mjs', import.meta.url),
      'utf8',
    );

    expect(catalogModuleSource).not.toMatch(/readFileSync|node:fs/);
    expect(catalogModuleSource).toMatch(
      /import\s+catalog\s+from\s+['"]\.\.\/\.\.\/policies\/professional-profile-catalog\.json['"]\s+with\s+\{\s*type:\s*['"]json['"]\s*\}/,
    );
  });
});

describe('normalizeProfessionalProfileInput', () => {
  it('normalizes the approved bachelor/master, English, and certification fixture without mutating it', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const input = baseInput();
    const before = structuredClone(input);

    const normalized = normalizeProfessionalProfileInput(input);

    expect(input).toEqual(before);
    expect(normalized).toEqual({
      educationRecords: [
        {
          attainmentCode: 'BACHELOR_GRADUATED',
          institutionName: '연세대학교',
          regionCode: 'DOMESTIC',
          major: '경영학', admissionYear: null, degreeYear: null, evidence: null,
        },
        {
          attainmentCode: 'MASTER_GRADUATED',
          institutionName: 'University of Sussex',
          regionCode: 'OVERSEAS_ENGLISH',
          major: 'Development Studies', admissionYear: null, degreeYear: null, evidence: null,
        },
      ],
      englishEvidence: [
        {
          testCode: 'TOEIC',
          scaleCode: 'TOEIC_990',
          resultValue: '920',
          otherTestName: null,
          testedAt: '2026-06', evidence: null,
        },
        {
          testCode: 'TOEFL',
          scaleCode: 'TOEFL_IBT_120',
          resultValue: '105',
          otherTestName: null,
          testedAt: '2025-12', evidence: null,
        },
      ],
      certifications: [
        { key: 'pmp', label: 'PMP', acquiredAt: null, evidence: null },
        { key: 'oda 전문가', label: 'ODA 전문가', acquiredAt: null, evidence: null },
      ],
    });
  });

  it.each([
    ['educationRecords', 10, 11, { attainmentCode: 'BACHELOR_GRADUATED' }],
    ['englishEvidence', 10, 11, { testCode: 'TOEIC', scaleCode: 'TOEIC_990', resultValue: '920' }],
    ['certifications', 20, 21, null],
  ])('enforces the %s maximum before normalization or deduplication', (field, accepted, rejected, value) => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const values = Array.from({ length: accepted }, (_, index) => (
      field === 'certifications' ? { label: `Certificate ${index}` } : value
    ));
    expect(() => normalizeProfessionalProfileInput({ [field]: values })).not.toThrow();

    const tooMany = Array.from({ length: rejected }, (_, index) => (
      field === 'certifications' ? { label: `Certificate ${index}` } : value
    ));
    expect(() => normalizeProfessionalProfileInput({ [field]: tooMany })).toThrow(/maximum|최대/i);
  });

  it('keeps evidence references and collects the paths that a save drops', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const collectProfileEvidencePaths = useExport('collectProfileEvidencePaths');
    const evidence = (id) => ({
      evidenceId: id,
      path: `orgs/mysc/person-hr-evidence/psn-a/${id}-diploma.pdf`,
      name: 'diploma.pdf',
      size: 1024,
      contentType: 'application/pdf',
      uploadedAt: '2026-08-27T00:00:00.000Z',
    });

    const before = normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED', evidence: evidence('ev-1') }],
      certifications: [{ label: 'PMP', evidence: evidence('ev-2') }],
    });
    expect(before.educationRecords[0].evidence).toMatchObject({ evidenceId: 'ev-1' });
    expect(collectProfileEvidencePaths(before)).toHaveLength(2);

    // 학력의 증빙만 떼어내면 그 파일 경로 하나가 고아가 된다.
    const after = normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED' }],
      certifications: [{ label: 'PMP', evidence: evidence('ev-2') }],
    });
    const kept = new Set(collectProfileEvidencePaths(after));
    expect(collectProfileEvidencePaths(before).filter((path) => !kept.has(path)))
      .toEqual([evidence('ev-1').path]);

    // 경로 없는 참조는 받지 않는다 - 가리키는 곳이 없는 증빙은 뜻이 없다.
    expect(() => normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED', evidence: { evidenceId: 'ev-3' } }],
    })).toThrow(/evidence/);
  });

  it('keeps admission/degree years and certification acquisition month, and rejects impossible ones', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const normalized = normalizeProfessionalProfileInput({
      educationRecords: [{
        attainmentCode: 'MASTER_GRADUATED',
        institutionName: '연세대학교',
        major: '경영학',
        admissionYear: '2015',
        degreeYear: 2017,
      }],
      certifications: [{ label: '정보처리기사', acquiredAt: '2019-05' }],
    });
    expect(normalized.educationRecords[0]).toMatchObject({ admissionYear: '2015', degreeYear: '2017' });
    expect(normalized.certifications[0]).toMatchObject({ label: '정보처리기사', acquiredAt: '2019-05' });

    // 안 적어도 된다 - 오래된 이력은 연도를 기억하지 못하는 경우가 있다.
    const blank = normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED' }],
      certifications: [{ label: '한국사능력검정' }],
    });
    expect(blank.educationRecords[0]).toMatchObject({ admissionYear: null, degreeYear: null });
    expect(blank.certifications[0].acquiredAt).toBeNull();

    expect(() => normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED', admissionYear: '15' }],
    })).toThrow(/admissionYear/);
    expect(() => normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED', admissionYear: '2020', degreeYear: '2018' }],
    })).toThrow(/degreeYear/);
    expect(() => normalizeProfessionalProfileInput({
      certifications: [{ label: '정보처리기사', acquiredAt: '2019-13' }],
    })).toThrow(/acquiredAt/);
  });

  it('normalizes blank optional text to null and validates text and education region boundaries', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const eightyCharacters = '가'.repeat(80);

    expect(normalizeProfessionalProfileInput({
      educationRecords: [{
        attainmentCode: 'OTHER',
        institutionName: eightyCharacters,
        regionCode: null,
        major: '   ', admissionYear: null, degreeYear: null, evidence: null,
      }],
    }).educationRecords[0]).toEqual({
      attainmentCode: 'OTHER',
      institutionName: eightyCharacters,
      regionCode: null,
      major: null, admissionYear: null, degreeYear: null, evidence: null,
    });

    expect(normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED', regionCode: ' overseas_english ' }],
    }).educationRecords[0].regionCode).toBe('OVERSEAS_ENGLISH');
    expect(() => normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED', institutionName: '가'.repeat(81) }],
    })).toThrow(/80/);
    expect(() => normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED', regionCode: 'NOWHERE' }],
    })).toThrow(/DOMESTIC/);
    expect(() => normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED', regionCode: 'ABC' }],
    })).toThrow(/DOMESTIC/);
    expect(() => normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: '__MISSING__' }],
    })).toThrow(/attainment/i);
  });

  it('deduplicates certification keys after NFKC, trimming, whitespace collapse, and case folding', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const normalized = normalizeProfessionalProfileInput({
      certifications: [
        { label: ' ＡＷＳ   Solutions Architect ' },
        { label: 'aws solutions architect' },
        { label: 'PMP' },
      ],
    });

    expect(normalized.certifications).toEqual([
      { key: 'aws solutions architect', label: 'AWS Solutions Architect', acquiredAt: null, evidence: null },
      { key: 'pmp', label: 'PMP', acquiredAt: null, evidence: null },
    ]);
    expect(() => normalizeProfessionalProfileInput({ certifications: [{ label: ' ' }] }))
      .toThrow(/label/i);
    expect(() => normalizeProfessionalProfileInput({ certifications: [{ label: 'A'.repeat(81) }] }))
      .toThrow(/80/);
  });

  it('accepts every catalog English scale at its upper boundary', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const normalized = normalizeProfessionalProfileInput({
      englishEvidence: [
        { testCode: 'TOEIC', scaleCode: 'TOEIC_990', resultValue: '990' },
        { testCode: 'TOEFL', scaleCode: 'TOEFL_IBT_120', resultValue: '120' },
        { testCode: 'OPIC', scaleCode: 'OPIC_GRADE', resultValue: ' ih ' },
        { testCode: 'IELTS', scaleCode: 'IELTS_9', resultValue: '9' },
        { testCode: 'TEPS', scaleCode: 'TEPS_600', resultValue: '600' },
        {
          testCode: 'OTHER',
          scaleCode: 'OTHER_TEXT',
          resultValue: ' C2 ',
          otherTestName: ' Cambridge English ',
          testedAt: '2026-08', evidence: null,
        },
      ],
    });

    expect(normalized.englishEvidence.map(({ resultValue }) => resultValue))
      .toEqual(['990', '120', 'IH', '9', '600', 'C2']);
    expect(normalized.englishEvidence.at(-1)).toEqual({
      testCode: 'OTHER',
      scaleCode: 'OTHER_TEXT',
      resultValue: 'C2',
      otherTestName: 'Cambridge English',
      testedAt: '2026-08', evidence: null,
    });
  });

  it('canonicalizes numeric result strings and rejects numeric JSON values', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    expect(normalizeProfessionalProfileInput({
      englishEvidence: [
        { testCode: 'TOEIC', scaleCode: 'TOEIC_990', resultValue: ' 0920 ' },
        { testCode: 'IELTS', scaleCode: 'IELTS_9', resultValue: ' 9.0 ' },
      ],
    }).englishEvidence.map(({ resultValue }) => resultValue)).toEqual(['920', '9']);
    expect(() => normalizeProfessionalProfileInput({
      englishEvidence: [{ testCode: 'TOEIC', scaleCode: 'TOEIC_990', resultValue: 920 }],
    })).toThrow(/result.*text|string/i);
  });

  it.each([
    [{ testCode: 'TOEIC', scaleCode: 'TOEIC_990', resultValue: '991' }, /result/i],
    [{ testCode: 'TOEFL', scaleCode: 'TOEFL_IBT_120', resultValue: '121' }, /result/i],
    [{ testCode: 'OPIC', scaleCode: 'OPIC_GRADE', resultValue: 'A1' }, /result/i],
    [{ testCode: 'IELTS', scaleCode: 'IELTS_9', resultValue: '9.5' }, /result/i],
    [{ testCode: 'TEPS', scaleCode: 'TEPS_600', resultValue: '601' }, /result/i],
    [{ testCode: 'TOEIC', scaleCode: 'TOEFL_IBT_120', resultValue: '100' }, /scale/i],
    [{ testCode: 'UNKNOWN', scaleCode: 'TOEIC_990', resultValue: '100' }, /test/i],
    [{ testCode: 'TOEIC', scaleCode: 'TOEIC_990', resultValue: '920', otherTestName: 'Not allowed' }, /otherTestName/i],
    [{ testCode: 'OTHER', scaleCode: 'OTHER_TEXT', resultValue: 'C2' }, /otherTestName/i],
    [{ testCode: 'OTHER', scaleCode: 'OTHER_TEXT', resultValue: 'A'.repeat(81), otherTestName: 'Other' }, /80/],
    [{ testCode: 'TOEIC', scaleCode: 'TOEIC_990', resultValue: '920', testedAt: '2026-13' }, /testedAt/i],
  ])('rejects invalid English evidence %#', (evidence, message) => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    expect(() => normalizeProfessionalProfileInput({ englishEvidence: [evidence] })).toThrow(message);
  });
});

describe('stored model and read DTO', () => {
  it('normalizes a missing stored profile to an explicit versioned DB model', () => {
    const normalizeStoredProfessionalProfile = useExport('normalizeStoredProfessionalProfile');

    expect(normalizeStoredProfessionalProfile(undefined)).toEqual({
      schemaVersion: 1,
      educationRecords: [],
      englishEvidence: [],
      certifications: [],
      provenance: {
        source: 'PEOPLE_MANUAL',
        revision: 0,
        updatedAt: null,
        updatedBy: null,
      },
    });
  });

  it('serializes an allowlisted JSON-safe read DTO without derived or unknown storage fields', () => {
    const serializeProfessionalProfile = useExport('serializeProfessionalProfile');
    const dto = serializeProfessionalProfile({
      schemaVersion: 1,
      ...baseInput(),
      unknownStorageField: 'secret',
      provenance: {
        source: 'PEOPLE_MANUAL',
        revision: 7,
        updatedAt: new Date('2026-08-24T01:02:03.000Z'),
        updatedBy: ' person-1 ',
        internalActorEmail: 'secret@example.com',
      },
    });

    expect(dto).toEqual({
      schemaVersion: 1,
      educationRecords: [
        {
          attainmentCode: 'BACHELOR_GRADUATED',
          institutionName: '연세대학교',
          regionCode: 'DOMESTIC',
          major: '경영학', admissionYear: null, degreeYear: null, evidence: null,
        },
        {
          attainmentCode: 'MASTER_GRADUATED',
          institutionName: 'University of Sussex',
          regionCode: 'OVERSEAS_ENGLISH',
          major: 'Development Studies', admissionYear: null, degreeYear: null, evidence: null,
        },
      ],
      englishEvidence: [
        {
          testCode: 'TOEIC',
          scaleCode: 'TOEIC_990',
          resultValue: '920',
          otherTestName: null,
          testedAt: '2026-06', evidence: null,
        },
        {
          testCode: 'TOEFL',
          scaleCode: 'TOEFL_IBT_120',
          resultValue: '105',
          otherTestName: null,
          testedAt: '2025-12', evidence: null,
        },
      ],
      certifications: [
        { key: 'pmp', label: 'PMP', acquiredAt: null, evidence: null },
        { key: 'oda 전문가', label: 'ODA 전문가', acquiredAt: null, evidence: null },
      ],
      provenance: {
        source: 'PEOPLE_MANUAL',
        revision: 7,
        updatedAt: '2026-08-24T01:02:03.000Z',
        updatedBy: 'person-1',
      },
    });
    expect(JSON.stringify(dto)).not.toMatch(/__MISSING__|displayText|embedding|vector|searchText|chunk|secret/i);
  });
});

describe('deriveProfessionalProfileFacts', () => {
  it('selects the maximum education rank, keeps the first tie, and builds approved display facts', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const deriveProfessionalProfileFacts = useExport('deriveProfessionalProfileFacts');
    const normalized = normalizeProfessionalProfileInput(baseInput());

    expect(deriveProfessionalProfileFacts(normalized)).toEqual({
      highestEducationCode: 'MASTER_GRADUATED',
      highestDegreeYear: null,
      highestEducationInstitution: 'University of Sussex',
      highestEducationMajor: 'Development Studies',
      englishFacets: ['TOEIC', 'TOEFL', 'OVERSEAS_EDUCATION'],
      highestEducationDisplayText: '석사 졸업 · Development Studies',
      englishEvidenceDisplayText: 'TOEIC 920 · TOEFL 105 · 해외 대학',
      certificationsDisplayText: 'PMP · ODA 전문가',
      certificationKeys: ['pmp', 'oda 전문가'],
    });

    const tied = normalizeProfessionalProfileInput({
      educationRecords: [
        { attainmentCode: 'MASTER_GRADUATED', institutionName: 'First University', regionCode: 'DOMESTIC' },
        { attainmentCode: 'MASTER_GRADUATED', institutionName: 'Second University', regionCode: 'DOMESTIC' },
      ],
    });
    expect(deriveProfessionalProfileFacts(tied).highestEducationDisplayText)
      .toBe('석사 졸업 · First University');
  });

  it('distinguishes truly missing English facts from overseas education and ignores null/KR countries', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const deriveProfessionalProfileFacts = useExport('deriveProfessionalProfileFacts');

    expect(deriveProfessionalProfileFacts(normalizeProfessionalProfileInput({}))).toEqual({
      highestEducationCode: null,
      highestDegreeYear: null,
      highestEducationInstitution: null,
      highestEducationMajor: null,
      englishFacets: ['__MISSING__'],
      highestEducationDisplayText: '',
      englishEvidenceDisplayText: '',
      certificationsDisplayText: '',
      certificationKeys: [],
    });
    expect(deriveProfessionalProfileFacts(normalizeProfessionalProfileInput({
      educationRecords: [
        { attainmentCode: 'BACHELOR_GRADUATED', regionCode: null },
        { attainmentCode: 'MASTER_ENROLLED', regionCode: 'DOMESTIC' },
      ],
    }))).toMatchObject({
      englishFacets: ['__MISSING__'],
      englishEvidenceDisplayText: '',
    });
    expect(deriveProfessionalProfileFacts(normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED', regionCode: 'OVERSEAS_ENGLISH' }],
    }))).toMatchObject({
      englishFacets: ['OVERSEAS_EDUCATION'],
      englishEvidenceDisplayText: '해외 대학',
    });
  });
});

describe('RAG canonical boundary', () => {
  it('keeps derived/search artifacts out of canonical storage data', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const normalizeStoredProfessionalProfile = useExport('normalizeStoredProfessionalProfile');
    const stored = normalizeStoredProfessionalProfile({
      schemaVersion: 1,
      ...normalizeProfessionalProfileInput(baseInput()),
      provenance: {
        source: 'PEOPLE_MANUAL',
        revision: 1,
        updatedAt: null,
        updatedBy: null,
      },
    });

    expect(JSON.stringify(stored)).not.toMatch(/__MISSING__|displayText|embedding|vector|searchText|chunk/i);
  });

  it('builds a deterministic SHA-256 fingerprint across identity, versions, and every canonical input', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const normalizeStoredProfessionalProfile = useExport('normalizeStoredProfessionalProfile');
    const buildProfessionalProfileRagFingerprint = useExport('buildProfessionalProfileRagFingerprint');
    const profile = normalizeStoredProfessionalProfile({
      schemaVersion: 1,
      ...normalizeProfessionalProfileInput(baseInput()),
      provenance: {
        source: 'PEOPLE_MANUAL',
        revision: 3,
        updatedAt: '2026-08-24T00:00:00.000Z',
        updatedBy: 'person-1',
      },
    });
    const baseArgs = { tenantId: 'tenant-1', personId: 'person-1', catalogVersion: 1, profile };
    const fingerprint = buildProfessionalProfileRagFingerprint(baseArgs);

    expect(fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(buildProfessionalProfileRagFingerprint(structuredClone(baseArgs))).toBe(fingerprint);

    const variants = [
      { ...baseArgs, tenantId: 'tenant-2' },
      { ...baseArgs, personId: 'person-2' },
      { ...baseArgs, catalogVersion: 2 },
      { ...baseArgs, profile: { ...profile, schemaVersion: 2 } },
      { ...baseArgs, profile: { ...profile, provenance: { ...profile.provenance, revision: 4 } } },
      {
        ...baseArgs,
        profile: {
          ...profile,
          educationRecords: profile.educationRecords.map((record, index) => (
            index === 0 ? { ...record, major: 'Economics' } : record
          )),
        },
      },
      {
        ...baseArgs,
        profile: {
          ...profile,
          englishEvidence: profile.englishEvidence.map((evidence, index) => (
            index === 0 ? { ...evidence, resultValue: '925' } : evidence
          )),
        },
      },
      {
        ...baseArgs,
        profile: {
          ...profile,
          certifications: [{ key: 'cpa', label: 'CPA', acquiredAt: null, evidence: null }],
        },
      },
    ];

    expect(new Set(variants.map((variant) => buildProfessionalProfileRagFingerprint(variant))).size)
      .toBe(variants.length);
    variants.forEach((variant) => {
      expect(buildProfessionalProfileRagFingerprint(variant)).not.toBe(fingerprint);
    });
  });
});

describe('증빙 경로', () => {
  const evidence = (path) => ({
    evidenceId: 'ev_a1b2c3d4e5f6',
    path,
    name: '졸업증명서.pdf',
    size: 12345,
    contentType: 'application/pdf',
    uploadedAt: '2026-08-27T00:00:00.000Z',
  });
  const withPath = (path) => ({
    educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED', evidence: evidence(path) }],
    englishEvidence: [],
    certifications: [],
  });

  /**
   * 실제로 저장이 막혔던 사고다. 사람이 쓰는 글자 제한(80자)이 서버가 만든 저장 키에도
   * 그대로 걸려 있었다. 경로는 org/사람/증빙id/파일명이 이어붙어 80자를 쉽게 넘는다.
   */
  it('80자가 넘는 저장 경로를 받는다', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const long = 'orgs/mysc/person-hr-evidence/p1774523456789012/ev_a1b2c3d4e5f6-2019년_학사학위증명서_사본.pdf';
    expect(long.length).toBeGreaterThan(80);
    const parsed = normalizeProfessionalProfileInput(withPath(long));
    expect(parsed.educationRecords[0].evidence.path).toBe(long);
  });

  it('증빙 보관함 밖을 가리키는 경로는 거부한다', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    expect(() => normalizeProfessionalProfileInput(withPath('orgs/mysc/payroll/secret.pdf')))
      .toThrow(/person evidence store/);
    expect(() => normalizeProfessionalProfileInput(withPath('orgs/mysc/person-hr-evidence/../payroll/x.pdf')))
      .toThrow(/person evidence store/);
  });

  it('경로가 아무리 길어도 한계는 있다', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const tooLong = `orgs/mysc/person-hr-evidence/p1/${'가'.repeat(600)}.pdf`;
    expect(() => normalizeProfessionalProfileInput(withPath(tooLong))).toThrow(/at most 512 characters/);
  });
});

describe('학력 구분', () => {
  /**
   * 예전에는 249개 ISO 국가 코드로 저장했다. 국내/해외 셋으로 줄이면서, 이미 적어 둔 학력이
   * 저장 한 번에 사라지지 않도록 옛 값을 옮겨 읽는다.
   */
  it('옛 국가 코드를 국내·영미권·기타로 옮겨 읽는다', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const regionOf = (countryCode) => normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'BACHELOR_GRADUATED', countryCode }],
    }).educationRecords[0].regionCode;

    expect(regionOf('KR')).toBe('DOMESTIC');
    expect(regionOf('US')).toBe('OVERSEAS_ENGLISH');
    expect(regionOf('GB')).toBe('OVERSEAS_ENGLISH');
    expect(regionOf('JP')).toBe('OVERSEAS_OTHER');
    expect(regionOf('DE')).toBe('OVERSEAS_OTHER');
  });

  it('해외 학위 표시는 영미권·기타 둘 다에서 켜진다', () => {
    const normalizeProfessionalProfileInput = useExport('normalizeProfessionalProfileInput');
    const deriveProfessionalProfileFacts = useExport('deriveProfessionalProfileFacts');
    const factsFor = (regionCode) => deriveProfessionalProfileFacts(normalizeProfessionalProfileInput({
      educationRecords: [{ attainmentCode: 'MASTER_GRADUATED', regionCode }],
    }));

    expect(factsFor('OVERSEAS_ENGLISH').englishEvidenceDisplayText).toContain('해외 대학');
    expect(factsFor('OVERSEAS_OTHER').englishEvidenceDisplayText).toContain('해외 대학');
    expect(factsFor('DOMESTIC').englishEvidenceDisplayText).not.toContain('해외 대학');
  });
});
