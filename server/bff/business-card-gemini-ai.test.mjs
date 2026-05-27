import { describe, expect, it, vi } from 'vitest';
import { buildPrompt, createBusinessCardGeminiAiService, resolveApiKey } from './business-card-gemini-ai.mjs';

describe('business-card-gemini-ai', () => {
  it('normalizes structured Gemini JSON responses', async () => {
    const generateContent = vi.fn(async () => ({
      text: JSON.stringify({
        name: { value: '홍길동', confidence: 'high', evidence: '홍길동' },
        organization: { value: 'MYSC', confidence: 'medium', evidence: 'MYSC' },
        department: { value: '', confidence: 'low', evidence: '' },
        title: { value: '대표', confidence: 'medium', evidence: '대표' },
        role: { value: '', confidence: 'low', evidence: '' },
        emails: [{ value: 'PERSON@EXAMPLE.COM', confidence: 'high', evidence: 'PERSON@EXAMPLE.COM' }],
        phones: [{ value: '010-1234-5678', confidence: 'high', evidence: '010-1234-5678' }],
        website: { value: 'example.com', confidence: 'medium', evidence: 'example.com' },
        address: { value: '', confidence: 'low', evidence: '' },
        memo: { value: '', confidence: 'low', evidence: '' },
        rawText: '홍길동 MYSC PERSON@EXAMPLE.COM',
        warnings: [],
      }),
    }));
    const service = createBusinessCardGeminiAiService({
      client: { models: { generateContent } },
      model: 'gemini-test',
    });

    const result = await service.analyzeBusinessCard({
      fileName: 'card.jpg',
      mimeType: 'image/jpeg',
      contentBase64: Buffer.from('fake-image', 'utf8').toString('base64'),
    });

    expect(generateContent).toHaveBeenCalled();
    const prompt = generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(prompt).toContain('Korean business-card cues');
    expect(prompt).toContain('대표이사');
    expect(prompt).toContain('Do not include fax numbers as phones');
    expect(prompt).toContain('File name: card.jpg');
    expect(result.status).toBe('ok');
    expect(result.extracted.name.value).toBe('홍길동');
    expect(result.extracted.emails[0].value).toBe('person@example.com');
    expect(result.extracted.website.value).toBe('https://example.com');
  });

  it('builds a Korean business-card specific prompt contract', () => {
    const prompt = buildPrompt('korean-card.jpg');

    expect(prompt).toContain('Return ONLY valid JSON');
    expect(prompt).toContain('(주)');
    expect(prompt).toContain('주식회사');
    expect(prompt).toContain('department.value');
    expect(prompt).toContain('휴대폰');
    expect(prompt).toContain('Do not infer a website from an email domain');
    expect(prompt).toContain('rawText should contain visible text lines');
    expect(prompt).toContain('File name: korean-card.jpg');
  });

  it('returns a manual review draft when Vertex AI is not configured', async () => {
    const service = createBusinessCardGeminiAiService({
      env: {
        GOOGLE_GENAI_USE_VERTEXAI: 'false',
      },
      importSdk: async () => {
        throw new Error('should not import');
      },
    });

    const result = await service.analyzeBusinessCard({
      fileName: 'card.jpg',
      mimeType: 'image/jpeg',
      contentBase64: 'abc',
    });

    expect(result.status).toBe('manual_review');
    expect(result.error.code).toBe('gemini_not_configured');
    expect(result.extracted.warnings[0]).toContain('수동 검토');
  });

  it('uses Gemini API key configuration before Vertex AI', async () => {
    const constructed = [];
    const generateContent = vi.fn(async () => ({
      text: JSON.stringify({
        name: { value: '김명함', confidence: 'high', evidence: '김명함' },
        organization: { value: 'MYSC', confidence: 'high', evidence: 'MYSC' },
        department: { value: '', confidence: 'low', evidence: '' },
        title: { value: '', confidence: 'low', evidence: '' },
        role: { value: '', confidence: 'low', evidence: '' },
        emails: [{ value: 'card@example.com', confidence: 'high', evidence: 'card@example.com' }],
        phones: [],
        website: { value: '', confidence: 'low', evidence: '' },
        address: { value: '', confidence: 'low', evidence: '' },
        memo: { value: '', confidence: 'low', evidence: '' },
        rawText: '김명함 MYSC card@example.com',
        warnings: [],
      }),
    }));
    const service = createBusinessCardGeminiAiService({
      env: {
        GEMINI_API_KEY: '  ai-studio-key-with-newline\n',
        GOOGLE_GENAI_USE_VERTEXAI: 'true',
        GOOGLE_CLOUD_PROJECT: 'should-not-be-used',
      },
      importSdk: async () => ({
        GoogleGenAI: class {
          constructor(options) {
            constructed.push(options);
            this.models = { generateContent };
          }
        },
      }),
    });

    const result = await service.analyzeBusinessCard({
      fileName: 'card.jpg',
      mimeType: 'image/jpeg',
      contentBase64: 'abc',
    });

    expect(constructed).toEqual([{ apiKey: 'ai-studio-key-with-newline' }]);
    expect(result.provider).toBe('gemini-api');
    expect(result.status).toBe('ok');
  });

  it('trims Gemini API keys from environment variables', () => {
    expect(resolveApiKey({ GEMINI_API_KEY: '  key\n' })).toBe('key');
    expect(resolveApiKey({ GOOGLE_API_KEY: '  fallback-key\n' })).toBe('fallback-key');
  });

  it('marks malformed Gemini responses for manual review', async () => {
    const service = createBusinessCardGeminiAiService({
      client: {
        models: {
          generateContent: vi.fn(async () => ({ text: 'not json' })),
        },
      },
      model: 'gemini-test',
    });

    const result = await service.analyzeBusinessCard({
      fileName: 'card.jpg',
      mimeType: 'image/jpeg',
      contentBase64: Buffer.from('fake-image', 'utf8').toString('base64'),
    });

    expect(result.status).toBe('manual_review');
    expect(result.error.code).toBe('gemini_malformed_response');
    expect(result.extracted.warnings[0]).toContain('수동 검토');
  });

  it('does not accept partial JSON as a successful extraction', async () => {
    const service = createBusinessCardGeminiAiService({
      client: {
        models: {
          generateContent: vi.fn(async () => ({ text: JSON.stringify({ warnings: [] }) })),
        },
      },
      model: 'gemini-test',
    });

    const result = await service.analyzeBusinessCard({
      fileName: 'card.jpg',
      mimeType: 'image/jpeg',
      contentBase64: Buffer.from('fake-image', 'utf8').toString('base64'),
    });

    expect(result.status).toBe('manual_review');
    expect(result.error.code).toBe('gemini_malformed_response');
  });
});
