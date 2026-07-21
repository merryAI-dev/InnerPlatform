import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./usePrivateDraftDocumentPreviews.ts', import.meta.url), 'utf8');

describe('private draft document preview lifecycle', () => {
  it('loads only the contract eagerly and keeps all other documents user-triggered', () => {
    expect(source).toContain("if (nextAttachments.has('contract')) void loadDocumentPreview('contract')");
    expect(source).not.toContain('Promise.all');
  });

  it('caches each exact attachment and updates preview URLs incrementally', () => {
    expect(source).toContain('`${attachment.documentKind}\\u0000${attachment.path}`');
    expect(source).toContain('cacheRef.current.get(key)');
    expect(source).toContain('setDocumentPreviewUrls((current) => ({ ...current, [documentKind]: url }))');
  });

  it('aborts downloads and revokes object URLs when attachments are replaced or previews are disabled', () => {
    expect(source).toContain('new AbortController()');
    expect(source).toContain('controller.abort()');
    expect(source).toContain('URL.revokeObjectURL(url)');
    expect(source).toContain('if (!enabled)');
    expect(source).toContain('releaseAll(true)');
    expect(source).toContain('releaseAll(false)');
  });
});
