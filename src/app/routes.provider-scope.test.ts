import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(import.meta.dirname, 'App.tsx'), 'utf8');
const routesSource = readFileSync(resolve(import.meta.dirname, 'routes.tsx'), 'utf8');

describe('route-scoped provider architecture', () => {
  it('keeps the app root free of broad operational providers', () => {
    expect(appSource).not.toContain('<HrAnnouncementProvider>');
    expect(appSource).not.toContain('<PayrollProvider>');
    expect(appSource).not.toContain('<CashflowWeekProvider>');
    expect(appSource).not.toContain('<BoardProvider>');
    expect(appSource).not.toContain('<TrainingProvider>');
    expect(appSource).not.toContain('<CareerProfileProvider>');
  });

  it('mounts dedicated admin, portal workspace, and portal entry wrappers in routes', () => {
    expect(routesSource).toContain('AdminRouteProviders');
    expect(routesSource).toContain('PortalRouteProviders');
    expect(routesSource).toContain('PortalEntryLayout');
    expect(routesSource).toContain('function PortalEntryRouteShell()');
    expect(routesSource).toContain('<AdminRouteProviders><AppLayout /></AdminRouteProviders>');
    expect(routesSource).toContain('<PortalRouteProviders><PortalLayout /></PortalRouteProviders>');
    expect(routesSource).toContain('<PortalEntryLayout />');
  });
});
