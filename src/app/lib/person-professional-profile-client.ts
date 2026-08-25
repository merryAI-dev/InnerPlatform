import {
  createPlatformApiClient,
  toRequestActor,
  type ActorLike,
  type PlatformApiClientLike,
} from './platform-bff-client';

export interface ProfessionalProfileEducationAttainment {
  code: string;
  label: string;
  rank: number;
}

export interface ProfessionalProfileEnglishScale {
  code: string;
  label?: string;
  resultType: 'NUMBER' | 'GRADE' | 'TEXT';
  min?: number;
  max?: number;
  step?: number;
  allowedValues?: string[];
}

export interface ProfessionalProfileEnglishTest {
  code: string;
  label: string;
  displayLabel: string;
  scales: ProfessionalProfileEnglishScale[];
}

export interface ProfessionalProfileCatalog {
  catalogVersion: number;
  educationAttainments: ProfessionalProfileEducationAttainment[];
  englishTests: ProfessionalProfileEnglishTest[];
  countryCodes: string[];
}

export interface ProfessionalProfileEducationRecordInput {
  attainmentCode: string;
  institutionName?: string | null;
  countryCode?: string | null;
  major?: string | null;
}

export interface ProfessionalProfileEnglishEvidenceInput {
  testCode: string;
  scaleCode: string;
  resultValue: string;
  otherTestName?: string | null;
  testedAt?: string | null;
}

export interface ProfessionalProfileInput {
  educationRecords: ProfessionalProfileEducationRecordInput[];
  englishEvidence: ProfessionalProfileEnglishEvidenceInput[];
  certifications: Array<{ label: string }>;
}

export interface StoredProfessionalProfile extends Omit<ProfessionalProfileInput, 'certifications'> {
  schemaVersion: number;
  certifications: Array<{ key: string; label: string }>;
  provenance: {
    source: 'PEOPLE_MANUAL';
    revision: number;
    updatedAt: string | null;
    updatedBy: string | null;
  };
}

export interface PersonProfessionalProfileResponse {
  profile: StoredProfessionalProfile;
  revision: number;
}

export interface PersonProfessionalProfileSaveResponse extends PersonProfessionalProfileResponse {
  changed: boolean;
}

function safePersonId(value: string): string {
  const personId = value.trim();
  if (!personId || personId === '.' || personId === '..' || personId.includes('/') || personId.length > 200) {
    throw new Error('person ID is invalid');
  }
  return personId;
}

export function createPersonProfessionalProfileClient(options: {
  tenantId: string;
  actor: ActorLike;
  client?: PlatformApiClientLike;
}) {
  const client = options.client || createPlatformApiClient();
  const request = { tenantId: options.tenantId, actor: toRequestActor(options.actor) };
  const profilePath = (personId: string) => (
    `/api/v1/persons/${encodeURIComponent(safePersonId(personId))}/professional-profile`
  );

  return {
    async getCatalog(signal?: AbortSignal): Promise<ProfessionalProfileCatalog> {
      const response = await client.get<ProfessionalProfileCatalog>(
        '/api/v1/person-professional-profile/catalog',
        { ...request, signal, timeoutMs: 10_000 },
      );
      return response.data;
    },

    async get(personId: string, signal?: AbortSignal): Promise<PersonProfessionalProfileResponse> {
      const response = await client.get<PersonProfessionalProfileResponse>(profilePath(personId), {
        ...request,
        signal,
        timeoutMs: 10_000,
      });
      return response.data;
    },

    async save(personId: string, input: {
      expectedRevision: number;
      profile: ProfessionalProfileInput;
      idempotencyKey: string;
    }): Promise<PersonProfessionalProfileSaveResponse> {
      const response = await client.request<PersonProfessionalProfileSaveResponse>(profilePath(personId), {
        ...request,
        method: 'PUT',
        body: { expectedRevision: input.expectedRevision, profile: input.profile },
        idempotencyKey: input.idempotencyKey,
        retries: 0,
        timeoutMs: 15_000,
      });
      return response.data;
    },
  };
}
