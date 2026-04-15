import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const vercelConfig = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../vercel.json'), 'utf8'),
) as {
  headers?: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
};

const fontsSource = readFileSync(resolve(import.meta.dirname, '../styles/fonts.css'), 'utf8');

describe('entry asset cache policy', () => {
  it('self-hosts the entry font without third-party CSS imports', () => {
    expect(fontsSource).toContain("font-family: 'Pretendard Variable'");
    expect(fontsSource).toContain('/fonts/PretendardVariable.woff2');
    expect(fontsSource).not.toContain('fonts.googleapis.com');
    expect(fontsSource).not.toContain('cdn.jsdelivr.net');
  });

  it('marks hashed assets and local fonts as immutable', () => {
    const headerSources = (vercelConfig.headers || []).map((entry) => entry.source);
    expect(headerSources).toContain('/assets/(.*)');
    expect(headerSources).toContain('/fonts/(.*)');

    const assetHeader = (vercelConfig.headers || []).find((entry) => entry.source === '/assets/(.*)');
    const fontHeader = (vercelConfig.headers || []).find((entry) => entry.source === '/fonts/(.*)');
    const expectedValue = 'public, max-age=31536000, immutable';

    expect(assetHeader?.headers).toContainEqual({
      key: 'Cache-Control',
      value: expectedValue,
    });
    expect(fontHeader?.headers).toContainEqual({
      key: 'Cache-Control',
      value: expectedValue,
    });
  });
});
