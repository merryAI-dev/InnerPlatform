import { randomUUID } from 'node:crypto';
import {
  asyncHandler, createMutatingRoute, assertActorRoleAllowed,
  ROUTE_ROLES, createHttpError, encryptAuditEmail,
} from '../bff-utils.mjs';
import { parseWithSchema, personCreateSchema, personEmploymentSchema, personProfileSchema } from '../schemas.mjs';

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

export function mountPersonRoutes(app, {
  db, now, idempotencyService, auditChainService, piiProtector,
}) {
  app.get('/api/v1/persons', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read the people directory');
    const { tenantId } = req.context;
    const snap = await db.collection(`orgs/${tenantId}/persons`).get();
    const items = snap.docs
      .map((doc) => readPerson(doc))
      .filter(Boolean)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
    res.status(200).json({ items, total: items.length });
  }));

  app.post('/api/v1/persons', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.personWrite, 'create a person');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(personCreateSchema, req.body, 'Invalid person payload');

    const personId = parsed.personId
      || `psn-x-${String(parsed.name).replace(/[()\s/]/g, '')}${String(parsed.nickname || '').replace(/[()\s/]/g, '')}`;
    const ref = db.doc(`orgs/${tenantId}/persons/${personId}`);

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
  }));

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
