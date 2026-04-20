import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');

describe('portal weekly submission status command boundary', () => {
  it('routes platform-mode weekly submission status writes through the portal command and keeps the Firestore fallback', () => {
    expect(portalStoreSource).toContain('const upsertWeeklySubmissionStatus = useCallback(async (input: {');
    expect(portalStoreSource).toContain('savePortalWeeklySubmissionStatusViaBff');
    expect(portalStoreSource).toContain('if (isPlatformApiEnabled() && !isDevHarnessUser) {');
    expect(portalStoreSource).toContain("throw new Error('Platform API requires an authenticated actor for weekly submission status updates.');");
    expect(portalStoreSource).toContain('/api/v1/portal/weekly-submission-status/upsert');
    expect(portalStoreSource).toContain('await savePortalWeeklySubmissionStatusViaBff({');
    expect(portalStoreSource).toContain('await setDoc(ref, patch, { merge: true });');
  });
});
