import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./CashflowAnalyticsPage.tsx', import.meta.url), 'utf8');

describe('CashflowAnalyticsPage copy', () => {
  it('uses bank transaction analysis wording for the report title', () => {
    expect(source).toContain('입출금 분석');
    expect(source).not.toContain('캐시플로 분석');
  });
});
