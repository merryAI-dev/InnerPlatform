import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readPortalSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

describe('portal autosave policy', () => {
  it('does not silently autosave bank statement edits while QA is validating flows', () => {
    const source = readPortalSource('PortalBankStatementPage.tsx');

    expect(source).not.toContain('window.setTimeout(() => {\n      void persistSheet');
  });

  it('only saves bank statement edits explicitly before opening the apply wizard', () => {
    const source = readPortalSource('PortalBankStatementPage.tsx');
    const applySelectedBlock = source.slice(
      source.indexOf('const handleApplySelected = useCallback'),
      source.indexOf('const updateWizardDraft = useCallback'),
    );

    expect(applySelectedBlock).toContain('await persistSheet({ silent: true })');
  });

  it('does not attach project editor autosave from portal register or edit screens', () => {
    expect(readPortalSource('PortalProjectRegister.tsx')).not.toContain('autosave=');
    expect(readPortalSource('PortalProjectEdit.tsx')).not.toContain('autosave=');
  });
});
