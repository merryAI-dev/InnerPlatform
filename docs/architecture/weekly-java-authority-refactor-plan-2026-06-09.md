# Weekly Java Authority Refactor Plan

Date: 2026-06-09
Status: plan ready, not yet implemented
Scope: weekly expense, bank statement intake, cashflow projection/actual, audit export, stage/live deploy gates

## Source Inputs

This plan combines:

- prior independent review-agent findings from the weekly Java API refactor thread
- `codex-stack-cso` security review criteria
- `codex-stack-autoplan` CEO, design, engineering, and DX review criteria
- the active backend authority policy in
  [`weekly-expense-backend-authority-gate-2026-06-08.md`](./weekly-expense-backend-authority-gate-2026-06-08.md)
- the active storage sequencing decision in
  [`weekly-expense-firestore-inheritance-postgres-roadmap-2026-06-08.md`](./weekly-expense-firestore-inheritance-postgres-roadmap-2026-06-08.md)

## Objective

The target is not "make the login error disappear." The target is that BFF removal does not break
weekly expense, bank intake, cashflow actual/projection, or audit export operation in stage/live.

The near-term architecture is:

```text
Browser Firebase Auth
  -> scoped Firebase ID token Bearer header
  -> Java weekly command/read contracts
  -> inherited Firestore-shaped documents
```

The longer-term architecture is:

```text
Browser Firebase Auth
  -> scoped Firebase ID token Bearer header
  -> Java ORM command/read contracts
  -> PostgreSQL canonical row/cell/projection/actual/audit tables
```

PostgreSQL remains valuable, but it is Phase 2. Phase 1 must first close authority leaks while
preserving the existing Firestore data shape.

## Non-Negotiable Invariants

1. Firebase Auth remains the browser identity provider.
2. Java API owns weekly validation, calculation, persistence, idempotency, permission checks, and audit events.
3. Frontend is input and display only. It may build command payloads, but it must not calculate authoritative actuals or write audit-relevant state.
4. Google Sheet and Excel are outputs for audit and external review. They are not the operational source of truth.
5. Stage and live fail closed. No BFF fallback, no same-origin Vercel API rewrite fallback, no local harness fallback.
6. Existing Firestore data must not be deleted or destructively migrated.
7. Every feature is a minimum audit unit: one business action, one permission check, one transaction boundary, one audit event.

## Current State Assessment

Resolved or materially improved:

- Stage authentication authority was fixed by pinning the Java API Firebase Auth project to `mysc-bmp-14173451` while keeping stage Firestore writes in `inner-platform-qa-20260310`.
- Stage Java API smoke passed with Firebase identity-token Bearer flow.
- Browser API base URL logic rejects same-origin Vercel preview rewrites in stage/live mode.
- `FirestoreInheritedWeeklyExpensePersistence` exists and can inherit the current Firestore-shaped weekly data.
- Bank import batch IDs no longer depend on predictable input IDs.
- Legacy `cashflow_weeks.actual` values are preserved under a legacy key when weekly actuals are merged.
- Firestore sheet mapping has tests around `tempId`, `sourceTxId`, and map/list cell preservation.
- Idempotency replay now rejects project and command mismatches.

Still open and must be treated as refactor blockers:

- Idempotency storage identity is still too broad if the physical key remains only tenant plus idempotency key. It must include tenant, project, command, and idempotency key in both Firestore and JPA paths.
- `InternalServiceTokenFilter` still contains a service-token path that can bypass the browser session model when enabled. For this domain, remove it or restrict it to named server jobs with a synthetic service actor and no caller-supplied actor trust.
- Firestore transaction behavior needs emulator or integration proof. The adapter must prove read-before-write, row identity preservation, actual replacement, audit write, and idempotency write are one command transaction.
- Firestore backend mode must not secretly require PostgreSQL/Flyway/JPA runtime boot dependencies unless that dependency is intentionally documented and smoke-tested.
- Cashflow aggregate/list screens need Java read coverage. Stage/live must not show empty weeks or Firestore-derived fallback when Java is enabled.
- Frontend bank apply/projection helper paths must be removed or hard-fenced in platform API mode. Server `applyBankStatementItems` is the authority.
- Audit export needs a reproducible manifest: projection snapshot, actual snapshot, audit event range/count, source document IDs, read timestamp or revision, and artifact hash.
- Policy tests that only assert source strings are insufficient. They need behavior tests for "no direct weekly writes", "no BFF weekly fallback", and "stage/live fail closed."
- Understand graph output must be refreshed before the next stage promotion so isolated or leaking nodes are reviewed against the current branch, not an earlier architecture.

## Refactor Stages

### Stage 0: Freeze Scope And Gates

Do this before changing behavior.

- Freeze scope to weekly expense, bank statement intake, cashflow weekly actual/projection, and audit export.
- Explicitly defer whole-ERP Firestore direct-write cleanup unless a path touches the weekly/cashflow audit domain.
- Record the fixed stage URL as `https://inner-platform-stage-merryai-devs-projects.vercel.app`.
- Block live promotion unless all gates in this document pass.

Pass condition:

- The plan is committed.
- Stage URL, Java API base URL, Firebase Auth project, Firestore project, and Cloud Run service account are written in the deploy runbook.

### Stage 1: Auth Authority Hardening

Keep Firebase Auth as the identity provider and use Firebase ID tokens as the browser-direct Java API credential.

Required changes:

- Do not expose `/api/v1/auth/session` as a required browser session establishment path.
- Require Java weekly/cashflow calls to send `Authorization: Bearer <Firebase ID token>` with `credentials: omit`.
- Scope Bearer injection to the Java weekly/cashflow routing client so legacy BFF routes do not receive Firebase ID tokens.
- Add a stage/live environment assertion for:
  - `JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID=mysc-bmp-14173451`
  - `JVM_WEEKLY_FIRESTORE_PROJECT_ID=inner-platform-qa-20260310` for stage
  - `JVM_WEEKLY_INTERNAL_API_TOKEN_ENABLED=false` unless a named internal job requires it
- Remove or hard-restrict the internal service-token path for weekly/cashflow user actions.
- Add a smoke that fails if Firebase Bearer Java calls return 400, 401, or 500.

Pass condition:

- Browser Google login provides a Firebase ID token to the Java routing client.
- A weekly/cashflow Java API request succeeds with automatically scoped Bearer auth.
- A spoofed actor header is rejected.
- A missing, expired, or wrong-project Firebase token is rejected.

### Stage 2: Persistence Authority Hardening

The Firestore adapter is the near-term canonical adapter. JPA/PostgreSQL remains a contract-compatible future adapter.

Required changes:

- Change idempotency key storage to tenant plus project plus command plus idempotency key.
- Add adapter contract tests that run the same command scenarios against JPA and Firestore adapter implementations.
- Add Firestore emulator/integration coverage for:
  - save draft with existing rows
  - paste/copy preserving source row identity rules
  - bank apply creating weekly rows
  - actual recalculation and cashflow merge
  - audit event write
  - idempotency conflict and replay
- Verify that Firestore backend mode can boot without an accidental live PostgreSQL dependency, or explicitly fail with a clear deploy-time error.

Pass condition:

- A command either commits sheet, actual, audit, and idempotency together or commits none of them.
- Replayed commands return the original response only for the same tenant, project, command, request hash, and actor scope.
- Existing Firestore rows and legacy actual values survive round trips.

### Stage 3: Cashflow Read Model Closure

Cashflow must follow the same authority policy as weekly expense.

Required changes:

- Ensure Java exposes every read needed by `/portal/cashflow` and `/portal/weekly-expenses`:
  - project cashflow snapshot
  - projection lines
  - actual lines
  - weekly submission/status lines
  - audit export summary
- Make stage/live cashflow read Java first and fail visibly if Java is unavailable.
- Remove empty-array or Firestore-direct fallback for platform API mode.
- Add totals and week mapping regression tests for projection versus actual.

Pass condition:

- BFF routes can be disabled without breaking weekly expense or cashflow reads.
- Cashflow actual shown in the UI equals Java-calculated actual.
- Projection shown in the UI equals Java-read projection.

### Stage 4: Frontend Thinness Cleanup

Frontend must stop acting like a backend.

Required changes:

- Remove or fence frontend helpers that derive weekly rows from bank statement items in platform API mode.
- Remove frontend write paths for weekly rows, cashflow actual, weekly status, bank apply state, and audit export artifacts in platform API mode.
- Keep only local draft text and provisional UI validation in React.
- Ensure ERP UI does not expose unapproved engineering terms or migration controls.
- Keep copy, paste, cut, shallow copy, and deep copy as server commands, not frontend-calculated persistence operations.

Pass condition:

- Source policy tests prove weekly/cashflow platform mode uses Java contracts.
- Behavior tests prove frontend cannot mark authoritative save/actual/export state without a Java response.
- No unapproved buttons, labels, tooltips, comments, or migration terms appear in rendered ERP UI.

### Stage 5: Audit Export Reproducibility

Audit export must be reproducible from backend state.

Required changes:

- Add an audit export manifest containing:
  - tenant, project, sheet key
  - actor uid and email
  - projection snapshot source and count
  - actual snapshot source and count
  - audit event range and count
  - Firestore source document IDs
  - read timestamp or revision marker
  - generated artifact hash
- Generate Google Sheet/Excel output only from backend-approved projection, actual, and audit summary.
- Store export metadata before returning the artifact reference.

Pass condition:

- The same export manifest can explain exactly which state produced an external audit artifact.
- Frontend-local spreadsheet state cannot produce an audit artifact on its own.

### Stage 6: Stage Deploy Gate

Every stage promotion must run the full gate. A single fail blocks the next stage.

Required checks:

```bash
node scripts/verify_weekly_bff_free_policy.mjs
npm test -- --run src/app/platform/backend-authority-policy.shell.test.ts src/app/platform/api-session.test.ts src/app/lib/platform-bff-client.test.ts src/app/data/portal-store.bank-statement-flow.shell.test.ts
mvn -f server/jvm-weekly-api/pom.xml test
node scripts/smoke_jvm_weekly_api.mjs --require-identity-token --base-url=<stage-cloud-run-url>
gcloud builds submit --config cloudbuild.jvm-weekly-api.yaml .
```

Required manual/browser checks:

- Open `https://inner-platform-stage-merryai-devs-projects.vercel.app`.
- Login with Google.
- Confirm no Firebase unauthorized-domain error.
- Confirm the frontend bundle does not call `/api/v1/auth/session`.
- Confirm Java weekly/cashflow calls carry a Firebase Bearer token and do not use cookies.
- Confirm weekly expense can read, save, apply bank items, and export audit summary through Java.
- Confirm cashflow projection and actual read from Java.

Pass condition:

- Score is 100/100.
- No P0/P1 review finding remains open.
- No "temporary fallback" is accepted as a pass.

## CSO Gate

Block stage/live promotion if any of these are true:

- Firebase Auth project and Firestore project are mismatched without an explicit documented reason.
- Cloud Run service account lacks the exact Firebase Auth project permission required for session verification.
- Internal service token is enabled for browser/user weekly paths.
- Frontend can write weekly/cashflow/audit state directly in platform API mode.
- Stage API base resolves to Vercel same-origin `/api/v1` instead of Cloud Run.
- Origin allowlist contains wildcard or random preview hosts.
- Smoke succeeds through a service token fallback instead of a Firebase identity.
- Audit export can be produced without backend permission and audit event checks.

## Autoplan Review Decisions

CEO review:

- The real problem is authority fragmentation, not storage brand choice.
- PostgreSQL migration is valuable only after Java commands are the single authority.
- Do not boil the entire ERP direct-Firestore surface now. Close the weekly/cashflow audit domain first.

Design review:

- No new visible controls unless tied to an approved business action.
- Error states should explain business failure, not storage or framework internals.
- The spreadsheet experience can feel familiar, but identity, validation, and save authority stay server-side.

Engineering review:

- Keep hierarchy thin: React -> Java API -> storage adapter.
- Ports/adapters are acceptable only where they protect the Firestore-to-PostgreSQL migration path.
- Integration tests matter more than string-policy tests for this domain.
- Explicit fail-closed deploy checks are better than clever runtime fallback.

DX review:

- Stage URL and Cloud Run API URL must be discoverable from docs and scripts.
- A developer should be able to run one gate command set and know why promotion failed.
- Review-agent findings must be reconciled against current code before being treated as open defects.

## PostgreSQL Phase 2 Entry Criteria

Start PostgreSQL migration only after Phase 1 gates pass. The expected PostgreSQL benefits are:

- row/cell-level unique constraints
- week, amount, budget category, and budget subcategory validation inside a database transaction
- row version and optimistic locking for concurrent edits
- clearer actual/projection aggregation queries
- stronger audit export snapshot reproducibility
- fewer conflicts from whole-document array updates such as `expense_sheets.rows`

Migration rules:

- Do not delete existing Firestore data.
- Build a migration script and a comparison script before cutover.
- Run Firestore-derived and PostgreSQL-derived projection/actual/audit comparisons in stage.
- Promote PostgreSQL only when row counts, totals, week mapping, identities, and audit manifests match.

## First Implementation Queue

1. Update idempotency persistence identity to tenant/project/command/key.
2. Remove or hard-restrict weekly internal service-token user path.
3. Add Firestore adapter transaction contract tests.
4. Close cashflow Java read model gaps and fail stage/live closed.
5. Fence frontend bank apply/projection helpers in platform API mode.
6. Add audit export manifest.
7. Refresh Understand graph and compare node connectivity before stage deploy.
8. Run full stage gate and browser smoke.
