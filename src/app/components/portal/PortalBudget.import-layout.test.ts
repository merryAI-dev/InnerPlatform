import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalBudgetSource = readFileSync(
  resolve(import.meta.dirname, 'PortalBudget.tsx'),
  'utf8',
);

describe('PortalBudget import guidance layout', () => {
  it('keeps recovery guide lists readable with explicit line-height and wrapping', () => {
    expect(portalBudgetSource).toContain(
      'list-disc space-y-2 pl-4 text-amber-700 leading-[1.65] break-words',
    );
  });

  it('keeps warning copy blocks readable when long guidance wraps', () => {
    expect(portalBudgetSource).toContain(
      'space-y-2 text-muted-foreground leading-[1.65] break-words',
    );
  });
});
