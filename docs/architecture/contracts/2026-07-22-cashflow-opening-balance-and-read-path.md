# Cashflow opening balance and month-close read-path contract

**Date:** 2026-07-22  
**Status:** automated Phase gate closed at 100/100; Stage browser QA pending
**Scope:** current cashflow sheet/close Phase, Stage only; no Live deployment

## Why this belongs in the current Phase

The source sheet stores prior years as annual totals and the selected year as
weekly values. The selected year's weekly ledger cannot start at zero when a
prior annual-only year has a remaining balance. This is part of the same
`sheet import -> BFF read composition -> JVM close policy -> frontend view`
contract, not a standalone UI hotfix.

The same Phase also owns the month-close status read. Stage QA showed that
mirror, year-view, and ledger hydration could recreate the React callback and
send the same BFF/JVM request four times. A late timeout could then overwrite
an earlier successful response. The opening-balance correction and the read
path reliability fix are therefore evaluated together before deployment.

## Accounting contract

For selected year `Y`, mode `M` (`projection` or `actual`), and canonical
cashflow row `L`:

```text
openingRow(Y, M, L)
  = sum(annualOnlyRow(year, M, L))
    for every year < Y
    only when that year is not represented by the weekly JVM ledger

openingBalance(Y, M)
  = sum(accountingSign(L) * openingRow(Y, M, L))

displayedRunningBalance(week, M)
  = JVM cross-year weekly running net(week, M) + openingBalance(Y, M)
```

- Projection and Actual have separate opening balances.
- The JVM carries every canonical cashflow row and its `EMPTY|ZERO|VALUE`
  source state per annual-only year. `amount` is a checksum derived from those
  rows, not the stored source of truth. A close request whose rows, states, or
  derived total changed is rejected and must be reloaded.
- Every included annual source must contain all 16 canonical row states.
  `lineAmounts` must contain exactly the rows marked `VALUE` or `ZERO`; an
  explicit zero remains distinguishable from an empty cell. A sparse source,
  an amount without a matching state, or a state without its required amount
  fails closed in both BFF and JVM validation.
- The immutable close snapshot stores the source-year row maps and states, not
  only their aggregate net. Therefore two prior-year sources with the same net
  but different account allocation are different accounting inputs.
- The row identity is never collapsed during import, persistence, read
  composition, or close. The authoritative key is
  `sourceYear + mode + canonicalLineId`; the value includes both the amount
  and `EMPTY|ZERO|VALUE` state. A derived total can be indexed or displayed,
  but can never replace this row-level evidence.
- The opening balance changes only balance, difference, and negative-balance
  evaluation. It is not an invented `Y-01 week 1` transaction and is not added
  to annual inflow/outflow totals.
- A prior weekly year is excluded from `openingBalance` because the JVM
  `week.net` already carries its movements across the year boundary. The
  annual-total fallback is used only for prior years without weekly documents.
  This explicit source precedence prevents double counting in 2027 and later.
- Future annual totals never affect the selected year's opening balance.
- Missing prior annual totals contribute zero and remain visible as missing
  annual source data; the system does not synthesize money.

Example: if 2025 annual-only Projection has `2,000,000` won inflow and zero
outflow, the 2026 Projection opening balance is `2,000,000` won. A 2026 first
week with no movement displays `2,000,000`, not zero.

The example does **not** authorize storing only `2,000,000`. The authoritative
input remains the 2025 source-year row map. For example,
`SALES_IN=3,000,000 / DIRECT_COST_OUT=1,000,000` and
`TEAM_SUPPORT_IN=2,000,000` have the same net but are different accounting
facts, produce different snapshot hashes, and cannot replace each other after
review.

## Layer responsibilities

| Layer | Responsibility |
| --- | --- |
| JVM | Own weekly ledger, annual-total writes, source-year exclusion, opening-balance calculation, month-close state, and immutable close snapshots. Every close snapshot contains the reviewed annual row/state sources and the full canonical weekly ledger rows used by the frozen closed view. |
| BFF | Require and forward the JVM `openingBalances` response, use it for server management checks, and fail closed when its year/scope is invalid. |
| Frontend | Display the server-composed opening balance on running balance rows. It never creates a carry-forward transaction or recalculates source annual totals. |

## Month-close read reliability contract

- React depends on one memoized annual-only boolean, not five asynchronously
  hydrated arrays.
- Same actor/project/month requests share only an in-flight Promise. There is
  no TTL response cache and a request after settlement performs a fresh read.
- A generation fence prevents an old month or failed request from overwriting
  the latest screen state.
- An OPEN dashboard reads the Firestore weekly collection once and derives
  Projection, Actual, and weekly-ledger years from that same snapshot. The old
  three-query path is forbidden because its inputs could observe different
  revisions and because it tripled the hot read cost.
- A CLOSED or REOPEN_REQUESTED dashboard with no approved amendment does not
  query the live weekly ledger. It validates and serves the row-level opening
  balance and canonical weekly rows captured in the immutable close snapshot.
- A successful closed-month amendment never replaces that immutable close
  snapshot. After `amendmentCount > 0`, however, the operational dashboard
  reads the current JVM ledger and current row-level opening balances under
  the explicit `LIVE_AMENDED` contract. This keeps the original close evidence
  auditable while ensuring an approved correction is visible instead of being
  hidden behind the first snapshot.
- `LIVE_AMENDED` is valid only while the close status is exactly `CLOSED` and
  the amendment evidence points to the immutable current close
  `snapshotHash`. Workflow revision is not an accounting identity: a reopen
  request and rejection may increment it without replacing the close
  snapshot.
  `REOPEN_REQUESTED` never becomes an amended-live view. A successful reclose
  starts a new immutable snapshot revision and resets the prior amendment
  counters and evidence.
- The staged month carries both the complete 160-cell `VALUE|EMPTY` matrix and
  the ten displayed sheet calculation results
  (`Projection|Actual × week 1..5`, each with inflow, outflow, and balance).
  When a closed month is amended, the JVM stores those displayed results with
  `closeRevision`, source revision, input target revision, and resulting target
  revision. The first close snapshot remains immutable.
- An amended dashboard rebuilds all 160 display cells from the current JVM
  canonical month. If the amended month contains no booked rows, all 160 cells
  are `EMPTY`; the BFF is forbidden from falling back to the first close
  snapshot. Summary rows use the JVM-stored displayed sheet results, including
  an intentionally inconsistent formula result, instead of silently
  recalculating it in the browser.
- The BFF may use `LIVE_AMENDED` only when the JVM returns it together with the
  current canonical ledger. It must not substitute the Google Sheet mirror or
  a frontend calculation for that server result.
- The same Firestore weekly query that constructs the current canonical ledger
  also returns its deterministic `targetRevision`. For an amended close the
  JVM reads the close evidence before and after that query and publishes the
  response only when the evidence is stable and
  `evidence.resultingTargetRevision == ledger.targetRevision`. A mismatch is
  retried once and then fails closed with 409.
- A project-scoped `cashflow_sheet_publications/{projectId}` document is the
  publication fence for the multi-command sheet apply. Reserving a stage run
  writes `APPLYING`; the stage run, mirror, and publication state become
  `APPLIED` in the completion transaction. A different run cannot reserve the
  same project while the fence is active. The month dashboard reads the
  publication fingerprint before and after JVM/BFF composition, refuses
  `APPLYING`, and retries a changed fingerprint. Month-close finalization
  performs the same checks before review, after review, and immediately before
  the JVM mutation. The JVM Firestore month-close transaction also reads the
  same publication document and rejects `APPLYING`. That read joins the
  transaction read-set, so a concurrent BFF reservation makes Firestore retry
  the close against the new state instead of committing through the BFF/JVM
  hand-off gap. Therefore monthly ledger and annual carry-forward commands
  cannot be exposed as one mixed intermediate dashboard or close input.
- A 5xx or uncertain network response does not create a new stage run. The
  publication document remains `APPLYING`, and
  `GET .../cashflow-sheet-lab/apply-status` returns the server-pinned
  `stagedRunId` and original apply input. Both cashflow screens can resume that
  exact idempotent command. During `APPLYING` and `APPLIED`, the BFF treats the
  stored input as authoritative and ignores a different screen's retry
  options. The recovery dialog cannot be dismissed while recovery is required.
  A deterministic validation failure restores the stage and publication to
  `READY`; an uncertain mutation outcome never silently unlocks a second write.
- Closed-month summary rows are frozen evidence too. The selected closed month
  uses its JVM dashboard evidence; other closed months use the calculation
  checks stored in their immutable snapshot, or in snapshot-hash-bound
  amendment evidence. They never fall back to the current Google Sheet mirror.
- A legacy CLOSED snapshot that predates row-level `openingBalances` or
  `ledgerWeeks` is returned as `LEGACY_EVIDENCE_ONLY`. Available frozen month
  evidence remains readable, missing evidence is named explicitly, and the
  server never fills the gap with live ledger or annual-total values. The
  recovery path is an approved reopen, a new sheet import, and a new close.
- The frontend resolves the month-close state before requesting the live
  annual year view. That request is allowed only for `OPEN`; CLOSED,
  REOPEN_REQUESTED, and legacy views neither request nor render current annual
  totals. Their project and sheet metadata also comes only from the JVM-backed
  frozen dashboard snapshot, never from the current mirror.
- The evidence resolver also requires the response `projectId` and `yearMonth`
  to match the current route. The route keys the cashflow screen by project, so
  navigating from project A to B discards A's finance state before B renders.
- `CashflowProjectSheet` obtains its month rows, comparisons, opening balance,
  and close state from the single JVM-backed dashboard source. Calling the
  generic cashflow ledger endpoint in parallel from this screen is forbidden.
- The actual BFF route uses the shared bounded JVM client: at most 12 seconds
  per attempt and 24 seconds total. A separate 26-second whole-route deadline
  also covers Firestore composition. The browser deadline is
  27 seconds so the BFF returns a stable error before browser cancellation.
- Identity-token resolution, trusted headers, fetch, and response parsing are
  inside the same BFF deadline.
- The mutating route has two phases. Read-only preflight receives at most 14
  seconds and reserves 12 seconds for the final JVM mutation. The final POST is
  outside the preflight timeout race and receives the same absolute deadline.
  Therefore a timed-out preflight can never start a delayed background close.
  The JVM idempotency key remains the recovery boundary if a final network
  response is uncertain.

## Phase acceptance criteria

1. Prior annual-only `+2,000,000` starts the selected year at `+2,000,000` in
   Projection; Actual is calculated independently.
2. The JVM response and immutable close snapshot preserve prior-year row
   amounts and cell states; equal net totals with different row composition
   are not treated as the same accounting source.
3. The JVM records included annual-total years and excluded weekly-ledger
   years, so the same prior year is never counted twice.
4. The server negative-Projection check starts from the same opening balance
   shown by the frontend.
5. Current-year inflow/outflow totals and line items remain unchanged.
6. Sequential mirror/year/ledger hydration issues one month-close network GET;
   concurrent same-scope reads share one in-flight request; a later read is
   fresh; a different month is never deduplicated.
7. A late response cannot replace the latest month or a successful result with
   an old error.
8. The BFF timeout completes before the 27-second frontend deadline.
9. `0`, blank, and a non-zero amount survive the annual sheet -> BFF -> JVM ->
   Firestore -> opening-balance -> close-snapshot round trip as `ZERO`, `EMPTY`,
   and `VALUE` respectively.
10. Focused tests, full regression, production build, Stage browser QA, and an
   independent 100/100 Phase-gate audit must pass before Stage deployment.
11. A legacy or unamended closed dashboard cannot render a current annual row
    value or current mirror metadata when the frozen snapshot lacks that
    evidence.
12. An amended closed dashboard displays the current JVM canonical amount and
    current row-level opening balance, while the original close snapshot hash
    and payload remain unchanged as audit evidence.
13. An amended month containing no booked rows returns exactly 160 `EMPTY`
    cells and never resurrects the first close snapshot values.
14. The exact displayed sheet inflow/outflow/balance values survive
    sheet mirror -> staged month -> JVM amendment evidence -> BFF -> frontend,
    even when a source formula is intentionally wrong.
15. `REOPEN_REQUESTED` is not `LIVE_AMENDED`; reclose clears prior amendment
    state and binds future amendments to the new close snapshot hash.
16. A dashboard or month-close mutation never publishes while a project sheet
    apply is in progress, and never combines a current ledger revision with
    amendment evidence for a different target revision.
17. A 5xx/timeout during sheet apply is recoverable only through the same
    server-pinned staged run and idempotency contract; no second run can bypass
    the publication fence.
18. Selected and nonselected closed-month formula summaries come only from
    immutable close or snapshot-hash-bound amendment evidence.
19. The JVM month-close Firestore transaction reads and rejects an `APPLYING`
    publication, so a reservation committed after BFF preflight cannot race a
    close snapshot into existence.
20. An uncertain apply retry uses the server-stored apply options in either UI;
    client option drift cannot change or strand the original command.

## Implementation and evaluation record

- Spring JVM full suite: **206/206 passed**. This includes rejection of an
  incomplete canonical-row state map and rejection of a same-net/different-row
  opening change without partial writes, explicit-zero persistence, a single
  weekly-ledger query, zero live-ledger reads for a CLOSED dashboard, rejection
  of a legacy close without an immutable snapshot hash, and fail-closed after
  two consecutive amendment-evidence drifts, a transaction-local rejection of
  an active sheet publication, and a simulated Firestore retry when an
  annual-only publication is reserved after the first transaction read. Both
  publication cases leave no close snapshot or version write.
- BFF/frontend focused suite: **214/214 passed** across the JVM proxy, sheet
  import, exact displayed-value snapshot, recovery client surface, and
  cashflow shell. The suite includes publication changes before the final JVM
  mutation, 5xx recovery through the same staged run with server-authoritative
  options in both drift directions, legacy/frozen evidence, and nonselected
  closed-month formula checks.
- Full frontend/BFF suite: **2,349 passed, 94 skipped**. One unrelated optional
  Firestore-rules suite cannot load because
  `@firebase/rules-unit-testing` is not installed in the shared workspace;
  the affected suite contains no executed test and is not changed by this
  Phase.
- Production build: **2,911 modules transformed**, successful.
- Stage data inventory on **2026-07-22 KST** found `0` monthly-close documents
  (`0` CLOSED/REOPEN_REQUESTED, `0` missing `openingBalances`, `0` missing
  `ledgerWeeks`). The legacy evidence-only path remains covered for future or
  migrated environments; no user document contents were printed during the
  read-only inventory.
- The first independent audit scored **42/100** and correctly found stale
  amended cells, all-empty fallback, missing displayed-formula evidence,
  `REOPEN_REQUESTED` overreach, stale reclose counters, and incomplete
  provenance. A second audit scored **72/100** and found a missing month-close
  publication check, an unrecoverable uncertain apply, and live-mirror fallback
  for nonselected closed months. An 84/100 re-audit then found the remaining
  BFF-to-JVM transaction race, cross-screen retry-option drift, and dismissible
  recovery state. Those findings and their regression tests are implemented.
  The final independent audit scored **100/100 PASS** with no remaining P0/P1.
  This closes the automated merge/Stage-candidate gate; Stage browser QA remains
  mandatory and does not authorize any Live deployment.

No Docker, Redis, response cache, or Live deployment is used for this Phase.
