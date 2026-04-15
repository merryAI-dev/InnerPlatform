import { execSync } from 'node:child_process';

const PATCH_NOTES_LOG = 'docs/wiki/patch-notes/log.md';

const SURFACE_TO_PATCH_NOTE_RULES = [
  {
    match: 'src/app/components/portal/PortalWeeklyExpensePage.tsx',
    page: 'docs/wiki/patch-notes/pages/portal-weekly-expense.md',
  },
  {
    match: 'src/app/components/portal/PortalBankStatementPage.tsx',
    page: 'docs/wiki/patch-notes/pages/portal-bank-statement.md',
  },
  {
    match: 'src/app/components/portal/PortalBudget.tsx',
    page: 'docs/wiki/patch-notes/pages/portal-budget.md',
  },
  {
    match: 'src/app/components/portal/PortalSubmissionsPage.tsx',
    page: 'docs/wiki/patch-notes/pages/portal-submissions.md',
  },
  {
    match: 'src/app/components/portal/PortalDashboard.tsx',
    page: 'docs/wiki/patch-notes/pages/portal-dashboard.md',
  },
  {
    match: 'src/app/data/portal-store.tsx',
    page: 'docs/wiki/patch-notes/pages/shared-portal-architecture.md',
  },
  {
    match: 'src/app/data/payroll-store.tsx',
    page: 'docs/wiki/patch-notes/pages/portal-dashboard.md',
  },
  {
    match: 'src/app/components/participation/ParticipationPage.tsx',
    page: 'docs/wiki/patch-notes/pages/admin-participation.md',
  },
  {
    match: 'src/app/components/dashboard/DashboardPage.tsx',
    page: 'docs/wiki/patch-notes/pages/admin-dashboard.md',
  },
  {
    match: 'src/app/components/auth/LoginPage.tsx',
    page: 'docs/wiki/patch-notes/pages/portal-onboarding.md',
  },
  {
    match: 'src/app/components/auth/WorkspaceSelectPage.tsx',
    page: 'docs/wiki/patch-notes/pages/portal-onboarding.md',
  },
  {
    match: 'src/app/policies/cashflow-policy.json',
    page: 'docs/wiki/patch-notes/pages/shared-label-policy.md',
  },
  {
    match: 'src/app/platform/policies/cashflow-policy.ts',
    page: 'docs/wiki/patch-notes/pages/shared-label-policy.md',
  },
  {
    match: 'server/bff/cashflow-policy.mjs',
    page: 'docs/wiki/patch-notes/pages/shared-label-policy.md',
  },
];

function normalizePath(filePath) {
  return String(filePath || '').replaceAll('\\', '/').trim();
}

export function resolveRequiredPatchNotePages(stagedFiles) {
  const pages = [];
  const seen = new Set();
  for (const rawFile of stagedFiles) {
    const file = normalizePath(rawFile);
    for (const rule of SURFACE_TO_PATCH_NOTE_RULES) {
      if (!file.endsWith(rule.match)) continue;
      if (seen.has(rule.page)) continue;
      seen.add(rule.page);
      pages.push(rule.page);
    }
  }
  return pages;
}

export function evaluatePatchNotesGuard({ stagedFiles }) {
  const normalized = stagedFiles.map(normalizePath).filter(Boolean);
  const stagedSet = new Set(normalized);
  const requiredPages = resolveRequiredPatchNotePages(normalized);
  const missingPages = requiredPages.filter((page) => !stagedSet.has(page));
  const requiresLog = requiredPages.length > 0;
  const hasLog = stagedSet.has(PATCH_NOTES_LOG);

  return {
    ok: missingPages.length === 0 && (!requiresLog || hasLog),
    requiredPages,
    missingPages,
    requiresLog,
    hasLog,
  };
}

function readStagedFilesFromGit() {
  const output = execSync('git diff --cached --name-only --diff-filter=ACMR', {
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function runPatchNotesGuard() {
  if (process.env.SKIP_PATCH_NOTES_GUARD === '1') {
    return { ok: true, skipped: true };
  }

  const stagedFiles = readStagedFilesFromGit();
  const result = evaluatePatchNotesGuard({ stagedFiles });
  if (result.ok) {
    return { ok: true, skipped: false, ...result };
  }

  console.error('\x1b[31m✗ Patch note checklist update is missing.\x1b[0m');
  if (result.missingPages.length > 0) {
    console.error('  Stage the matching page patch note files:');
    for (const page of result.missingPages) {
      console.error(`  - ${page}`);
    }
  }
  if (result.requiresLog && !result.hasLog) {
    console.error(`  - ${PATCH_NOTES_LOG}`);
  }
  console.error('  If this commit truly should bypass the guard, use SKIP_PATCH_NOTES_GUARD=1.');
  return { ok: false, skipped: false, ...result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runPatchNotesGuard();
  process.exit(result.ok ? 0 : 1);
}
