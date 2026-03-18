import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_PROJECT_REQUEST_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1800;
const MAX_TEXT_CHARS = 18000;

function nowIso() {
  return new Date().toISOString();
}

function readOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWhitespace(value) {
  return readOptionalText(String(value ?? '')).replace(/\s+/g, ' ').trim();
}

function truncateText(value, maxLength = MAX_TEXT_CHARS) {
  const normalized = readOptionalText(value);
  if (!normalized) return '';
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function emptyTextSuggestion() {
  return { value: '', confidence: 'low', evidence: '' };
}

function emptyNumberSuggestion() {
  return { value: null, confidence: 'low', evidence: '' };
}

function stripPdfExtension(fileName) {
  return readOptionalText(fileName).replace(/\.pdf$/i, '');
}

function sanitizeProjectName(value) {
  const normalized = normalizeWhitespace(value)
    .replace(/[()[\]{}]/g, ' ')
    .replace(/(계약서|협약서|용역|과업|운영|계약|협약|사업)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.replace(/\s+/g, '').slice(0, 10);
}

function sanitizeOfficialContractName(value) {
  const normalized = normalizeWhitespace(value)
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  const stripped = normalized
    .replace(/\s*(계약서|협약서|제안서|합의서|신청서|확인서|각서|문서)(\s*(초안|사본|원본|최종본|최종))?\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || normalized;
}

function normalizeDate(value) {
  const normalized = readOptionalText(value).replace(/\s+/g, '');
  if (!normalized) return '';

  const patterns = [
    /(\d{4})[.\-/년](\d{1,2})[.\-/월](\d{1,2})일?/,
    /(\d{4})(\d{2})(\d{2})/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const year = Number.parseInt(match[1], 10);
    const month = Number.parseInt(match[2], 10);
    const day = Number.parseInt(match[3], 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) continue;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return '';
}

function parseCurrency(value) {
  const digits = readOptionalText(value).replace(/[^0-9.-]/g, '');
  if (!digits) return null;
  const parsed = Number.parseFloat(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractByPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = normalizeWhitespace(match[1] || '');
    if (value) {
      return {
        value,
        evidence: normalizeWhitespace(match[0] || value),
      };
    }
  }
  return null;
}

function extractDateRange(text) {
  const rangePatterns = [
    /(\d{4}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}일?)\s*(?:~|부터|[-–])\s*(\d{4}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}일?)/,
  ];
  for (const pattern of rangePatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const start = normalizeDate(match[1]);
    const end = normalizeDate(match[2]);
    if (start || end) {
      return {
        start,
        end,
        evidence: normalizeWhitespace(match[0] || ''),
      };
    }
  }
  return null;
}

function buildHeuristicTextSuggestion(value, evidence, confidence = 'medium') {
  return {
    value: normalizeWhitespace(value),
    confidence,
    evidence: normalizeWhitespace(evidence || value),
  };
}

function buildHeuristicNumberSuggestion(value, evidence, confidence = 'medium') {
  return {
    value: typeof value === 'number' && Number.isFinite(value) ? value : null,
    confidence,
    evidence: normalizeWhitespace(evidence),
  };
}

function buildFallbackProjectRequestContractAnalysis(input, timestamp = nowIso()) {
  const fileName = stripPdfExtension(input?.fileName || '');
  const documentText = truncateText(input?.documentText || '');
  const condensedText = documentText.replace(/\n+/g, ' ');
  const firstParagraph = normalizeWhitespace(documentText.split(/\n{2,}/)[0] || documentText.slice(0, 300));

  const officialContractMatch = extractByPatterns(documentText, [
    /(?:계약명|계약서명|사업명|용역명|과업명)\s*[:：]?\s*([^\n]{4,80})/,
  ]) || extractByPatterns(condensedText, [
    /([가-힣A-Za-z0-9\s()\-·]+(?:계약|협약|용역|과업)[가-힣A-Za-z0-9\s()\-·]{0,20})/,
  ]);
  const clientOrgMatch = extractByPatterns(documentText, [
    /(?:발주기관|발주처|수요기관|계약상대자|계약 대상)\s*[:：]?\s*([^\n]{2,60})/,
    /(?:갑)\s*[:：]?\s*([^\n]{2,60})/,
  ]);
  const purposeMatch = extractByPatterns(documentText, [
    /(?:사업 목적|과업 목적|목적)\s*[:：]?\s*([^\n]{10,200})/,
  ]);
  const descriptionMatch = extractByPatterns(documentText, [
    /(?:주요 내용|사업 내용|과업 내용|수행 내용)\s*[:：]?\s*([^\n]{10,260})/,
  ]);
  const contractAmountMatch = extractByPatterns(condensedText, [
    /(?:총\s*계약금액|계약금액|총액)\s*[:：]?\s*([0-9,]+)\s*원/,
    /([0-9,]+)\s*원\s*(?:정|부가세 포함|계약금액)/,
  ]);
  const salesVatMatch = extractByPatterns(condensedText, [
    /(?:매출\s*부가세|부가세|부가가치세|VAT)\s*[:：]?\s*([0-9,]+)\s*원/i,
  ]);
  const dateRange = extractDateRange(documentText);

  const rawOfficialContractName = officialContractMatch?.value || fileName;
  const officialContractName = sanitizeOfficialContractName(rawOfficialContractName);
  const suggestedProjectName = sanitizeProjectName(officialContractName || fileName);
  const warnings = [];
  const nextActions = [];

  if (documentText.length < 120) {
    warnings.push('PDF에서 추출된 텍스트가 적습니다. 스캔본이면 사람이 직접 기본 정보를 한 번 더 확인하는 것이 안전합니다.');
  }
  if (!officialContractMatch?.value) {
    warnings.push('공식 계약명은 파일명 기준 초안입니다. 계약서 상의 공식 명칭과 같은지 확인해 주세요.');
  }
  if (!contractAmountMatch?.value) {
    warnings.push('계약금액은 문서에서 확실히 읽히지 않았습니다. 사람이 직접 입력해 주세요.');
  }

  nextActions.push('계약서 초안을 확인한 뒤, 담당팀·정산유형·통장 유형은 사람이 직접 선택해 주세요.');
  nextActions.push('등록 프로젝트명은 10자 이내 별칭이라서 공식 계약명과 다를 수 있습니다. 팀에서 쓰는 짧은 이름으로 조정해 주세요.');

  return {
    provider: 'heuristic',
    model: 'deterministic-fallback',
    summary: officialContractName
      ? `계약서에서 "${officialContractName}" 중심의 초안을 만들었습니다. 금액·기간·계약 대상은 계약서 원문과 한 번 더 대조하는 것이 안전합니다.`
      : '계약서에서 기본 정보를 일부 추출했습니다. 사람이 주요 항목을 한 번 더 확인해 주세요.',
    warnings,
    nextActions,
    extractedAt: timestamp,
    fields: {
      officialContractName: buildHeuristicTextSuggestion(
        officialContractName,
        officialContractMatch?.evidence || fileName,
        officialContractMatch?.value ? 'medium' : 'low',
      ),
      suggestedProjectName: buildHeuristicTextSuggestion(
        suggestedProjectName,
        officialContractName || fileName,
        suggestedProjectName ? 'medium' : 'low',
      ),
      clientOrg: buildHeuristicTextSuggestion(
        clientOrgMatch?.value || '',
        clientOrgMatch?.evidence || '',
        clientOrgMatch?.value ? 'medium' : 'low',
      ),
      projectPurpose: buildHeuristicTextSuggestion(
        purposeMatch?.value || '',
        purposeMatch?.evidence || '',
        purposeMatch?.value ? 'medium' : 'low',
      ),
      description: buildHeuristicTextSuggestion(
        descriptionMatch?.value || firstParagraph,
        descriptionMatch?.evidence || firstParagraph,
        descriptionMatch?.value ? 'medium' : firstParagraph ? 'low' : 'low',
      ),
      contractStart: buildHeuristicTextSuggestion(
        dateRange?.start || '',
        dateRange?.evidence || '',
        dateRange?.start ? 'medium' : 'low',
      ),
      contractEnd: buildHeuristicTextSuggestion(
        dateRange?.end || '',
        dateRange?.evidence || '',
        dateRange?.end ? 'medium' : 'low',
      ),
      contractAmount: buildHeuristicNumberSuggestion(
        parseCurrency(contractAmountMatch?.value),
        contractAmountMatch?.evidence || '',
        contractAmountMatch?.value ? 'medium' : 'low',
      ),
      salesVatAmount: buildHeuristicNumberSuggestion(
        parseCurrency(salesVatMatch?.value),
        salesVatMatch?.evidence || '',
        salesVatMatch?.value ? 'medium' : 'low',
      ),
    },
  };
}

let _anthropic = null;
function getClient() {
  if (!_anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

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

function sanitizeConfidence(value, fallback = 'medium') {
  return value === 'high' || value === 'medium' || value === 'low' ? value : fallback;
}

function sanitizeTextSuggestion(value, fallback) {
  if (!value || typeof value !== 'object') return fallback;
  return {
    value: normalizeWhitespace(value.value || fallback.value),
    confidence: sanitizeConfidence(readOptionalText(value.confidence), fallback.confidence),
    evidence: normalizeWhitespace(value.evidence || fallback.evidence),
  };
}

function sanitizeNumberSuggestion(value, fallback) {
  if (!value || typeof value !== 'object') return fallback;
  const parsed = typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : parseCurrency(value.value);
  return {
    value: parsed,
    confidence: sanitizeConfidence(readOptionalText(value.confidence), fallback.confidence),
    evidence: normalizeWhitespace(value.evidence || fallback.evidence),
  };
}

function sanitizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean)
    .slice(0, 6);
}

function buildPrompt(input, fallback) {
  const previewText = truncateText(input.documentText || '');
  const fallbackJson = JSON.stringify(fallback);
  const examplesXml = [
    [
      '<example>',
      '<document_name>뷰티풀커넥트_계약서.pdf</document_name>',
      '<document_excerpt>사업명: 뷰티풀 커넥트 운영 계약 발주기관: 아모레퍼시픽재단 계약기간: 2026.03.01 ~ 2026.12.31 총 계약금액: 120,000,000원 부가세: 12,000,000원 사업 목적: 청년 창업가의 지역 연결을 지원한다.</document_excerpt>',
      '<ideal_json>{"summary":"계약서 주요 항목을 읽어 기본 정보를 채울 수 있습니다.","warnings":[],"nextActions":["담당팀과 정산유형은 사람이 직접 선택하세요."],"fields":{"officialContractName":{"value":"뷰티풀 커넥트 운영 계약","confidence":"high","evidence":"사업명: 뷰티풀 커넥트 운영 계약서"},"suggestedProjectName":{"value":"뷰티풀커넥트","confidence":"high","evidence":"뷰티풀 커넥트 운영 계약"},"clientOrg":{"value":"아모레퍼시픽재단","confidence":"high","evidence":"발주기관: 아모레퍼시픽재단"},"projectPurpose":{"value":"청년 창업가의 지역 연결을 지원한다.","confidence":"high","evidence":"사업 목적: 청년 창업가의 지역 연결을 지원한다."},"description":{"value":"","confidence":"low","evidence":""},"contractStart":{"value":"2026-03-01","confidence":"high","evidence":"계약기간: 2026.03.01 ~ 2026.12.31"},"contractEnd":{"value":"2026-12-31","confidence":"high","evidence":"계약기간: 2026.03.01 ~ 2026.12.31"},"contractAmount":{"value":120000000,"confidence":"high","evidence":"총 계약금액: 120,000,000원"},"salesVatAmount":{"value":12000000,"confidence":"high","evidence":"부가세: 12,000,000원"}}}</ideal_json>',
      '</example>',
    ].join('\n'),
    [
      '<example>',
      '<document_name>scan_only_contract.pdf</document_name>',
      '<document_excerpt></document_excerpt>',
      '<ideal_json>{"summary":"텍스트 추출이 거의 없어 사람 확인이 필요합니다.","warnings":["스캔본이면 공식 계약명과 금액을 직접 확인하세요."],"nextActions":["계약서 원문을 보고 기본 정보를 직접 보완하세요."],"fields":{"officialContractName":{"value":"scan_only_contract","confidence":"low","evidence":"파일명"},"suggestedProjectName":{"value":"scanonlyco","confidence":"low","evidence":"파일명"},"clientOrg":{"value":"","confidence":"low","evidence":""},"projectPurpose":{"value":"","confidence":"low","evidence":""},"description":{"value":"","confidence":"low","evidence":""},"contractStart":{"value":"","confidence":"low","evidence":""},"contractEnd":{"value":"","confidence":"low","evidence":""},"contractAmount":{"value":null,"confidence":"low","evidence":""},"salesVatAmount":{"value":null,"confidence":"low","evidence":""}}}</ideal_json>',
      '</example>',
    ].join('\n'),
  ].join('\n');

  return [
    '<role>',
    '당신은 MYSC 사업관리 플랫폼의 계약서 초안 추출 assistant 입니다.',
    '계약서에서 사업 등록 제안 폼의 기본값을 보수적으로 추출합니다.',
    '</role>',
    '<success_criteria>',
    '사용자가 계약서를 업로드한 뒤 바로 검토할 수 있는 초안을 만듭니다.',
    '모호하면 빈 값 또는 낮은 confidence를 사용하세요.',
    '반드시 한국어 JSON만 반환하세요.',
    '</success_criteria>',
    '<field_rules>',
    '<rule>officialContractName은 계약서 상의 공식 명칭입니다.</rule>',
    '<rule>officialContractName에서는 협약서, 계약서, 제안서처럼 문서 형식/종류를 나타내는 단어를 제외합니다.</rule>',
    '<rule>suggestedProjectName은 내부 등록용 10자 이내 짧은 이름입니다.</rule>',
    '<rule>department, settlementType, accountType은 추측하지 않습니다.</rule>',
    '<rule>날짜는 YYYY-MM-DD 형식입니다.</rule>',
    '<rule>금액은 숫자만 반환합니다.</rule>',
    '</field_rules>',
    '<output_schema>',
    '{"summary":"string","warnings":["string"],"nextActions":["string"],"fields":{"officialContractName":{"value":"string","confidence":"high|medium|low","evidence":"string"},"suggestedProjectName":{"value":"string","confidence":"high|medium|low","evidence":"string"},"clientOrg":{"value":"string","confidence":"high|medium|low","evidence":"string"},"projectPurpose":{"value":"string","confidence":"high|medium|low","evidence":"string"},"description":{"value":"string","confidence":"high|medium|low","evidence":"string"},"contractStart":{"value":"YYYY-MM-DD or empty","confidence":"high|medium|low","evidence":"string"},"contractEnd":{"value":"YYYY-MM-DD or empty","confidence":"high|medium|low","evidence":"string"},"contractAmount":{"value":"number|null","confidence":"high|medium|low","evidence":"string"},"salesVatAmount":{"value":"number|null","confidence":"high|medium|low","evidence":"string"}}}',
    '</output_schema>',
    '<examples>',
    examplesXml,
    '</examples>',
    '<fallback_reference>',
    fallbackJson,
    '</fallback_reference>',
    '<document_name>',
    readOptionalText(input.fileName) || 'contract.pdf',
    '</document_name>',
    '<document_excerpt>',
    previewText,
    '</document_excerpt>',
  ].join('\n');
}

function sanitizeAnalysis(value, fallback, timestamp = nowIso()) {
  const raw = value && typeof value === 'object' ? value : {};
  const officialContractName = sanitizeTextSuggestion(raw.fields?.officialContractName, fallback.fields.officialContractName);
  officialContractName.value = sanitizeOfficialContractName(officialContractName.value);
  const suggestedProjectName = sanitizeTextSuggestion(raw.fields?.suggestedProjectName, fallback.fields.suggestedProjectName);
  if (!suggestedProjectName.value) {
    suggestedProjectName.value = sanitizeProjectName(officialContractName.value);
  }
  return {
    provider: 'anthropic',
    model: MODEL,
    summary: normalizeWhitespace(raw.summary || fallback.summary),
    warnings: sanitizeStringArray(raw.warnings, fallback.warnings),
    nextActions: sanitizeStringArray(raw.nextActions, fallback.nextActions),
    extractedAt: timestamp,
    fields: {
      officialContractName,
      suggestedProjectName,
      clientOrg: sanitizeTextSuggestion(raw.fields?.clientOrg, fallback.fields.clientOrg),
      projectPurpose: sanitizeTextSuggestion(raw.fields?.projectPurpose, fallback.fields.projectPurpose),
      description: sanitizeTextSuggestion(raw.fields?.description, fallback.fields.description),
      contractStart: sanitizeTextSuggestion(raw.fields?.contractStart, fallback.fields.contractStart),
      contractEnd: sanitizeTextSuggestion(raw.fields?.contractEnd, fallback.fields.contractEnd),
      contractAmount: sanitizeNumberSuggestion(raw.fields?.contractAmount, fallback.fields.contractAmount),
      salesVatAmount: sanitizeNumberSuggestion(raw.fields?.salesVatAmount, fallback.fields.salesVatAmount),
    },
  };
}

export function createProjectRequestContractAiService(options = {}) {
  const timestamp = options.now || nowIso;

  return {
    async analyzeContract(input) {
      const fallback = buildFallbackProjectRequestContractAnalysis(input, timestamp());
      const client = getClient();
      if (!client) return fallback;

      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          messages: [{
            role: 'user',
            content: buildPrompt(input, fallback),
          }],
        });

        const rawText = response.content
          .filter((part) => part?.type === 'text')
          .map((part) => part.text)
          .join('\n');
        const parsed = extractJson(rawText);
        if (!parsed) return fallback;
        return sanitizeAnalysis(parsed, fallback, timestamp());
      } catch (error) {
        console.error('[project-request-contract-ai] anthropic analyze failed:', error);
        return fallback;
      }
    },
  };
}

export {
  buildFallbackProjectRequestContractAnalysis,
  sanitizeOfficialContractName,
  sanitizeProjectName,
};
