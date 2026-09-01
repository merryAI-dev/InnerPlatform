import { randomUUID } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';
import { readOptionalText } from './bff-utils.mjs';
import { getOrInitAdminApp, resolveProjectId } from './firestore.mjs';

/**
 * 인사정보 증빙 파일 저장.
 *
 * 졸업증명서·성적표·자격증 사본은 민감한 개인정보다. 그래서 조직 구성원이면 누구나 읽는
 * 일반 스토리지 경로에 두지 않고, storage rules 에서 통째로 막은 뒤 BFF 를 통해서만
 * 오간다(`person:professional_profile:read|write` 권한이 문지기다).
 *
 * 업로드는 서명 URL 로 브라우저가 스토리지에 직접 넣는다 - Vercel 서버리스가 요청 본문을
 * 4.5MB 에서 자르기 때문에, 스캔본을 본문에 실어 보내면 큰 파일이 그대로 막힌다.
 */

const EVIDENCE_ROOT = 'person-hr-evidence';
const UPLOAD_URL_TTL_MS = 10 * 60 * 1000;

function requireSegment(value, fieldName) {
  const normalized = readOptionalText(value);
  if (!normalized || !/^[A-Za-z0-9._가-힣-]+$/.test(normalized) || normalized === '.' || normalized === '..') {
    throw new Error(`${fieldName} must be a safe storage path segment`);
  }
  return normalized;
}

function safeFileName(fileName) {
  const trimmed = readOptionalText(fileName) || 'evidence';
  const normalized = trimmed
    .replace(/\s+/g, '_')
    .replace(/[^\w.\-가-힣()]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'evidence';
}

function resolveBucketName(env = process.env) {
  return readOptionalText(env.FIREBASE_STORAGE_BUCKET)
    || readOptionalText(env.VITE_FIREBASE_STORAGE_BUCKET)
    || `${resolveProjectId(env)}.firebasestorage.app`;
}

export function personEvidencePrefix(tenantId, personId) {
  return `orgs/${requireSegment(tenantId, 'tenantId')}/${EVIDENCE_ROOT}/${requireSegment(personId, 'personId')}/`;
}

export function createPersonHrEvidenceStorageService(options = {}) {
  const bucketName = options.bucketName || resolveBucketName(options.env || process.env);
  const adminApp = options.adminApp || getOrInitAdminApp({ projectId: options.projectId });
  const storage = options.storage || getStorage(adminApp);
  const bucket = storage.bucket(bucketName);
  const createEvidenceId = options.createEvidenceId || randomUUID;

  /** 경로는 절대 클라이언트에서 받지 않고 evidenceId 로 다시 만든다 - 남의 파일을 가리킬 수 없다. */
  function evidencePath(tenantId, personId, evidenceId, fileName) {
    return `${personEvidencePrefix(tenantId, personId)}${requireSegment(evidenceId, 'evidenceId')}-${safeFileName(fileName)}`;
  }

  return {
    async createUploadUrl(input) {
      const tenantId = requireSegment(input?.tenantId, 'tenantId');
      const personId = requireSegment(input?.personId, 'personId');
      const evidenceId = createEvidenceId();
      const fileName = safeFileName(input?.fileName);
      const mimeType = readOptionalText(input?.mimeType) || 'application/octet-stream';
      const path = evidencePath(tenantId, personId, evidenceId, fileName);
      const expiresAtMs = Date.now() + UPLOAD_URL_TTL_MS;
      const [uploadUrl] = await bucket.file(path).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: expiresAtMs,
        contentType: mimeType,
      });
      return { evidenceId, path, fileName, uploadUrl, expiresAt: new Date(expiresAtMs).toISOString() };
    },

    /** 업로드가 실제로 끝났는지 확인하고 크기를 서버가 직접 읽는다 - 브라우저가 적어 온 값은 믿지 않는다. */
    async describeEvidence(input) {
      const tenantId = requireSegment(input?.tenantId, 'tenantId');
      const personId = requireSegment(input?.personId, 'personId');
      const path = evidencePath(tenantId, personId, input?.evidenceId, input?.fileName);
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [metadata] = await file.getMetadata();
      return {
        path,
        size: Number(metadata?.size) || 0,
        contentType: readOptionalText(metadata?.contentType) || 'application/octet-stream',
        uploadedAt: readOptionalText(metadata?.timeCreated) || new Date().toISOString(),
      };
    },

    async downloadEvidence(input) {
      const tenantId = requireSegment(input?.tenantId, 'tenantId');
      const personId = requireSegment(input?.personId, 'personId');
      const path = readOptionalText(input?.path);
      const prefix = personEvidencePrefix(tenantId, personId);
      if (!path || !path.startsWith(prefix) || path.includes('..')) {
        throw new Error('Evidence path is outside the person prefix');
      }
      const file = bucket.file(path);
      const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
      return {
        buffer,
        contentType: readOptionalText(metadata?.contentType) || 'application/octet-stream',
        name: path.slice(prefix.length),
      };
    },

    async deleteEvidence(input) {
      const tenantId = requireSegment(input?.tenantId, 'tenantId');
      const personId = requireSegment(input?.personId, 'personId');
      const path = readOptionalText(input?.path);
      const prefix = personEvidencePrefix(tenantId, personId);
      if (!path || !path.startsWith(prefix) || path.includes('..')) return;
      await bucket.file(path).delete({ ignoreNotFound: true });
    },
  };
}
