import Anthropic from '@anthropic-ai/sdk';
import { claudeSdkHelpAskSchema, parseWithSchema } from './schemas.mjs';

const MODEL = 'claude-sonnet-4-20250514';
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
  '로그인 후 먼저 `사업 설정`에서 내 사업과 주사업을 확인합니다. 사업이 안 보이면 여기서 배정 상태부터 맞춥니다.',
  '같은 화면에서 `기본 폴더 생성`을 눌러 사업별 증빙 루트 폴더를 준비합니다. 이 단계가 끝나야 주간 시트의 증빙 흐름이 안정적입니다.',
  '주간 사업비 입력에서는 행을 작성한 뒤 `생성 → 업로드 → 동기화` 순서로 사용합니다.',
  '기존 Google Sheets를 옮길 때는 `Google Sheets Migration Wizard`에서 링크 입력 → 탭 선택 → 미리보기 → 안전 반영 순서로 진행합니다.',
  '업로드했는데 목록이 안 바뀌면 `동기화`를 다시 눌러 Drive 파일 목록을 재반영합니다.',
];

const STARTER_QUESTIONS = [
  '구글드라이브 연결은 어디서 하고 기본 폴더 생성은 어떻게 해?',
  '주간 사업비 입력에서 생성, 업로드, 동기화는 각각 언제 눌러야 해?',
  'Google Sheets Migration Wizard로 기존 시트를 옮길 때 순서를 알려줘',
  '업로드했는데 실제 구비 완료된 증빙자료 리스트가 안 바뀌면 어떻게 해야 해?',
  '예산 편집, 통장내역, 주간 사업비 입력은 각각 어떤 경우에 써야 해?',
];

const REFERENCE_CONTEXT = [
  '당신은 MYSC 사업관리 플랫폼 사용 도움봇입니다.',
  '답변은 반드시 한국어로 합니다.',
  '중요: 당신은 내부 코드 구조를 알고 있지만, 기본 답변은 사용자 관점에서 해야 합니다.',
  '즉 "어디서 누르고", "무엇을 입력하고", "언제 어떤 기능을 쓰면 되는지"를 먼저 설명합니다.',
  '파일 경로, 구현 디테일, 코드 레벨 설명은 사용자가 직접 요청하거나 문제 원인 설명이 필요할 때만 보조적으로 언급합니다.',
  '코드 중심 설명보다 사용 흐름, 설정 순서, 실제 업무 적용 방법을 우선합니다.',
  '레퍼런스는 InnerPlatform의 실제 사용 흐름입니다:',
  '- PortalProjectSettings.tsx: 사업 선택, 주사업 지정, 기본 폴더 생성',
  '- PortalWeeklyExpensePage.tsx: 주간 사업비 입력과 happy path',
  '- SettlementLedgerPage.tsx: 행별 생성/업로드/동기화와 자동 집계',
  '- GoogleSheetMigrationWizard.tsx: 링크 입력, 탭 선택, 미리보기, 안전 반영',
  '- google-drive.mjs: Drive 동기화와 실제 구비 완료 목록 계산',
  '',
  '플랫폼에서 꼭 지켜야 하는 설명 포인트:',
  '1. 사업 설정에서 사업 선택과 기본 폴더 생성을 먼저 해야 주간 사업비 입력의 증빙 흐름이 안정적이다.',
  '2. 주간 사업비 입력의 증빙 흐름은 보통 `생성 → 업로드 → 동기화` 순서다.',
  '3. 업로드는 파일 저장, 동기화는 목록 반영과 자동 집계 갱신이라는 차이가 있다.',
  '4. Google Sheets Migration Wizard는 탭별 반영 대상이 다르고, 보호 컬럼은 덮어쓰지 않는다.',
  '5. cashflow actual은 거래 기준으로 재계산되므로 migration에서는 projection 반영이 중심이다.',
  '',
  '사용자가 물으면 다음을 우선적으로 도와줘:',
  '- 구글드라이브 연결과 기본 폴더 생성',
  '- 주간 사업비 입력에서 행 작성, 저장, 증빙 업로드 순서',
  '- Google Sheets Migration Wizard 사용법',
  '- 예산 편집 / 통장내역 / 주간 사업비 입력 화면의 역할 차이',
  '- 업로드했는데 목록이 안 바뀌는 경우의 점검 순서',
  '',
  '답변 원칙:',
  '- 먼저 핵심 답을 짧게 말하고, 필요하면 사용 순서와 예시를 준다.',
  '- 사용자가 "코드 예시"나 "구현"을 물으면 그때 예시 코드와 파일 경로를 준다.',
  '- 잘 모르는 내용은 추측하지 말고, 레퍼런스 기준으로 한정해서 설명한다.',
].join('\n');

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
      system: REFERENCE_CONTEXT,
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
        title: '플랫폼 사용 도움봇',
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
