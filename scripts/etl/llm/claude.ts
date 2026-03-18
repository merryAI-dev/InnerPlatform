/**
 * Claude API wrapper — retry, token budget, structured output
 */
import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env.local');
    client = new Anthropic({ apiKey });
  }
  return client;
}

export interface LLMCallOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  retries?: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

/**
 * Send a prompt to Claude and get text response
 */
export async function askClaude(prompt: string, opts: LLMCallOptions = {}): Promise<string> {
  const { system, maxTokens = 4096, temperature = 0.1, retries = 2 } = opts;

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await getClient().messages.create({
        model: DEFAULT_MODEL,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages,
      });

      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('');

      return text;
    } catch (err: any) {
      lastError = err;
      if (attempt < retries) {
        const wait = 1000 * (attempt + 1);
        console.warn(`[LLM] Retry ${attempt + 1}/${retries} after ${wait}ms...`);
        await sleep(wait);
      }
    }
  }

  throw lastError ?? new Error('Claude API call failed');
}

/**
 * Send a prompt and parse JSON response
 */
export async function askClaudeJSON<T = unknown>(prompt: string, opts: LLMCallOptions = {}): Promise<T> {
  const text = await askClaude(prompt, opts);

  // Extract JSON from markdown code blocks if present
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text;

  try {
    return JSON.parse(jsonStr.trim()) as T;
  } catch {
    throw new Error(`Failed to parse Claude JSON response:\n${text.slice(0, 500)}`);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
