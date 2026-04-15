import { describe, expect, it } from 'vitest';

import {
  evaluatePatchNotesGuard,
  resolveRequiredPatchNotePages,
} from '../../../scripts/check_patch_notes_guard.mjs';

describe('resolveRequiredPatchNotePages', () => {
  it('maps changed weekly expense files to the weekly expense patch note page', () => {
    expect(
      resolveRequiredPatchNotePages([
        'src/app/components/portal/PortalWeeklyExpensePage.tsx',
      ]),
    ).toEqual(['docs/wiki/patch-notes/pages/portal-weekly-expense.md']);
  });

  it('deduplicates repeated matches and keeps a stable order', () => {
    expect(
      resolveRequiredPatchNotePages([
        'src/app/components/portal/PortalWeeklyExpensePage.tsx',
        'src/app/components/portal/PortalWeeklyExpensePage.tsx',
        'src/app/components/portal/PortalBankStatementPage.tsx',
      ]),
    ).toEqual([
      'docs/wiki/patch-notes/pages/portal-weekly-expense.md',
      'docs/wiki/patch-notes/pages/portal-bank-statement.md',
    ]);
  });

  it('maps shared policy files to the shared label policy page', () => {
    expect(
      resolveRequiredPatchNotePages([
        'src/app/policies/cashflow-policy.json',
        'src/app/platform/policies/cashflow-policy.ts',
      ]),
    ).toEqual(['docs/wiki/patch-notes/pages/shared-label-policy.md']);
  });

  it('returns an empty list for unrelated infra changes', () => {
    expect(
      resolveRequiredPatchNotePages([
        'server/bff/app.mjs',
        'package.json',
      ]),
    ).toEqual([]);
  });
});

describe('evaluatePatchNotesGuard', () => {
  it('passes when there are no mapped surface changes', () => {
    expect(
      evaluatePatchNotesGuard({
        stagedFiles: ['server/bff/app.mjs'],
      }),
    ).toMatchObject({
      ok: true,
      requiredPages: [],
      missingPages: [],
      requiresLog: false,
      hasLog: false,
    });
  });

  it('fails when a mapped surface changed but its patch note page was not staged', () => {
    expect(
      evaluatePatchNotesGuard({
        stagedFiles: ['src/app/components/portal/PortalWeeklyExpensePage.tsx'],
      }),
    ).toMatchObject({
      ok: false,
      requiredPages: ['docs/wiki/patch-notes/pages/portal-weekly-expense.md'],
      missingPages: ['docs/wiki/patch-notes/pages/portal-weekly-expense.md'],
      requiresLog: true,
      hasLog: false,
    });
  });

  it('fails when page docs are staged but log is missing', () => {
    expect(
      evaluatePatchNotesGuard({
        stagedFiles: [
          'src/app/components/portal/PortalWeeklyExpensePage.tsx',
          'docs/wiki/patch-notes/pages/portal-weekly-expense.md',
        ],
      }),
    ).toMatchObject({
      ok: false,
      missingPages: [],
      requiresLog: true,
      hasLog: false,
    });
  });

  it('passes when both the page docs and log are staged together', () => {
    expect(
      evaluatePatchNotesGuard({
        stagedFiles: [
          'src/app/components/portal/PortalWeeklyExpensePage.tsx',
          'src/app/components/portal/PortalBankStatementPage.tsx',
          'docs/wiki/patch-notes/pages/portal-weekly-expense.md',
          'docs/wiki/patch-notes/pages/portal-bank-statement.md',
          'docs/wiki/patch-notes/log.md',
        ],
      }),
    ).toMatchObject({
      ok: true,
      missingPages: [],
      requiresLog: true,
      hasLog: true,
    });
  });
});
