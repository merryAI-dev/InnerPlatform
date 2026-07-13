# JVM Weekly Expense API

This module is the first server-authoritative slice for weekly expense work.

It is a Spring Boot + Spring Data JPA service. The goal is to move weekly expense
validation, persistence, actual aggregation, idempotency, and audit authority out
of the frontend.

## Current Slice

- Exposes a Spring Boot Java 21 API.
- Persists weekly expense sheets, rows, and cells through JPA.
- Runs `save-draft` in one backend transaction.
- Validates cells and recalculates row amounts on the server.
- Rebuilds sheet-scoped actual aggregates from persisted rows.
- Writes idempotency and audit records for `weeklyExpense.saveDraft`.
- Writes projection lines through `weeklyExpense.projection.upsert`.
- Runs weekly submit state transitions through `weeklyExpense.submitWeek`.
- Serves weekly submit/close status through `weeklyExpense.status.read`.
- Creates hash-addressed CSV audit export artifacts through `weeklyExpense.auditExport.create`.
- Enforces command-level role gates before persistence.
- Provides a backend cashflow read model for projection + actual comparison.
- Keeps Google Sheet/Excel as output concerns, not source-of-truth concerns.

## Run

Compile and test the Java API:

```bash
mvn -f server/jvm-weekly-api/pom.xml test
```

Run:

```bash
mvn -f server/jvm-weekly-api/pom.xml spring-boot:run
```

Optional environment:

- `WEEKLY_API_PORT`: defaults to `8088`
- `JVM_WEEKLY_DATABASE_URL`: defaults to `jdbc:postgresql://localhost:5432/innerplatform_weekly`
- `JVM_WEEKLY_DATABASE_USER`: defaults to `innerplatform`
- `JVM_WEEKLY_DATABASE_PASSWORD`: defaults to `innerplatform`
- `JVM_WEEKLY_INTERNAL_API_TOKEN`: shared secret accepted for deployment smoke and internal jobs
- `JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID`: Firebase Auth project whose ID tokens are accepted for browser-direct calls
- `JVM_WEEKLY_FIRESTORE_PROJECT_ID`: Firestore project used when `JVM_WEEKLY_STORAGE_BACKEND=firestore`
- `JVM_WEEKLY_FIREBASE_PROJECT_ID`: legacy fallback for both Firebase Auth and Firestore when the split envs are not set
- `JVM_WEEKLY_ALLOWED_ORIGINS`: comma-separated browser origins allowed by CORS; defaults to fixed stage and live origins

## First Endpoints

- `GET /api/v1/health`
- `POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/save-draft`
- `POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/cell-patch`
- `POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/copy`
- `POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/paste`
- `POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/cut`
- `POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/row-insert`
- `POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetId}/commands/row-delete`
- `POST /api/v1/weekly-expenses/{projectId}/submit`
- `POST /api/v1/weekly-expenses/{projectId}/close`
- `GET /api/v1/weekly-expenses/{projectId}/statuses`
- `POST /api/v1/weekly-expenses/{projectId}/audit-export`
- `POST /api/v1/cashflow/{projectId}/projection`
- `GET /api/v1/cashflow/{projectId}`

`save-draft` is no longer a placeholder. Mutating commands require trusted actor
headers and a body idempotency key, then transactionally save the sheet and write
audit metadata.

Runtime auth:

- Browser/direct path: Java weekly and cashflow calls send `Authorization: Bearer <Firebase ID token>`
  with `credentials: omit`. The frontend routing client scopes this Bearer channel to
  the Java API only; legacy BFF routes must not receive Firebase ID tokens.
- Internal path: `x-inner-platform-service-token`.

For browser-direct calls the Java API verifies the Firebase ID token with
revocation checks, reads `{ role, tenantId }` custom claims when present, falls
back to request tenant/role context for low-friction ERP use, rejects spoofed
actor headers, and injects trusted actor context before controller logic runs.
The command body does not define actor or tenant authority.
`JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID` controls token verification.
`JVM_WEEKLY_FIRESTORE_PROJECT_ID` controls Firestore storage. Do not fix login by
implicitly moving storage to a different Firebase project.

The Java API is deployed as a private Cloud Run service. Stage BFF calls carry
an audience-bound Google ID token from the Stage-only invoker credential; the
service account has only `roles/run.invoker` on this Stage service. Firebase token
verification, CORS, command authorization, idempotency, validation, and JPA
transactions remain the runtime boundary.

Firebase custom claims are not a frontend or BFF dependency for weekly operation.
Use `npm run firebase:sync-member-claims -- --uid <uid> --tenant-id <tenant> --role <role>`
or `--email <email>` to repair or update the `{ tenantId, role }` claims that the
Java API verifies for browser-direct calls.

## ORM Domain Shape

The weekly sheet is modeled as an aggregate:

- `WeeklyExpenseSheetEntity`: project sheet identity and sheet version
- `WeeklyExpenseRowEntity`: row version, source transaction identity, row-level derived amounts
- `WeeklyExpenseCellEntity`: raw value, normalized value, validation state, user-edited marker
- `WeeklyExpenseActualEntity`: sheet-scoped actual aggregate lines
- `WeeklyExpenseProjectionEntity`: planned projection lines
- `WeeklyExpenseWeeklyStatusEntity`: weekly submit/close status
- `WeeklyExpenseIdempotencyEntity`: command idempotency ledger
- `WeeklyExpenseAuditEventEntity`: append-only command audit event
- `WeeklyExpenseAuditExportEntity`: external audit artifact content, file name, counts, and SHA-256 hash

Spreadsheet behavior is handled in `WeeklyExpenseSpreadsheetService`:

- copy: returns a server-built clipboard payload for a rectangular selection
- shallow copy: value-only copy, validation recalculates at paste target
- deep copy: value plus cell metadata, then validation still reruns at paste target
- cut: creates a clipboard payload and clears the source cells
- paste: validates touched cells and recalculates touched rows only
- row insert: shifts rows and creates empty persisted rows through the backend aggregate
- row delete: requires row version checks before removing rows and rebuilding actuals

Row identity fields such as `sourceTxId` are not copied by clipboard operations. Copying those would duplicate transaction identity and corrupt audit/accounting semantics.
Client-returned clipboard metadata such as `normalizedValue`, `valueType`, and `validationStatus` is advisory only. Paste targets are revalidated from `rawValue` by the Java ORM service before row calculation and actual aggregation.
