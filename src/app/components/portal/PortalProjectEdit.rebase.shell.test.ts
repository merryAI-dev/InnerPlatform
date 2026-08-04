import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const editSource = readFileSync(resolve(import.meta.dirname, 'PortalProjectEdit.tsx'), 'utf8');
const dialogSource = readFileSync(resolve(import.meta.dirname, 'ProjectInfoRebaseDialog.tsx'), 'utf8');
const clientSource = readFileSync(resolve(import.meta.dirname, '../../lib/project-info-draft-client.ts'), 'utf8');
const routeSource = readFileSync(resolve(import.meta.dirname, '../../../../server/bff/routes/project-info-drafts.mjs'), 'utf8');

describe('project info draft rebase contract', () => {
  it('freezes the canonical values a draft started from so a rebase can tell the sides apart', () => {
    expect(routeSource).toContain('baseSnapshot: seed');
    expect(routeSource).toContain('export function mergeProjectInfoDraftFields');
    expect(routeSource).toContain("app.post('/api/v1/project-info-drafts/:projectId/rebase'");
  });

  it('rebases only after every conflict is resolved, and never writes during a preview', () => {
    expect(routeSource).toContain("'draft_rebase_unresolved'");
    expect(routeSource).toContain('if (!resolutions) {');
    expect(routeSource).toContain('rebased: false');
    expect(routeSource).toContain('baseCanonicalVersion: actualVersion');
    expect(routeSource).toContain('PROJECT_INFO_DRAFT_REBASE');
  });

  it('routes a canonical version conflict into the rebase dialog instead of a dead-end error', () => {
    expect(editSource).toContain("body?.error === 'canonical_version_conflict'");
    expect(editSource).toContain('function isCanonicalVersionConflict');
    expect(editSource).toContain('if (isCanonicalVersionConflict(error)) {');
    expect(editSource).toContain('<ProjectInfoRebaseDialog');
    expect(editSource).toContain('const applyRebase = async');
  });

  it('submits against the version the rebase aligned to, not the stale store copy', () => {
    expect(editSource).toContain('expectedVersion: rebasedVersionRef.current || storedVersion');
    expect(editSource).toContain('rebasedVersionRef.current = result.canonicalVersion;');
    expect(editSource).toContain('rebasedVersionRef.current = 0;');
  });

  it('blocks confirmation until the owner has chosen a value for every conflict', () => {
    expect(dialogSource).toContain('disabled={busy || unresolvedCount > 0}');
    expect(dialogSource).toContain('내가 입력한 값');
    expect(dialogSource).toContain('최신 프로젝트 값');
    expect(dialogSource).toContain('자동으로 반영되는 항목');
  });

  it('exposes rebase on the draft client with resolutions optional for preview', () => {
    expect(clientSource).toContain('async rebase(');
    expect(clientSource).toContain('...(input.resolutions ? { resolutions: input.resolutions } : {})');
    expect(clientSource).toContain('export interface ProjectInfoRebaseResult');
  });
});
