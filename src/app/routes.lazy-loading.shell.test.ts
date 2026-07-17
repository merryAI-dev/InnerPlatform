import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routesSource = readFileSync(resolve(import.meta.dirname, 'routes.tsx'), 'utf8');

describe('route lazy-loading recovery contract', () => {
  it('loads every lazy page through the shared safe loader', () => {
    const lazyDeclarations = routesSource.match(/^const\s+\w+\s*=\s*lazy(?:Route)?\(/gm) || [];

    expect(lazyDeclarations.length).toBeGreaterThan(0);
    expect(lazyDeclarations.every((declaration) => declaration.includes('lazyRoute('))).toBe(true);
    expect(routesSource).toContain('loadLazyRouteModule(');
    expect(routesSource).not.toMatch(/lazy\(\(\)\s*=>\s*import\([^\n]+\.then\(/);
  });

  it('offers a user-triggered refresh without adding an automatic reload', () => {
    expect(routesSource).toContain('새 버전 불러오기');
    expect(routesSource).toContain('onClick={() => window.location.reload()}');
    expect(routesSource.match(/window\.location\.reload\(\)/g)).toHaveLength(1);
  });
});
