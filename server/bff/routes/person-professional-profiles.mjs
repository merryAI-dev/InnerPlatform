import {
  asyncHandler,
  assertActorPermissionAllowed,
  createHttpError,
  encryptAuditEmail,
} from '../bff-utils.mjs';
import {
  collectProfileEvidencePaths,
  getProfessionalProfileCatalog,
  normalizeProfessionalProfileInput,
  normalizeStoredProfessionalProfile,
  serializeProfessionalProfile,
} from '../professional-profile.mjs';
import { parseWithSchema, personHrEvidenceUploadUrlSchema, personProfessionalProfilePutSchema } from '../schemas.mjs';
import { buildRequestFingerprint } from '../utils.mjs';

const PROFILE_READ_PERMISSION = 'person:professional_profile:read';
const PROFILE_WRITE_PERMISSION = 'person:professional_profile:write';
const PROFILE_FIELDS = ['educationRecords', 'englishEvidence', 'certifications'];

function preventProfileCaching(_req, res, next) {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}

function profileContent(profile) {
  return {
    educationRecords: profile.educationRecords,
    englishEvidence: profile.englishEvidence,
    certifications: profile.certifications,
  };
}

function profileContentMatches(storedProfile, normalizedInput) {
  return JSON.stringify(profileContent(storedProfile)) === JSON.stringify(normalizedInput);
}

function normalizeProfileCommand(value) {
  try {
    return normalizeProfessionalProfileInput(value);
  } catch (error) {
    if (error?.code !== 'professional_profile_invalid') throw error;
    throw createHttpError(400, error.message, 'professional_profile_invalid');
  }
}

function personNotFound() {
  return createHttpError(404, '명부에 없는 인력입니다.', 'person_not_found');
}

function revisionConflict(currentRevision) {
  const error = createHttpError(
    409,
    '전문 프로필이 변경되었습니다. 최신 값을 다시 불러와 주세요.',
    'professional_profile_revision_conflict',
  );
  error.details = { currentRevision };
  return error;
}

function idempotencyError(lock) {
  if (lock.mode === 'conflict') {
    return createHttpError(409, lock.reason, 'idempotency_conflict');
  }
  if (lock.mode === 'in_progress') {
    return createHttpError(409, lock.reason, 'idempotency_in_progress');
  }
  return null;
}

/**
 * 담당자 권한이 없어도 본인이면 통과시킨다.
 *
 * 자기 학력·어학·자격은 자기 계정으로 넣는 것이 자연스럽다. 판정 기준은 역할이 아니라
 * 대상 person 문서의 uid 가 로그인 계정과 같은지다 - 남의 것은 여전히 담당자만 만진다.
 */
async function assertProfileAccessOrSelf({ rbacPolicy, req, db, permission, action }) {
  try {
    assertActorPermissionAllowed(rbacPolicy, req, permission, action);
    return { self: false };
  } catch (error) {
    const { tenantId, actorId } = req.context;
    const { personId } = req.params;
    if (actorId && personId) {
      const snapshot = await db.doc(`orgs/${tenantId}/persons/${personId}`).get();
      if (snapshot.exists && snapshot.data()?.uid === actorId) return { self: true };
    }
    throw error;
  }
}

/** 카탈로그는 코드 목록일 뿐이라, 명부에 연결된 본인 계정이면 권한 없이도 준다. */
async function assertCatalogAccessOrLinked({ rbacPolicy, req, db }) {
  try {
    assertActorPermissionAllowed(rbacPolicy, req, PROFILE_READ_PERMISSION, 'read the professional profile catalog');
    return;
  } catch (error) {
    const { tenantId, actorId } = req.context;
    if (actorId) {
      const snap = await db.collection(`orgs/${tenantId}/persons`).where('uid', '==', actorId).limit(1).get();
      if (!snap.empty) return;
    }
    throw error;
  }
}

export function mountPersonProfessionalProfileRoutes(app, {
  db,
  now,
  idempotencyService,
  auditChainService,
  piiProtector,
  rbacPolicy,
  evidenceStorageService,
  catalog = getProfessionalProfileCatalog(),
}) {
  app.get(
    '/api/v1/person-professional-profile/catalog',
    preventProfileCaching,
    asyncHandler(async (req, res) => {
      await assertCatalogAccessOrLinked({ rbacPolicy, req, db });
      res.status(200).json(catalog);
    }),
  );

  app.get(
    '/api/v1/persons/:personId/professional-profile',
    preventProfileCaching,
    asyncHandler(async (req, res) => {
      await assertProfileAccessOrSelf({
        rbacPolicy, req, db, permission: PROFILE_READ_PERMISSION, action: 'read a professional profile',
      });
      const { tenantId } = req.context;
      const { personId } = req.params;
      const snapshot = await db.doc(`orgs/${tenantId}/persons/${personId}`).get();
      if (!snapshot.exists) throw personNotFound();

      const profile = serializeProfessionalProfile(snapshot.data()?.professionalProfile);
      res.status(200).json({ profile, revision: profile.provenance.revision });
    }),
  );

  app.put(
    '/api/v1/persons/:personId/professional-profile',
    preventProfileCaching,
    asyncHandler(async (req, res) => {
      await assertProfileAccessOrSelf({
        rbacPolicy, req, db, permission: PROFILE_WRITE_PERMISSION, action: 'write a professional profile',
      });
      const parsed = parseWithSchema(
        personProfessionalProfilePutSchema,
        req.body,
        'Invalid professional profile payload',
      );
      const normalizedInput = normalizeProfileCommand(parsed.profile);
      const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
      const { personId } = req.params;
      const timestamp = now();
      const requestFingerprint = buildRequestFingerprint({
        method: req.method,
        path: req.path,
        body: req.body,
      });
      const personRef = db.doc(`orgs/${tenantId}/persons/${personId}`);

      const result = await db.runTransaction(async (tx) => {
        const lock = await idempotencyService.checkInTransaction(tx, {
          tenantId,
          idempotencyKey: req.context.idempotencyKey,
          requestFingerprint,
          actorId,
          nowDate: new Date(timestamp),
        });
        if (lock.mode === 'replay') {
          const replaySnapshot = await tx.get(personRef);
          if (!replaySnapshot.exists) throw personNotFound();
          const replayProfile = serializeProfessionalProfile(
            replaySnapshot.data()?.professionalProfile,
          );
          return {
            replayed: true,
            status: lock.status,
            body: {
              profile: replayProfile,
              revision: replayProfile.provenance.revision,
              changed: lock.body?.changed ?? false,
            },
          };
        }
        const lockError = idempotencyError(lock);
        if (lockError) throw lockError;

        const personSnapshot = await tx.get(personRef);
        if (!personSnapshot.exists) throw personNotFound();

        const currentProfile = normalizeStoredProfessionalProfile(
          personSnapshot.data()?.professionalProfile,
        );
        const currentRevision = currentProfile.provenance.revision;
        const complete = (profile, changed) => {
          const canonicalProfile = serializeProfessionalProfile(profile);
          const revision = canonicalProfile.provenance.revision;
          idempotencyService.completeInTransaction(tx, {
            ref: lock.ref,
            tenantId,
            idempotencyKey: req.context.idempotencyKey,
            requestFingerprint,
            responseStatus: 200,
            responseBody: { personId, revision, changed },
            actorId,
            requestId,
            method: req.method,
            path: req.path,
            nowDate: new Date(timestamp),
          });
          return {
            replayed: false,
            status: 200,
            body: { profile: canonicalProfile, revision, changed },
          };
        };
        if (profileContentMatches(currentProfile, normalizedInput)) {
          return complete(currentProfile, false);
        }
        if (parsed.expectedRevision !== currentRevision) {
          throw revisionConflict(currentRevision);
        }

        const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
        const nextRevision = currentRevision + 1;
        const nextProfile = {
          schemaVersion: 1,
          ...normalizedInput,
          provenance: {
            source: 'PEOPLE_MANUAL',
            revision: nextRevision,
            updatedAt: timestamp,
            updatedBy: actorId,
          },
        };
        await auditChainService.appendManyInTransaction(tx, [{
          tenantId,
          entityType: 'person',
          entityId: personId,
          action: 'PROFILE_UPDATE',
          actorId,
          actorRole,
          actorEmailEnc,
          requestId,
          details: '전문 프로필 수정',
          metadata: {
            source: 'bff',
            fields: PROFILE_FIELDS,
            previousRevision: currentRevision,
            nextRevision,
          },
          timestamp,
        }]);
        tx.set(personRef, {
          professionalProfile: nextProfile,
          updatedAt: timestamp,
          updatedBy: actorId,
        }, { merge: true });
        // 이번 저장에서 떨어져 나간 증빙 파일. 커밋된 뒤에만 지운다.
        const keptPaths = new Set(collectProfileEvidencePaths(nextProfile));
        const orphanPaths = collectProfileEvidencePaths(currentProfile)
          .filter((path) => !keptPaths.has(path));
        return { ...complete(nextProfile, true), orphanPaths };
      });

      // 참조가 끊긴 증빙은 남겨둘 이유가 없다. 실패해도 저장은 이미 끝났으므로 응답을 막지 않는다.
      if (!result.replayed && result.orphanPaths?.length && evidenceStorageService?.deleteEvidence) {
        await Promise.all(result.orphanPaths.map((path) => (
          evidenceStorageService.deleteEvidence({ tenantId, personId, path }).catch(() => undefined)
        )));
      }

      if (result.replayed) res.setHeader('x-idempotency-replayed', '1');
      res.status(result.status).json(result.body);
    }),
  );

  /**
   * 증빙 업로드 자리 발급. 파일은 브라우저가 서명 URL 로 스토리지에 직접 넣고, 프로필에는
   * 저장 버튼을 누를 때 참조만 붙는다 - 큰 스캔본이 요청 본문 한도에 막히지 않게 한다.
   */
  app.post(
    '/api/v1/persons/:personId/hr-evidence/upload-url',
    preventProfileCaching,
    asyncHandler(async (req, res) => {
      await assertProfileAccessOrSelf({
        rbacPolicy, req, db, permission: PROFILE_WRITE_PERMISSION, action: 'upload professional profile evidence',
      });
      if (!evidenceStorageService?.createUploadUrl) {
        throw createHttpError(503, '증빙 업로드가 아직 켜져 있지 않습니다.', 'hr_evidence_unavailable');
      }
      const parsed = parseWithSchema(personHrEvidenceUploadUrlSchema, req.body, 'Invalid evidence upload payload');
      const { tenantId } = req.context;
      const { personId } = req.params;
      const snapshot = await db.doc(`orgs/${tenantId}/persons/${personId}`).get();
      if (!snapshot.exists) throw personNotFound();
      const session = await evidenceStorageService.createUploadUrl({
        tenantId,
        personId,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
      });
      res.status(200).json({
        evidenceId: session.evidenceId,
        fileName: session.fileName,
        path: session.path,
        uploadUrl: session.uploadUrl,
        expiresAt: session.expiresAt,
      });
    }),
  );

  /** 증빙 원문. 권한 확인과 경로 검증을 서버가 하고, 브라우저에는 파일만 내려보낸다. */
  app.get(
    '/api/v1/persons/:personId/hr-evidence',
    preventProfileCaching,
    asyncHandler(async (req, res) => {
      await assertProfileAccessOrSelf({
        rbacPolicy, req, db, permission: PROFILE_READ_PERMISSION, action: 'read professional profile evidence',
      });
      if (!evidenceStorageService?.downloadEvidence) {
        throw createHttpError(503, '증빙 조회가 아직 켜져 있지 않습니다.', 'hr_evidence_unavailable');
      }
      const { tenantId } = req.context;
      const { personId } = req.params;
      const path = String(req.query?.path || '');
      let file;
      try {
        file = await evidenceStorageService.downloadEvidence({ tenantId, personId, path });
      } catch {
        throw createHttpError(404, '증빙 파일을 찾지 못했습니다.', 'hr_evidence_not_found');
      }
      res.setHeader('content-type', file.contentType);
      res.setHeader('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      res.status(200).send(file.buffer);
    }),
  );
}
