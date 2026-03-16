import { randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { getOrInitAdminApp, resolveProjectId } from './firestore.mjs';

function readOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSafeFileName(fileName) {
  const trimmed = readOptionalText(fileName) || 'contract.pdf';
  const normalized = trimmed
    .replace(/\s+/g, '_')
    .replace(/[^\w.\-가-힣()]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || `contract_${Date.now()}.pdf`;
}

function resolveBucketName(env = process.env) {
  return readOptionalText(env.FIREBASE_STORAGE_BUCKET)
    || readOptionalText(env.VITE_FIREBASE_STORAGE_BUCKET)
    || `${resolveProjectId(env)}.firebasestorage.app`;
}

function buildDownloadUrl(bucketName, objectPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(objectPath)}?alt=media&token=${encodeURIComponent(token)}`;
}

export function createProjectRequestContractStorageService(options = {}) {
  const bucketName = options.bucketName || resolveBucketName(options.env || process.env);
  const adminApp = options.adminApp || getOrInitAdminApp({ projectId: options.projectId });
  const storage = options.storage || getStorage(adminApp);
  const bucket = storage.bucket(bucketName);

  return {
    async uploadContract(input) {
      const tenantId = readOptionalText(input?.tenantId) || 'mysc';
      const actorId = readOptionalText(input?.actorId) || 'system';
      const fileName = normalizeSafeFileName(input?.fileName);
      const mimeType = readOptionalText(input?.mimeType) || 'application/pdf';
      const fileSize = Number.isFinite(input?.fileSize) ? input.fileSize : 0;
      const contentBase64 = readOptionalText(input?.contentBase64);
      if (!contentBase64) {
        throw new Error('contentBase64 is required');
      }

      const uploadedAt = new Date().toISOString();
      const token = randomUUID();
      const path = `orgs/${tenantId}/project-request-contracts/${actorId}/${Date.now()}-${fileName}`;
      const file = bucket.file(path);
      const buffer = Buffer.from(contentBase64, 'base64');

      await file.save(buffer, {
        resumable: false,
        metadata: {
          contentType: mimeType,
          metadata: {
            firebaseStorageDownloadTokens: token,
          },
        },
      });

      return {
        path,
        name: readOptionalText(input?.fileName) || fileName,
        downloadURL: buildDownloadUrl(bucketName, path, token),
        size: fileSize || buffer.byteLength,
        contentType: mimeType,
        uploadedAt,
      };
    },
  };
}

export {
  normalizeSafeFileName,
  resolveBucketName,
  buildDownloadUrl,
};
