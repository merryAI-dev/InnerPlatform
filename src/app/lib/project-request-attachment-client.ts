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

export async function downloadProjectRequestAttachmentViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  requestId: string;
  documentKind: ProjectRequestDocumentKind;
  fetchImpl?: typeof fetch;
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
