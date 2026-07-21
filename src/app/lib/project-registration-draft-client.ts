import type { RequestActor } from '../platform/request-context';
import { resolveProjectDocumentMimeType } from '../platform/project-contract-upload';
import {
  createPlatformApiClient,
  toRequestActor,
  type ActorLike,
  type PlatformApiClientLike,
} from './platform-bff-client';

export const PROJECT_REGISTRATION_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export type ProjectRegistrationDocumentKind =
  | 'contract'
  | 'customer_business_registration'
  | 'quote'
  | 'proposal'
  | 'proposal_word_original'
  | 'proposal_ppt_original'
  | 'presentation_ppt_original'
  | 'rfp_request_evidence';

export interface ProjectRegistrationAttachment {
  attachmentId?: string;
  documentKind: ProjectRegistrationDocumentKind;
  path: string;
  name: string;
  size: number;
  contentType: string;
  uploadedAt?: string;
}

export interface ProjectRegistrationDraft {
  draftId: string;
  resourceType: 'project-registration';
  resourceId: string;
  draftRevision: number;
  payload: Record<string, unknown>;
  attachmentRefs: ProjectRegistrationAttachment[];
  stepIndex: number;
  status: 'ACTIVE' | 'SUBMITTED' | 'DISCARDED';
  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string;
}

export interface ProjectRegistrationLeaseOwnership {
  serverNow: string;
  state: 'ACTIVE';
  canEdit: true;
  expiresAt: string;
  leaseId: string;
  fence: number;
}

export interface ProjectRegistrationSubmitResult {
  status: 'SUBMITTED';
  projectId: string;
  projectRequestId: string;
  draftId: string;
  draftRevision: number;
  submittedAt: string;
  lease: { state: 'RELEASED'; canEdit: false };
  outbox: { id: string; status: string };
}

export interface ProjectRegistrationFileLike {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ProjectRegistrationDraftApiClient = Pick<PlatformApiClientLike, 'get' | 'post' | 'patch' | 'request'>;

function safeId(value: string, field: string): string {
  const normalized = value.trim();
  if (
    !normalized
    || normalized === '.'
    || normalized === '..'
    || !/^[A-Za-z0-9._-]+$/.test(normalized)
  ) throw new Error(`${field} is invalid`);
  return normalized;
}

function revision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('draft revision is invalid');
  return value;
}

function ownershipHeaders(sessionId: string, ownership: { leaseId: string; fence: number }) {
  if (!Number.isSafeInteger(ownership.fence) || ownership.fence < 1) throw new Error('lease fence is invalid');
  return {
    'x-edit-session-id': sessionId,
    'x-edit-lease-id': safeId(ownership.leaseId, 'lease ID'),
    'x-edit-fence': String(ownership.fence),
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} response`);
  return value as Record<string, unknown>;
}

function parseDraft(value: unknown): ProjectRegistrationDraft {
  const draft = requireObject(value, 'draft');
  const draftId = safeId(String(draft.draftId || ''), 'draft ID');
  if (draft.resourceType !== 'project-registration' || draft.resourceId !== draftId) {
    throw new Error('Invalid draft response');
  }
  const payload = requireObject(draft.payload ?? {}, 'draft payload');
  const attachmentRefs = Array.isArray(draft.attachmentRefs) ? draft.attachmentRefs : [];
  return {
    ...(draft as unknown as ProjectRegistrationDraft),
    draftId,
    resourceType: 'project-registration',
    resourceId: draftId,
    draftRevision: revision(Number(draft.draftRevision)),
    payload,
    attachmentRefs: attachmentRefs as ProjectRegistrationAttachment[],
    stepIndex: revision(Number(draft.stepIndex || 0)),
  };
}

function parseDraftBody(value: unknown): { draft: ProjectRegistrationDraft } {
  const body = requireObject(value, 'draft');
  return { draft: parseDraft(body.draft) };
}

function parseLease(value: unknown): ProjectRegistrationLeaseOwnership {
  const lease = requireObject(value, 'lease');
  const fence = Number(lease.fence);
  if (
    lease.state !== 'ACTIVE'
    || lease.canEdit !== true
    || !Number.isSafeInteger(fence)
    || fence < 1
    || typeof lease.leaseId !== 'string'
  ) throw new Error('Invalid lease response');
  return lease as unknown as ProjectRegistrationLeaseOwnership;
}

function parseAttachment(value: unknown): ProjectRegistrationAttachment {
  const attachment = requireObject(value, 'draft attachment');
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
    ].includes(String(attachment.documentKind))
    || typeof attachment.path !== 'string'
    || !attachment.path.trim()
    || typeof attachment.name !== 'string'
  ) throw new Error('Invalid draft attachment response');
  return attachment as unknown as ProjectRegistrationAttachment;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function createProjectRegistrationDraftClient(options: {
  tenantId: string;
  actor: ActorLike;
  sessionId: string;
  client?: ProjectRegistrationDraftApiClient;
}) {
  const client = options.client || createPlatformApiClient();
  const actor: RequestActor = toRequestActor(options.actor);
  const sessionId = safeId(options.sessionId, 'edit session ID');
  const sessionHeaders = { 'x-edit-session-id': sessionId };
  const pathFor = (draftId: string) => `/api/v1/project-registration-drafts/${safeId(draftId, 'draft ID')}`;
  const request = { tenantId: options.tenantId, actor };

  return {
    async create(input: { payload: Record<string, unknown>; stepIndex?: number }) {
      const response = await client.post<unknown>('/api/v1/project-registration-drafts', {
        ...request,
        headers: sessionHeaders,
        body: { payload: input.payload, stepIndex: revision(input.stepIndex || 0) },
      });
      const body = requireObject(response.data, 'draft create');
      return { draft: parseDraft(body.draft), lease: parseLease(body.lease) };
    },

    async get(draftId: string) {
      const response = await client.get<unknown>(pathFor(draftId), { ...request, headers: sessionHeaders });
      return parseDraftBody(response.data);
    },

    async save(
      draftId: string,
      ownership: { leaseId: string; fence: number },
      input: { expectedDraftRevision: number; payload: Record<string, unknown>; stepIndex?: number },
    ) {
      const response = await client.patch<unknown>(pathFor(draftId), {
        ...request,
        headers: ownershipHeaders(sessionId, ownership),
        body: {
          expectedDraftRevision: revision(input.expectedDraftRevision),
          payload: input.payload,
          ...(input.stepIndex === undefined ? {} : { stepIndex: revision(input.stepIndex) }),
        },
      });
      return parseDraftBody(response.data);
    },

    async upload(
      draftId: string,
      ownership: { leaseId: string; fence: number },
      input: {
        expectedDraftRevision: number;
        documentKind: ProjectRegistrationDocumentKind;
        file: ProjectRegistrationFileLike;
      },
    ) {
      if (input.file.size < 1 || input.file.size > PROJECT_REGISTRATION_ATTACHMENT_MAX_BYTES) {
        throw new Error('첨부파일은 10MB 이하만 업로드할 수 있습니다.');
      }
      const bytes = new Uint8Array(await input.file.arrayBuffer());
      if (bytes.byteLength !== input.file.size) throw new Error('Attachment size does not match its content');
      const response = await client.post<unknown>(`${pathFor(draftId)}/attachments`, {
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
      const body = requireObject(response.data, 'draft attachment');
      return { draft: parseDraft(body.draft), attachment: parseAttachment(body.attachment) };
    },

    async removeAttachment(
      draftId: string,
      ownership: { leaseId: string; fence: number },
      input: { expectedDraftRevision: number; documentKind: ProjectRegistrationDocumentKind },
    ) {
      const response = await client.request<unknown>(
        `${pathFor(draftId)}/attachments/${encodeURIComponent(input.documentKind)}`,
        {
          method: 'DELETE',
          ...request,
          headers: ownershipHeaders(sessionId, ownership),
          body: { expectedDraftRevision: revision(input.expectedDraftRevision) },
        },
      );
      return parseDraftBody(response.data);
    },

    async submit(
      draftId: string,
      ownership: { leaseId: string; fence: number },
      input: { expectedDraftRevision: number },
    ) {
      const response = await client.post<ProjectRegistrationSubmitResult>(`${pathFor(draftId)}/submit`, {
        ...request,
        headers: ownershipHeaders(sessionId, ownership),
        body: { expectedDraftRevision: revision(input.expectedDraftRevision) },
      });
      const body = requireObject(response.data, 'draft submit');
      if (body.status !== 'SUBMITTED' || typeof body.projectId !== 'string') throw new Error('Invalid draft submit response');
      return body as unknown as ProjectRegistrationSubmitResult;
    },
  };
}
