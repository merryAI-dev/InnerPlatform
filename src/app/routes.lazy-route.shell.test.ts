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

  it('registers the mobile PWA entry route separately from the desktop root', () => {
    expect(routesSource).toContain("const MobileEntryPage = lazy(() => import('./components/pwa/MobileEntryPage')");
    expect(routesSource).toContain("{ path: '/mobile-entry', element: <S C={MobileEntryPage} /> }");
    expect(routesSource).toContain('function MobileAwareAdminHome()');
    expect(routesSource).toContain('shouldUseBusinessCardMobileEntry');
    expect(routesSource).toContain('{ index: true, element: <MobileAwareAdminHome /> }');
  });

  it('closes the PM portal project dashboard route by sending /portal to project selection', () => {
    expect(routesSource).toContain('{ index: true, element: <Navigate to="/portal/project-select" replace /> }');
    expect(routesSource).not.toContain('{ index: true, element: <S C={PortalDashboard} /> }');
  });
});
