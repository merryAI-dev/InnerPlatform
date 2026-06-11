# Java Cashflow Read Model Transition Plan

Captured: 2026-06-11  
Branch: `weekly-java-deployed-live-baseline`  
Scope: stage first. Weekly expense, bank statement wizard, cashflow actual/projection, week close, audit export.

## Decision

Do not copy the BFF `cashflow-weeks/upsert` endpoint into Java.

Actual flow must become:

```text
Bank statement / wizard
  -> weekly expense ledger save command
  -> Java row/cell validation
  -> Java actual recomputation
  -> Java cashflow read model
  -> cashflow screen reads the read model
```

The frontend must not write cashflow actuals. It may request a ledger save, show returned state, and read the Java cashflow snapshot.

## Current Failure

Stage frontend points `VITE_PLATFORM_API_BASE_URL` at the Java Cloud Run API. Some cashflow code still calls BFF-only routes:

- `POST /api/v1/projects/:projectId/cashflow-weeks/upsert`
- `POST /api/v1/projects/:projectId/cashflow-actuals/sync`

Those routes exist in the BFF, not in `WeeklyExpenseController`, so stage returns `404`.

The cashflow screen still reads Firestore `cashflowWeeks.actual` through `useCashflowWeeks`. That makes legacy actual values remain visible even after Java saves weekly expense rows.

Separately, bank import stores `signedAmount` as negative for withdrawals. That is correct for dedupe and direction, but `PortalBankStatementPage.buildInitialWizardDraft` currently leaks the signed value into the human-facing `사업비 사용액` input. UI amount fields must display absolute amounts. Direction must stay metadata.

## Policy

1. Weekly expense ledger is the source of actual.
2. Java owns validation, calculation, persistence, idempotency, audit export, and read model generation.
3. Cashflow actual is read-only in the frontend.
4. Projection can be edited only through the Java projection command.
5. Stage auth policy: Firebase/Google login plus `email.endsWith("@mysc.co.kr")` maps to `workspace_user`.
6. Stage must not require project membership gates for the scoped internal SaaS commands.
7. Live strictness can be restored later by auth mode, not by adding divergent frontend code.
8. Legacy Firestore actual must not silently mix into the canonical Java actual read model.

## Existing Code Leverage

| Area | Existing code | Keep or change |
|---|---|---|
| Java cashflow snapshot | `WeeklyExpenseController.cashflowSnapshot` | Keep. Make it the cashflow read path. |
| Java projection write | `POST /api/v1/cashflow/{projectId}/projection` | Keep. Use for projection edits. |
| Java actual recompute | `WeeklyExpenseCommandService.saveDraft` plus persistence `replaceActuals` | Keep, but verify it runs on every ledger save. |
| Workspace auth | `WeeklyExpenseAuthorizationService.WORKSPACE_COMMANDS` | Keep. Ensure new read/write commands are included. |
| BFF actual upsert | `server/bff/routes/cashflow-exports.mjs` | Do not port. Remove frontend dependency. |
| Cashflow frontend store | `src/app/data/cashflow-weeks-store.tsx` | Split projection write from actual read, remove actual write APIs. |
| Cashflow screen | `CashflowProjectSheet` | Read actual from Java snapshot, not Firestore legacy actual. |
| Bank wizard amount seed | `PortalBankStatementPage.buildInitialWizardDraft` | Change withdrawal display to absolute amount. |

## Implementation Plan

### Stage 1: Kill Frontend Actual Writes

Remove frontend calls that write or sync cashflow actuals directly:

- `upsertCashflowWeekAmountsViaBff` for `mode: "actual"`
- `syncProjectCashflowActualsViaBff`
- `SettlementLedgerPage.syncImportRowsToCashflow` fallback loop that calls `upsertWeekAmounts`
- retry effect that re-runs failed cashflow sync after save

Replacement behavior:

- Ledger save command returns success or failure.
- UI displays ledger save status only.
- If actual needs refresh, call Java cashflow snapshot read after save. Do not write actual from the frontend.

Fail condition:

- Any frontend code path can POST actual amounts to `cashflow-weeks/upsert`.
- Any shell test expects `syncProjectCashflowActualsViaBff` to remain.

### Stage 2: Hydrate Cashflow From Java Snapshot

Add a Java snapshot client for:

```text
GET /api/v1/cashflow/{projectId}
```

Use it on `/portal/cashflow` for:

- projection lines
- actual lines
- per-week read model

Projection edits continue to call:

```text
POST /api/v1/cashflow/{projectId}/projection
```

Fail condition:

- Cashflow actual renders from `doc.actual` in Firestore `cashflowWeeks`.
- Old Firestore actual can appear as canonical actual without Java snapshot.

### Stage 3: Stop Legacy Actual From Polluting Canonical Reads

Review `FirestoreCashflowWeekActualMerge` and `FirestoreInheritedWeeklyExpensePersistence.readActualLines`.

Required stage behavior:

- If `weeklyExpenseActualBySheet` exists, read only that by-sheet model.
- Do not inject `__legacy_cashflow_weeks__` into canonical stage actual.
- If legacy actual is needed for audit history, expose it separately, never as canonical current actual.

Fail condition:

- Java snapshot returns old `actual` rows that were never produced by current weekly expense ledger saves.

### Stage 4: Preserve Internal Signed Amount, Fix UI Amounts

Keep negative `signedAmount` internally for:

- duplicate key
- direction
- cashflow line direction
- import canonicalization

Show absolute values in human input fields:

- `통장에 찍힌 입/출금액`
- `사업비 사용액`
- `입금액`
- VAT split fields

Fail condition:

- Withdrawal wizard draft starts with a negative `사업비 사용액`.
- Tests assert `expenseAmount: formatNumberDraft(signedAmount)` for withdrawals.

### Stage 5: Auth Boundary Verification

For stage, Java must accept `workspace_user` for:

- bank statement import/list/apply
- weekly expense save/read/cell commands
- cashflow snapshot read
- projection upsert
- week close
- audit export

Actor logging:

- `actorId`
- `actorEmail`
- `actorName`
- `actorRole = workspace_user`
- timestamp

Fail condition:

- `@mysc.co.kr` Google user gets 403 on any scoped stage command above.
- Frontend bypasses Java calculation because Java auth is inconvenient.

## Architecture Target

```text
Firebase Auth
  -> frontend actor headers
  -> Java InternalServiceTokenFilter
  -> workspace_user
  -> Java command service

Bank statement upload
  -> Java import batch
  -> staged import lines
  -> wizard drafts in frontend temp state
  -> Java apply/save command
  -> weekly expense rows
  -> actual recomputation
  -> cashflow read model

Cashflow screen
  -> Java cashflow snapshot
  -> display projection vs actual
  -> projection edits through Java projection command
```

## Tests Required

### Frontend Tests

- Cashflow screen does not import or call `syncProjectCashflowActualsViaBff`.
- Cashflow screen does not render actual from Firestore `doc.actual`.
- Weekly expense save does not trigger `cashflow-weeks/upsert`.
- Wizard withdrawal amount seed uses absolute amount.
- Projection edit still calls Java projection command.
- Stage API base cannot be `/`, localhost, or Vercel for weekly/cashflow Java flows.

### Java Tests

- `workspace_user` can call cashflow snapshot, projection upsert, week close, audit export, bank import/apply, weekly save.
- `workspace_user` with non-`@mysc.co.kr` email is rejected before command execution.
- Save draft recomputes actual and replaces stale by-sheet values for the same sheet.
- Java snapshot excludes legacy actual from canonical stage current actual.
- Cashflow read model totals match the saved ledger rows.

### Stage Smoke

Use a real `@mysc.co.kr` stage login:

1. Upload bank statement.
2. Select rows.
3. Open wizard.
4. Confirm ledger save.
5. Open weekly expense ledger, rows are appended/updated as expected.
6. Open cashflow, actual appears from Java snapshot.
7. Edit projection, save through Java.
8. Close week.
9. Create audit export.
10. Confirm no calls to `/cashflow-weeks/upsert` or `/cashflow-actuals/sync`.

## Review Scorecard

Target score: 100.

| Category | Weight | Pass criteria |
|---|---:|---|
| Actual authority | 25 | No frontend/BFF actual writes remain. |
| Java auth clarity | 20 | Stage workspace user succeeds, non-domain users fail. |
| Cashflow read model | 20 | Cashflow screen reads Java snapshot and excludes stale legacy actual. |
| Ledger integrity | 15 | Weekly expense rows drive actual, not UI calculation. |
| UI thinness | 10 | Frontend displays, routes, and submits commands only. |
| Tests and smoke | 10 | Unit, shell, Java, and stage smoke cover the flow. |

Blockers:

- Any `404` from BFF-only cashflow routes.
- Any `403` for `@mysc.co.kr` workspace user in scoped stage commands.
- Any direct frontend actual upsert.
- Any stale legacy actual rendered as current actual.
- Any negative withdrawal amount shown in human-facing wizard input.

## Not In Scope

- PostgreSQL migration.
- Rebuilding the full budget UI.
- Adding Java copies of BFF cashflow actual upsert routes.
- Tight live project membership enforcement changes.
- New in-app explanatory policy text.

## Decision Audit Trail

| # | Decision | Classification | Rationale |
|---|---|---|---|
| 1 | Do not port BFF actual upsert to Java | Mechanical | It preserves the wrong authority model and keeps frontend actual writes alive. |
| 2 | Read cashflow actual from Java snapshot | Mechanical | Actual is produced by Java ledger calculation, so display must read the same authority. |
| 3 | Keep signedAmount internal, show absolute UI amounts | Mechanical | Sign is useful for direction, but users should not edit negative expense amounts. |
| 4 | Stage workspace_user can run scoped commands | Mechanical | Internal SaaS QA requires low-friction stage access while keeping actor logs. |
| 5 | Legacy actual cannot be canonical current actual | Mechanical | Otherwise stale cashflow values survive the migration and hide broken recomputation. |
