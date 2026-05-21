import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const systemHealthSource = readFileSync(
  resolve(import.meta.dirname, 'SystemHealthPanel.tsx'),
  'utf8',
);

describe('SystemHealthPanel shell contract', () => {
  it('filters dashboard health and activity surfaces through LAB visibility', () => {
    expect(systemHealthSource).toContain('useShellLabEnabled');
    expect(systemHealthSource).toContain('shouldShowShellRoute');
    expect(systemHealthSource).toContain('visibleMetrics');
    expect(systemHealthSource).toContain('visibleActivities');
    expect(systemHealthSource).toContain('ACTIVITY_ROUTE_BY_TYPE');
    expect(systemHealthSource).toContain("'admin', 'welcome'");
  });
});
