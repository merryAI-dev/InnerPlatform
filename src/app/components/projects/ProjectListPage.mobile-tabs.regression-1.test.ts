import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectListPage.tsx'), 'utf8');

describe('ProjectListPage mobile lifecycle tabs', () => {
  // Regression: ISSUE-001 — 375px에서 네 번째 휴지통 탭이 잘림
  // Found by /qa on 2026-07-14
  // Report: .gstack/qa-reports/qa-report-project-navigation-2026-07-14.md
  it('fits all four lifecycle tabs in one responsive grid', () => {
    expect(source).toContain('<TabsList className="grid w-full grid-cols-4">');
    expect(source.match(/className="gap-1 px-1\.5 sm:gap-1\.5 sm:px-3"/g)).toHaveLength(4);
  });
});
