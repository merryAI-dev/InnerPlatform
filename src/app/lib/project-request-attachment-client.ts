import { buildStandardHeaders } from '../platform/request-context';
import {
  readPlatformApiRuntimeConfig,
  toRequestActor,
  type ActorLike,
} from './platform-bff-client';
import type { ProjectRequestDocumentKind } from '../platform/project-contract-upload';

function contentDispositionFileName(value: string | null) {
  const match = String(value || '').match(/filename\*=UTF-8''([^;]+)/i);
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

const DRAFT_DOCUMENT_KINDS = new Set<ProjectRequestDocumentKind>([
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
]);

function assertDraftDocumentKind(value: ProjectRequestDocumentKind) {
  if (!DRAFT_DOCUMENT_KINDS.has(value)) throw new Error('document kind is invalid');
}

async function downloadDraftAttachment(params: {
  tenantId: string;
  actor: ActorLike;
  path: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; fileName: string }> {
  const response = await (params.fetchImpl || globalThis.fetch)(
    `${readPlatformApiRuntimeConfig().baseUrl}${params.path}`,
    {
      method: 'GET',
      headers: buildStandardHeaders({
        tenantId: params.tenantId,
        actor: toRequestActor(params.actor),
        method: 'GET',
      }),
      signal: params.signal,
    },
  );
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || '임시저장 첨부 파일을 불러오지 못했습니다.');
  }
  return {
    blob: await response.blob(),
    fileName: contentDispositionFileName(response.headers.get('content-disposition')) || 'attachment',
  };
}

/** 인사정보 증빙 원문. 권한 검사와 경로 검증은 BFF 가 한다. */
export async function downloadPersonHrEvidenceViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  personId: string;
  path: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const personId = params.personId.trim();
  if (!personId || personId.includes('/')) throw new Error('person ID is invalid');
  return downloadDraftAttachment({
    ...params,
    path: `/api/v1/persons/${encodeURIComponent(personId)}/hr-evidence?path=${encodeURIComponent(params.path)}`,
  });
}

export async function downloadProjectRegistrationDraftAttachmentViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  draftId: string;
  documentKind: ProjectRequestDocumentKind;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const draftId = params.draftId.trim();
  if (!draftId || draftId.includes('/')) throw new Error('project registration draft ID is invalid');
  assertDraftDocumentKind(params.documentKind);
  return downloadDraftAttachment({
    ...params,
    path: `/api/v1/project-registration-drafts/${encodeURIComponent(draftId)}/attachments/${params.documentKind}`,
  });
}

export async function downloadProjectInfoDraftAttachmentViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  documentKind: ProjectRequestDocumentKind;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}) {
  const projectId = params.projectId.trim();
  if (!projectId || projectId.includes('/')) throw new Error('project ID is invalid');
  assertDraftDocumentKind(params.documentKind);
  return downloadDraftAttachment({
    ...params,
    path: `/api/v1/project-info-drafts/${encodeURIComponent(projectId)}/attachments/${params.documentKind}`,
  });
}

export async function downloadProjectRequestAttachmentViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  requestId: string;
  documentKind: ProjectRequestDocumentKind;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; fileName: string }> {
  const requestId = params.requestId.trim();
  if (!requestId || requestId.includes('/')) throw new Error('project request ID is invalid');
  const response = await (params.fetchImpl || globalThis.fetch)(
    `${readPlatformApiRuntimeConfig().baseUrl}/api/v1/project-requests/${encodeURIComponent(requestId)}/attachments/${params.documentKind}`,
    {
      method: 'GET',
      headers: buildStandardHeaders({
        tenantId: params.tenantId,
        actor: toRequestActor(params.actor),
        method: 'GET',
      }),
      signal: params.signal,
    },
  );
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || '첨부 파일을 불러오지 못했습니다.');
  }
  return {
    blob: await response.blob(),
    fileName: contentDispositionFileName(response.headers.get('content-disposition')) || 'attachment',
  };
}

export async function downloadProjectAttachmentViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  documentKind: ProjectRequestDocumentKind;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; fileName: string }> {
  const projectId = params.projectId.trim();
  if (!projectId || projectId.includes('/')) throw new Error('project ID is invalid');
  const response = await (params.fetchImpl || globalThis.fetch)(
    `${readPlatformApiRuntimeConfig().baseUrl}/api/v1/projects/${encodeURIComponent(projectId)}/attachments/${params.documentKind}`,
    {
      method: 'GET',
      headers: buildStandardHeaders({
        tenantId: params.tenantId,
        actor: toRequestActor(params.actor),
        method: 'GET',
      }),
      signal: params.signal,
    },
  );
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || '첨부 파일을 불러오지 못했습니다.');
  }
  return {
    blob: await response.blob(),
    fileName: contentDispositionFileName(response.headers.get('content-disposition')) || 'attachment',
  };
}
