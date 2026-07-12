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
      '}, [authLoading, isMemberLoading, isAuthenticated, authUser?.uid, hasHydratedPortalSession, firestoreEnabled, db, orgId, isDevHarnessUser, assignedProjectIdsKey, livePortalMode]);',
    );
    expect(portalStoreSource).toContain(
      '}, [authLoading, isMemberLoading, isAuthenticated, authUser?.uid, hasHydratedPortalSession, currentProjectId, firestoreEnabled, db, orgId, scopedProjectIdsKey, isDevHarnessUser, portalUserProjectIdsKey, livePortalMode]);',
    );
    expect(portalStoreSource).toContain(
      '}, [authLoading, isMemberLoading, isAuthenticated, authUser?.uid, hasHydratedPortalSession, firestoreEnabled, db, orgId, isDevHarnessUser, scopedProjectIdsKey, livePortalMode]);',
    );
  });

  it('does not restart data listeners only because the auth token object changed', () => {
    expect(portalStoreSource).not.toContain('isAuthenticated, authUser, firestoreEnabled');
    expect(portalStoreSource).not.toContain('isAuthenticated, authUser, currentProjectId');
    expect(portalStoreSource).toContain('authUserProjectIdsKey, firestoreEnabled');
  });
});
