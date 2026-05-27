import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'BusinessCardLabPage.tsx'), 'utf8');

describe('BusinessCardLabPage shell contract', () => {
  it('keeps capture as the first and default mobile workflow', () => {
    expect(source.indexOf("{ id: 'capture'")).toBeLessThan(source.indexOf("{ id: 'search'"));
    expect(source).toContain("useState<BusinessCardTab>('capture')");
    expect(source).toContain('capture="environment"');
    expect(source).toContain('aria-label="명함 촬영 시작"');
    expect(source).toContain('processPreparedImage(nextImage)');
    expect(source).toContain('이미지 선택');
    expect(source).not.toContain('Gemini 추출');
    expect(source).toContain('DB 저장');
    expect(source).toContain('Excel CSV');
    expect(source).toContain('updateContactViaBff');
    expect(source).toContain('검색어 없이 조회하면 연락처 목록이 먼저 표시됩니다.');
    expect(source).not.toContain("'review'");
  });
});
