# Weekly Expense Backend Authority Gate

Date: 2026-06-08

## Decision

The weekly expense refactor must make the frontend thin.

Frontend code may:

- render sheet state
- collect user edits
- send edit commands to the backend
- show backend validation results
- show backend save/sync/export status
- keep local draft UI state for responsiveness

Frontend code must not own:

- authoritative validation
- row derivation
- cashflow actual calculation
- weekly submission status decisions
- audit log decisions
- persistence source-of-truth
- spreadsheet export truth
- transaction identity decisions

Any refactor that keeps these responsibilities in React/TypeScript is rejected and must be recoded.

## Hard Reject Conditions

Reject a PR if any of these are true:

1. `PortalWeeklyExpensePage`, `SettlementLedgerPage`, `ImportEditor`, or `portal-store` computes authoritative `actual` values.
2. Frontend saves full sheet snapshots without a server-issued sheet or row version.
3. Frontend marks a row, week, or sheet as submitted/synced/closed without backend state transition.
4. Frontend decides cell validity beyond provisional UI hints.
5. Frontend writes audit-relevant state directly to Firestore/Postgres.
6. Spreadsheet copy/paste duplicates row identity fields such as `sourceTxId`.
7. Google Sheet/Excel is treated as source-of-truth instead of output.
8. Save completion can mark a newer local edit clean.
9. A backend API route calls the Rust kernel but does not persist the server result transactionally.
10. ERP frontend surfaces expose implementation terms such as storage engines, backend framework names, migration comments, or unapproved action buttons.

## Frontend Exposure Policy

This is an enterprise ERP surface. Frontend labels, helper text, toasts, tooltips, and
empty states must use agreed business language only.

Allowed examples:

- 저장 기준본
- Actual 반영
- 입력 검토 항목
- 저장 경로를 확인할 수 없습니다

Rejected examples:

- backend
- BFF
- Java ORM
- Firestore direct
- SQL Connect
- Data Connect
- Cloud SQL
- PostgreSQL
- Rust 계산
- read model

New visible buttons on weekly expense, cashflow, and audit surfaces must be tied to
an approved product action and a named server command/read contract. Engineering
comments, migration notes, and storage details belong in code/docs, not in rendered
ERP UI. `npm run policy:verify` enforces the current banned frontend terms through
`policies/frontend-exposure-policy.json`.

## Required Backend Shape

Model weekly expense as a JPA aggregate:

- `WeeklyExpenseSheetEntity`: tenant/project/sheet identity, sheet version
- `WeeklyExpenseRowEntity`: row version, optional source transaction identity, row-level derived amounts
- `WeeklyExpenseCellEntity`: raw value, normalized value, value type, validation status, user-edited marker

Spreadsheet operations are backend domain commands:

- shallow copy: copy raw values only
- deep copy: copy raw values plus cell metadata, then revalidate target cells
- cut: create clipboard payload, clear source cells, recalculate touched rows
- paste: validate touched cells, recalculate touched rows, return cell-level issues

Row identity fields must never be copied by clipboard operations.
Client-supplied clipboard metadata such as normalized values or validation status is advisory only.
The Java ORM backend must revalidate paste targets from raw values before row calculation and actual aggregation.

## Thin Hierarchy Policy

The target hierarchy is intentionally thin:

```text
React UI -> Java ORM command/read model
```

Allowed responsibilities:

- React UI: render backend state, keep temporary draft text, send explicit commands, show backend results.
- BFF: optional legacy transport adapter only. Weekly expense and cashflow operation must keep working when the BFF route is removed.
- Java ORM backend: validate cells and rows, persist commands, calculate actual, load projection, export audit artifacts, and write audit events.

Rejected layers:

- BFF validation, calculation, idempotency, audit, projection, actual, or persistence authority
- BFF-only authentication or private-network dependency for weekly expense/cashflow operation
- frontend calculation/save authority
- frontend-to-Firestore write fallback for audit-relevant state
- sync adapters that copy weekly expense actual into cashflow actual
- generic save endpoints that hide multiple audit actions
- duplicated validation services outside the Java command boundary

Cashflow follows the same rule: Projection is the only cashflow write command the UI may invoke,
and Actual is a backend-calculated read model. Any `/portal/cashflow` implementation that lets
React save, sync, or recalculate Actual fails the frontend thinness gate.

## Firebase SQL Connect / Data Connect Policy

Cloud SQL for PostgreSQL may be the canonical database for this domain, but Firebase
SQL Connect/Data Connect must not become a second write authority.

Allowed use:

- expose backend-approved read/query contracts for projection, actual, cashflow, and audit status
- provide realtime read updates from PostgreSQL after Java ORM commands commit
- generate typed read clients for UI query consumption

Rejected use:

- frontend or generated SQL Connect/Data Connect SDK writes weekly expense rows, cells, projection, actual, weekly status, audit events, bank apply state, or export artifacts
- SQL Connect/Data Connect mutations bypass Java ORM validation, calculation, idempotency, optimistic locking, or audit events
- SQL Connect/Data Connect output is treated as the audit export artifact
- SQL Connect/Data Connect product names, database names, or migration notes appear in ERP UI labels, helper text, toasts, or buttons

If SQL Connect/Data Connect mutations are ever considered, they must be limited to a
non-canonical command-intake table consumed by the Java backend. They must not mutate
the weekly expense, projection, actual, audit, or bank import canonical tables directly.

## Required API Shape

First authoritative slice:

```text
POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/cell-patch
POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/copy
POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/paste
POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/cut
POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/row-insert
POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/row-delete
POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/save-draft
POST /api/v1/weekly-expenses/{projectId}/submit
POST /api/v1/weekly-expenses/{projectId}/close
GET  /api/v1/weekly-expenses/{projectId}/statuses
GET  /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}
GET  /api/v1/cashflow/{projectId}
POST /api/v1/weekly-expenses/{projectId}/audit-export
```

Every mutating command requires:

- Firebase ID token verified by Java API, or internal service token for deployment smoke/internal jobs
- trusted actor identity derived by Java from Firebase `{ role, tenantId }` custom claims, not request body
- trusted tenant scope derived by Java from Firebase claims, not request body
- idempotency key
- expected sheet version or row versions
- backend validation result
- audit event

Every read model used by `/portal/weekly-expenses` or `/portal/cashflow` must also
be available from Java without BFF proxying. Weekly submit/close UI state is read
from `GET /api/v1/weekly-expenses/{projectId}/statuses`; React must not replace
that state with Firestore-derived or locally inferred status in stage/live.
`PortalWeeklyExpensePage` must not wire BFF-only transaction upsert, evidence Drive,
server upload fallback, or budget suggestion callbacks unless matching Java
contracts exist.

Firebase custom claims operations must also remain BFF-free for this domain. The
approved repair/update path is `scripts/sync_firebase_member_claims.mjs`, which
updates `{ tenantId, role }` claims through Firebase Admin credentials without
importing `server/bff/*` or exposing a new ERP frontend button.

Production deploy must pull Vercel environment variables and run
`scripts/verify_weekly_direct_vercel_env.mjs` before `npm run build`. The verifier
rejects disabled platform API mode and same-origin `*.vercel.app` API bases so
`/api/v1` rewrites cannot silently become the weekly/cashflow runtime path.

Stage/live Java API smoke must run with a Firebase browser identity token, not the
internal service token. `scripts/create_firebase_smoke_id_token.mjs` signs in a
dedicated smoke user, and `scripts/smoke_jvm_weekly_api.mjs --require-identity-token`
fails if a service token fallback is present. The smoke actor id must come from
the Firebase sign-in `localId`, so Java's actor spoof guard is exercised in the
same way as browser traffic.

## Audit Minimum Unit Policy

Weekly expense is an audit domain. Refactoring must split behavior into the smallest
reviewable units that still map to a business action, permission, transaction, and
audit event.

Minimum backend command units:

- `weeklyExpense.bankStatement.importBatch`: upload Excel/bank rows into a staging import batch
- `weeklyExpense.bankStatement.applyItems`: apply explicitly selected staging items into weekly expense rows
- `weeklyExpense.cell.patch`: edit one or more explicit cells
- `weeklyExpense.cells.copy`: create a backend clipboard payload for a rectangular selection without copying row identity
- `weeklyExpense.cells.paste`: paste a rectangular clipboard payload
- `weeklyExpense.cells.cut`: cut a rectangular selection and clear the source cells
- `weeklyExpense.row.insert`: insert rows without deriving authoritative values in the frontend
- `weeklyExpense.row.delete`: delete rows with row-version checks
- `weeklyExpense.saveDraft`: persist the current draft state
- `weeklyExpense.submitWeek`: submit a week through the backend state machine
- `weeklyExpense.projection.upsert`: write planned projection lines
- `weeklyExpense.actual.recalculate`: recalculate actuals from persisted rows
- `weeklyExpense.auditExport.create`: generate Google Sheet/Excel audit output from backend projection, actual, and audit summary

Each unit must define:

- command name
- required permission
- actor and tenant/project scope
- idempotency key requirement
- optimistic concurrency fields
- validation result schema
- audit event type
- rollback or compensating behavior

Hard reject a refactor if:

- multiple audit-significant actions are hidden behind one generic save command
- a permission cannot be changed for one unit without affecting unrelated units
- an audit event cannot identify the exact cells, rows, weeks, or export artifact affected
- tests cannot target one command without invoking unrelated commands
- the frontend batches commands in a way that loses per-cell/per-row validation results
- a bank statement upload auto-applies rows into weekly expense without an explicit user selection/apply command

## Stage Gate

Target score is 100/100. A stage may advance only when every hard gate passes and the
stage score is at least 90/100. If any hard gate fails, the stage fails immediately
even if the numeric score is high.

Current gate status on 2026-06-08:

| Stage | Score | Status | Feedback |
| --- | ---: | --- | --- |
| Shadow JVM/Rust compute | 82/100 | PASS WITH LIMITS | Domain tests pass and frontend hard-fail imports were removed from weekly expense paths, but Rust parity still needs backend-only orchestration. |
| Stage authoritative API | 98/100 | PASS WITH LIMITS | Spring Boot JPA commands reject client actor/tenant body fields, accept browser-direct Firebase ID tokens, derive trusted actor headers inside Java, expose public Cloud Run behind app-level auth/CORS, and run command smoke across spreadsheet, bank apply, projection, cashflow, submit/close, and audit export. Remaining limit is stage/live Firebase-token smoke automation. |
| Frontend thinness | 96/100 | PASS WITH LIMITS | Weekly expense direct actual sync is removed, `/portal/cashflow` Actual is read-only, Projection writes use the Java projection command, and legacy BFF cashflow write endpoints permanently reject requests; remaining risk is Firestore read-model cutover to Java cashflow reads. |
| External audit export | 90/100 | PASS WITH LIMITS | `weeklyExpense.auditExport.create` now generates a CSV artifact from backend projection + actual + audit summary with artifact id and SHA-256 hash; Excel/Google Sheet import formatting and private Java exposure are still deployment concerns. |

Stage deploy is allowed only when:

- [x] Java API has compile/test gate.
- [x] Postgres/Flyway migrations exist for sheet, row, cell, weekly status, projection, actual, idempotency, and audit tables.
- [x] `save-draft` is no longer `501` and runs in one backend transaction.
- [x] `submitWeek` runs through backend state machine and audit event.
- [x] Projection write/import runs through backend command.
- [x] Cell patch, rectangular copy/paste/cut, row insert, and row delete are independent backend commands.
- [x] Row delete requires explicit row version checks.
- [x] Mutating sheet commands, including `saveDraft`, load the aggregate with a pessimistic sheet lock.
- [x] Optimistic/data-integrity persistence conflicts map to `409`.
- [x] Command bodies no longer define actor or tenant authority.
- [x] Java command JSON rejects unknown actor/tenant body fields.
- [x] Java API accepts browser-direct Firebase ID tokens and derives trusted tenant/actor/role from claims.
- [x] Java API rejects spoofed tenant/actor headers that do not match token claims.
- [x] Java API still accepts an internal service token for deployment smoke/internal jobs.
- [x] `/portal/cashflow` no longer exposes manual Actual save/sync controls.
- [x] Cashflow Projection writes are proxied through the Java ORM projection command.
- [x] Legacy BFF cashflow week/actual write endpoints permanently reject requests.
- [x] Java API can be deployed as public Cloud Run with `--allow-unauthenticated`; app-level Firebase auth, CORS, command authorization, and ORM validation are the operation boundary.
- [x] Audit Sheet/Excel export artifact is generated from backend projection + actual + audit summary.
- [ ] Rust kernel is called from the backend, not from the frontend, for parity-sensitive calculation.
- [x] Frontend stops importing calculation modules and legacy sync APIs for weekly expense authoritative save/sync paths.
- [ ] Parity tests prove Java/Rust backend output matches current accepted behavior.
- [ ] Stage/live Firebase-user smoke proves browser-direct Java calls with real ID tokens after deploy.

Until then, JVM/Rust may run only as shadow compute.

## Fail-Fast Review Loop

Every refactor stage must be reviewed in this order:

1. Backend authority gate
2. Data model and transaction gate
3. Calculation parity gate
4. Frontend thinness gate
5. Export and audit gate
6. Stage deploy gate

If a stage fails, stop there and send feedback with:

- failing score
- exact hard gate that failed
- files or modules responsible
- minimum changes required to re-run the gate

Do not proceed to the next stage until the current stage reaches at least 90/100
and has no hard-gate failure.
