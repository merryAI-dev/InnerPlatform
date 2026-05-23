import { getStorage } from 'firebase-admin/storage';
import { getOrInitAdminApp, resolveProjectId } from './firestore.mjs';
import { readOptionalText } from './business-card-domain.mjs';

const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function normalizeSafeFileName(fileName) {
  const trimmed = readOptionalText(fileName) || 'business-card.jpg';
  const normalized = trimmed
    .replace(/\s+/g, '_')
    .replace(/[^\w.\-가-힣()]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || `business-card-${Date.now()}.jpg`;
}

function normalizeStoragePathSegment(value, fallback) {
  const normalized = readOptionalText(value)
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function resolveBucketName(env = process.env) {
  return readOptionalText(env.FIREBASE_STORAGE_BUCKET)
    || readOptionalText(env.VITE_FIREBASE_STORAGE_BUCKET)
    || `${resolveProjectId(env)}.firebasestorage.app`;
}

function toBuffer(input) {
  if (Buffer.isBuffer(input?.buffer)) return input.buffer;
  if (input?.buffer instanceof Uint8Array) return Buffer.from(input.buffer);
  const contentBase64 = readOptionalText(input?.contentBase64);
  return contentBase64 ? Buffer.from(contentBase64, 'base64') : null;
}

function createPayloadTooLargeError(maxImageBytes, actualBytes) {
  const error = new Error(`business card image exceeds ${maxImageBytes} bytes: ${actualBytes}`);
  error.statusCode = 413;
  error.code = 'business_card_image_too_large';
  return error;
}

export function createBusinessCardStorageService(options = {}) {
  const bucketName = options.bucketName || resolveBucketName(options.env || process.env);
  const adminApp = options.adminApp || getOrInitAdminApp({ projectId: options.projectId });
  const storage = options.storage || getStorage(adminApp);
  const bucket = storage.bucket(bucketName);
  const maxImageBytes = Number.isFinite(options.maxImageBytes) && options.maxImageBytes > 0
    ? options.maxImageBytes
    : DEFAULT_MAX_IMAGE_BYTES;

  return {
    async uploadBusinessCard(input) {
      const tenantId = normalizeStoragePathSegment(input?.tenantId, 'mysc');
      const actorId = normalizeStoragePathSegment(input?.actorId, 'system');
      const importId = normalizeStoragePathSegment(input?.importId, `bcimp_${Date.now()}`);
      const fileName = normalizeSafeFileName(input?.fileName);
      const mimeType = readOptionalText(input?.mimeType) || 'image/jpeg';
      const buffer = toBuffer(input);
      if (!buffer) throw new Error('buffer or contentBase64 is required');
      if (buffer.byteLength > maxImageBytes) {
        throw createPayloadTooLargeError(maxImageBytes, buffer.byteLength);
      }

      const uploadedAt = new Date().toISOString();
      const path = `orgs/${tenantId}/business-cards/${actorId}/${importId}-${fileName}`;
      const file = bucket.file(path);

      await file.save(buffer, {
        resumable: false,
        metadata: {
          contentType: mimeType,
          metadata: {
            ownerActorId: actorId,
            tenantId,
            importId,
          },
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

    createReadStream(storagePath) {
      const normalizedPath = readOptionalText(storagePath);
      if (!normalizedPath) throw new Error('storagePath is required');
      return bucket.file(normalizedPath).createReadStream();
    },
  };
}

export {
  normalizeStoragePathSegment,
  normalizeSafeFileName,
  resolveBucketName,
};
