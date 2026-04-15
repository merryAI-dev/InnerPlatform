import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');

describe('portal-store fetch architecture', () => {
  it('splits project catalog, project scope, and weekly submission subscriptions', () => {
    expect(portalStoreSource).toContain('projectCatalogUnsubsRef');
    expect(portalStoreSource).toContain('projectScopeUnsubsRef');
    expect(portalStoreSource).toContain('weeklySubmissionUnsubsRef');
    expect(portalStoreSource).toContain('setProjectsIfChanged');
  });

  it('keeps project catalog loading isolated from scoped project ids', () => {
    expect(portalStoreSource).toContain(
      '}, [authLoading, isMemberLoading, isAuthenticated, authUser, firestoreEnabled, db, orgId, isDevHarnessUser, assignedProjectIds, livePortalMode]);',
    );
    expect(portalStoreSource).toContain(
      '}, [authLoading, isMemberLoading, isAuthenticated, authUser, currentProjectId, firestoreEnabled, db, orgId, isDevHarnessUser, portalUser?.projectIds, livePortalMode]);',
    );
    expect(portalStoreSource).toContain(
      '}, [authLoading, isMemberLoading, isAuthenticated, authUser, firestoreEnabled, db, orgId, isDevHarnessUser, scopedProjectIds, livePortalMode]);',
    );
  });
});
