# Cashflow closed-month amendment contract

**Date:** 2026-07-22

**Status:** implemented and locally verified — Stage deployment pending
**Scope:** Stage only; no Live deployment

## Research record

This decision was checked against 11 open-source implementations and 22
engineering/accounting references, rather than treating the existing BFF flow
as the only available shape.

### Open-source implementations reviewed

1. [TigerBeetle design](https://github.com/tigerbeetle/tigerbeetle-history-archive/blob/main/docs/DESIGN.md)
2. [Formance Ledger](https://github.com/formancehq/ledger)
3. [Blnk](https://github.com/blnkfinance/blnk)
4. [Ledger CLI](https://github.com/ledger/ledger)
5. [Abivia Ledger](https://github.com/abivia/ledger)
6. [Open Data Fabric](https://github.com/open-data-fabric/open-data-fabric)
7. [Coinbase ChainStorage](https://github.com/coinbase/chainstorage)
8. [Jube fraud monitoring](https://github.com/jube-home/aml-fraud-transaction-monitoring)
9. [PhpAudit](https://github.com/SetBased/php-audit)
10. [Safe financial import design](https://gist.github.com/sombochea/b624b975aa9ff2c1beb4d0cdb0517a07)
11. [Event sourcing audit design](https://gist.github.com/chengyixu/9ee6807ae74b16be6e644fe0f4616fc7)

### Articles and technical references reviewed

1. [Google Dataflow exactly-once](https://docs.cloud.google.com/dataflow/docs/concepts/exactly-once)
2. [Google Dataflow delivery guarantees](https://cloud.google.com/blog/products/data-analytics/dataflow-at-least-once-vs-exactly-once-streaming-modes)
3. [Idempotent pipeline design](https://dataarchitect.studio/essays/how-to-make-a-data-pipeline-idempotent/)
4. [Financial drift detection](https://www.usefreed.vc/)
5. [Month-end close procedures](https://www.xenett.com/blog/month-end-close-best-practices)
6. [Month-end close checklist](https://tidyflow.com/practice-management-glossary/month-end-close/)
7. [Financial close process](https://www.halsimplify.com/knowledge-center/month-end-closing-process-steps-checklist)
8. [Post-close corrections](https://www.canopyservicing.com/blog/immutable-ledger/)
9. [Retroactive correction trade-offs](https://preciseledger.pro/whitepaper.html)
10. [Month-end adjustments and locking](https://synder.com/blog/month-end-close-process/)
11. [Monthly close policy guide](https://www.ojp.gov/sites/g/files/xyckuh241/files/media/document/26309_DOJ_OJP_TFSC_Monthly_Financial_Close_Policy_Guide_v4_508.pdf)
12. [Month-end process controls](https://webvantage.hiebing.com/webvantage/webhelp/Month_End_Closing_Best_Practices.pdf)
13. [Accounting close audit controls](https://www.utoledo.edu/offices/internalaudit/pdfs/10-9closethebooks.pdf)
14. [SQL Server append-only ledger](https://www.sqlservercentral.com/articles/database-ledger-in-sql-server-2022)
15. [Open Data Fabric protocol](https://opendatafabric.org/)
16. [ETL validation and audit discussion](https://en.wikipedia.org/wiki/Extract%2C_transform%2C_load)
17. [Canonical data model](https://en.wikipedia.org/wiki/Canonical_model)
18. [Audit-trail overview](https://en.wikipedia.org/wiki/Audit_trail)
19. [Financial-close overview](https://en.wikipedia.org/wiki/Financial_close_management)
20. [TRES accounting and reconciliation](https://www.fireblocks.com/products/financial-data)
21. [HighRadius close process](https://pages.highradius.com/hubfs/Organizing_the_Month_End_Financial_Close_Process__1_.pdf)
22. [Post-close adjustment workflow](https://www.reddit.com/r/Accounting/comments/15y1pi0/can_you_describe_what_the_month_end_closing/)

### Explicit insights

1. **A fixed spreadsheet revision is evidence, not an accounting decision.**
   The import hash must stay readable even after the canonical ledger changes.
2. **Exactly-once needs an idempotency key at the final sink.**  A browser or
   BFF retry cannot be trusted to be exactly once on its own.
3. **A closed-period change is an amendment, not a normal import.**  It needs
   an explicit intent, deadline policy, a reason when late, and its own audit
   event; hiding a grid does not make that policy safe.
4. **Current balances and historical close evidence must be separate.**  The
   current cashflow projection can advance, but the original close snapshot is
   immutable and amendments point back to it.
5. **The right unit of human review is an affected period, not every cell.**
   Show month/week/count and a reason only when a closed-period amendment is
   requested.  This is both safer and substantially easier to use.
6. **Do not add Redis or a queue for this path yet.**  This is an explicit,
   bounded import (at most twelve 160-cell months).  Atomic stage records,
   revision fencing, and idempotency solve the current correctness problem
   without adding a second source of operational truth.

## Problem

The sheet-import flow currently detects a difference against a closed month in
the BFF and blocks the whole run.  That makes a normal sheet import depend on
a BFF policy branch, hides the reason/deadline rule from the JVM, and forces a
large cell-by-cell review UI for a decision that is actually about a closed
month amendment.

The canonical month-close path already defines the finance deadline as the
10th of the following month.  Closed-month changes must use that same rule.

## Options considered

1. **Keep the BFF block and show a smaller dialog.**
   Rejected.  It improves the screen only; the BFF would still own a finance
   policy that the JVM does not independently enforce.
2. **Let the BFF pass an unrestricted `allowClosed` flag to the JVM.**
   Rejected.  A caller or a future BFF route could bypass the policy, and the
   amendment reason and warning count would not be an atomic JVM record.
3. **JVM-owned closed-month amendment contract.**
   Chosen.  The BFF stages technical sheet data and reads the JVM-owned
   canonical month-close document only to describe affected periods.  The JVM
   re-reads month state inside its canonical
   transaction, applies the same following-month-10th deadline used by month
   close, requires a reason after that deadline, and atomically records an
   amendment/audit counter with the write.
4. **Replace the current ledger with a fully event-sourced correction ledger.**
   Deferred.  It is a valid long-term finance architecture, but replacing the
   existing weekly source-of-truth and month-close snapshots is wider than the
   current contract.  The chosen design preserves an immutable audit trail and
   is a safe migration point if that future change is approved.

## Chosen contract

### Target flow

```text
Google Sheet
  -> BFF fixed source revision (raw cells + schema/range/provenance)
  -> BFF technical staging (idempotent run; no finance decision)
  -> BFF canonical close-state read (display metadata only)
  -> JVM atomic apply (revision fence + policy + ledger + amendment/audit)
  -> if JVM returns late-reason-required: compact reason input + same-run retry
  -> read models (dashboard, month-close status, activity)
```

The first two steps are retriable and reversible evidence handling.  The last
write is a single finance command.  A stale plan is rejected using its source
and target revisions; the user restarts from a new fixed source revision.

### Responsibilities

| Layer | Owns | Does not own |
| --- | --- | --- |
| Frontend | Trigger the explicit sheet import and collect a reason only when the JVM says the deadline passed. | Deadline, permission, warning count, or permission bypass. |
| BFF | Materialize a fixed sheet revision, read canonical close state for display, pass the reason, and expose audit activity. | Finance policy or direct canonical writes. |
| JVM | Canonical month-state read, deadline decision, reason requirement, amendment authorization, ledger write, snapshot-version metadata, audit event, and warning counters. | Spreadsheet UI. |

Active operational project roles are `admin`, `finance`, `pm`, `viewer`, and
`tenant_admin`.  They may import sheet values, close a month, and request a
reopen.  Oversight-only `auditor`, `support`, and `security` roles remain
read-only; Finance/Admin approval is still required to approve or reject a
reopen.

### State and deadline

- Open months are applied normally.
- The explicit “시트 값 반영” action is the import intent.  Google Sheet is the
  human review surface, so MYSCube does not add a second cell confirmation.
- The authoritative deadline is **the 10th of the following month**, using the
  JVM business-date/QA-clock source already used by month close.
- On or before the deadline, a changed closed month is applied and recorded as
  an amendment without adding a warning.
- After the deadline, the JVM rejects an empty reason.  A successful write
  increments the project/month late-amendment warning counter and records the
  actor, reason, deadline, and timestamp atomically with the ledger change.
- The historical month-close snapshot is never overwritten.  The canonical
  ledger advances, while the amendment record links the change to the prior
  close revision.

### UI contract

- No candidate grid, no 500/885-cell preview, and no manual per-cell review.
- A normal import stages then applies directly.
- When the JVM says a late reason is required, show only affected month(s),
  week count, and changed cell count in a compact dialog.  Request the reason
  and retry with the same stage run.

### BFF/JVM transport contract

- Each JVM attempt covers identity-token resolution, trusted-header creation,
  the JVM fetch, and response parsing.  It is limited to 12 seconds
  (`JVM_WEEKLY_API_TIMEOUT_MS` can only lower that ceiling), and both attempts
  share a 24-second total budget so the BFF resolves before the browser's
  30-second timeout.  Metadata fetch receives the same abort signal; GoogleAuth
  and injected resolvers are bounded by the outer timeout race.
- Transport failure returns `jvm_weekly_api_unreachable`; generic upstream 5xx
  returns `jvm_weekly_api_internal_error`.  Domain 4xx codes such as
  `cashflow_closed_month_reason_required` are preserved.
- A 2xx status is not sufficient.  BFF verifies `ok=true`, the fixed command
  `weeklyExpense.cashflowSheetLab.apply`, project/source identity, and source/
  target revisions before accepting monthly batch or annual results.
- Monthly ledger writes run before independent annual totals.  Monthly state is
  revision-dependent and stays sequential; independent annual totals use a
  bounded concurrency of four.

## Success criteria

- The same month-close deadline is evaluated by JVM code for close and
  amendment; the BFF cannot waive it.
- Every change to a closed month is traceable through the fixed source
  revision, actor, amendment record, and immutable audit event.
- A post-deadline change has a non-empty reason and increments a persistent
  warning count in the same transaction as the change.
- Unaffected months continue to apply in one batch; no large review table is
  rendered.
- JVM, BFF, and frontend tests cover normal, closed-before-deadline,
  closed-after-deadline-without-reason, and closed-after-deadline-with-reason
  paths.

## Implementation and evaluation record

- `mvn -q test`: **194 tests**, 0 failures, 0 errors, 0 skipped.
- Full npm regression with one worker: **2,320 passed, 222 skipped, 0
  failed** across 320 test files.
- Focused JVM client/BFF/frontend contract suite: **107 tests passed** with a
  single worker.  It includes timeout/normalization, malformed-success
  responses, multi-month atomic rejection and retry, compact UI behavior, and
  bounded identity-token/metadata resolution before the JVM fetch begins.
- `npm run build`: **2,910 modules transformed**, production build succeeded.
- The same focused suite once produced a Supertest `socket hang up` only when
  test files competed in parallel.  No assertion failed; the bounded
  single-worker rerun passed 107/107 and is the recorded deterministic gate.
- Docker, Redis, and an external queue were not used.
- Independent phase-gate audit: **100/100**. The auditor reproduced a hanging
  identity resolver, verified bounded `jvm_weekly_api_unreachable` failure
  without starting the JVM fetch, and confirmed that 401/403/409 are not
  retried while JVM 500 is normalized to the stable BFF 503 contract.
- Stage deployment is permitted by the phase gate; deployment evidence is
  recorded separately after the Stage workflow completes.
