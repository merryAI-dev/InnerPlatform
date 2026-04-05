# Settlement Product Completeness Release Gate Runbook

## Purpose

Use this runbook to decide whether the settlement local-kernel slice is release-complete as a product, not just as a code change.

Source documents:

- `docs/superpowers/specs/2026-04-05-settlement-product-completeness-design.md`
- `docs/superpowers/plans/2026-04-05-settlement-product-completeness.md`

This gate is stricter than the current GitHub Actions workflow in `.github/workflows/ci.yml`, which today runs the settlement-targeted Vitest, Playwright harness, emulator integration, and build checks. Treat this document as the authoritative release checklist for whether those checks are sufficient to call the slice product-ready.

## Hard Gates

All four gates must be `PASS` before calling the slice release-complete.

### Gate 1: Targeted Vitest

Purpose:

- Prove the browser-side settlement rules and store orchestration regressions are covered.
- Catch settlement-specific breakage without requiring the full suite.

Command:

```bash
npx vitest run src/app/platform/settlement-calculation-kernel.test.ts src/app/platform/weekly-accounting-state.test.ts src/app/platform/navigation.test.ts src/app/data/portal-store.settlement.test.ts src/app/data/portal-store.integration.test.ts src/app/data/cashflow-weeks-store.integration.test.ts
```

Expected scope:

- Pure calculation regression coverage
- Browser/store settlement save preparation coverage
- Settlement-specific browser integration coverage
- Refresh-churn and workspace-selection continuity coverage

### Gate 2: Playwright Harness

Purpose:

- Prove the PM-facing product flow closes end-to-end in the dev auth harness.
- Cover `wizard apply -> save -> budget -> cashflow -> refresh` and manual-pending/review-required behavior.

Command:

```bash
npm run test:e2e -- tests/e2e/platform-smoke.spec.ts tests/e2e/migration-wizard.harness.spec.js tests/e2e/settlement-product-completeness.spec.ts
```

Notes:

- `npm run test:e2e` uses `playwright.harness.config.mjs`.
- The harness starts `npm run dev` with `VITE_DEV_AUTH_HARNESS_ENABLED=true` and serves `http://localhost:4173`.
- Passing Gate 2 now explicitly includes:
  - `wizard apply -> reload -> rows restored`
  - dirty weekly-expense edits are guarded before route navigation
  - no hard reload on the weekly-expense happy path

### Gate 3: Production Build

Purpose:

- Prove the release artifact still builds after the settlement completeness changes.

Command:

```bash
npm run build
```

Expected scope:

- Vite production build succeeds
- No TypeScript/import/lazy-load regressions introduced by the slice

### Gate 4: Emulator-Backed Integration

Purpose:

- Prove the persistence boundary works against a real Firestore emulator path.
- Exercise the BFF integration suite under emulator control, not mocked storage only.

Commands:

```bash
npm run firebase:emulators:prepare
npm run test:settlement:integration
```

Notes:

- `npm run firebase:emulators:prepare` generates `.env.local` and `.firebaserc`.
- `npm run test:settlement:integration` runs `scripts/test_settlement_product_completeness_integration.sh`, which starts Firestore emulator execution with `firebase-tools emulators:exec` and runs only the settlement-specific persistence tests.
- This gate is intentionally slice-scoped. Do not widen it to the full BFF integration matrix until the unrelated failing suites are stabilized.

## Gate Interpretation

### PASS

- Command exits `0`.
- The settlement-specific files for that gate exist and ran.
- No targeted test is skipped for missing infra or missing files.

Release meaning:

- Gate is closed.

### PARTIAL PASS

- Command exits `0`, but the settlement completeness slice is not fully represented.

Examples:

- Gate 1 passes on current files, but `src/app/data/portal-store.integration.test.ts` and `src/app/data/cashflow-weeks-store.integration.test.ts` do not exist yet.
- Gate 2 passes on `platform-smoke` and `migration-wizard.harness`, but `tests/e2e/settlement-product-completeness.spec.ts` is not present yet.
- Gate 4 passes broadly, but there is no settlement-specific BFF integration assertion in the emulator suite yet.

Release meaning:

- Not release-complete. Treat as progress evidence only.

### BLOCKED

- The gate cannot be exercised in a meaningful way.

Examples:

- Planned test file is missing.
- Playwright harness cannot boot the dev server.
- Firestore emulator cannot start because Java 21+ is unavailable.
- Emulator-backed tests are skipped because `FIRESTORE_EMULATOR_HOST` or emulator execution never came up.

Release meaning:

- Stop. Fix the environment or land the missing gate artifact before proceeding.

### FAIL

- Command exits non-zero.
- Or the command exits `0` but targeted settlement assertions failed inside the run.

Release meaning:

- Stop. Investigate and fix before merge.

## Release Decision Rule

- `Ready`: all four gates are `PASS`.
- `Not ready`: any gate is `PARTIAL PASS`, `BLOCKED`, or `FAIL`.

## Recommended Local Order

Run in this order so failures narrow quickly:

```bash
npm test -- src/app/platform/settlement-calculation-kernel.test.ts src/app/platform/weekly-accounting-state.test.ts src/app/data/portal-store.settlement.test.ts src/app/data/portal-store.integration.test.ts src/app/data/cashflow-weeks-store.integration.test.ts
npx playwright test tests/e2e/migration-wizard.harness.spec.js tests/e2e/settlement-product-completeness.spec.ts --config playwright.harness.config.mjs
npm run build
npm run firebase:emulators:prepare
npm run test:settlement:integration
```

Interpretation:

- If Gate 1 fails, stop before browser or emulator work.
- If Gate 2 fails, treat the product flow as open even if unit tests are green.
- If Gate 3 fails, do not merge even if the targeted tests pass.
- If Gate 4 is blocked or partial, do not call persistence/retry behavior release-complete.
