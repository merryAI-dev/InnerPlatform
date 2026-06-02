import { getDownloadURL, ref, uploadBytesResumable, type UploadTaskSnapshot } from 'firebase/storage';
import { getAuthInstance, getStorageInstance } from '../lib/firebase';
import type { FileAttachment } from '../data/types';
import {
  isPlatformApiEnabled,
  processProjectRequestContractViaBff,
  type ActorLike,
} from '../lib/platform-bff-client';

export type ProjectRequestDocumentKind = 'contract' | 'quote' | 'proposal';

export const PROJECT_REQUEST_DOCUMENT_UPLOAD_MAX_SIZE_BYTES = 1024 * 1024 * 1024;
export const PROJECT_REQUEST_DOCUMENT_UPLOAD_MAX_SIZE_LABEL = '1GB';
const BFF_CONTRACT_PROCESS_MAX_SIZE_BYTES = 25 * 1024 * 1024;

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSafeFileName(fileName: string, fallback: string) {
  const normalized = (readText(fileName) || fallback)
    .replace(/\s+/g, '_')
    .replace(/[^\w.\-가-힣()]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function assertProjectDocumentUploadAllowed(params: {
  actor: ActorLike | null | undefined;
  file: File;
}) {
  if (!params.actor?.uid) {
    throw new Error('로그인 정보를 확인할 수 없습니다.');
  }
  if (params.file.size > PROJECT_REQUEST_DOCUMENT_UPLOAD_MAX_SIZE_BYTES) {
    throw new Error(`첨부 PDF는 ${PROJECT_REQUEST_DOCUMENT_UPLOAD_MAX_SIZE_LABEL} 이하만 업로드할 수 있습니다.`);
  }
}

async function uploadProjectRequestDocumentDirectly(params: {
  tenantId: string;
  actor: ActorLike;
  file: File;
  kind: ProjectRequestDocumentKind;
}): Promise<FileAttachment> {
  const storage = getStorageInstance();
  if (!storage) {
    throw new Error('Firebase Storage 설정을 확인할 수 없습니다.');
  }

  const tenantId = readText(params.tenantId) || 'mysc';
  const actorId = readText(params.actor.uid) || 'system';
  const fileName = normalizeSafeFileName(params.file.name, `${params.kind}.pdf`);
  const path = `orgs/${tenantId}/project-request-documents/${actorId}/${Date.now()}-${params.kind}-${fileName}`;
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, params.file, {
    contentType: params.file.type || 'application/pdf',
    customMetadata: {
      tenantId,
      actorId,
      documentKind: params.kind,
      originalFileName: params.file.name,
    },
  });

  const snapshot = await new Promise<UploadTaskSnapshot>((resolve, reject) => {
    task.on('state_changed', undefined, reject, () => resolve(task.snapshot));
  });
  const downloadURL = await getDownloadURL(snapshot.ref);
  return {
    path: snapshot.ref.fullPath,
    name: params.file.name || fileName,
    downloadURL,
    size: params.file.size,
    contentType: params.file.type || 'application/pdf',
    uploadedAt: new Date().toISOString(),
  };
}

export async function uploadProjectRequestContractFile(params: {
  tenantId: string;
  actor: ActorLike | null | undefined;
  file: File;
}) {
  assertProjectDocumentUploadAllowed({ actor: params.actor, file: params.file });
  if (!params.actor) throw new Error('로그인 정보를 확인할 수 없습니다.');

  if (!isPlatformApiEnabled() || params.file.size > BFF_CONTRACT_PROCESS_MAX_SIZE_BYTES) {
    const contractDocument = await uploadProjectRequestDocumentDirectly({
      tenantId: params.tenantId,
      actor: params.actor,
      file: params.file,
      kind: 'contract',
    });
    return {
      contractDocument,
      contractAnalysis: null,
    };
  }

  const idToken = params.actor.idToken
    || await getAuthInstance()?.currentUser?.getIdToken()
    || undefined;
  const processed = await processProjectRequestContractViaBff({
    tenantId: params.tenantId,
    actor: {
      ...params.actor,
      idToken,
    },
    file: params.file,
  });

  return {
    contractDocument: processed.contractDocument,
    contractAnalysis: processed.analysis,
  };
}

export async function uploadProjectRequestSupplementalDocumentFile(params: {
  tenantId: string;
  actor: ActorLike | null | undefined;
  file: File;
  kind: Exclude<ProjectRequestDocumentKind, 'contract'>;
}) {
  assertProjectDocumentUploadAllowed({ actor: params.actor, file: params.file });
  if (!params.actor) throw new Error('로그인 정보를 확인할 수 없습니다.');
  return uploadProjectRequestDocumentDirectly({
    tenantId: params.tenantId,
    actor: params.actor,
    file: params.file,
    kind: params.kind,
  });
}
