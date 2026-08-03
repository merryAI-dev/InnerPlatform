import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MARKERS = ['AXR_MONTH_CLOSE_QA_PROJECT_ID', 'AXR_MONTH_CLOSE_QA_ENABLED'];
const ALLOWED = new Set([
  'server/bff/app.mjs',
  'server/bff/routes/axr-month-close-qa.mjs',
  'server/bff/routes/axr-month-close-qa.test.mjs',
  'src/app/components/cashflow/AxrMonthCloseQaPanel.tsx',
  'src/app/components/cashflow/AxrMonthCloseQaPanel.test.ts',
  'src/app/components/cashflow/AxrMonthCloseQaIsolation.test.ts',
]);
const REGISTRATIONS = {
  'server/bff/app.mjs': [
    "import { mountAxrMonthCloseQaRoutes } from './routes/axr-month-close-qa.mjs';",
    'mountAxrMonthCloseQaRoutes(app, { db });',
  ],
  'src/app/components/cashflow/CashflowProjectSheet.tsx': [
    "import { AxrMonthCloseQaPanel } from './AxrMonthCloseQaPanel';",
    '<AxrMonthCloseQaPanel',
  ],
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:js|mjs|ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('AXR QA removal boundary', () => {
  it('keeps every QA marker inside the two feature files and their registration/tests', () => {
    const touched = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'server'))]
      .filter((path) => MARKERS.some((marker) => readFileSync(path, 'utf8').includes(marker)))
      .map((path) => relative(ROOT, path).replaceAll('\\', '/'))
      .sort();
    expect(touched.every((path) => ALLOWED.has(path))).toBe(true);
  });

  it('keeps the only two removable registration points explicit', () => {
    for (const [path, expected] of Object.entries(REGISTRATIONS)) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      for (const registration of expected) expect(source.split(registration)).toHaveLength(2);
    }
  });
});
