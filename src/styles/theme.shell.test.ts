import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(resolve(import.meta.dirname, 'theme.css'), 'utf8');

describe('global theme polish', () => {
  it('keeps app-wide UI polish in CSS without changing page markup', () => {
    expect(themeCss).toContain("[data-slot='card']");
    expect(themeCss).toContain("[data-slot='button']");
    expect(themeCss).toContain("[data-slot='input']");
    expect(themeCss).toContain("[data-slot='table-container']");
    expect(themeCss).toContain("[data-slot='dialog-content']");
    expect(themeCss).toContain('prefers-reduced-motion: reduce');
  });

  it('keeps typography stable without negative base heading letter spacing', () => {
    expect(themeCss).toContain('letter-spacing: 0;');
    expect(themeCss).toContain("[class*='tracking-[-']");
    expect(themeCss).not.toContain('letter-spacing: -0.');
  });
});
