import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(
  resolve(import.meta.dirname, 'portal-store.tsx'),
  'utf8',
);

describe('portal-store realtime safety', () => {
  it('uses stable dependency keys for portal hydration listeners', () => {
    expect(portalStoreSource).toContain("const scopedProjectIdsKey = scopedProjectIds.join('|');");
    expect(portalStoreSource).toContain("const portalUserProjectIdsKey = (portalUser?.projectIds || []).join('|');");
    expect(portalStoreSource).toContain('scopedProjectIdsKey, isDevHarnessUser, portalUserProjectIdsKey, livePortalMode');
    expect(portalStoreSource).not.toContain('scopedProjectIds, isDevHarnessUser, portalUser?.projectIds, livePortalMode');
  });

  it('does not revive or persist the active project through sessionStorage', () => {
    expect(portalStoreSource).not.toContain('sessionStorage');
  });

  it('keeps assigned project ids usable when the project catalog cannot be read', () => {
    expect(portalStoreSource).toContain('...portalProjectCandidates.searchProjects.map((project) => project.id),');
    expect(portalStoreSource).toContain('...assignedProjectIds,');

    const handleProjectsErrorSlice = portalStoreSource.slice(
      portalStoreSource.indexOf('const handleProjectsError ='),
      portalStoreSource.indexOf('const projectsQuery ='),
    );
    expect(handleProjectsErrorSlice).not.toContain('setProjectsIfChanged([]);');
  });
});
