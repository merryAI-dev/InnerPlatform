import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MIGRATION_AI_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const MAX_ANALYSIS_ROWS = 40;
const MAX_ANALYSIS_COLS = 24;
const MAX_CELL_CHARS = 160;
const MAX_TOKENS = 1400;

function readOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCell(value) {
  return readOptionalText(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateCell(value) {
  const normalized = normalizeCell(value);
  if (!normalized) return '';
  return normalized.length > MAX_CELL_CHARS
    ? `${normalized.slice(0, MAX_CELL_CHARS - 1)}…`
    : normalized;
}

function truncateMatrix(matrix) {
  if (!Array.isArray(matrix)) return [];
  return matrix
    .slice(0, MAX_ANALYSIS_ROWS)
    .map((row) => (Array.isArray(row) ? row.slice(0, MAX_ANALYSIS_COLS).map((cell) => truncateCell(cell)) : []));
}

function compactRows(matrix) {
  return truncateMatrix(matrix)
    .map((row, rowIndex) => ({
      rowIndex: rowIndex + 1,
      cells: row.filter((cell) => cell),
    }))
    .filter((row) => row.cells.length > 0);
}

function detectTarget(sheetName) {
  const normalized = readOptionalText(sheetName);
  if (!normalized) return 'preview_only';
  if (normalized.includes('예산총괄') || normalized.includes('그룹예산')) return 'budget_plan';
  if (normalized.includes('비목별 증빙자료')) return 'evidence_rules';
  if (normalized.includes('cashflow') && !normalized.includes('가이드')) return 'cashflow_projection';
  if (normalized.includes('사용내역') || normalized.includes('지출대장') || normalized.includes('비용사용내역')) return 'expense_sheet';
  if (normalized.includes('통장내역')) return 'bank_statement';
  return 'preview_only';
}

function buildCompositeHeaders(matrix) {
  const rows = truncateMatrix(matrix).slice(0, 3);
  if (!rows.length) return [];
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const seen = new Set();
  const headers = [];

  for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
    const parts = rows
      .map((row) => normalizeCell(row[columnIndex] || ''))
      .filter(Boolean)
      .slice(0, 2);
    const header = parts.join(' > ') || normalizeCell(rows[0]?.[columnIndex] || '');
    if (!header || seen.has(header)) continue;
    seen.add(header);
    headers.push(header);
  }
  return headers.slice(0, 18);
}

function inferMappings(headers, target) {
  const mappingRules = [
    { needle: '거래일시', field: '거래일시', reason: '거래 기준 날짜 컬럼으로 바로 연결됩니다.' },
    { needle: '지급처', field: '지급처', reason: '거래 상대방/가맹점 컬럼으로 연결됩니다.' },
    { needle: '비목', field: '비목', reason: '예산 대분류를 나타내는 컬럼입니다.' },
    { needle: '세목', field: '세목', reason: '예산 세부 분류를 나타내는 컬럼입니다.' },
    { needle: '통장에 찍힌 입/출금액', field: '통장에 찍힌 입/출금액', reason: '실제 입출금 기준 금액으로 연결됩니다.' },
    { needle: '입금액', field: '입금합계/입금액', reason: '입금 집계 또는 입금 실제값 후보입니다.' },
    { needle: '사업비 사용액', field: '출금합계/사업비 사용액', reason: '실지출 또는 출금 집계 컬럼 후보입니다.' },
    { needle: '지급처', field: '사업팀/정산지원/도담', reason: '그룹 헤더 아래 지급처 분기 컬럼일 가능성이 큽니다.' },
    { needle: '상세 적요', field: '비고/상세 적요', reason: '설명/비고 계열 필드로 연결됩니다.' },
    { needle: '필수증빙자료 리스트', field: '필수증빙자료 리스트', reason: '필수 증빙 규칙에 그대로 연결됩니다.' },
    { needle: '최초 승인 예산', field: '최초 승인 예산', reason: '예산 원본 금액 컬럼입니다.' },
    { needle: '변경 승인 예산', field: '변경 승인 예산', reason: '수정 승인 예산 컬럼입니다.' },
    { needle: '특이사항', field: '특이사항/비고', reason: '운영 메모/특이사항으로 연결됩니다.' },
  ];

  const suggestions = [];
  headers.forEach((header) => {
    const normalized = normalizeCell(header);
    const rule = mappingRules.find((item) => normalized.includes(item.needle));
    if (!rule) return;
    suggestions.push({
      sourceHeader: header,
      platformField: rule.field,
      confidence: target === 'preview_only' ? 'medium' : 'high',
      reason: rule.reason,
    });
  });

  return suggestions.slice(0, 8);
}

export function buildFallbackGoogleSheetMigrationAnalysis(input) {
  const spreadsheetTitle = readOptionalText(input?.spreadsheetTitle) || 'Google Sheets';
  const selectedSheetName = readOptionalText(input?.selectedSheetName) || '시트 미선택';
  const matrix = truncateMatrix(input?.matrix || []);
  const target = detectTarget(selectedSheetName);
  const headers = buildCompositeHeaders(matrix);
  const usageTips = [
    '먼저 탭 성격을 확인하고, 바로 반영 가능한 탭만 apply 단계로 넘기세요.',
    '예산/사용내역/통장내역처럼 반영 대상이 다른 탭은 한 번에 덮어쓰지 말고 순서대로 확인하세요.',
    '반영 전에는 비목·세목, 날짜, 금액 컬럼이 실제 플랫폼 필드와 맞는지 먼저 비교하세요.',
  ];
  const warnings = [];
  const nextActions = [];

  if (target === 'preview_only') {
    warnings.push('현재 규칙상 바로 반영되지 않는 탭입니다. preview 결과를 먼저 검토하세요.');
    nextActions.push('preview-only 탭은 즉시 반영하지 말고 구조 확인 후 별도 migration 단계로 넘기세요.');
  } else {
    nextActions.push('AI가 추천한 핵심 컬럼과 실제 반영 대상 화면이 일치하는지 먼저 확인하세요.');
    nextActions.push('반영 후에는 표본 3~5행을 열어 금액/날짜/비목·세목이 그대로 들어왔는지 검증하세요.');
  }
  if (headers.length === 0) {
    warnings.push('헤더 후보가 비어 있습니다. 병합 셀 또는 숨김 행 때문에 상단 구조를 다시 확인하세요.');
  }
  if (matrix.length >= MAX_ANALYSIS_ROWS) {
    warnings.push('AI 분석은 상단 일부 행 기준입니다. 하단 예외 행은 사람이 한 번 더 봐야 합니다.');
  }

  const targetLabels = {
    expense_sheet: '사업비 입력(주간)',
    budget_plan: '예산 편집',
    bank_statement: '통장내역',
    evidence_rules: '증빙 규칙',
    cashflow_projection: '캐시플로우 projection',
    preview_only: 'preview only',
  };

  return {
    provider: 'heuristic',
    model: 'deterministic-fallback',
    summary: `${spreadsheetTitle}의 "${selectedSheetName}" 탭은 ${targetLabels[target]} 성격으로 보입니다. 헤더 구조와 그룹 컬럼을 먼저 확인한 뒤 반영하는 것이 안전합니다.`,
    confidence: target === 'preview_only' ? 'low' : 'medium',
    likelyTarget: target,
    usageTips,
    warnings,
    nextActions,
    suggestedMappings: inferMappings(headers, target),
    headerPreview: headers,
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

function sanitizeConfidence(value, fallback) {
  return ['high', 'medium', 'low'].includes(value) ? value : fallback;
}

function sanitizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => readOptionalText(item))
    .filter(Boolean)
    .slice(0, 8);
}

function sanitizeMappings(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => ({
      sourceHeader: readOptionalText(item?.sourceHeader),
      platformField: readOptionalText(item?.platformField),
      confidence: sanitizeConfidence(readOptionalText(item?.confidence), 'medium'),
      reason: readOptionalText(item?.reason),
    }))
    .filter((item) => item.sourceHeader && item.platformField)
    .slice(0, 8);
}

function buildPrompt(input, fallback) {
  const sampleRows = compactRows(input.matrix).slice(0, 16);
  const examples = [
    {
      sheetName: '사용내역(통장내역기준/취소내역,불인정포함)',
      summary: '2줄 헤더가 있는 사용내역 탭으로 보이며, 사업비 입력(주간) 반영 대상으로 우선 검토하는 것이 안전합니다.',
      confidence: 'high',
      likelyTarget: 'expense_sheet',
      usageTips: [
        '그룹 헤더와 실제 컬럼 헤더를 함께 읽어 입금/출금/지급처 컬럼을 확인하세요.',
        '반영 후 표본 3~5행에서 거래일시, 지급처, 금액이 올바른지 확인하세요.',
      ],
      warnings: [
        '2줄 헤더 탭이라 그룹 헤더 아래 실제 컬럼이 밀리지 않았는지 사람이 한 번 더 확인해야 합니다.',
      ],
      nextActions: [
        '미리보기에서 입금합계 > 입금액, 사업팀 > 지급처 같은 매핑이 맞는지 확인하세요.',
      ],
      suggestedMappings: [
        { sourceHeader: '입금합계 > 입금액', platformField: '입금합계/입금액', confidence: 'high', reason: '입금 집계 또는 실제 입금 금액 후보입니다.' },
      ],
    },
    {
      sheetName: 'FAQ',
      summary: '반영 대상이 아니라 참고용 탭으로 보입니다. 구조만 점검하고 실제 반영은 하지 않는 것이 안전합니다.',
      confidence: 'high',
      likelyTarget: 'preview_only',
      usageTips: ['preview-only 탭은 반영보다 안내문/참고자료 여부를 먼저 확인하세요.'],
      warnings: ['FAQ/안내문 성격 탭은 직접 반영하면 데이터가 섞일 수 있습니다.'],
      nextActions: ['이 탭은 넘어가고 실제 데이터가 있는 탭으로 이동하세요.'],
      suggestedMappings: [],
    },
  ];

  const examplesXml = examples
    .map((example) => [
      '<example>',
      `<sheet_name>${example.sheetName}</sheet_name>`,
      `<ideal_json>${JSON.stringify(example)}</ideal_json>`,
      '</example>',
    ].join('\n'))
    .join('\n');

  return [
    '<role>',
    '당신은 Google Sheets → MYSC 플랫폼 migration assistant 입니다.',
    '탭 구조를 읽고, 사용자가 실제 migration 전에 무엇을 먼저 확인해야 하는지 업무 관점에서 도와줍니다.',
    '</role>',
    '<success_criteria>',
    '보수적으로 판단하세요. 최종 저장 로직은 사람이 결정하므로, 확신이 낮으면 낮게 표시하세요.',
    '반드시 한국어 JSON만 반환하세요.',
    '</success_criteria>',
    '<output_schema>',
    '{',
    '  "summary": "한두 문장 요약",',
    '  "confidence": "high|medium|low",',
    '  "likelyTarget": "expense_sheet|budget_plan|bank_statement|evidence_rules|cashflow_projection|preview_only",',
    '  "usageTips": ["실사용 팁", "..."],',
    '  "warnings": ["위험/주의사항", "..."],',
    '  "nextActions": ["바로 할 일", "..."],',
    '  "suggestedMappings": [',
    '    { "sourceHeader": "원본 헤더", "platformField": "플랫폼 필드", "confidence": "high|medium|low", "reason": "근거" }',
    '  ]',
    '}',
    '</output_schema>',
    '<heuristic_baseline>',
    JSON.stringify({
      likelyTarget: fallback.likelyTarget,
      headerPreview: fallback.headerPreview,
      suggestedMappings: fallback.suggestedMappings,
    }, null, 2),
    '</heuristic_baseline>',
    '<sheet_context>',
    JSON.stringify({
      spreadsheetTitle: input.spreadsheetTitle,
      selectedSheetName: input.selectedSheetName,
      sampleRows,
    }, null, 2),
    '</sheet_context>',
    '<examples>',
    examplesXml,
    '</examples>',
    '<rules>',
    '- 근거가 약하면 confidence를 낮게 주세요.',
    '- 헤더가 2줄처럼 보이면 그룹 헤더와 실제 컬럼 헤더를 함께 읽으세요.',
    '- 사람이 바로 확인해야 할 리스크를 warnings에 우선 적으세요.',
    '- usageTips에는 이 wizard를 어떤 순서로 쓰면 좋은지 실무 팁을 주세요.',
    '- summary는 탭 성격과 가장 중요한 주의점이 바로 보이도록 짧고 직접적으로 쓰세요.',
    '</rules>',
  ].join('\n');
}

export function createGoogleSheetMigrationAiService() {
  async function analyzePreview(input) {
    const normalizedInput = {
      spreadsheetTitle: readOptionalText(input?.spreadsheetTitle) || 'Google Sheets',
      selectedSheetName: readOptionalText(input?.selectedSheetName) || '시트 미선택',
      matrix: truncateMatrix(input?.matrix || []),
    };
    const fallback = buildFallbackGoogleSheetMigrationAnalysis(normalizedInput);
    const client = getClient();
    if (!client) {
      return fallback;
    }

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: '당신은 MYSC 사업비/정산 migration assistant 입니다. JSON만 반환하세요.',
        messages: [
          {
            role: 'user',
            content: buildPrompt(normalizedInput, fallback),
          },
        ],
      });

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      const parsed = extractJson(text);
      if (!parsed) {
        return {
          ...fallback,
          warnings: [
            ...fallback.warnings,
            'AI 응답 형식을 해석하지 못해 규칙 기반 분석으로 표시합니다.',
          ].slice(0, 8),
        };
      }

      return {
        provider: 'anthropic',
        model: MODEL,
        summary: readOptionalText(parsed.summary) || fallback.summary,
        confidence: sanitizeConfidence(readOptionalText(parsed.confidence), fallback.confidence),
        likelyTarget: readOptionalText(parsed.likelyTarget) || fallback.likelyTarget,
        usageTips: sanitizeStringArray(parsed.usageTips, fallback.usageTips),
        warnings: sanitizeStringArray(parsed.warnings, fallback.warnings),
        nextActions: sanitizeStringArray(parsed.nextActions, fallback.nextActions),
        suggestedMappings: sanitizeMappings(parsed.suggestedMappings, fallback.suggestedMappings),
        headerPreview: fallback.headerPreview,
      };
    } catch (error) {
      return {
        ...fallback,
        warnings: [
          ...fallback.warnings,
          `AI 분석 호출에 실패해 규칙 기반 분석으로 표시합니다: ${readOptionalText(error?.message) || 'unknown error'}`,
        ].slice(0, 8),
      };
    }
  }

  return {
    analyzePreview,
  };
}
