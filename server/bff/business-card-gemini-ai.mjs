import {
  buildEmptyBusinessCardExtraction,
  normalizeBusinessCardExtraction,
  readOptionalText,
} from './business-card-domain.mjs';

const DEFAULT_MODEL = 'gemini-2.5-flash';

function resolveModel(env = process.env) {
  return readOptionalText(env.BUSINESS_CARD_GEMINI_MODEL) || DEFAULT_MODEL;
}

function resolveApiKey(env = process.env) {
  return readOptionalText(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
}

function buildPrompt(fileName) {
  return [
    'You extract contact details from a Korean or bilingual business card image.',
    'Return ONLY valid JSON that matches the response schema. Do not wrap it in Markdown.',
    'Every scalar field must be { value, confidence, evidence }. Arrays must contain the same field objects.',
    'Always include all required top-level keys: name, organization, department, title, role, emails, phones, website, address, memo, rawText, warnings.',
    '',
    'Korean business-card cues:',
    '- Names are often 2-4 Korean syllables near a job title. If Korean and romanized names refer to the same person, put the Korean name in name.value and put the romanized alias in memo.value if useful.',
    '- Organizations may appear as logos or text with cues such as (주), 주식회사, 유한회사, 재단법인, 사단법인, 센터, 연구소, 랩, CIC, 본부, 사업부. Keep the printed language and wording.',
    '- Departments usually contain 팀, 본부, 센터, 실, 부, 랩, CIC, 파트, 그룹. Put these in department.value, not organization.value, when they are internal units.',
    '- title.value is a formal rank/job title: 대표이사, 대표, 이사, 상무, 팀장, 매니저, 책임, 선임, 연구원, 컨설턴트, 프로, 사원, 디렉터, PM.',
    '- role.value is the functional responsibility when visible: 사업담당, 프로젝트 담당, 마케팅, 개발, 파트너십, 운영, 영업.',
    '',
    'Contact extraction rules:',
    '- emails: fix only obvious OCR punctuation/spacing such as full-width ＠ to @, spaces around @, and full-width dots. Do not invent missing email addresses.',
    '- phones: include mobile/tel/direct numbers labelled M, Mobile, 휴대폰, HP, Cell, T, Tel, 전화, Direct. Preserve country code if visible. Do not include fax numbers as phones unless they are the only reachable number; mention visible fax in memo.value or warnings.',
    '- website: capture only a visible website/domain. Do not infer a website from an email domain unless it is printed.',
    '- address: keep the full Korean address in one string, including postal code, building, floor, room, 로/길/동 details if visible.',
    '',
    'Ambiguity and quality:',
    '- Do not infer personal data that is not visible on the card. If you infer from layout only, use low confidence and add a warning.',
    '- Use high confidence only when the value is directly visible and clearly associated with its label or layout.',
    '- Use medium confidence when the value is visible but the label/layout is ambiguous or you applied minor OCR cleanup.',
    '- Use low confidence for partial, uncertain, or layout-inferred values.',
    '- evidence must be a short visible text snippet supporting the value; never use generic labels alone such as Tel, Email, Mobile, Company as evidence.',
    '- rawText should contain visible text lines in approximate reading order.',
    '- If multiple cards or multiple people are visible, extract the largest/most complete/frontmost card and add a warning.',
    '- If front/back or Korean/English duplicate the same card, merge and deduplicate phones/emails.',
    `File name: ${fileName || 'business-card'}`,
  ].join('\n');
}

const extractedFieldSchema = {
  type: 'object',
  properties: {
    value: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence: { type: 'string' },
  },
  required: ['value', 'confidence', 'evidence'],
};

const responseSchema = {
  type: 'object',
  properties: {
    name: extractedFieldSchema,
    organization: extractedFieldSchema,
    department: extractedFieldSchema,
    title: extractedFieldSchema,
    role: extractedFieldSchema,
    emails: { type: 'array', items: extractedFieldSchema },
    phones: { type: 'array', items: extractedFieldSchema },
    website: extractedFieldSchema,
    address: extractedFieldSchema,
    memo: extractedFieldSchema,
    rawText: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'organization', 'department', 'title', 'role', 'emails', 'phones', 'website', 'address', 'memo', 'rawText', 'warnings'],
};

const EXPECTED_RESPONSE_KEYS = [
  'name',
  'organization',
  'department',
  'title',
  'role',
  'emails',
  'phones',
  'website',
  'address',
  'memo',
  'rawText',
  'warnings',
];

function extractJson(text) {
  const raw = readOptionalText(text);
  if (!raw) return null;
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isStructuredExtractionCandidate(value) {
  const presentKeys = value && typeof value === 'object' && !Array.isArray(value)
    ? EXPECTED_RESPONSE_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(value, key))
    : [];
  return Boolean(
    presentKeys.length >= 8
    && ['name', 'organization', 'emails', 'phones'].some((key) => Object.prototype.hasOwnProperty.call(value, key)),
  );
}

function readResponseText(response) {
  if (typeof response?.text === 'string') return response.text;
  if (typeof response?.text === 'function') return response.text();
  return readOptionalText(response?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n'));
}

export function createBusinessCardGeminiAiService(options = {}) {
  const env = options.env || process.env;
  const model = options.model || resolveModel(env);
  const client = options.client || null;
  const importSdk = options.importSdk || (() => import('@google/genai'));
  const configuredProvider = resolveApiKey(env) ? 'gemini-api' : 'vertex-ai';

  async function getClient() {
    if (client) return client;
    const apiKey = resolveApiKey(env);
    if (apiKey) {
      const { GoogleGenAI } = await importSdk();
      return new GoogleGenAI({ apiKey });
    }
    if (String(env.GOOGLE_GENAI_USE_VERTEXAI || '').toLowerCase() !== 'true') return null;
    const { GoogleGenAI } = await importSdk();
    return new GoogleGenAI({
      vertexai: true,
      project: readOptionalText(env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || env.FIREBASE_PROJECT_ID),
      location: readOptionalText(env.GOOGLE_CLOUD_LOCATION) || 'global',
    });
  }

  return {
    async analyzeBusinessCard(input) {
      const fallback = buildEmptyBusinessCardExtraction([
        'Gemini 추출을 사용할 수 없어 수동 검토가 필요합니다.',
      ]);
      let ai;
      try {
        ai = await getClient();
      } catch (error) {
        return {
          provider: configuredProvider,
          model,
          status: 'manual_review',
          extracted: fallback,
          error: {
            code: 'gemini_sdk_unavailable',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }

      if (!ai?.models?.generateContent) {
        return {
          provider: configuredProvider,
          model,
          status: 'manual_review',
          extracted: fallback,
          error: {
            code: 'gemini_not_configured',
            message: 'Vertex AI Gemini is not configured.',
          },
        };
      }

      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { text: buildPrompt(input?.fileName) },
                {
                  inlineData: {
                    mimeType: input?.mimeType || 'image/jpeg',
                    data: input?.contentBase64,
                  },
                },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema,
          },
        });
        const rawText = await readResponseText(response);
        const parsed = extractJson(rawText);
        if (!isStructuredExtractionCandidate(parsed)) {
          return {
            provider: configuredProvider,
            model,
            status: 'manual_review',
            extracted: buildEmptyBusinessCardExtraction([
              'Gemini 응답 형식이 맞지 않아 수동 검토가 필요합니다.',
            ]),
            rawResponseText: rawText,
            error: {
              code: 'gemini_malformed_response',
              message: 'Gemini did not return the expected business-card JSON shape.',
            },
          };
        }
        const extracted = normalizeBusinessCardExtraction(parsed);
        return {
          provider: configuredProvider,
          model,
          status: 'ok',
          extracted,
          rawResponseText: rawText,
        };
      } catch (error) {
        return {
          provider: configuredProvider,
          model,
          status: 'failed',
          extracted: fallback,
          error: {
            code: 'gemini_extract_failed',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}

export {
  buildPrompt,
  responseSchema as businessCardGeminiResponseSchema,
  resolveApiKey,
  resolveModel,
};
