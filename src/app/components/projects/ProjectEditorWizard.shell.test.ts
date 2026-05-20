import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectEditorWizard.tsx'), 'utf8');

describe('ProjectEditorWizard dropdown contract', () => {
  it('renders editor dropdowns from canonical option maps instead of surface-local labels', () => {
    expect(source).toContain('getProjectTypeSelectableOptions');
    expect(source).toContain('PROJECT_TYPE_LABELS[type]');
    expect(source).toContain('getProjectContractTypeSelectableOptions');
    expect(source).toContain('normalizeProjectContractType');
    expect(source).toContain('SETTLEMENT_TYPE_LABELS');
    expect(source).toContain('BASIS_LABELS');
    expect(source).toContain('ACCOUNT_TYPE_LABELS');
    expect(source).toContain('PROJECT_FUND_INPUT_MODE_LABELS');
    expect(source).not.toContain('<Input value={draft.contractType}');
  });

  it('keeps select values representable in their option lists', () => {
    expect(source).toContain('const managerOptions = useMemo');
    expect(source).toContain('uid: draft.managerId');
    expect(source).toContain("if (value === 'none')");
    expect(source).toContain("updateTeamMember(index, { memberName: '', memberNickname: '' })");
  });
});
