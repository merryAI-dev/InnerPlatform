# Cashflow Sheet Integration Boundary

Google Sheets is a read-only source. MYSCube never writes back to the sheet; an
explicit user action pins the sheet values and overwrites the MYSCube ledger
through the BFF and Spring JVM authority.

Allowed:

- Render Google Sheet template status.
- Show cell coordinate mappings.
- Preview Java cashflow Actual and Projection values on a sheet-like layout.
- Apply a server-pinned snapshot to the MYSCube ledger through the BFF/JVM contract.

Forbidden:

- Save or sync values back to Google Sheets.
- Reimplement cashflow calculations in the frontend or BFF.

## Apply performance and ordering

The apply path intentionally uses no Redis or external job queue. The current
traffic is one explicit import per project, protected by a staged snapshot,
idempotency keys, and the JVM transaction boundary.

- Annual totals are independent documents. The BFF applies them with a maximum
  concurrency of four and records fulfilled operations before surfacing a
  partial failure, so the same staged run can resume safely.
- Two or more monthly ledgers use one JVM batch command. The JVM sorts months in
  a `TreeMap`, reads every target week with one `getAll`, reads the project ledger
  with one query, validates the target revision once, and commits all months in
  the existing Firestore command transaction.
- A single month keeps the existing endpoint for compatibility, but uses the
  same storage implementation as the batch command.
- Ordered arrays preserve apply order. `Map`/`Set` indexes are used only for
  identity, deduplication, and verification; finance order never depends on hash
  iteration.
- BFF logs `annual.ok`, `month.ok`, and `months.ok` with `durationMs`.
  `months.ok` also exposes the JVM service `jvmDurationMs`. Do not solve a
  remaining latency problem by merely increasing the browser timeout.

Rationale: Firestore recommends asynchronous calls for independent operations,
but transactions require all reads before writes and can be retried on
contention. Batched/bulk writes are unsuitable here because the monthly target
revision must be read and verified before replacement.

- [Firestore best practices](https://firebase.google.com/docs/firestore/best-practices)
- [Firestore transactions and batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions)

## Performance experiment log

### 2026-07-21: explicit sheet apply exceeds the browser timeout

**Observation**

- Stage trace for project `p1773817948751` showed four annual JVM requests and
  eight monthly JVM requests completing serially over roughly 45 seconds.
- Annual calls took about 1.6–4.4 seconds each; monthly calls took about
  4.3–5.0 seconds each. The browser stopped waiting at 30 seconds while the BFF
  and JVM continued saving.
- Each monthly JVM transaction read five canonical week documents one by one,
  then queried all project weeks including those same documents.

**Hypothesis**

The primary delay is avoidable network round trips, not cashflow arithmetic:

1. Replacing five serial canonical-week reads with one Firestore `getAll` should
   preserve malformed-document detection while reducing monthly latency.
2. Applying independent annual documents with bounded concurrency should reduce
   the annual phase without weakening monthly target-revision ordering.
3. Monthly writes must remain sequential because each resulting target revision
   is the compare-and-set input for the next month.

**Implementation**

- The first deletion-only attempt was rejected by the canonical-ID corruption
  regression tests: those reads also detect documents whose path is canonical
  but whose project/month metadata is corrupt. The implementation therefore
  retained the check and changed only its transport from five serial `get`
  calls to one `getAll`.
- JVM canonical-week validation now uses one five-document `getAll`; the
  project-wide query remains the single source for revision calculation.
- BFF annual apply uses batches of at most four and `Promise.allSettled`.
  Fulfilled writes are counted before a failure is returned, allowing the same
  staged run and per-year idempotency keys to resume safely.
- Monthly apply remains an ordered loop.
- Per-operation `annual.ok` and `month.ok` logs include `durationMs`.
- Stage browser logs expose conservative user-perceived timing without sheet
  values or credentials:
  - `overwrite.sheet_values.ok`: click-to-completion total.
  - `stage.sheet_values.ok`: snapshot validation/staging step.
  - `apply.sheet_values.ok`: JVM ledger apply step.
  - `overwrite.sheet_values.error`: click-to-error total and failed `step`.
- Redis, background queues, and a larger browser timeout were deliberately not
  added.

**Evaluation**

- BFF cashflow sheet route: 54 tests passed, including concurrent annual start,
  partial annual failure/resume with stable idempotency keys, ordered monthly
  apply, idempotent replay, and value verification.
- JVM storage regression: 51 tests passed, including canonical-ID corruption,
  month-close locks, target-revision drift, and the assertion that five direct
  week reads were replaced by one five-reference `getAll`.
- Stage acceptance is not inferred from local tests. After deployment, rerun the
  same explicit import and use `overwrite.sheet_values.ok durationMs` as the
  conservative browser wall-clock. Compare its `stageDurationMs` and
  `applyDurationMs`, plus every server-side `annual.ok/month.ok durationMs`,
  against the baseline above. Cold starts remain included in the first run and
  should be reported separately from a second warm run.

**Stage evidence after deployment**

- Revision `innerplatform-jvm-weekly-api-lease-stage-00013-5q5` served the
  2026-07-21 manual retry for project `p1773817948751`; the browser received a
  successful apply response instead of the previous 30-second timeout.
- The stage request started 3.344 seconds before the apply request. The remaining
  two JVM apply calls returned HTTP 200 in 6.432 seconds and 3.850 seconds; their
  first-start-to-last-finish server span was 10.623 seconds.
- This was a residual retry after the earlier timed-out request had continued on
  the server. It is evidence that the retry path completes, but it is not a
  valid replacement for the original four-annual/eight-month baseline.
- The already-open browser tab still served the previous JavaScript asset, so
  this run did not expose the new browser wall-clock label. After reloading the
  Stage page, the next full import must record
  `cashflow.sheet_lab.overwrite.sheet_values.ok durationMs`; only that value can
  close the 12-month Stage acceptance check.

**Decision threshold at that revision**

Keep this design if a normal 12-month import completes inside the 30-second UI
budget on Stage. If it does not, the next change is one JVM multi-month command
that reads the project revision once and commits one bounded transaction—not
Redis and not another timeout increase.

### 2026-07-21: multi-month atomic command

**Planning**

The remaining monthly cost was linear in the number of months because the BFF
called the JVM once per month. Every call repeated a project-wide query and a
target-revision calculation. Parallel monthly calls were rejected because each
call depended on the preceding resulting revision, while Redis would add a
second consistency system without removing those reads.

**Hypothesis**

One bounded JVM command can preserve compare-and-set safety and remove repeated
network/query work if it:

1. normalizes input into `TreeMap<yearMonth, cells>` to reject duplicate months
   and fix finance order;
2. indexes target documents by month and canonical document ID;
3. performs one target-week `getAll`, one project-ledger query, and one revision
   comparison;
4. schedules every monthly replacement inside the existing Firestore command
   transaction; and
5. records one idempotency result and one audit event.

**Execution**

- Added `POST /api/v1/cashflow/{projectId}/sheet-lab/batch/apply` for up to 12
  complete finance months, matching one annual source sheet. At five week
  documents per month, the maximum remains well below Firestore's 500-write
  transaction limit and keeps the idempotency response bounded.
- The BFF now uses the batch endpoint whenever two or more months are staged.
  One-month requests retain the old endpoint.
- The JVM uses a `TreeMap` for deterministic month ordering and maps keyed by
  canonical week document IDs for replacement and verification. It issues one
  `getAll` for all target weeks and one project query, validates the starting
  target revision once, then writes every month atomically.
- Annual totals remain independent and bounded to four concurrent requests.
- Redis, an external queue, a generic DAG executor, and a new snapshot pointer
  collection were not added. The existing Firestore transaction already owns
  atomicity and retry semantics; Redis is reserved for a measured distributed
  queue or rate-limit requirement.

**Local evaluation**

- BFF route/client: 66 tests passed. A two- or three-month staged run makes one
  JVM batch call, verifies every returned cell, and keeps single-month replay
  behavior.
- JVM service/storage: 59 tests passed. A reversed two-month input is returned
  in ascending month order, reads ten canonical week documents in one `getAll`,
  and commits both months in one command transaction. A batch containing a
  closed month writes no weekly documents. Existing revision-drift, provenance,
  explicit-zero, and single-month tests remain green.
- The complete JVM module regression suite passed 167/167, and the production
  Vite build completed successfully.
- This local result proves the call/query shape and transaction contract, not
  production-like latency. After Stage deployment, a fresh full-year import must
  record browser `overwrite.sheet_values.ok durationMs`, BFF `months.ok
  durationMs`, and JVM `jvmDurationMs` before/after values here.

**Stage deployment evidence**

- Cloud Build `231f133f-2cc4-42d1-9ac9-c3003d2adb04` reran the complete JVM
  suite (167/167), built image tag `d7fd8bd`, and deployed Cloud Run revision
  `innerplatform-jvm-weekly-api-lease-stage-00014-psl` with 100% Stage traffic.
- The BFF/frontend deployment is intentionally separate and must run through
  the guarded GitHub Actions Stage workflow. Until that workflow deploys this
  BFF change, the Stage browser cannot call the new multi-month endpoint and no
  full-year before/after latency claim should be made.

### 2026-07-22: weekly settlement lock contract

**Planning**

Weekly settlement previously recorded only an actor and timestamp. It did not
prevent a later sheet import, Projection command, or weekly-expense Actual sync
from changing the same week. The phase contract therefore treats a weekly
settlement as an immutable server snapshot until an explicit, reasoned reopen.
Monthly close remains the stronger contract and is the only path that may
finalize a month containing weekly locks.

The project-wide phase gate is 100/100. A read-only evaluator checks main-path
wiring, transaction boundaries, authorization, idempotency, legacy documents,
BFF contracts, real-format sheet regression, build evidence, and this record.
UI work and Stage deployment remain blocked until every item has evidence.

**Hypothesis**

The existing Firestore transaction is sufficient when the lock participates in
the canonical JVM write boundary:

1. one completion document stores the current state and optimistic revision;
2. immutable version documents retain each locked snapshot;
3. a `CashflowWeekScope(yearMonth, weekNo)` set guards only changed weeks;
4. sheet apply uses canonical week-ID maps to compare current and replacement
   financial content before scheduling any writes;
5. Projection and Actual commands collect all affected scopes before their
   first write; and
6. monthly close calls one explicit internal apply variant that bypasses only
   the weekly guard while retaining the month guard and pinned-source checks.

Redis, a queue, and a second lock service are not used. They would introduce a
second consistency authority without removing the Firestore compare-and-set
transaction that already owns these values.

**Execution**

- `cashflow_weekly_update_completions` now stores `LOCKED` or `OPEN`, revision,
  reopen count, server scope, actor/time, source/target revisions, canonical
  week snapshot, and SHA-256.
- Each lock writes one immutable
  `cashflow_weekly_update_completion_versions/{project-yearMonth-week-revision}`
  document in the same command transaction. An idempotent replay does not write
  another version or audit event.
- Legacy completion rows without `status` remain dashboard-compatible but do
  not block writes. Their next explicit completion upgrades them to revision 1.
- Sheet apply rejects the whole transaction when any changed week is locked;
  unchanged weeks and other unlocked weeks remain writable. Projection no-op
  values do not create a canonical write. Both Actual replacement paths guard
  their changed patch scopes.
- Reopen requires project access, `LOCKED` state, the current revision, and a
  non-empty reason. It preserves the prior snapshot/hash and advances the state
  to `OPEN`. A closed month rejects a standalone weekly reopen.
- Finance/Admin month-reopen approval atomically advances every `LOCKED` weekly
  completion in that month to `OPEN`. Each transition records the approver,
  reason, incremented revision/reopen count, and
  `reopenSource=MONTH_REOPEN_APPROVAL`; a rejected request changes no weekly
  lock.
- Weekly status submit/close guards the target week before the first possible
  transaction write. Repeating an identical status is a no-op, while a changed
  status for a locked week is rejected. This keeps Firestore's required
  read-before-write ordering intact.
- A complete retry hashes the semantic scope (`yearMonth`, `weekNo`) rather than
  the client timestamp. The same idempotency key therefore returns the original
  lock even when a client regenerates `completedAt`; reuse for another scope is
  rejected.
- JVM and BFF expose explicit read, complete, and reopen contracts. Complete
  accepts an explicit year/month and week, while an omitted scope retains the
  Stage QA-clock behavior for compatibility. Reopened documents are no longer
  counted as completed in the deadline dashboard.

**Local evaluation**

- JVM cashflow storage regression: 71/71 passed. Coverage includes exact changed
  week detection for sheet, Projection, both Actual paths, and weekly status;
  explicit zero versus missing values; same-week multi-line merges; unchanged
  locked-week skips; all-empty week materialization; no partial writes; legacy
  upgrades; retry-safe idempotency; read-before-write ordering; weekly reopen;
  month-close bypass; Finance/Admin month-reopen approval reopening its weekly
  locks; and snapshot-drift detection.
- Spring MVC contract tests exercise read, complete, reopen, malformed explicit
  scope, and JVM `409` propagation through real controller mappings. The full
  JVM module passed 190/190 in 26.909 seconds.
- BFF route plus TypeScript client contracts passed 120/120. Coverage includes
  lease-free read/complete/reopen, exact field-presence validation, explicit
  zero rejection, JVM `409`/`503` propagation, status-aware deadline summary,
  and the intentionally limited no-scope Stage QA-clock fallback.
- The BFF/client contracts plus the sanitized 260701 full-year workbook parser
  and exact-ledger apply regression passed 174/174 in 7.77 seconds. The fixture
  read 1,920 cells, preserved 34 values and 1,886 explicit empty cells, and
  applied its three populated months through the multi-month contract.
- The production Vite build transformed 2,910 modules and completed in 24.58
  seconds. All runs used local Maven/Node processes; Docker was not started.
- Independent read-only re-audit scored this phase 100/100: contract/main path
  20/20; atomicity/concurrency 15/15; snapshot/hash/version 15/15;
  authorization/reopen/month precedence 15/15; idempotency/audit/legacy 10/10;
  BFF/TypeScript/error contract 10/10; regression/real input 10/10; and
  documentation/build/gate 5/5. The auditor independently rebuilt 2,910 Vite
  modules in 21.87 seconds. One earlier parallel test run had a transient local
  socket failure under concurrent load; isolated 77/77 and the subsequent
  single-worker 174/174 run did not reproduce it.
- This closes only the weekly settlement lock phase. UI work and Stage
  deployment require their own tracked contract and the relevant retrospective
  phase audits; Live deployment remains prohibited without explicit approval.
