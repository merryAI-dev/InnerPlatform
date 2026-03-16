import { describe, expect, it } from 'vitest';
import { createClaudeSdkHelpService } from './claude-sdk-help.mjs';

describe('claude-sdk-help', () => {
  it('returns reference-driven metadata', () => {
    const service = createClaudeSdkHelpService({
      askModel: async () => ({
        answer: 'ok',
        model: 'test-model',
        provider: 'anthropic',
        tokensUsed: 12,
      }),
    });

    const meta = service.getMeta();
    expect(meta.title).toBe('Claude SDK 도움봇');
    expect(meta.sourceFiles.length).toBeGreaterThanOrEqual(5);
    expect(meta.quickstartSteps.some((step) => step.includes('ANTHROPIC_API_KEY'))).toBe(true);
    expect(meta.starterQuestions.some((item) => item.includes('Claude Agent SDK'))).toBe(true);
  });

  it('uses injected model response when available', async () => {
    const service = createClaudeSdkHelpService({
      model: 'test-model',
      askModel: async ({ question }) => ({
        answer: `답변: ${question}`,
        model: 'test-model',
        provider: 'anthropic',
        tokensUsed: 42,
      }),
    });

    const result = await service.ask({
      question: 'Claude SDK와 Anthropic SDK 차이 설명',
      history: [],
    });

    expect(result.provider).toBe('anthropic');
    expect(result.answer).toContain('Claude SDK와 Anthropic SDK 차이 설명');
    expect(result.tokensUsed).toBe(42);
  });

  it('falls back to reference summary when model call fails', async () => {
    const service = createClaudeSdkHelpService({
      askModel: async () => {
        throw new Error('boom');
      },
    });

    const result = await service.ask({
      question: 'connect query receive_response 순서를 알려줘',
      history: [],
    });

    expect(result.provider).toBe('fallback');
    expect(result.warning).toBe('boom');
    expect(result.answer).toContain('autonomous_agent.py');
  });
});
