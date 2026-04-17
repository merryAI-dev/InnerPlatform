import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');
const saveEvidenceRequiredMapStart = portalStoreSource.indexOf(
  'const saveEvidenceRequiredMap = useCallback(async (map: Record<string, string>) => {',
);
const markSheetSourceAppliedStart = saveEvidenceRequiredMapStart >= 0
  ? portalStoreSource.indexOf('const markSheetSourceApplied = useCallback(async (input: {', saveEvidenceRequiredMapStart)
  : -1;
const saveEvidenceRequiredMapSource = saveEvidenceRequiredMapStart >= 0 && markSheetSourceAppliedStart > saveEvidenceRequiredMapStart
  ? portalStoreSource.slice(saveEvidenceRequiredMapStart, markSheetSourceAppliedStart)
  : '';
const platformBranchStart = saveEvidenceRequiredMapSource.indexOf('if (isPlatformApiEnabled() && !isDevHarnessUser) {');
const fallbackBranchStart = saveEvidenceRequiredMapSource.indexOf('const now = new Date().toISOString();', platformBranchStart);
const platformBranchSource = platformBranchStart >= 0 && fallbackBranchStart > platformBranchStart
  ? saveEvidenceRequiredMapSource.slice(platformBranchStart, fallbackBranchStart)
  : '';
const fallbackBranchSource = fallbackBranchStart >= 0
  ? saveEvidenceRequiredMapSource.slice(fallbackBranchStart)
  : '';

describe('portal evidence required map command boundary', () => {
  it('routes platform-mode evidence map saves through the portal command and leaves the Firestore fallback unchanged', () => {
    expect(portalStoreSource).toContain('savePortalEvidenceRequiredMapViaBff');
    expect(portalStoreSource).toContain('/api/v1/portal/evidence-required-map/save');
    expect(platformBranchSource).toContain('if (isPlatformApiEnabled() && !isDevHarnessUser) {');
    expect(platformBranchSource).toContain('if (!authUser) {');
    expect(platformBranchSource).toContain("throw new Error('Platform API requires an authenticated actor for evidence requirement saves.');");
    expect(platformBranchSource).not.toContain('updatedAt: now');
    expect(platformBranchSource).not.toContain('updatedBy: portalUser?.name || authUser?.name ||');
    expect(fallbackBranchSource).toContain('await setDoc(');
  });
});
