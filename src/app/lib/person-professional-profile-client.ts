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
  educationRegions: ProfessionalProfileEducationRegion[];
}

/** 학교가 국내인지 해외인지. 249개 국가를 고르게 하던 자리를 대신한다. */
export interface ProfessionalProfileEducationRegion {
  code: string;
  label: string;
  rank: number;
}

/** 증빙 참조. 파일은 스토리지에 있고 프로필에는 가리키는 표만 남는다. */
export interface ProfessionalProfileEvidenceRef {
  evidenceId: string;
  path: string;
  name?: string | null;
  size?: number;
  contentType?: string | null;
  uploadedAt?: string | null;
}

export interface ProfessionalProfileEducationRecordInput {
  attainmentCode: string;
  institutionName?: string | null;
  regionCode?: string | null;
  major?: string | null;
  /** 입학년도 (YYYY) */
  admissionYear?: string | null;
  /** 학위취득년도 (YYYY) */
  degreeYear?: string | null;
  evidence?: ProfessionalProfileEvidenceRef | null;
}

export interface ProfessionalProfileEnglishEvidenceInput {
  testCode: string;
  scaleCode: string;
  resultValue: string;
  otherTestName?: string | null;
  testedAt?: string | null;
  evidence?: ProfessionalProfileEvidenceRef | null;
}

export interface ProfessionalProfileInput {
  educationRecords: ProfessionalProfileEducationRecordInput[];
  englishEvidence: ProfessionalProfileEnglishEvidenceInput[];
  /** acquiredAt: 취득일 (YYYY-MM) */
  certifications: Array<{ label: string; acquiredAt?: string | null; evidence?: ProfessionalProfileEvidenceRef | null }>;
}

export interface StoredProfessionalProfile extends Omit<ProfessionalProfileInput, 'certifications'> {
  schemaVersion: number;
  certifications: Array<{ key: string; label: string; acquiredAt: string | null; evidence?: ProfessionalProfileEvidenceRef | null }>;
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

const EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;

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

    /**
     * 증빙 업로드. 서명 URL 로 스토리지에 직접 넣는다 - 스캔본이 요청 본문 한도에 막히지 않게.
     * 파일을 올린 뒤 돌려주는 참조를 프로필 저장 때 함께 보내야 실제로 붙는다.
     */
    async uploadEvidence(personId: string, file: {
      name: string;
      type: string;
      size: number;
      arrayBuffer(): Promise<ArrayBuffer>;
    }): Promise<ProfessionalProfileEvidenceRef> {
      if (file.size < 1 || file.size > EVIDENCE_MAX_BYTES) {
        throw new Error('증빙 파일은 20MB 이하만 올릴 수 있습니다.');
      }
      const mimeType = file.type || 'application/octet-stream';
      const session = await client.post<{
        evidenceId: string; fileName: string; path: string; uploadUrl: string;
      }>(`/api/v1/persons/${encodeURIComponent(safePersonId(personId))}/hr-evidence/upload-url`, {
        ...request,
        body: { fileName: file.name, mimeType, fileSize: file.size },
        timeoutMs: 15_000,
      });
      const { evidenceId, path, uploadUrl, fileName } = session.data;
      if (!uploadUrl || !path) throw new Error('증빙 업로드 자리를 받지 못했습니다.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': mimeType },
        body: bytes,
      });
      if (!put.ok) throw new Error('증빙 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return {
        evidenceId,
        path,
        name: file.name || fileName,
        size: file.size,
        contentType: mimeType,
        uploadedAt: new Date().toISOString(),
      };
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
