import { randomUUID } from 'node:crypto';
import {
  asyncHandler, createMutatingRoute, assertActorRoleAllowed, assertActorPermissionAllowed,
  ROUTE_ROLES, createHttpError, encryptAuditEmail,
} from '../bff-utils.mjs';
import { parseWithSchema, personCreateSchema, personEmploymentSchema, personProfileSchema } from '../schemas.mjs';
import { deriveProfessionalProfileFacts, normalizeProfessionalProfileInput, serializeProfessionalProfile } from '../professional-profile.mjs';
import { buildRequestFingerprint } from '../utils.mjs';

/**
 * 인력 명부(persons) — 사람과 그 고용(계약) 구간을 관리한다.
 *
 * 저장되는 진실은 employments 배열 하나다. 근로형태·재직상태·퇴사일은 읽는 쪽에서
 * 파생시킨다. 여기서 같이 저장하면 둘이 갈라지고 어느 쪽이 맞는지 알 수 없게 된다.
 *
 * 전환 규칙은 src/app/platform/person-employment.ts 와 같은 규칙이다. BFF 는 .mjs 라
 * 그 모듈을 그대로 못 읽어서 여기 한 번 더 있다 — persons.test.mjs 의 픽스처가
 * person-employment.test.ts 와 같은 값을 쓰고, 둘이 갈라지면 양쪽에서 깨진다.
 */

const OPEN_ENDED = '9999-12-31';

function previousDay(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function overlaps(a, b) {
  return a.startDate <= (b.endDate ?? OPEN_ENDED) && b.startDate <= (a.endDate ?? OPEN_ENDED);
}

function sortByStart(employments) {
  return [...employments].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** 사람에게 그대로 보여줄 안내를 담은 400. 기술 용어를 넣지 않는다. */
function invalidChange(guide) {
  return createHttpError(400, guide, 'person_employment_change_invalid');
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

export function applyEmploymentChange(existing, input) {
  const next = {
    id: input.id,
    type: input.type,
    state: input.state,
    startDate: input.effectiveFrom,
    endDate: input.endDate ?? null,
    note: (input.note || '').trim(),
  };

  if (next.endDate !== null && next.endDate < next.startDate) {
    throw invalidChange('종료일이 적용일보다 빠릅니다. 날짜를 다시 확인해 주세요.');
  }

  if (input.mode === 'add') {
    for (const item of existing) {
      if (overlaps(item, next)) {
        throw invalidChange(
          `${formatDate(item.startDate)}부터의 기존 계약과 기간이 겹칩니다. 겹치지 않게 날짜를 조정하거나 "계약 변경"으로 이어 주세요.`,
        );
      }
    }
    return sortByStart([...existing, next]);
  }

  const closedBefore = previousDay(next.startDate);
  const kept = [];
  for (const item of existing) {
    if (item.startDate >= next.startDate) {
      throw invalidChange(
        `${formatDate(item.startDate)}부터 시작하는 계약이 이미 있습니다. 적용일을 그보다 앞으로 잡거나, 기존 계약을 먼저 정리해 주세요.`,
      );
    }
    kept.push(
      item.endDate === null || item.endDate >= next.startDate
        ? { ...item, endDate: closedBefore }
        : item,
    );
  }
  return sortByStart([...kept, next]);
}

function readPerson(snapshot) {
  if (!snapshot.exists) return null;
  const data = snapshot.data() || {};
  return { ...data, employments: Array.isArray(data.employments) ? data.employments : [] };
}

/**
 * 명부 목록에 실을 인사 요약. 원문(학교·전공 외 나머지 학력 이력, 점수, 시험월)은 싣지 않고
 * 화면이 바로 읽을 값만 만든다. 권한이 없으면 아예 만들지 않는다.
 */
function personHrSummary(person) {
  try {
    const facts = deriveProfessionalProfileFacts(person?.professionalProfile);
    return {
      highestEducationDisplayText: facts.highestEducationDisplayText || '',
      highestDegreeYear: facts.highestDegreeYear || '',
      highestEducationCode: facts.highestEducationCode || '',
      highestEducationInstitution: facts.highestEducationInstitution || '',
      highestEducationMajor: facts.highestEducationMajor || '',
      englishEvidenceDisplayText: facts.englishEvidenceDisplayText || '',
      certificationsDisplayText: facts.certificationsDisplayText || '',
    };
  } catch {
    // 한 사람의 깨진 프로필이 명부 전체를 무너뜨리면 안 된다. 그 사람만 빈 요약으로 둔다.
    return {
      highestEducationDisplayText: '',
      highestDegreeYear: '',
      highestEducationCode: '',
      highestEducationInstitution: '',
      highestEducationMajor: '',
      englishEvidenceDisplayText: '',
      certificationsDisplayText: '',
    };
  }
}

function serializePersonDirectoryItem(person) {
  return {
    personId: person.personId,
    name: person.name || '',
    nickname: person.nickname || '',
    email: person.email || '',
    departmentTop: person.departmentTop || '',
    departmentMid: person.departmentMid || '',
    departmentSub: person.departmentSub || '',
    title: person.title || '',
    grade: person.grade || '',
    birthDate: person.birthDate || '',
    workLocation: person.workLocation || '',
    joinedAt: person.joinedAt || '',
    uid: person.uid || null,
    employments: Array.isArray(person.employments) ? person.employments : [],
  };
}

function actorCanUseProfile(rbacPolicy, req, permission) {
  try {
    assertActorPermissionAllowed(rbacPolicy, req, permission, 'access a professional profile');
    return true;
  } catch (error) {
    if (error?.statusCode === 403) return false;
    throw error;
  }
}

function hasProfileContent(profile) {
  return profile.educationRecords.length > 0
    || profile.englishEvidence.length > 0
    || profile.certifications.length > 0;
}

function normalizeProfileCommand(value) {
  try {
    return normalizeProfessionalProfileInput(value);
  } catch (error) {
    if (error?.code !== 'professional_profile_invalid') throw error;
    throw createHttpError(400, error.message, 'professional_profile_invalid');
  }
}

function preventPersonCaching(_req, res, next) {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
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

function preparePersonCreate(rbacPolicy) {
  return (req, _res, next) => {
    try {
      assertActorRoleAllowed(req, ROUTE_ROLES.personWrite, 'create a person');
      const parsed = parseWithSchema(personCreateSchema, req.body, 'Invalid person payload');
      const profileProvided = Object.hasOwn(req.body || {}, 'professionalProfile');
      const normalizedProfile = profileProvided
        ? normalizeProfileCommand(parsed.professionalProfile)
        : null;
      const includesProfile = normalizedProfile !== null && hasProfileContent(normalizedProfile);
      if (profileProvided) {
        assertActorPermissionAllowed(
          rbacPolicy,
          req,
          'person:professional_profile:write',
          'create a professional profile',
        );
      }
      req.personCreateCommand = {
        parsed,
        normalizedProfile,
        profileProvided,
        includesProfile,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

function buildPersonCreateDocument({ parsed, normalizedProfile, includesProfile }, context, timestamp) {
  const { tenantId, actorId } = context;
  const personId = parsed.personId
    || `psn-x-${String(parsed.name).replace(/[()\s/]/g, '')}${String(parsed.nickname || '').replace(/[()\s/]/g, '')}`;
  const employment = {
    id: randomUUID(),
    type: parsed.employment.type,
    state: parsed.employment.state,
    startDate: parsed.employment.effectiveFrom,
    endDate: parsed.employment.endDate ?? null,
    note: (parsed.employment.note || '').trim(),
  };
  if (employment.endDate !== null && employment.endDate < employment.startDate) {
    throw invalidChange('종료일이 적용일보다 빠릅니다. 날짜를 다시 확인해 주세요.');
  }

  const doc = {
    personId,
    tenantId,
    name: parsed.name,
    nickname: parsed.nickname || '',
    email: (parsed.email || '').trim().toLowerCase(),
    departmentTop: parsed.departmentTop || '',
    departmentMid: parsed.departmentMid || '',
    departmentSub: parsed.departmentSub || '',
    title: parsed.title || '',
    grade: parsed.grade || '',
    birthDate: parsed.birthDate || '',
    workLocation: parsed.workLocation || '',
    note: parsed.note || '',
    joinedAt: employment.startDate,
    employments: [employment],
    uid: null,
    // 시트에서 온 인력이 아니라는 걸 남긴다 — 시트 재동기화가 덮어쓰면 안 된다.
    source: { sheet: null, origin: 'manual', createdBy: actorId, createdAt: timestamp },
    createdAt: timestamp,
    updatedAt: timestamp,
    updatedBy: actorId,
  };

  if (includesProfile) {
    doc.professionalProfile = {
      schemaVersion: 1,
      ...normalizedProfile,
      provenance: {
        source: 'PEOPLE_MANUAL',
        revision: 1,
        updatedAt: timestamp,
        updatedBy: actorId,
      },
    };
  }
  return { personId, employment, doc };
}

export function mountPersonRoutes(app, {
  db, now, idempotencyService, auditChainService, piiProtector, rbacPolicy,
}) {
  /**
   * 내 인사정보. 남의 것은 못 보고 자기 것만 본다 - 본인 데이터라 별도 권한을 요구하지 않는다.
   * 인사 담당자가 남의 것을 보는 경로(person:professional_profile:read)와는 다른 문이다.
   */
  app.get('/api/v1/persons/me/hr-profile', preventPersonCaching, asyncHandler(async (req, res) => {
    const { tenantId, actorId } = req.context;
    if (!actorId) throw createHttpError(400, 'actorId is required', 'actor_required');
    const snap = await db.collection(`orgs/${tenantId}/persons`).where('uid', '==', actorId).limit(2).get();
    const doc = snap.docs[0];
    if (!doc) {
      // 명부에 아직 연결되지 않은 계정이다. 빈 화면 대신 왜 비어 있는지 알려야 한다.
      res.status(200).json({ linked: false, person: null, profile: null });
      return;
    }
    const person = readPerson(doc);
    const stored = doc.data()?.professionalProfile;
    res.status(200).json({
      linked: true,
      person: serializePersonDirectoryItem(person),
      profile: serializeProfessionalProfile(stored),
    });
  }));

  app.get('/api/v1/persons', preventPersonCaching, asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read the people directory');
    const { tenantId } = req.context;
    const snap = await db.collection(`orgs/${tenantId}/persons`).get();
    const canReadProfile = actorCanUseProfile(rbacPolicy, req, 'person:professional_profile:read');
    const items = snap.docs
      .map((doc) => ({ raw: doc.data() || {}, person: readPerson(doc) }))
      .filter(({ person }) => Boolean(person))
      .sort((a, b) => String(a.person.name || '').localeCompare(String(b.person.name || ''), 'ko'))
      .map(({ raw, person }) => (canReadProfile
        ? { ...serializePersonDirectoryItem(person), hrSummary: personHrSummary(raw) }
        : serializePersonDirectoryItem(person)));
    res.status(200).json({
      items,
      total: items.length,
      capabilities: {
        professionalProfileRead: canReadProfile,
        professionalProfileWrite: actorCanUseProfile(
          rbacPolicy,
          req,
          'person:professional_profile:write',
        ),
      },
    });
  }));

  const createLegacyPerson = createMutatingRoute(idempotencyService, async (req) => {
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const timestamp = now();
    const { parsed } = req.personCreateCommand;
    const { personId, employment, doc } = buildPersonCreateDocument(
      req.personCreateCommand,
      req.context,
      timestamp,
    );
    const ref = db.doc(`orgs/${tenantId}/persons/${personId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        throw createHttpError(409, `이미 명부에 있는 인력입니다: ${parsed.name}`, 'person_already_exists');
      }
      tx.set(ref, doc);
    });

    await auditChainService.append({
      tenantId,
      entityType: 'person',
      entityId: personId,
      action: 'CREATE',
      actorId,
      actorRole,
      actorEmailEnc: await encryptAuditEmail(piiProtector, actorEmail),
      requestId,
      details: `인력 등록: ${parsed.name} (${employment.type})`,
      metadata: { source: 'bff', employmentType: employment.type, startDate: employment.startDate },
      timestamp,
    });

    return { status: 201, body: { person: doc } };
  });

  const createPersonWithProfile = asyncHandler(async (req, res) => {
    const { tenantId, actorId, actorRole, actorEmail, requestId, idempotencyKey } = req.context;
    const { parsed } = req.personCreateCommand;
    const timestamp = now();
    const requestFingerprint = buildRequestFingerprint({
      method: req.method,
      path: req.path,
      body: req.body,
    });
    const { personId, employment, doc } = buildPersonCreateDocument(
      req.personCreateCommand,
      req.context,
      timestamp,
    );
    const ref = db.doc(`orgs/${tenantId}/persons/${personId}`);

    const result = await db.runTransaction(async (tx) => {
      const lock = await idempotencyService.checkInTransaction(tx, {
        tenantId,
        idempotencyKey,
        requestFingerprint,
        actorId,
        nowDate: new Date(timestamp),
      });
      if (lock.mode === 'replay') {
        const replayPersonId = lock.body?.personId || lock.body?.person?.personId || personId;
        const replayRef = db.doc(`orgs/${tenantId}/persons/${replayPersonId}`);
        const replaySnapshot = await tx.get(replayRef);
        if (!replaySnapshot.exists) {
          throw createHttpError(404, '명부에 없는 인력입니다.', 'person_not_found');
        }
        return {
          replayed: true,
          status: lock.status,
          body: {
            person: serializePersonDirectoryItem(replaySnapshot.data() || {}),
            professionalProfile: {
              revision: lock.body?.revision ?? lock.body?.professionalProfile?.revision ?? 1,
              changed: lock.body?.changed ?? lock.body?.professionalProfile?.changed ?? true,
            },
          },
        };
      }
      const lockError = idempotencyError(lock);
      if (lockError) throw lockError;

      const snap = await tx.get(ref);
      if (snap.exists) {
        throw createHttpError(409, `이미 명부에 있는 인력입니다: ${parsed.name}`, 'person_already_exists');
      }

      const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
      const auditEntries = [{
        tenantId,
        entityType: 'person',
        entityId: personId,
        action: 'CREATE',
        actorId,
        actorRole,
        actorEmailEnc,
        requestId,
        details: `인력 등록: ${parsed.name} (${employment.type})`,
        metadata: {
          source: 'bff',
          employmentType: employment.type,
          startDate: employment.startDate,
        },
        timestamp,
      }];
      if (req.personCreateCommand.includesProfile) {
        auditEntries.push({
          tenantId,
          entityType: 'person',
          entityId: personId,
          action: 'PROFILE_UPDATE',
          actorId,
          actorRole,
          actorEmailEnc,
          requestId,
          details: '전문 프로필 등록',
          metadata: {
            source: 'bff',
            fields: ['educationRecords', 'englishEvidence', 'certifications'],
            previousRevision: 0,
            nextRevision: 1,
          },
          timestamp,
        });
      }
      await auditChainService.appendManyInTransaction(tx, auditEntries);
      tx.set(ref, doc);
      const revision = req.personCreateCommand.includesProfile ? 1 : 0;
      const changed = req.personCreateCommand.includesProfile;
      const body = {
        person: serializePersonDirectoryItem(doc),
        professionalProfile: { revision, changed },
      };
      const receipt = { personId, revision, changed };
      idempotencyService.completeInTransaction(tx, {
        ref: lock.ref,
        tenantId,
        idempotencyKey,
        requestFingerprint,
        responseStatus: 201,
        responseBody: receipt,
        actorId,
        requestId,
        method: req.method,
        path: req.path,
        nowDate: new Date(timestamp),
      });
      return { replayed: false, status: 201, body };
    });

    if (result.replayed) res.setHeader('x-idempotency-replayed', '1');
    res.status(result.status).json(result.body);
  });

  app.post(
    '/api/v1/persons',
    preventPersonCaching,
    preparePersonCreate(rbacPolicy),
    (req, res, next) => (req.personCreateCommand.profileProvided
      ? createPersonWithProfile(req, res, next)
      : createLegacyPerson(req, res, next)),
  );

  app.post('/api/v1/persons/:personId/employments', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.personWrite, 'change a person employment');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { personId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(personEmploymentSchema, req.body, 'Invalid employment payload');

    const ref = db.doc(`orgs/${tenantId}/persons/${personId}`);
    const result = await db.runTransaction(async (tx) => {
      const person = readPerson(await tx.get(ref));
      if (!person) {
        throw createHttpError(404, `명부에 없는 인력입니다: ${personId}`, 'person_not_found');
      }
      const employments = applyEmploymentChange(person.employments, { ...parsed, id: randomUUID() });
      tx.set(ref, { employments, updatedAt: timestamp, updatedBy: actorId }, { merge: true });
      return { before: person.employments, after: employments };
    });

    await auditChainService.append({
      tenantId,
      entityType: 'person',
      entityId: personId,
      action: parsed.mode === 'add' ? 'EMPLOYMENT_ADD' : 'EMPLOYMENT_CHANGE',
      actorId,
      actorRole,
      actorEmailEnc: await encryptAuditEmail(piiProtector, actorEmail),
      requestId,
      details: `계약 ${parsed.mode === 'add' ? '추가' : '변경'}: ${parsed.type} / ${parsed.state} (${parsed.effectiveFrom}부터)`,
      metadata: {
        source: 'bff',
        mode: parsed.mode,
        effectiveFrom: parsed.effectiveFrom,
        reason: (parsed.note || '').trim() || null,
        previousCount: result.before.length,
        nextCount: result.after.length,
      },
      timestamp,
    });

    return { status: 200, body: { personId, employments: result.after, updatedAt: timestamp } };
  }));

  app.patch('/api/v1/persons/:personId', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.personWrite, 'update a person profile');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { personId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(personProfileSchema, req.body, 'Invalid person profile payload');

    const ref = db.doc(`orgs/${tenantId}/persons/${personId}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw createHttpError(404, `명부에 없는 인력입니다: ${personId}`, 'person_not_found');
      }
      tx.set(ref, { ...parsed, updatedAt: timestamp, updatedBy: actorId }, { merge: true });
    });

    await auditChainService.append({
      tenantId,
      entityType: 'person',
      entityId: personId,
      action: 'PROFILE_UPDATE',
      actorId,
      actorRole,
      actorEmailEnc: await encryptAuditEmail(piiProtector, actorEmail),
      requestId,
      details: `인력 정보 수정: ${Object.keys(parsed).join(', ')}`,
      metadata: { source: 'bff', fields: Object.keys(parsed) },
      timestamp,
    });

    return { status: 200, body: { personId, updatedAt: timestamp } };
  }));
}
