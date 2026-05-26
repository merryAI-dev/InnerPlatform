import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routesSource = readFileSync(resolve(import.meta.dirname, 'routes.tsx'), 'utf8');

describe('route lazy loading safety', () => {
  it('loads PortalProjectSettings through the guarded lazy route helper', () => {
    expect(routesSource).toContain('const PortalProjectSettings = lazy(() => loadLazyRouteModule(');
    expect(routesSource).toContain("'[routes] failed to load PortalProjectSettings:'");
    expect(routesSource).not.toContain(
      "const PortalProjectSettings = lazy(() => import('./components/portal/PortalProjectSettings').then(m => ({ default: m.PortalProjectSettings })));",
    );
  });
});
