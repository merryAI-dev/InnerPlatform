import Anthropic from '@anthropic-ai/sdk';
import { claudeSdkHelpAskSchema, parseWithSchema } from './schemas.mjs';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_ANSWER_TOKENS = 2200;
const ALL_ROLES = ['admin', 'tenant_admin', 'finance', 'pm', 'viewer', 'auditor', 'support', 'security'];

const SOURCE_FILES = [
  {
    label: 'AGENT_SDK_DESIGN.md',
    path: 'merry/AGENT_SDK_DESIGN.md',
    note: 'Claude Agent SDK와 Anthropic SDK 차이, 에이전트 설계 원칙',
  },
  {
    label: 'QUICKSTART.md',
    path: 'merry/QUICKSTART.md',
    note: 'API 키 설정, 설치, chat/analyze/test 명령 빠른 시작',
  },
  {
    label: 'USAGE.md',
    path: 'merry/USAGE.md',
    note: '웹 UI, CLI, 파일 분석/Exit 프로젝션 실제 사용 흐름',
  },
  {
    label: 'discovery_agent.py',
    path: 'merry/agent/discovery_agent.py',
    note: 'ClaudeSDKClient + ClaudeAgentOptions 구성, Anthropic SDK 폴백 패턴',
  },
  {
    label: 'autonomous_agent.py',
    path: 'merry/agent/autonomous_agent.py',
    note: 'connect/query/receive_response/disconnect 기반 자율 에이전트 실행 흐름',
  },
];

const QUICKSTART_STEPS = [
  'Python 가상환경을 만들고 `pip install -r requirements.txt`로 의존성을 설치합니다.',
  '`.env` 또는 환경변수에 `ANTHROPIC_API_KEY`를 넣습니다. 코드에 키를 직접 넣지 않습니다.',
  '`ClaudeSDKClient`와 `ClaudeAgentOptions`를 생성하고 모델, allowed_tools, setting_sources를 설정합니다.',
  '스트리밍 실행은 `await client.connect()` → `await client.query(prompt)` → `for await ... receive_response()` → `await client.disconnect()` 순서로 사용합니다.',
  '단순 1회성 텍스트 질의는 Claude Agent SDK보다 Anthropic SDK가 더 단순할 수 있습니다.',
];

const STARTER_QUESTIONS = [
  'Claude Agent SDK와 Anthropic SDK 차이를 merry 코드 기준으로 설명해줘',
  'merry의 discovery_agent.py처럼 ClaudeSDKClient를 초기화하는 예시를 보여줘',
  'autonomous_agent.py 기준으로 connect/query/receive_response 패턴을 설명해줘',
  'InnerPlatform에서 Claude SDK 도움봇이나 자동화 에이전트를 붙이려면 어떤 구조가 좋아?',
  'Vercel과 로컬에서 ANTHROPIC_API_KEY를 어떻게 안전하게 관리하면 돼?',
];

const REFERENCE_CONTEXT = [
  '당신은 MYSC 내부 Claude SDK 도우미입니다.',
  '답변은 반드시 한국어로 합니다.',
  '중요: 당신은 내부 코드 구조를 알고 있지만, 기본 답변은 사용자 관점에서 해야 합니다.',
  '즉 "어디서 누르고", "무엇을 입력하고", "언제 어떤 기능을 쓰면 되는지"를 먼저 설명합니다.',
  '파일 경로, 구현 디테일, 코드 레벨 설명은 사용자가 직접 요청하거나 문제 원인 설명이 필요할 때만 보조적으로 언급합니다.',
  '코드 중심 설명보다 사용 흐름, 설정 순서, 실제 업무 적용 방법을 우선합니다.',
  '레퍼런스는 merry 프로젝트의 다음 파일들입니다:',
  '- AGENT_SDK_DESIGN.md: Claude Agent SDK와 Anthropic SDK 차이, 에이전트 설계 철학',
  '- QUICKSTART.md: .env에 ANTHROPIC_API_KEY 설정, venv/requirements 설치, python cli.py chat, python cli.py analyze, python cli.py test',
  '- USAGE.md: streamlit run app.py 기반 웹 UI, CLI 사용 흐름, 분석/Exit 프로젝션 예시',
  '- agent/discovery_agent.py: ClaudeSDKClient를 선택적으로 사용하고, SDK unavailable 시 Anthropic SDK로 폴백',
  '- agent/autonomous_agent.py: ClaudeSDKClient를 기본으로 쓰며 setting_sources=["project"], allowed_tools=["Read","Write","Edit","Bash","Glob","Grep"], permission_mode="acceptEdits" 예시 포함',
  '',
  '레퍼런스에서 중요한 실무 포인트:',
  '1. API 키는 .env 또는 환경변수로 관리하고 절대 코드에 하드코딩하지 않는다.',
  '2. Claude Agent SDK는 세션, 도구 사용, 스트리밍, 컨텍스트 관리가 필요한 에이전트형 작업에 적합하다.',
  '3. Anthropic SDK는 단순 text generation이나 서버 단일 응답 생성에 더 단순하다.',
  '4. discovery_agent.py는 SDK가 없을 수 있는 환경을 고려해 Anthropic SDK 폴백을 유지한다.',
  '5. autonomous_agent.py는 connect/query/receive_response/disconnect 라이프사이클을 보여준다.',
  '',
  '사용자가 물으면 다음을 우선적으로 도와줘:',
  '- 설치/환경변수 설정',
  '- 최소 실행 예시 코드',
  '- 언제 Claude Agent SDK를 쓰고 언제 Anthropic SDK를 쓰는지',
  '- merry 코드 기준으로 어떤 파일을 참고해야 하는지',
  '- InnerPlatform에 붙일 때의 구조 제안',
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
  if (normalized.includes('차이') || normalized.includes('anthropic sdk')) {
    return [
      'Claude Agent SDK는 도구 사용과 세션 관리가 필요한 에이전트형 작업에 더 적합합니다.',
      'Anthropic SDK는 단순한 `messages.create()` 호출처럼 서버 단일 응답을 만들 때 더 단순합니다.',
      '',
      'merry 기준 참고 파일:',
      '- `merry/AGENT_SDK_DESIGN.md`',
      '- `merry/agent/discovery_agent.py`',
      '- `merry/agent/autonomous_agent.py`',
    ].join('\n');
  }

  if (normalized.includes('connect') || normalized.includes('query') || normalized.includes('receive_response')) {
    return [
      '`autonomous_agent.py` 패턴 기준 기본 순서는 다음과 같습니다.',
      '1. `await client.connect()`',
      '2. `await client.query(prompt)`',
      '3. `async for message in client.receive_response(): ...`',
      '4. `await client.disconnect()`',
      '',
      '실제 예시는 `merry/agent/autonomous_agent.py`를 참고하면 됩니다.',
    ].join('\n');
  }

  return [
    '현재 Claude API 답변을 생성하지 못해 레퍼런스 요약으로 안내합니다.',
    '',
    '빠른 시작:',
    '- `python -m venv venv && source venv/bin/activate`',
    '- `pip install -r requirements.txt`',
    '- `.env`에 `ANTHROPIC_API_KEY=...` 설정',
    '- 필요 시 `python cli.py chat` 또는 `streamlit run app.py`',
    '',
    '참고 파일:',
    '- `merry/QUICKSTART.md`',
    '- `merry/USAGE.md`',
    '- `merry/AGENT_SDK_DESIGN.md`',
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
        title: 'Claude SDK 도움봇',
        description: 'merry 프로젝트 레퍼런스를 바탕으로 Claude Agent SDK와 Anthropic SDK 사용법을 안내합니다.',
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
          warning: error instanceof Error ? error.message : 'Claude SDK help fallback used',
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
