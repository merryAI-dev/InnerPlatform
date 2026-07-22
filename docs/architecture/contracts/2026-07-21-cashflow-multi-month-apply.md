# Cashflow Multi-month Apply Contract

**Original phase:** 2026-07-21
**Retrospective contract:** 2026-07-22
**Status:** COMPLETE — 100/100

## Scope

- BFF stages one pinned sheet revision and calls the JVM batch endpoint once
  when two or more complete finance months are present.
- JVM accepts at most 12 months, sorts them with `TreeMap`, indexes canonical
  week documents by identity, reads all target weeks with one `getAll`, reads
  the project ledger with one query, validates one starting target revision,
  and commits all months in one existing Firestore command transaction.
- Annual totals remain independent and run with bounded concurrency of four.
- Redis, an external queue, and a second snapshot authority remain out of scope.

## Required guarantees

- Input order cannot alter output month order.
- Any invalid/closed month or revision drift writes no month.
- Empty, explicit zero, Projection, Actual, and other Actual sources retain
  their existing semantics.
- One batch produces one audit event and one stored idempotency response.
- Repeating the exact request with the same idempotency key returns the stored
  response without another replacement, audit, or idempotency write.
- Single-month API and month-close paths remain compatible.
- BFF logs wall-clock `durationMs`; JVM returns `jvmDurationMs` for Stage
  acceptance measurement.

## Failure conditions

- Per-month JVM HTTP calls for a multi-month stage run.
- More than one project-wide query in the atomic batch replacement.
- Partial externally visible month writes.
- Permission, weekly-lock, monthly-lock, source-revision, target-revision, or
  data-project checks becoming weaker.
- Browser timeout increase presented as a performance fix.
- Live deployment.

## Evidence required for 100/100

- BFF route proves one batch call for a complete 12-month XLSX fixture.
- Storage test proves one 60-reference `getAll`, exactly one project query,
  deterministic order, and all-or-nothing behavior.
- Service test proves exact idempotent response replay and no second canonical
  write/audit/idempotency write.
- Full JVM, focused BFF/client, and production build regressions pass.
- Stage deployment acceptance records one warm full-year explicit import using
  browser total, BFF batch, and JVM durations. Cold start is recorded
  separately and does not redefine the correctness gate.

## 2026-07-22 remediation evidence

- Actual XLSX parser-to-stage-to-apply regression: 1,920 canonical cells,
  49 explicit values (including zero), 1,871 blanks, 12 staged months, and one
  JVM batch invocation.
- Expected synthetic totals: Projection input 7,800,000; Projection output
  3,900,000; Actual input 7,020,000; Actual output 3,120,000.
- Targeted BFF route: 54/54 passed in 8.29 seconds.
- Targeted JVM storage/service: 79/79 passed in 23.202 seconds.
- Full-year JVM storage regression submits months in reverse order, returns
  January–December, reads exactly 60 canonical week references in one `getAll`,
  performs one project query, and commits 1,920 Projection/Actual lines.
- Stage performance remains an explicit post-deployment acceptance item; no
  local timing is represented as production latency.

## Independent audit

- BFF batch main path: 15/15
- TreeMap/index/read plan: 15/15
- Atomicity/revision: 20/20
- Finance state and Actual-source preservation: 15/15
- Idempotency/audit/permission/error: 15/15
- Actual XLSX 12-month regression: 10/10
- Tests/build/observability: 5/5
- Contract/release boundary: 5/5

**Final score: 100/100.**
