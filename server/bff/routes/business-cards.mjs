import { createHash } from 'node:crypto';
import {
  asyncHandler,
  createMutatingRoute,
  assertActorPermissionAllowed,
  createHttpError,
  parseLimit,
  parseCursor,
  buildListResponse,
  encryptAuditEmail,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import {
  parseWithSchema,
  businessCardContactUpdateSchema,
  businessCardConfirmSchema,
  businessCardProcessSchema,
  businessCardSearchSchema,
} from '../schemas.mjs';
import {
  assertConfirmableContact,
  buildContactDerivedFields,
  createBusinessCardImportId,
  createContactId,
  normalizeBusinessCardContactPayload,
  normalizeBusinessCardExtraction,
  readOptionalText,
  scoreContactSearchResult,
  tokenizeContactSearchQuery,
} from '../business-card-domain.mjs';

function hashSearchQuery(tenantId, query) {
  const normalized = readOptionalText(query).toLowerCase();
  const salt = `business-card-search:${tenantId}`;
  return createHash('sha256').update(`${salt}:${normalized}`).digest('hex');
}

async function appendAudit({
  auditChainService,
  piiProtector,
  context,
  entityType,
  entityId,
  action,
  details,
  metadata,
  timestamp,
}) {
  if (!auditChainService?.append) return null;
  const actorEmailEnc = await encryptAuditEmail(piiProtector, context.actorEmail);
  return auditChainService.append({
    tenantId: context.tenantId,
    entityType,
    entityId,
    action,
    actorId: context.actorId,
    actorRole: context.actorRole,
    actorEmailEnc,
    requestId: context.requestId,
    details,
    metadata,
    timestamp,
  });
}

function importDocToResponse(doc) {
  return {
    id: doc.id,
    status: doc.status,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    fileSize: doc.fileSize,
    uploadedBy: doc.uploadedBy,
    uploadedByEmail: doc.uploadedByEmail,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    extracted: doc.extracted || null,
    contactId: doc.contactId || null,
    error: doc.error || null,
  };
}

function contactDocToSearchResult(doc, score = 0) {
  return {
    id: doc.id,
    name: doc.name || '',
    organization: doc.organization || '',
    department: doc.department || '',
    title: doc.title || '',
    role: doc.role || '',
    emails: Array.isArray(doc.emails) ? doc.emails : [],
    phones: Array.isArray(doc.phones) ? doc.phones : [],
    website: doc.website || '',
    address: doc.address || '',
    memo: doc.memo || '',
    score,
    updatedAt: doc.updatedAt || '',
  };
}

export function mountBusinessCardRoutes(app, {
  db,
  now,
  idempotencyService,
  auditChainService,
  piiProtector,
  rbacPolicy,
  businessCardStorageService,
  businessCardGeminiAiService,
}) {
  app.post('/api/v1/business-card-imports/process', createMutatingRoute(idempotencyService, async (req) => {
    assertActorPermissionAllowed(rbacPolicy, req, 'contact:write', 'process business card imports');
    const { tenantId, actorId, actorEmail } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(businessCardProcessSchema, req.body, 'Invalid business card image payload');
    const importId = createBusinessCardImportId();

    const uploaded = await businessCardStorageService.uploadBusinessCard({
      tenantId,
      actorId,
      importId,
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      fileSize: parsed.fileSize,
      contentBase64: parsed.contentBase64,
    });

    const analysis = await businessCardGeminiAiService.analyzeBusinessCard({
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      contentBase64: parsed.contentBase64,
    });

    const extracted = normalizeBusinessCardExtraction(analysis.extracted);
    const status = analysis.status === 'failed' ? 'failed' : 'needs_review';
    const importDoc = stripUndefinedDeep({
      id: importId,
      tenantId,
      status,
      storagePath: uploaded.path,
      fileName: uploaded.name,
      mimeType: uploaded.contentType,
      fileSize: uploaded.size,
      uploadedBy: actorId,
      uploadedByEmail: actorEmail || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      geminiProvider: analysis.provider || 'vertex-ai',
      geminiModel: analysis.model || 'unavailable',
      rawText: extracted.rawText || '',
      extracted,
      error: analysis.error || null,
    });

    await db.doc(`orgs/${tenantId}/business_card_imports/${importId}`).set(importDoc, { merge: true });
    await appendAudit({
      auditChainService,
      piiProtector,
      context: req.context,
      entityType: 'business_card_import',
      entityId: importId,
      action: status === 'failed' ? 'GEMINI_FAILED' : 'PROCESS',
      details: status === 'failed' ? '명함 이미지 업로드 후 Gemini 추출 실패' : '명함 이미지 업로드 및 Gemini 추출 draft 생성',
      metadata: {
        source: 'bff',
        status,
        fileName: uploaded.name,
        fileSize: uploaded.size,
        geminiProvider: importDoc.geminiProvider,
        geminiModel: importDoc.geminiModel,
        errorCode: analysis.error?.code || null,
      },
      timestamp,
    });

    const body = {
      importId,
      status,
      extracted,
      error: analysis.error || null,
    };

    return {
      status: status === 'failed' ? 502 : 200,
      body,
    };
  }));

  app.get('/api/v1/business-card-imports', asyncHandler(async (req, res) => {
    assertActorPermissionAllowed(rbacPolicy, req, 'contact:read', 'list business card imports');
    const { tenantId } = req.context;
    const limit = parseLimit(req.query.limit, 50, 100);
    const cursor = parseCursor(req.query.cursor);
    const statusFilter = readOptionalText(req.query.status);

    let query = db.collection(`orgs/${tenantId}/business_card_imports`);
    if (statusFilter) query = query.where('status', '==', statusFilter);
    query = query.orderBy('__name__').limit(limit);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    const items = snap.docs.map((doc) => importDocToResponse({ id: doc.id, ...(doc.data() || {}) }));
    res.status(200).json(buildListResponse(items, limit));
  }));

  app.post('/api/v1/business-card-imports/:importId/confirm', createMutatingRoute(idempotencyService, async (req) => {
    assertActorPermissionAllowed(rbacPolicy, req, 'contact:write', 'confirm business card imports');
    const { tenantId, actorId } = req.context;
    const importId = readOptionalText(req.params.importId);
    const timestamp = now();
    if (!importId) throw createHttpError(400, 'importId is required', 'missing_import_id');

    const parsed = parseWithSchema(businessCardConfirmSchema, req.body, 'Invalid business card contact payload');
    const contactPayload = normalizeBusinessCardContactPayload(parsed);
    assertConfirmableContact(contactPayload);

    const importRef = db.doc(`orgs/${tenantId}/business_card_imports/${importId}`);
    const contactId = createContactId();
    const result = await db.runTransaction(async (tx) => {
      const importSnap = await tx.get(importRef);
      if (!importSnap.exists) throw createHttpError(404, `Business card import not found: ${importId}`, 'not_found');
      const importDoc = importSnap.data() || {};
      if (importDoc.status === 'saved' && importDoc.contactId) {
        return { contactId: importDoc.contactId, existing: true, importDoc };
      }
      if (importDoc.status !== 'needs_review') {
        throw createHttpError(409, `Business card import is not confirmable: ${importDoc.status || 'unknown'}`, 'import_not_confirmable');
      }

      const storagePath = readOptionalText(importDoc.storagePath);
      if (!storagePath) {
        throw createHttpError(409, 'Business card import image is missing', 'image_missing');
      }

      const contact = stripUndefinedDeep({
        id: contactId,
        tenantId,
        visibility: 'org',
        ...contactPayload,
        sourceImportId: importId,
        imageStoragePath: storagePath,
        ...buildContactDerivedFields(contactPayload),
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      tx.set(db.doc(`orgs/${tenantId}/contacts/${contactId}`), contact, { merge: true });
      tx.set(importRef, {
        status: 'saved',
        contactId,
        updatedAt: timestamp,
        updatedBy: actorId,
      }, { merge: true });
      return { contactId, existing: false, importDoc };
    });

    await appendAudit({
      auditChainService,
      piiProtector,
      context: req.context,
      entityType: 'business_card_import',
      entityId: importId,
      action: 'CONFIRM',
      details: '명함 추출 draft를 연락처로 저장',
      metadata: {
        source: 'bff',
        contactId: result.contactId,
        existing: result.existing,
      },
      timestamp,
    });

    if (!result.existing) {
      await appendAudit({
        auditChainService,
        piiProtector,
        context: req.context,
        entityType: 'contact',
        entityId: result.contactId,
        action: 'CREATE',
        details: `연락처 생성: ${contactPayload.name || contactPayload.organization}`,
        metadata: {
          source: 'business_card_import',
          importId,
          visibility: 'org',
        },
        timestamp,
      });
    }

    return {
      status: result.existing ? 200 : 201,
      body: {
        ok: true,
        importId,
        contactId: result.contactId,
        status: 'saved',
      },
    };
  }));

  app.get('/api/v1/contacts', asyncHandler(async (req, res) => {
    assertActorPermissionAllowed(rbacPolicy, req, 'contact:read', 'search contacts');
    const { tenantId } = req.context;
    const parsed = parseWithSchema(businessCardSearchSchema, {
      query: readOptionalText(req.query.query),
      limit: req.query.limit ? Number.parseInt(String(req.query.limit), 10) : undefined,
      cursor: parseCursor(req.query.cursor),
    }, 'Invalid contact search query');
    const limit = parseLimit(parsed.limit, 20, 100);
    const tokens = tokenizeContactSearchQuery(parsed.query);

    let query = db.collection(`orgs/${tenantId}/contacts`);
    if (tokens[0]) query = query.where('searchTokens', 'array-contains', tokens[0]);
    query = query.orderBy('__name__').limit(Math.max(limit, 50));
    if (parsed.cursor) query = query.startAfter(parsed.cursor);

    const snap = await query.get();
    const nowDate = new Date(now());
    const items = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
      .map((doc) => ({ doc, score: scoreContactSearchResult(doc, parsed.query, nowDate) }))
      .filter((item) => !tokens.length || item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.doc.id).localeCompare(String(b.doc.id)))
      .slice(0, limit)
      .map((item) => contactDocToSearchResult(item.doc, Number(item.score.toFixed(4))));

    await appendAudit({
      auditChainService,
      piiProtector,
      context: req.context,
      entityType: 'contact',
      entityId: 'search',
      action: 'SEARCH',
      details: '연락처 검색',
      metadata: {
        source: 'bff',
        queryHash: hashSearchQuery(tenantId, parsed.query),
        resultCount: items.length,
      },
      timestamp: nowDate.toISOString(),
    });

    res.status(200).json(buildListResponse(items, limit));
  }));

  app.patch('/api/v1/contacts/:contactId', createMutatingRoute(idempotencyService, async (req) => {
    assertActorPermissionAllowed(rbacPolicy, req, 'contact:write', 'update contacts');
    const { tenantId, actorId } = req.context;
    const contactId = readOptionalText(req.params.contactId);
    const timestamp = now();
    if (!contactId) throw createHttpError(400, 'contactId is required', 'missing_contact_id');

    const parsed = parseWithSchema(businessCardContactUpdateSchema, req.body, 'Invalid contact payload');
    const contactPayload = normalizeBusinessCardContactPayload(parsed);
    assertConfirmableContact(contactPayload);

    const contactRef = db.doc(`orgs/${tenantId}/contacts/${contactId}`);
    const updatedDoc = await db.runTransaction(async (tx) => {
      const contactSnap = await tx.get(contactRef);
      if (!contactSnap.exists) throw createHttpError(404, `Contact not found: ${contactId}`, 'not_found');
      const existing = contactSnap.data() || {};
      const nextContact = stripUndefinedDeep({
        ...existing,
        ...contactPayload,
        ...buildContactDerivedFields(contactPayload),
        id: contactId,
        tenantId,
        updatedBy: actorId,
        updatedAt: timestamp,
      });
      tx.set(contactRef, nextContact, { merge: true });
      return nextContact;
    });

    await appendAudit({
      auditChainService,
      piiProtector,
      context: req.context,
      entityType: 'contact',
      entityId: contactId,
      action: 'UPDATE',
      details: `연락처 수정: ${contactPayload.name || contactPayload.organization}`,
      metadata: {
        source: 'business_card_db',
        visibility: updatedDoc.visibility || 'org',
      },
      timestamp,
    });

    return {
      status: 200,
      body: {
        ok: true,
        contact: contactDocToSearchResult(updatedDoc, 1),
      },
    };
  }));

  app.get('/api/v1/business-card-imports/:importId/image', asyncHandler(async (req, res) => {
    assertActorPermissionAllowed(rbacPolicy, req, 'contact:image:read', 'read business card images');
    const { tenantId } = req.context;
    const importId = readOptionalText(req.params.importId);
    if (!importId) throw createHttpError(400, 'importId is required', 'missing_import_id');

    const snap = await db.doc(`orgs/${tenantId}/business_card_imports/${importId}`).get();
    if (!snap.exists) throw createHttpError(404, `Business card import not found: ${importId}`, 'not_found');
    const importDoc = snap.data() || {};
    const storagePath = readOptionalText(importDoc.storagePath);
    if (!storagePath) throw createHttpError(404, 'Business card image is missing', 'image_missing');

    await appendAudit({
      auditChainService,
      piiProtector,
      context: req.context,
      entityType: 'business_card_import',
      entityId: importId,
      action: 'IMAGE_VIEW',
      details: '명함 원본 이미지 조회',
      metadata: {
        source: 'bff',
        contactId: importDoc.contactId || null,
      },
      timestamp: now(),
    });

    res.setHeader('Content-Type', readOptionalText(importDoc.mimeType) || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');

    const stream = businessCardStorageService.createReadStream(storagePath);
    stream.on('error', (error) => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'image_stream_failed', message: error instanceof Error ? error.message : String(error) });
      } else {
        res.destroy(error);
      }
    });
    stream.pipe(res);
  }));
}
