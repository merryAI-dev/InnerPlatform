import {
  asyncHandler,
  assertActorPermissionAllowed,
  createHttpError,
  encryptAuditEmail,
} from '../bff-utils.mjs';
import {
  getProfessionalProfileCatalog,
  normalizeProfessionalProfileInput,
  normalizeStoredProfessionalProfile,
  serializeProfessionalProfile,
} from '../professional-profile.mjs';
import { parseWithSchema, personProfessionalProfilePutSchema } from '../schemas.mjs';
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

function requireProfileWrite(rbacPolicy) {
  return (req, _res, next) => {
    try {
      assertActorPermissionAllowed(
        rbacPolicy,
        req,
        PROFILE_WRITE_PERMISSION,
        'write a professional profile',
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function mountPersonProfessionalProfileRoutes(app, {
  db,
  now,
  idempotencyService,
  auditChainService,
  piiProtector,
  rbacPolicy,
  catalog = getProfessionalProfileCatalog(),
}) {
  app.get(
    '/api/v1/person-professional-profile/catalog',
    preventProfileCaching,
    asyncHandler(async (req, res) => {
      assertActorPermissionAllowed(
        rbacPolicy,
        req,
        PROFILE_READ_PERMISSION,
        'read the professional profile catalog',
      );
      res.status(200).json(catalog);
    }),
  );

  app.get(
    '/api/v1/persons/:personId/professional-profile',
    preventProfileCaching,
    asyncHandler(async (req, res) => {
      assertActorPermissionAllowed(
        rbacPolicy,
        req,
        PROFILE_READ_PERMISSION,
        'read a professional profile',
      );
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
    requireProfileWrite(rbacPolicy),
    asyncHandler(async (req, res) => {
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
        return complete(nextProfile, true);
      });

      if (result.replayed) res.setHeader('x-idempotency-replayed', '1');
      res.status(result.status).json(result.body);
    }),
  );
}
