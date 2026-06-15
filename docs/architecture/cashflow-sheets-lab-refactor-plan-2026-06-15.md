# Cashflow Sheets Lab Refactor Plan

Date: 2026-06-15

Branch baseline: `experiment/sheets-cashflow-projection-readonly` at `4b317b5`

Source diagnosis: `docs/architecture/cso-ponytail-refactoring-dialogue-2026-06-15.md`

## Goal

Make the current Sheets Lab behavior match the safe product boundary:

- Preview stays read-only.
- Java remains the only cashflow read-model authority.
- Apply/write fails closed unless the BFF Firestore project and Java Firestore project are explicitly the same environment.
- No new sync engine, no BFF cashflow calculator, no Sheet writeback.

The defect is not "formatted numbers were hard." That bug was real, but smaller. The bigger issue is cross-environment authority: the UI/BFF can read one Firebase project while Java writes another.

## Current Risk

`cashflow-sheet-lab/preview` is mostly acceptable because it is read-only and already exposes:

- `bffFirestoreProjectId`
- `javaFirestoreProjectId`
- `applyEnvironmentAligned`
- `valueSource: "java_cashflow_read_model"`

`cashflow-sheet-lab/apply` is the unsafe seam because it:

1. reads Sheet text,
2. parses it as cashflow amounts,
3. sends those values to Java,
4. can succeed while BFF and Java are pointed at different Firestore projects.

That creates a false success path. The user selected a project from one environment, but the write can land in another.

## Non-Negotiables

- Do not revive legacy BFF cashflow writes.
- Do not treat Sheet numeric cells as authoritative values in preview.
- Do not add AI sheet analysis.
- Do not add bidirectional sync.
- Do not add a generic workbook abstraction.
- Do not rename the lab into an import product.
- Do not let unknown environment IDs count as aligned.

## Plan

### Phase 1. Centralize Environment Alignment

Add one small BFF helper in `server/bff/routes/cashflow-sheet-lab.mjs`:

```js
function buildApplyEnvironmentPolicy({ bffProjectId, javaFirestoreProjectId }) {
  const bff = readOptionalText(bffProjectId);
  const java = readOptionalText(javaFirestoreProjectId);
  return {
    bffFirestoreProjectId: bff || null,
    javaFirestoreProjectId: java || null,
    applyEnvironmentAligned: Boolean(bff && java && bff === java),
  };
}
```

Use this helper in both:

- preview response `accessPolicy`
- apply route guard

Do not introduce a policy class. One helper is enough.

Acceptance:

- Preview still returns `200` when environments differ.
- Preview shows `applyEnvironmentAligned: false`.
- Missing project IDs produce `applyEnvironmentAligned: false`.

### Phase 2. Fail Closed On Apply

In `POST /api/v1/projects/:projectId/cashflow-sheet-lab/apply`, block before parsing Sheet values when the environment policy is not aligned.

Recommended response:

```text
409 cashflow_sheet_apply_environment_mismatch
```

Message:

```text
Apply is disabled because this lab preview reads one Firebase project while Java writes another. Align the environments before enabling apply.
```

Response body should include the same non-secret diagnostics already exposed by preview:

- `bffFirestoreProjectId`
- `javaFirestoreProjectId`
- `applyEnvironmentAligned: false`

Acceptance:

- Split Firestore apply does not call `javaWeeklyClient.applyCashflowSheetLab`.
- Missing BFF project ID blocks.
- Missing Java Firestore project ID blocks.
- Aligned IDs preserve the existing apply behavior.

### Phase 3. Invert The Misleading Test

Replace the current test named like:

```text
allows apply when BFF stores sheet config and Java owns cashflow read models in different Firestore projects
```

with:

```text
blocks apply when BFF and Java Firestore projects are different
```

Keep the formatted currency parsing test. It is still useful for any future aligned apply path.

Target tests:

- split Firestore returns `409`
- Java apply client is not called
- preview still returns mapping and `applyEnvironmentAligned: false`
- formatted amounts parse correctly when apply is allowed in an aligned fixture

### Phase 4. UI Copy, No New Flow

In `src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.tsx`, keep the lab framing and make the write boundary visible.

Do:

- show "Preview only" when `applyEnvironmentAligned` is false
- disable or hide any apply affordance in that state
- label values as "Sheet text" and "Internal ledger value"

Do not:

- add a wizard
- add a diagnostics dashboard
- add a new review modal
- make users choose between databases

Acceptance:

- A user cannot confuse Sheet-entered numbers with Java ledger values.
- The disabled apply state explains the environment mismatch in one sentence.
- There is no UI path that implies Sheet writeback or sync.

### Phase 5. Java Write-Side Follow-Up

BFF blocking is not enough if Java can be called directly.

Add a follow-up Java guard so `CASHFLOW_SHEET_LAB_APPLY_COMMAND` requires canonical project document existence, not just orphan project-scoped rows.

Smallest acceptable shape:

- keep legacy read compatibility in `FirestoreWeeklyProjectExistenceRepository`
- add a stricter write check for `cashflow-sheet-lab.apply`
- leave read commands unchanged

Likely files:

- `server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/service/FirestoreWeeklyProjectExistenceRepository.java`
- `server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/service/WeeklyExpenseAuthorizationService.java`
- `server/jvm-weekly-api/src/test/java/dev/merryai/innerplatform/weekly/service/WeeklyExpenseAuthorizationServiceTest.java`

Acceptance:

- existing read-model hydration still works for legacy project-scoped data
- `cashflow-sheet-lab.apply` cannot create or mutate data for a project that lacks the canonical project document

## Implementation Order

1. BFF helper and apply guard.
2. BFF tests, including inverted split-Firestore test.
3. UI disabled-state copy.
4. Java strict write-side guard.
5. Targeted tests only.

## Commands

Run the smallest useful checks:

```bash
npm test -- server/bff/routes/cashflow-sheet-lab.test.mjs
npm test -- src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.shell.test.ts
cd server/jvm-weekly-api && ./mvnw test -Dtest=WeeklyExpenseAuthorizationServiceTest
```

If the repo test runner does not support those exact selectors, use the nearest existing targeted command. Do not run a full unrelated suite first.

## Done Means

- Preview works exactly as before.
- Split-environment apply is blocked.
- Aligned-environment apply is the only path that can reach Java apply.
- Java has a direct-call write guard.
- The UI says "preview only" instead of pretending this is an import workflow.
- No new sync layer exists.

## Deferred

- PM apply permissions.
- Import workflow naming.
- Sheet-to-Java write product.
- Any data migration to align old orphan Java rows.
- Full security audit outside this Sheets Lab seam.
