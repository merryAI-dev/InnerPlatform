import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectRegisterRedirectPage.tsx'), 'utf8');

describe('ProjectRegisterRedirectPage redirect contract', () => {
  it('keeps legacy project registration entry explicit instead of auto redirecting', () => {
    expect(source).toContain('프로젝트 등록 요청 열기');
    expect(source).not.toContain('Navigate');
    expect(source).not.toContain('replace');
  });
});
