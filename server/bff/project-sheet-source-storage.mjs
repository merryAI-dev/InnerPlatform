import { randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { getOrInitAdminApp, resolveProjectId } from './firestore.mjs';

function readOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSafeFileName(fileName) {
  const trimmed = readOptionalText(fileName) || 'source.xlsx';
  const normalized = trimmed
    .replace(/\s+/g, '_')
    .replace(/[^\w.\-가-힣()]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || `source_${Date.now()}.xlsx`;
}

function resolveBucketName(env = process.env) {
  return readOptionalText(env.FIREBASE_STORAGE_BUCKET)
    || readOptionalText(env.VITE_FIREBASE_STORAGE_BUCKET)
    || `${resolveProjectId(env)}.firebasestorage.app`;
}

function buildDownloadUrl(bucketName, objectPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(objectPath)}?alt=media&token=${encodeURIComponent(token)}`;
}

export function createProjectSheetSourceStorageService(options = {}) {
  const bucketName = options.bucketName || resolveBucketName(options.env || process.env);
  const adminApp = options.adminApp || getOrInitAdminApp({ projectId: options.projectId });
  const storage = options.storage || getStorage(adminApp);
  const bucket = storage.bucket(bucketName);

  return {
    async uploadSource(input) {
      const tenantId = readOptionalText(input?.tenantId) || 'mysc';
      const actorId = readOptionalText(input?.actorId) || 'system';
      const projectId = readOptionalText(input?.projectId) || 'unknown-project';
      const sourceType = readOptionalText(input?.sourceType) || 'usage';
      const fileName = normalizeSafeFileName(input?.fileName);
      const mimeType = readOptionalText(input?.mimeType)
        || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const fileSize = Number.isFinite(input?.fileSize) ? input.fileSize : 0;
      const buffer = input?.buffer instanceof Uint8Array
        ? Buffer.from(input.buffer)
        : Buffer.isBuffer(input?.buffer)
          ? input.buffer
          : null;
      const contentBase64 = readOptionalText(input?.contentBase64);
      if (!buffer && !contentBase64) {
        throw new Error('buffer or contentBase64 is required');
      }

      const uploadedAt = new Date().toISOString();
      const token = randomUUID();
      const path = `orgs/${tenantId}/project-sheet-sources/${projectId}/${sourceType}/${Date.now()}-${fileName}`;
      const file = bucket.file(path);
      const uploadBuffer = buffer || Buffer.from(contentBase64, 'base64');

      await file.save(uploadBuffer, {
        resumable: false,
        metadata: {
          contentType: mimeType,
          metadata: {
            firebaseStorageDownloadTokens: token,
            actorId,
            sourceType,
          },
        },
      });

      return {
        path,
        name: readOptionalText(input?.fileName) || fileName,
        downloadURL: buildDownloadUrl(bucketName, path, token),
        size: fileSize || uploadBuffer.byteLength,
        contentType: mimeType,
        uploadedAt,
      };
    },
  };
}

export {
  buildDownloadUrl,
  normalizeSafeFileName,
  resolveBucketName,
};
