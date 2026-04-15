import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalProjectSelectPage.tsx'), 'utf8');

describe('PortalProjectSelectPage shell', () => {
  it('keeps the page focused on current-session project choice only', () => {
    expect(source).toContain('오늘 작업할 사업 선택');
    expect(source).toContain('이 사업으로 시작');
    expect(source).toContain('data-testid="portal-project-select-page"');
    expect(source).toContain('fetchPortalEntryContextViaBff');
    expect(source).toContain('switchPortalSessionProjectViaBff');
    expect(source).not.toContain('usePortalStore');
    expect(source).not.toContain('주사업으로 지정');
    expect(source).not.toContain('증빙 드라이브 연결');
  });
});
