import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'BusinessCardLabPage.tsx'), 'utf8');

describe('BusinessCardLabPage shell contract', () => {
  it('keeps capture as the first and default mobile workflow', () => {
    expect(source.indexOf("{ id: 'capture'")).toBeLessThan(source.indexOf("{ id: 'search'"));
    expect(source).toContain("useState<BusinessCardTab>('capture')");
    expect(source).toContain('capture="environment"');
    expect(source).toContain('촬영/업로드');
  });
});
