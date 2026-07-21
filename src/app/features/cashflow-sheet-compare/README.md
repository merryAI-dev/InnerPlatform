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
- Monthly ledgers stay ordered. Each result produces the target revision for the
  next month, so parallel monthly writes would bypass drift detection.
- The JVM loads the project's weekly documents once per month and derives the
  five target weeks from that result. It must not issue five direct week reads
  followed by the same project-wide query.
- Ordered arrays preserve apply order. `Map`/`Set` indexes are used only for
  identity, deduplication, and verification; finance order never depends on hash
  iteration.
- BFF logs `annual.ok` and `month.ok` with `durationMs`. Reconsider a JVM
  multi-month command if a 12-month Stage import still exceeds the 30-second UI
  budget after this optimization. Do not solve that condition by adding Redis or
  merely increasing the browser timeout.

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
  same explicit import and compare total request latency plus every
  `annual.ok/month.ok durationMs` against the baseline above.

**Decision threshold**

Keep this design if a normal 12-month import completes inside the 30-second UI
budget on Stage. If it does not, the next change is one JVM multi-month command
that reads the project revision once and commits one bounded transaction—not
Redis and not another timeout increase.
