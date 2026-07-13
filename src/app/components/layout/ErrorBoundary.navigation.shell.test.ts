import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ErrorBoundary.tsx'), 'utf8');

describe('ErrorBoundary navigation contract', () => {
  it('recovers inside the SPA without reloading or replacing the document', () => {
    expect(source).toContain('handleRetry');
    expect(source).toContain('window.history.pushState');
    expect(source).toContain("window.dispatchEvent(new PopStateEvent('popstate'))");
    expect(source).not.toContain('window.location.reload');
    expect(source).not.toContain('window.location.assign');
    expect(source).not.toContain('새로고침을 시도하거나');
  });
});
