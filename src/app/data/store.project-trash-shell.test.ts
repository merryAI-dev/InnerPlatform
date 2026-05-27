import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'store.tsx'), 'utf8');

function extractFunction(name: string): string {
  const start = source.indexOf(`const ${name} = useCallback`);
  const end = source.indexOf(`const ${name === 'trashProject' ? 'restoreProject' : 'addLedger'} = useCallback`, start + 1);
  return source.slice(start, end);
}

describe('project trash local state contract', () => {
  it('does not seed live Firestore sessions with mock projects before remote data arrives', () => {
    expect(source).toContain('const usesLocalSeedData = !featureFlags.firestoreCoreEnabled');
    expect(source).toContain('useState<Project[]>(() => (usesLocalSeedData ? PROJECTS : []))');
    expect(source).toContain('setProjects(usesLocalSeedData ? PROJECTS : [])');
  });

  it('mirrors trash and restore success into local state even when Firestore is online', () => {
    const trashProject = extractFunction('trashProject');
    const restoreProject = extractFunction('restoreProject');

    expect(trashProject).toContain('const result = await trashProjectViaBff');
    expect(trashProject).toContain('mergeProjectMutationResult(project, result, patch)');
    expect(trashProject).toContain('await upsertProject(db, orgId, { ...existing, ...patch }, auditActor);');
    expect(trashProject).toContain('setProjects((prev) => prev.map((project) => (project.id === id ? { ...project, ...patch } : project)))');

    expect(restoreProject).toContain('const result = await restoreProjectViaBff');
    expect(restoreProject).toContain('mergeProjectMutationResult(project, result, patch)');
    expect(restoreProject).toContain('await upsertProject(db, orgId, { ...existing, ...patch }, auditActor);');
    expect(restoreProject).toContain('setProjects((prev) => prev.map((project) => (project.id === id ? { ...project, ...patch } : project)))');
  });
});
