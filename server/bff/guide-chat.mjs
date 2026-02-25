import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_GUIDE_CHARS = 500_000;
const MAX_ANSWER_TOKENS = 4096;
const MAX_CALIBRATION_TURNS = 6; // 3 user + 3 assistant

const ALL_ROLES = ['admin', 'tenant_admin', 'finance', 'pm', 'viewer', 'auditor', 'support', 'security'];
const ADMIN_ROLES = ['admin', 'tenant_admin'];

function createHttpError(statusCode, message, code = 'request_error') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

let _anthropic = null;
function getClient() {
  if (!_anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw createHttpError(503, 'ANTHROPIC_API_KEY is not configured');
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

function guideDocPath(tenantId, guideId) {
  return `orgs/${tenantId}/guide_documents/${guideId}`;
}

function guideQaPath(tenantId, qaId) {
  return `orgs/${tenantId}/guide_qa/${qaId}`;
}

async function getLatestGuide(db, tenantId) {
  const snap = await db.collection(`orgs/${tenantId}/guide_documents`)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data();
}

// ── 캘리브레이션 시스템 프롬프트 ──
function buildCalibrationSystem(content) {
  return [
    '당신은 MYSC 사업비 가이드 분석 어시스턴트입니다.',
    '아래 가이드 문서를 분석하고, 관리자의 질문에 정확하게 답변하세요.',
    '모호하거나 불명확한 부분이 있으면 솔직하게 알려주세요.',
    '답변은 한국어로, 명확하고 간결하게 작성하세요.',
    '',
    '=== 사업비 가이드 원문 ===',
    content,
  ].join('\n');
}

// ── Q&A 시스템 프롬프트 (원문 + 캘리브레이션 요약) ──
function buildQaSystem(content, calibrationSummary) {
  const parts = [
    '당신은 MYSC 사업비 가이드 전문 Q&A 어시스턴트입니다.',
    '아래 제공된 가이드 문서와 보충 설명을 기반으로 질문에 정확하게 답변하세요.',
    '가이드에 없는 내용이라면 "가이드 문서에 해당 내용이 없습니다"라고 솔직하게 답변하세요.',
    '답변은 한국어로, 명확하고 간결하게 작성하세요.',
    '',
    '=== 사업비 가이드 원문 ===',
    content,
  ];
  if (calibrationSummary) {
    parts.push('', '=== 관리자 보충 설명 (캘리브레이션) ===', calibrationSummary);
  }
  return parts.join('\n');
}

/**
 * Mount guide-chat routes onto the Express app.
 * Called inside createBffApp() after the API context middleware.
 */
export function mountGuideChatRoutes(app, { db, now, idempotencyService, asyncHandler, createMutatingRoute, assertActorRoleAllowed }) {

  // ── POST /api/v1/guide/upload ── Admin uploads guide text
  app.post('/api/v1/guide/upload', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ADMIN_ROLES, 'upload guide document');
    const { tenantId, actorId, actorEmail } = req.context;
    const { title, content, sourceType, sourceFileName } = req.body || {};

    if (!title?.trim()) throw createHttpError(400, 'title is required');
    if (!content?.trim()) throw createHttpError(400, 'content is required');
    if (content.length > MAX_GUIDE_CHARS) throw createHttpError(400, `content exceeds ${MAX_GUIDE_CHARS} characters`);

    const timestamp = now();
    const guideId = `guide_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
    const doc = {
      id: guideId,
      tenantId,
      title: title.trim(),
      content: content.trim(),
      sourceType: sourceType || 'text',
      sourceFileName: sourceFileName || null,
      charCount: content.trim().length,
      status: 'CALIBRATING',
      calibrationMessages: [],
      calibrationSummary: null,
      uploadedBy: actorId,
      uploadedByName: actorEmail || actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await db.doc(guideDocPath(tenantId, guideId)).set(doc);
    return { status: 201, body: { id: guideId, charCount: doc.charCount, status: doc.status } };
  }));

  // ── POST /api/v1/guide/calibrate ── Admin multi-turn calibration
  app.post('/api/v1/guide/calibrate', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ADMIN_ROLES, 'calibrate guide');
    const { tenantId } = req.context;
    const { guideId, message } = req.body || {};

    if (!message?.trim()) throw createHttpError(400, 'message is required');
    if (message.trim().length > 2000) throw createHttpError(400, 'message too long (max 2000 chars)');

    // Load guide
    let guideDoc;
    if (guideId) {
      const snap = await db.doc(guideDocPath(tenantId, guideId)).get();
      if (!snap.exists) throw createHttpError(404, 'Guide not found');
      guideDoc = snap.data();
    } else {
      guideDoc = await getLatestGuide(db, tenantId);
      if (!guideDoc) throw createHttpError(404, 'No guide uploaded yet');
    }

    if (guideDoc.status !== 'CALIBRATING') {
      throw createHttpError(400, 'Guide is already finalized. Upload a new guide to recalibrate.');
    }

    const existingMessages = guideDoc.calibrationMessages || [];
    if (existingMessages.length >= MAX_CALIBRATION_TURNS) {
      throw createHttpError(400, `Maximum calibration turns (${MAX_CALIBRATION_TURNS / 2}) reached. Please finalize.`);
    }

    // Build messages for Claude (convert to API format)
    const apiMessages = existingMessages.map(m => ({ role: m.role, content: m.content }));
    apiMessages.push({ role: 'user', content: message.trim() });

    // Call Claude
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_ANSWER_TOKENS,
      temperature: 0.2,
      system: buildCalibrationSystem(guideDoc.content),
      messages: apiMessages,
    });

    const answer = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const timestamp = now();
    const updatedMessages = [
      ...existingMessages,
      { role: 'user', content: message.trim(), timestamp },
      { role: 'assistant', content: answer, timestamp },
    ];

    await db.doc(guideDocPath(tenantId, guideDoc.id)).update({
      calibrationMessages: updatedMessages,
      updatedAt: timestamp,
    });

    return {
      status: 200,
      body: {
        answer,
        turnCount: updatedMessages.filter(m => m.role === 'user').length,
        maxTurns: MAX_CALIBRATION_TURNS / 2,
        guideId: guideDoc.id,
      },
    };
  }));

  // ── POST /api/v1/guide/finalize ── Summarize calibration + mark READY
  app.post('/api/v1/guide/finalize', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ADMIN_ROLES, 'finalize guide');
    const { tenantId } = req.context;
    const { guideId } = req.body || {};

    let guideDoc;
    if (guideId) {
      const snap = await db.doc(guideDocPath(tenantId, guideId)).get();
      if (!snap.exists) throw createHttpError(404, 'Guide not found');
      guideDoc = snap.data();
    } else {
      guideDoc = await getLatestGuide(db, tenantId);
      if (!guideDoc) throw createHttpError(404, 'No guide uploaded yet');
    }

    if (guideDoc.status === 'READY') {
      return { status: 200, body: { id: guideDoc.id, status: 'READY', message: 'Already finalized' } };
    }

    const messages = guideDoc.calibrationMessages || [];
    let calibrationSummary = null;

    // If there were calibration conversations, generate a summary
    if (messages.length > 0) {
      const client = getClient();
      const summaryMessages = messages.map(m => ({ role: m.role, content: m.content }));
      summaryMessages.push({
        role: 'user',
        content: '지금까지의 대화를 바탕으로, 원본 가이드 문서에 대한 보충 설명과 명확히 한 사항들을 간결하게 요약해주세요. 이 요약은 향후 Q&A 응답 시 참고 자료로 사용됩니다.',
      });

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_ANSWER_TOKENS,
        temperature: 0.1,
        system: buildCalibrationSystem(guideDoc.content),
        messages: summaryMessages,
      });

      calibrationSummary = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
    }

    const timestamp = now();
    await db.doc(guideDocPath(tenantId, guideDoc.id)).update({
      status: 'READY',
      calibrationSummary,
      updatedAt: timestamp,
    });

    return {
      status: 200,
      body: { id: guideDoc.id, status: 'READY', hasSummary: !!calibrationSummary },
    };
  }));

  // ── GET /api/v1/guide/current ── Get latest guide metadata
  app.get('/api/v1/guide/current', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ALL_ROLES, 'read guide');
    const { tenantId } = req.context;
    const guideDoc = await getLatestGuide(db, tenantId);

    if (!guideDoc) {
      res.status(200).json({ guide: null });
      return;
    }

    // Return metadata only (not full content)
    res.status(200).json({
      guide: {
        id: guideDoc.id,
        title: guideDoc.title,
        status: guideDoc.status,
        sourceType: guideDoc.sourceType,
        sourceFileName: guideDoc.sourceFileName,
        charCount: guideDoc.charCount,
        calibrationTurns: (guideDoc.calibrationMessages || []).filter(m => m.role === 'user').length,
        hasCalibrationSummary: !!guideDoc.calibrationSummary,
        uploadedByName: guideDoc.uploadedByName,
        createdAt: guideDoc.createdAt,
        updatedAt: guideDoc.updatedAt,
      },
    });
  }));

  // ── POST /api/v1/guide/ask ── Q&A from fixed context (원문 + calibration summary)
  app.post('/api/v1/guide/ask', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ALL_ROLES, 'ask guide question');
    const { tenantId, actorId, actorRole, actorEmail } = req.context;
    const { question, guideId } = req.body || {};

    if (!question?.trim()) throw createHttpError(400, 'question is required');
    if (question.trim().length > 2000) throw createHttpError(400, 'question too long (max 2000 chars)');

    // Load guide
    let guideDoc;
    if (guideId) {
      const snap = await db.doc(guideDocPath(tenantId, guideId)).get();
      if (!snap.exists) throw createHttpError(404, 'Guide not found');
      guideDoc = snap.data();
    } else {
      guideDoc = await getLatestGuide(db, tenantId);
      if (!guideDoc) throw createHttpError(404, 'No guide uploaded yet');
    }

    if (guideDoc.status !== 'READY') {
      throw createHttpError(400, 'Guide is still being calibrated. Please wait for admin to finalize.');
    }

    // Call Claude with fixed context: 원문 + calibration summary
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_ANSWER_TOKENS,
      temperature: 0.2,
      system: buildQaSystem(guideDoc.content, guideDoc.calibrationSummary),
      messages: [{ role: 'user', content: question.trim() }],
    });

    const answer = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    // Save Q&A record
    const timestamp = now();
    const qaId = `qa_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.doc(guideQaPath(tenantId, qaId)).set({
      id: qaId,
      tenantId,
      guideId: guideDoc.id,
      question: question.trim(),
      answer,
      askedBy: actorId,
      askedByName: actorEmail || actorId,
      askedByRole: actorRole || 'unknown',
      tokensUsed,
      modelUsed: MODEL,
      createdAt: timestamp,
    });

    return {
      status: 200,
      body: { id: qaId, answer, tokensUsed, guideId: guideDoc.id, guideTitle: guideDoc.title },
    };
  }));

  // ── GET /api/v1/guide/qa ── Q&A history
  app.get('/api/v1/guide/qa', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ALL_ROLES, 'read guide Q&A');
    const { tenantId } = req.context;
    const limitRaw = Number.parseInt(String(req.query.limit || '50'), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;

    const snap = await db.collection(`orgs/${tenantId}/guide_qa`)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    const items = snap.docs.map(d => d.data());
    res.status(200).json({ items, count: items.length });
  }));
}
