import type { RequestActor } from '../platform/request-context';
import { resolveProjectDocumentMimeType } from '../platform/project-contract-upload';
import {
  createPlatformApiClient,
  toRequestActor,
  type ActorLike,
  type PlatformApiClientLike,
} from './platform-bff-client';

export const PROJECT_INFO_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export type ProjectInfoDocumentKind =
  | 'contract'
  | 'customer_business_registration'
  | 'quote'
  | 'proposal'
  | 'proposal_word_original'
  | 'proposal_ppt_original'
  | 'presentation_ppt_original'
  | 'rfp_request_evidence'
  | 'performance_certificate'
  | 'tax_invoice'
  | 'final_settlement_report';

export interface ProjectInfoAttachment {
  attachmentId?: string;
  documentKind: ProjectInfoDocumentKind;
  path: string;
  name: string;
  size: number;
  contentType: string;
  uploadedAt?: string;
}

export interface ProjectInfoDraft {
  projectId: string;
  resourceType: 'project-info';
  resourceId: string;
  draftRevision: number;
  baseCanonicalVersion: number;
  payload: Record<string, unknown>;
  attachmentRefs: ProjectInfoAttachment[];
  stepIndex: number;
  status: 'ACTIVE' | 'SUBMITTED' | 'DISCARDED';
  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string;
}

export interface ProjectInfoFileLike {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ProjectInfoSubmitResult {
  status: 'SUBMITTED';
  projectId: string;
  projectRequestId: string;
  projectVersion: number;
  draftRevision: number;
  submittedAt: string;
  lease: { state: 'RELEASED'; canEdit: false };
  outbox: { id: string; status: string };
}

export type ProjectInfoDraftApiClient = Pick<PlatformApiClientLike, 'get' | 'post' | 'patch' | 'request'>;

function safeHeaderId(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === '.' || normalized === '..' || !/^[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function safeProjectId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.length > 512) {
    throw new Error('project ID is invalid');
  }
  return normalized;
}

function revision(value: number, field = 'draft revision'): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} is invalid`);
  return value;
}

function ownershipHeaders(sessionId: string, ownership: { leaseId: string; fence: number }) {
  if (!Number.isSafeInteger(ownership.fence) || ownership.fence < 1) throw new Error('lease fence is invalid');
  return {
    'x-edit-session-id': sessionId,
    'x-edit-lease-id': safeHeaderId(ownership.leaseId, 'lease ID'),
    'x-edit-fence': String(ownership.fence),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} response`);
  return value as Record<string, unknown>;
}

function parseDraft(value: unknown, projectId: string): ProjectInfoDraft {
  const draft = object(value, 'project information draft');
  if (draft.resourceType !== 'project-info' || draft.resourceId !== projectId || draft.projectId !== projectId) {
    throw new Error('Invalid project information draft response');
  }
  const baseCanonicalVersion = Number(draft.baseCanonicalVersion);
  if (!Number.isSafeInteger(baseCanonicalVersion) || baseCanonicalVersion < 1) {
    throw new Error('Invalid project information draft response');
  }
  return {
    ...(draft as unknown as ProjectInfoDraft),
    projectId,
    resourceType: 'project-info',
    resourceId: projectId,
    draftRevision: revision(Number(draft.draftRevision)),
    baseCanonicalVersion,
    payload: object(draft.payload ?? {}, 'project information draft payload'),
    attachmentRefs: Array.isArray(draft.attachmentRefs) ? draft.attachmentRefs as ProjectInfoAttachment[] : [],
    stepIndex: revision(Number(draft.stepIndex || 0), 'draft step'),
  };
}

function parseDraftBody(value: unknown, projectId: string) {
  return { draft: parseDraft(object(value, 'project information draft').draft, projectId) };
}

export type ProjectInfoRebaseResolution = 'MINE' | 'THEIRS';

export interface ProjectInfoRebaseConflict {
  field: string;
  base: unknown;
  mine: unknown;
  theirs: unknown;
}

export interface ProjectInfoRebaseResult {
  rebased: boolean;
  canonicalVersion: number;
  baseCanonicalVersion?: number;
  autoMerged: Array<{ field: string; value: unknown }>;
  conflicts: ProjectInfoRebaseConflict[];
  draft?: ProjectInfoDraft;
}

function parseRebaseBody(value: unknown, projectId: string): ProjectInfoRebaseResult {
  const body = object(value, 'project information rebase');
  const list = (input: unknown) => (Array.isArray(input) ? input : []);
  return {
    rebased: body.rebased === true,
    canonicalVersion: Number(body.canonicalVersion) || 0,
    ...(body.baseCanonicalVersion === undefined
      ? {}
      : { baseCanonicalVersion: Number(body.baseCanonicalVersion) || 0 }),
    autoMerged: list(body.autoMerged).map((entry) => {
      const row = object(entry, 'project information rebase merge');
      return { field: String(row.field ?? ''), value: row.value ?? null };
    }),
    conflicts: list(body.conflicts).map((entry) => {
      const row = object(entry, 'project information rebase conflict');
      return {
        field: String(row.field ?? ''),
        base: row.base ?? null,
        mine: row.mine ?? null,
        theirs: row.theirs ?? null,
      };
    }),
    ...(body.draft === undefined ? {} : { draft: parseDraft(body.draft, projectId) }),
  };
}

function parseAttachment(value: unknown): ProjectInfoAttachment {
  const attachment = object(value, 'project information attachment');
  if (
    ![
      'contract',
      'customer_business_registration',
      'quote',
      'proposal',
      'proposal_word_original',
      'proposal_ppt_original',
      'presentation_ppt_original',
      'rfp_request_evidence',
      'performance_certificate',
      'tax_invoice',
      'final_settlement_report',
    ].includes(String(attachment.documentKind))
    || typeof attachment.path !== 'string'
    || !attachment.path.trim()
    || typeof attachment.name !== 'string'
  ) throw new Error('Invalid project information attachment response');
  return attachment as unknown as ProjectInfoAttachment;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function createProjectInfoDraftClient(options: {
  tenantId: string;
  actor: ActorLike;
  sessionId: string;
  projectId: string;
  client?: ProjectInfoDraftApiClient;
}) {
  const client = options.client || createPlatformApiClient();
  const actor: RequestActor = toRequestActor(options.actor);
  const sessionId = safeHeaderId(options.sessionId, 'edit session ID');
  const projectId = safeProjectId(options.projectId);
  const path = `/api/v1/project-info-drafts/${encodeURIComponent(projectId)}`;
  const request = { tenantId: options.tenantId, actor };

  return {
    async get() {
      const response = await client.get<unknown>(path, {
        ...request,
        headers: { 'x-edit-session-id': sessionId },
      });
      return parseDraftBody(response.data, projectId);
    },

    async open(ownership: { leaseId: string; fence: number }) {
      const response = await client.post<unknown>(`${path}/open`, {
        ...request,
        headers: ownershipHeaders(sessionId, ownership),
        body: {},
      });
      return parseDraftBody(response.data, projectId);
    },

    async save(
      ownership: { leaseId: string; fence: number },
      input: { expectedDraftRevision: number; payload: Record<string, unknown>; stepIndex?: number },
    ) {
      const response = await client.patch<unknown>(path, {
        ...request,
        headers: ownershipHeaders(sessionId, ownership),
        body: {
          expectedDraftRevision: revision(input.expectedDraftRevision),
          payload: input.payload,
          ...(input.stepIndex === undefined ? {} : { stepIndex: revision(input.stepIndex, 'draft step') }),
        },
      });
      return parseDraftBody(response.data, projectId);
    },

    async upload(
      ownership: { leaseId: string; fence: number },
      input: {
        expectedDraftRevision: number;
        documentKind: ProjectInfoDocumentKind;
        file: ProjectInfoFileLike;
      },
    ) {
      if (input.file.size < 1 || input.file.size > PROJECT_INFO_ATTACHMENT_MAX_BYTES) {
        throw new Error('첨부파일은 10MB 이하만 업로드할 수 있습니다.');
      }
      const bytes = new Uint8Array(await input.file.arrayBuffer());
      if (bytes.byteLength !== input.file.size) throw new Error('Attachment size does not match its content');
      const response = await client.post<unknown>(`${path}/attachments`, {
        ...request,
        headers: ownershipHeaders(sessionId, ownership),
        body: {
          expectedDraftRevision: revision(input.expectedDraftRevision),
          documentKind: input.documentKind,
          fileName: input.file.name,
          mimeType: resolveProjectDocumentMimeType(input.documentKind, input.file),
          fileSize: input.file.size,
          contentBase64: bytesToBase64(bytes),
        },
      });
      const body = object(response.data, 'project information attachment');
      return { draft: parseDraft(body.draft, projectId), attachment: parseAttachment(body.attachment) };
    },

    async removeAttachment(
      ownership: { leaseId: string; fence: number },
      input: { expectedDraftRevision: number; documentKind: ProjectInfoDocumentKind },
    ) {
      const response = await client.request<unknown>(
        `${path}/attachments/${encodeURIComponent(input.documentKind)}`,
        {
          method: 'DELETE',
          ...request,
          headers: ownershipHeaders(sessionId, ownership),
          body: { expectedDraftRevision: revision(input.expectedDraftRevision) },
        },
      );
      return parseDraftBody(response.data, projectId);
    },

    // Without `resolutions` this previews the merge and writes nothing.
    async rebase(
      ownership: { leaseId: string; fence: number },
      input: {
        expectedDraftRevision: number;
        resolutions?: Record<string, ProjectInfoRebaseResolution>;
      },
    ): Promise<ProjectInfoRebaseResult> {
      const response = await client.post<unknown>(`${path}/rebase`, {
        ...request,
        headers: ownershipHeaders(sessionId, ownership),
        body: {
          expectedDraftRevision: revision(input.expectedDraftRevision),
          ...(input.resolutions ? { resolutions: input.resolutions } : {}),
        },
      });
      return parseRebaseBody(response.data, projectId);
    },

    async submit(
      ownership: { leaseId: string; fence: number },
      input: {
        expectedDraftRevision: number;
        expectedVersion: number;
        resubmit?: boolean;
        reviewComment?: string;
      },
    ) {
      const expectedVersion = revision(input.expectedVersion, 'project version');
      if (expectedVersion < 1) throw new Error('project version is invalid');
      const response = await client.post<unknown>(`${path}/submit`, {
        ...request,
        headers: ownershipHeaders(sessionId, ownership),
        body: {
          expectedDraftRevision: revision(input.expectedDraftRevision),
          expectedVersion,
          resubmit: input.resubmit === true,
          ...(input.reviewComment?.trim() ? { reviewComment: input.reviewComment.trim() } : {}),
        },
      });
      const body = object(response.data, 'project information submit');
      if (
        body.status !== 'SUBMITTED'
        || body.projectId !== projectId
        || !Number.isSafeInteger(Number(body.projectVersion))
      ) throw new Error('Invalid project information submit response');
      return body as unknown as ProjectInfoSubmitResult;
    },
  };
}
