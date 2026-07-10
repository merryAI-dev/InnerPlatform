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

function requireStoragePathSegment(value, fieldName) {
  const normalized = readOptionalText(value);
  if (!normalized || !/^[A-Za-z0-9._-]+$/.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error(`${fieldName} must be a safe storage path segment`);
  }
  return normalized;
}

function draftAttachmentPrefix(tenantId, draftId) {
  return `orgs/${requireStoragePathSegment(tenantId, 'tenantId')}/project-registration-drafts/${requireStoragePathSegment(draftId, 'draftId')}/`;
}

function projectRegistrationAttachmentPrefix(tenantId, projectId) {
  return `orgs/${requireStoragePathSegment(tenantId, 'tenantId')}/project-registration-documents/${requireStoragePathSegment(projectId, 'projectId')}/`;
}

function objectNameWithinPrefix(path, prefix, errorMessage) {
  const normalized = readOptionalText(path);
  const objectName = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : '';
  if (!objectName || objectName.includes('/') || objectName === '.' || objectName === '..') {
    throw new Error(errorMessage);
  }
  return { path: normalized, objectName };
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
      const path = `orgs/${tenantId}/project-request-contracts/${actorId}/${Date.now()}-${fileName}`;
      const file = bucket.file(path);
      const uploadBuffer = buffer || Buffer.from(contentBase64, 'base64');

      await file.save(uploadBuffer, {
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
        size: fileSize || uploadBuffer.byteLength,
        contentType: mimeType,
        uploadedAt,
      };
    },

    async uploadDraftAttachment(input) {
      const tenantId = requireStoragePathSegment(input?.tenantId, 'tenantId');
      const draftId = requireStoragePathSegment(input?.draftId, 'draftId');
      const attachmentId = requireStoragePathSegment(input?.attachmentId, 'attachmentId');
      const fileName = normalizeSafeFileName(input?.fileName);
      const mimeType = readOptionalText(input?.mimeType) || 'application/octet-stream';
      const buffer = input?.buffer instanceof Uint8Array
        ? Buffer.from(input.buffer)
        : Buffer.isBuffer(input?.buffer)
          ? input.buffer
          : null;
      if (!buffer) throw new Error('buffer is required');

      const uploadedAt = new Date().toISOString();
      const path = `${draftAttachmentPrefix(tenantId, draftId)}${attachmentId}-${fileName}`;
      await bucket.file(path).save(buffer, {
        resumable: false,
        metadata: {
          contentType: mimeType,
          metadata: { tenantId, draftId, attachmentId },
        },
      });

      return {
        path,
        name: readOptionalText(input?.fileName) || fileName,
        size: buffer.byteLength,
        contentType: mimeType,
        uploadedAt,
      };
    },

    async deleteDraftAttachment(input) {
      const prefix = draftAttachmentPrefix(input?.tenantId, input?.draftId);
      const { path } = objectNameWithinPrefix(
        input?.path,
        prefix,
        'draft attachment path is outside its draft prefix',
      );
      await bucket.file(path).delete({ ignoreNotFound: true });
    },

    async relocateDraftAttachments(input) {
      const sourcePrefix = draftAttachmentPrefix(input?.tenantId, input?.draftId);
      const destinationPrefix = projectRegistrationAttachmentPrefix(input?.tenantId, input?.projectId);
      const attachments = (Array.isArray(input?.attachmentRefs) ? input.attachmentRefs : []).map((attachment) => {
        const { path, objectName } = objectNameWithinPrefix(
          attachment?.path,
          sourcePrefix,
          'draft attachment path is outside its draft prefix',
        );
        return { attachment: attachment || {}, sourcePath: path, destinationPath: `${destinationPrefix}${objectName}` };
      });

      return Promise.all(attachments.map(async ({ attachment, sourcePath, destinationPath }) => {
        await bucket.file(sourcePath).copy(bucket.file(destinationPath));
        return {
          ...(readOptionalText(attachment.attachmentId) ? { attachmentId: readOptionalText(attachment.attachmentId) } : {}),
          documentKind: readOptionalText(attachment.documentKind),
          path: destinationPath,
          name: readOptionalText(attachment.name),
          size: Number.isSafeInteger(attachment.size) && attachment.size >= 0 ? attachment.size : 0,
          contentType: readOptionalText(attachment.contentType) || 'application/octet-stream',
          ...(readOptionalText(attachment.uploadedAt) ? { uploadedAt: readOptionalText(attachment.uploadedAt) } : {}),
          visibility: 'PRIVATE',
        };
      }));
    },

    async downloadProjectRegistrationAttachment(input) {
      const prefix = projectRegistrationAttachmentPrefix(input?.tenantId, input?.projectId);
      const { path } = objectNameWithinPrefix(
        input?.path,
        prefix,
        'project registration attachment path is outside its canonical prefix',
      );
      const file = bucket.file(path);
      const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
      return {
        buffer,
        contentType: readOptionalText(metadata?.contentType) || 'application/octet-stream',
        size: Number.parseInt(String(metadata?.size || buffer.byteLength), 10) || buffer.byteLength,
      };
    },
  };
}

export {
  normalizeSafeFileName,
  resolveBucketName,
  buildDownloadUrl,
};
