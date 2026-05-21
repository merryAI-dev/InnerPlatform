import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const notFoundSource = readFileSync(
  resolve(import.meta.dirname, 'NotFoundPage.tsx'),
  'utf8',
);

describe('NotFoundPage shell contract', () => {
  it('keeps quick links aligned with LAB visibility', () => {
    expect(notFoundSource).toContain('useShellLabEnabled');
    expect(notFoundSource).toContain('shouldShowShellRoute');
    expect(notFoundSource).toContain('visibleQuickLinks');
    expect(notFoundSource).toContain("'admin', 'quick-action'");
    expect(notFoundSource).toContain('/evidence');
  });
});
