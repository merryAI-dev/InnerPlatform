import Anthropic from '@anthropic-ai/sdk';
import { claudeSdkHelpAskSchema, parseWithSchema } from './schemas.mjs';

const MODEL = process.env.ANTHROPIC_PLATFORM_HELP_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const MAX_ANSWER_TOKENS = 2200;
const ALL_ROLES = ['admin', 'tenant_admin', 'finance', 'pm', 'viewer', 'auditor', 'support', 'security'];

const SOURCE_FILES = [
  {
    label: 'PortalProjectSettings.tsx',
    path: 'src/app/components/portal/PortalProjectSettings.tsx',
    note: '사업 선택, 주사업 지정, 기본 증빙 폴더 생성 흐름',
  },
  {
    label: 'PortalWeeklyExpensePage.tsx',
    path: 'src/app/components/portal/PortalWeeklyExpensePage.tsx',
    note: '주간 사업비 입력, Drive 생성/업로드/동기화, happy path 안내',
  },
  {
    label: 'SettlementLedgerPage.tsx',
    path: 'src/app/components/cashflow/SettlementLedgerPage.tsx',
    note: '행 단위 업로드, 동기화, 자동 집계, 셀 편집 규칙',
  },
  {
    label: 'GoogleSheetMigrationWizard.tsx',
    path: 'src/app/components/portal/GoogleSheetMigrationWizard.tsx',
    note: '시트 링크 입력, 탭 선택, 미리보기, 안전 반영 단계',
  },
  {
    label: 'google-drive.mjs',
    path: 'server/bff/google-drive.mjs',
    note: 'Drive 폴더 생성, 파일 동기화, 실제 구비 완료 자동 집계 규칙',
  },
];

const QUICKSTART_STEPS = [
  '먼저 `사업 설정`에서 내 사업과 주사업을 확인하고 `기본 폴더 생성`으로 사업별 증빙 루트 폴더를 준비합니다.',
  '`통장내역` 화면에서 엑셀이나 통장 원본을 업로드하면 주간 사업비 입력의 초안 정리에 도움이 됩니다.',
  '`주간 사업비 입력`에서 비목/세목, 거래처, 적요를 정리하고 필요한 행을 저장합니다.',
  '증빙은 각 행에서 `생성 → 업로드 → 동기화` 순서로 사용합니다. 업로드는 파일 저장, 동기화는 목록 반영입니다.',
  '기존 Google Sheets를 옮길 때는 `Google Sheets Migration Wizard`에서 링크 입력 → 탭 선택 → 미리보기 → 안전 반영 순서로 진행합니다.',
];

const STARTER_QUESTIONS = [
  '구글드라이브 연결은 어디서 하고 기본 폴더 생성은 어떻게 해?',
  '주간 사업비 입력에서 생성, 업로드, 동기화는 각각 언제 눌러야 해?',
  'Google Sheets Migration Wizard로 기존 시트를 옮길 때 순서를 알려줘',
  '업로드했는데 실제 구비 완료된 증빙자료 리스트가 안 바뀌면 어떻게 해야 해?',
  '예산 편집, 통장내역, 주간 사업비 입력은 각각 어떤 경우에 써야 해?',
];

const OPERATION_GUIDES = {
  onboarding: [
    '처음 쓰는 사람은 `사업 설정`에서 사업 선택, 주사업 지정, 기본 폴더 생성을 먼저 끝내는 것이 가장 중요합니다.',
    '그 다음에는 `통장내역` 또는 `Google Sheets Migration Wizard`로 초안을 가져오고, 이후 `주간 사업비 입력`에서 행을 정리합니다.',
  ],
  drive_setup: [
    '`기본 폴더 생성`은 사업당 한 번만 해두면 됩니다.',
    '기본 폴더가 준비되어야 각 행에서 `생성`으로 거래별 증빙 폴더를 만들고, 이후 `업로드`와 `동기화`를 안정적으로 사용할 수 있습니다.',
  ],
  weekly_entry: [
    '`주간 사업비 입력`은 실제 거래 행을 정리하는 화면입니다.',
    '비목/세목, 거래일시, 지급처, 적요를 먼저 정리하고, 필요한 경우에만 증빙 `생성 → 업로드 → 동기화`를 이어서 씁니다.',
  ],
  evidence: [
    '`업로드`는 파일을 Drive 폴더에 저장하는 단계이고, `동기화`는 Drive 파일 목록을 다시 읽어 상태와 완료 목록을 갱신하는 단계입니다.',
    '업로드 후 화면 반영이 기대와 다르면 보통 `동기화`를 다시 한 번 해야 합니다.',
  ],
  migration: [
    '`Google Sheets Migration Wizard`는 링크 입력 → 탭 선택 → 미리보기 → 안전 반영 순서로 쓰는 것이 기본입니다.',
    '예산, 사용내역, 통장내역, cashflow는 성격이 달라서 한 번에 덮어쓰지 말고 탭별로 나눠 확인해야 합니다.',
  ],
  budget: [
    '`예산 편집`은 비목/세목과 승인 예산을 다루고, `통장내역`은 은행 원본을 다루며, `주간 사업비 입력`은 실제 정산 행을 다룹니다.',
    'cashflow actual은 거래 기준으로 다시 계산되므로 migration에서는 projection 반영이 중심입니다.',
  ],
  error_triage: [
    '오류가 나면 먼저 현재 사업 선택, 기본 폴더 생성 여부, 대상 행 저장 여부, 업로드 후 동기화 여부를 순서대로 확인하는 것이 좋습니다.',
    '원인 설명이 필요한 경우에만 코드/구현 디테일을 보조적으로 안내합니다.',
  ],
};

const HELP_EXAMPLES = [
  {
    user: '구글드라이브 연결은 어디서 하고 기본 폴더 생성은 어떻게 해?',
    assistant: [
      '구글드라이브 연결은 보통 `사업 설정` 화면에서 먼저 합니다.',
      '먼저 내 사업과 주사업을 확인한 뒤 `기본 폴더 생성`을 누르세요. 이 단계가 끝나야 주간 사업비 입력에서 각 행별 `생성 / 업로드 / 동기화` 흐름을 안정적으로 쓸 수 있습니다.',
      '처음 설정할 때는 사업당 한 번만 하면 되고, 이미 폴더가 있으면 다시 만들 필요는 없습니다.',
    ].join('\n'),
  },
  {
    user: '업로드했는데 실제 구비 완료된 증빙자료 리스트가 안 바뀌어요',
    assistant: [
      '대부분은 `업로드`까지만 하고 `동기화`를 안 해서 생기는 경우가 많습니다.',
      '먼저 해당 행에서 파일 업로드가 완료됐는지 확인하고, 이어서 `동기화`를 눌러 Drive 목록을 다시 읽어오세요.',
      '그래도 안 바뀌면 같은 행에 이미 다른 수기 보정이 들어가 있는지, 혹은 업로드한 파일 분류가 문서 종류와 맞는지도 확인하면 좋습니다.',
    ].join('\n'),
  },
  {
    user: 'Google Sheets Migration Wizard는 어떤 순서로 쓰면 돼?',
    assistant: [
      '기본 순서는 `링크 입력 → 탭 선택 → 미리보기 → 안전 반영`입니다.',
      '먼저 `사용내역`, `예산총괄시트`, `통장내역`, `cashflow`, `비목별 증빙자료` 중 어떤 탭을 옮길지 고르고, 미리보기에서 반영 대상 화면과 위험 포인트를 확인하세요.',
      '특히 보호 컬럼과 cashflow actual처럼 자동 계산되는 값은 그대로 덮어쓰지 않는 쪽이 안전합니다.',
    ].join('\n'),
  },
];

function classifyQuestion(question) {
  const normalized = readOptionalText(question).toLowerCase();
  const intents = [];
  if (/(처음|시작|온보딩|뭐부터|어떻게 시작)/.test(normalized)) intents.push('onboarding');
  if (/(구글드라이브|드라이브|기본 폴더|폴더 생성)/.test(normalized)) intents.push('drive_setup');
  if (/(주간|사업비 입력|행 작성|비목|세목|적요|저장)/.test(normalized)) intents.push('weekly_entry');
  if (/(업로드|동기화|증빙|실제 구비|완료 목록)/.test(normalized)) intents.push('evidence');
  if (/(migration|wizard|시트|탭|구글 시트|google sheets)/.test(normalized)) intents.push('migration');
  if (/(예산|통장내역|cashflow|프로젝션|actual)/.test(normalized)) intents.push('budget');
  if (/(오류|실패|안 돼|안돼|안 바뀌|권한|403|409|401)/.test(normalized)) intents.push('error_triage');
  return intents.length ? intents : ['onboarding'];
}

function buildRelevantGuidance(question) {
  const intents = classifyQuestion(question);
  return intents.map((intent) => ({
    intent,
    guidance: OPERATION_GUIDES[intent] || [],
  }));
}

function buildHelpSystemPrompt(question) {
  const relevantGuidance = buildRelevantGuidance(question);
  const sourceFiles = SOURCE_FILES
    .map((item) => `<source_file><label>${item.label}</label><path>${item.path}</path><note>${item.note}</note></source_file>`)
    .join('\n');
  const guidanceXml = relevantGuidance
    .map((item) => [
      `<guidance intent="${item.intent}">`,
      ...item.guidance.map((line) => `  <point>${line}</point>`),
      '</guidance>',
    ].join('\n'))
    .join('\n');
  const examplesXml = HELP_EXAMPLES
    .map((example) => [
      '<example>',
      `<user_question>${example.user}</user_question>`,
      `<assistant_answer>${example.assistant}</assistant_answer>`,
      '</example>',
    ].join('\n'))
    .join('\n');

  return [
    '<role>',
    '당신은 MYSC 사업관리 플랫폼 사용 도움봇 "사업관리 메리"입니다.',
    '답변은 반드시 한국어로 합니다.',
    '</role>',
    '<context>',
    '사용자는 실제 홈페이지를 보면서 바로 따라할 수 있는 안내를 원합니다.',
    '코드 구조는 알고 있어도 답변의 기본 시점은 사용자 관점이어야 합니다.',
    '파일 경로나 구현 디테일은 사용자가 직접 요청하거나, 문제 원인 설명에 꼭 필요할 때만 짧게 언급합니다.',
    '</context>',
    '<success_criteria>',
    '답변은 먼저 핵심 결론을 짧게 말하고, 이어서 사용자가 실제 화면에서 따라 할 순서를 설명해야 합니다.',
    '답변에는 최소 한 개 이상의 다음 행동(next step)이 포함되어야 합니다.',
    '잘 모르는 내용은 추측하지 말고, 현재 플랫폼 기준으로 확인 가능한 범위만 안내합니다.',
    '</success_criteria>',
    '<platform_truths>',
    '<truth>사업 설정에서 사업 선택과 기본 폴더 생성을 먼저 해야 증빙 흐름이 안정적입니다.</truth>',
    '<truth>주간 사업비 입력의 증빙 흐름은 보통 생성 → 업로드 → 동기화 순서입니다.</truth>',
    '<truth>업로드는 파일 저장, 동기화는 목록 반영과 자동 집계 갱신입니다.</truth>',
    '<truth>Google Sheets Migration Wizard는 탭별 반영 대상이 다르고, 보호 컬럼은 덮어쓰지 않습니다.</truth>',
    '<truth>cashflow actual은 거래 기준으로 재계산되므로 migration에서는 projection 반영이 중심입니다.</truth>',
    '</platform_truths>',
    '<relevant_guidance>',
    guidanceXml,
    '</relevant_guidance>',
    '<source_files>',
    sourceFiles,
    '</source_files>',
    '<examples>',
    examplesXml,
    '</examples>',
    '<answer_style>',
    '말투는 친절하지만 짧고 직접적으로 합니다.',
    '과한 마크다운이나 장황한 서론은 피합니다.',
    '가능하면 "어디서 누르고, 무엇을 입력하고, 언제 다음 단계로 넘어가는지"를 먼저 씁니다.',
    '사용자가 코드 예시를 요청하지 않았다면 코드 블록을 출력하지 않습니다.',
    '</answer_style>',
    '<self_check>',
    '최종 답변 전 내부적으로 다음을 확인하세요.',
    '1. 사용자가 당장 따라할 수 있는 단계가 포함되었는가?',
    '2. 코드 중심 설명으로 치우치지 않았는가?',
    '3. 질문 의도와 가장 관련 있는 화면/기능을 먼저 설명했는가?',
    '</self_check>',
  ].join('\n');
}

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

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string')
    .slice(-12)
    .map((entry) => ({
      role: entry.role,
      content: entry.content.trim(),
    }))
    .filter((entry) => entry.content);
}

function buildFallbackAnswer(question) {
  const normalized = String(question || '').trim().toLowerCase();
  if (normalized.includes('구글드라이브') || normalized.includes('드라이브 연결') || normalized.includes('기본 폴더')) {
    return [
      '구글드라이브 연결은 보통 `사업 설정` 화면에서 먼저 합니다.',
      '1. 사업을 선택하거나 주사업을 지정합니다.',
      '2. `기본 폴더 생성`을 눌러 사업별 증빙 루트 폴더를 만듭니다.',
      '3. 그 다음 주간 사업비 입력으로 가면 각 행에서 `생성 / 업로드 / 동기화`를 사용할 수 있습니다.',
      '',
      '실무 팁:',
      '- 기본 폴더 생성은 사업당 한 번만 하면 됩니다.',
      '- 행에 이미 폴더가 있으면 다시 만들지 않고 기존 폴더를 재사용합니다.',
      '- 업로드 후 목록 반영은 `동기화` 버튼에서 마무리됩니다.',
    ].join('\n');
  }

  if (normalized.includes('업로드') || normalized.includes('동기화')) {
    return [
      '증빙은 보통 `생성 → 업로드 → 동기화` 순서로 씁니다.',
      '1. `생성`: 거래 행에 대응하는 Drive 폴더를 준비합니다.',
      '2. `업로드`: 파일을 Drive 폴더에 올립니다. 이 단계만으로는 목록 반영이 끝나지 않을 수 있습니다.',
      '3. `동기화`: Drive 파일 목록을 다시 읽어서 `실제 구비 완료된 증빙자료 리스트`와 상태를 갱신합니다.',
      '',
      '업로드만 했는데 화면이 안 바뀌면 `동기화`를 한 번 더 눌러야 합니다.',
    ].join('\n');
  }

  if (normalized.includes('migration') || normalized.includes('시트') || normalized.includes('wizard')) {
    return [
      '기존 Google Sheets를 옮길 때는 `Google Sheets Migration Wizard`를 쓰면 됩니다.',
      '1. 시트 링크 또는 spreadsheet ID를 붙여넣습니다.',
      '2. 탭 목록에서 `사용내역`, `예산총괄시트`, `cashflow`, `비목별 증빙자료` 같은 반영 대상을 고릅니다.',
      '3. 미리보기에서 어떤 화면으로 들어갈지 확인합니다.',
      '4. `안전 반영` 단계에서 실제로 가져옵니다.',
      '',
      '주의:',
      '- 증빙 드라이브 링크처럼 보호 컬럼은 덮어쓰지 않습니다.',
      '- `cashflow`는 projection만 가져오고 actual은 거래 기준으로 다시 계산합니다.',
    ].join('\n');
  }

  return [
    '현재 AI 답변을 만들지 못해 기본 사용 흐름 기준으로 안내합니다.',
    '',
    '추천 시작 순서:',
    '- `사업 설정`에서 사업 선택과 기본 폴더 생성',
    '- `주간 사업비 입력`에서 행 작성 후 생성/업로드/동기화',
    '- 기존 시트가 있으면 `Google Sheets Migration Wizard` 사용',
    '',
    '지금 바로 물어볼 만한 질문:',
    '- 구글드라이브 연결은 어떻게 해?',
    '- 기본 폴더 생성은 어디서 해?',
    '- 업로드했는데 목록이 안 바뀌면?',
  ].join('\n');
}

export function createClaudeSdkHelpService(options = {}) {
  const model = options.model || MODEL;
  const askModel = options.askModel || (async ({ question, history }) => {
    const client = getClient();
    const response = await client.messages.create({
      model,
      max_tokens: MAX_ANSWER_TOKENS,
      temperature: 0.2,
      system: buildHelpSystemPrompt(question),
      messages: [
        ...normalizeHistory(history),
        { role: 'user', content: question.trim() },
      ],
    });

    const answer = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      answer,
      model,
      provider: 'anthropic',
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    };
  });

  return {
    getMeta() {
      return {
        title: '사업관리 메리',
        description: '실제 홈페이지 흐름을 기준으로 사업 설정, Drive 연결, Migration, 주간 사업비 입력 사용법을 안내합니다.',
        sourceFiles: SOURCE_FILES,
        quickstartSteps: QUICKSTART_STEPS,
        starterQuestions: STARTER_QUESTIONS,
        model,
      };
    },

    async ask({ question, history }) {
      try {
        return await askModel({ question, history });
      } catch (error) {
        return {
          answer: buildFallbackAnswer(question),
          model,
          provider: 'fallback',
          tokensUsed: 0,
          warning: error instanceof Error ? error.message : 'platform help fallback used',
        };
      }
    },
  };
}

export function mountClaudeSdkHelpRoutes(
  app,
  { asyncHandler, createMutatingRoute, idempotencyService, assertActorRoleAllowed, service: providedService },
) {
  const service = providedService || createClaudeSdkHelpService();

  app.get('/api/v1/claude-sdk/help/meta', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ALL_ROLES, 'read claude sdk help metadata');
    res.status(200).json(service.getMeta());
  }));

  app.post('/api/v1/claude-sdk/help/ask', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ALL_ROLES, 'ask claude sdk help');
    const parsed = parseWithSchema(claudeSdkHelpAskSchema, req.body, 'Invalid Claude SDK help request');
    const result = await service.ask({
      question: parsed.question,
      history: parsed.history || [],
    });

    return {
      status: 200,
      body: result,
    };
  }));
}
