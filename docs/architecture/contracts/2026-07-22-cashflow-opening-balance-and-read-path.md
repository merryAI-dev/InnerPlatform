# Cashflow opening balance and month-close read-path contract

**Date:** 2026-07-22  
**Status:** implementation in progress; Phase gate not yet closed  
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
- A CLOSED or REOPEN_REQUESTED dashboard does not query the live weekly ledger.
  It validates and serves the row-level opening balance and canonical weekly
  rows captured in the immutable close snapshot. The frontend also refuses to
  substitute a live `cashflowSnapshot.readModel` for this frozen source.
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
  also covers the QA clock and Firestore composition. The browser deadline is
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
11. A legacy or closed dashboard cannot render a current annual row value or
    current mirror metadata when the frozen snapshot lacks that evidence.

## Implementation and evaluation record

- Spring JVM full suite: **202/202 passed**. This includes rejection of an
  incomplete canonical-row state map and rejection of a same-net/different-row
  opening change without partial writes, explicit-zero persistence, a single
  weekly-ledger query, and zero live-ledger reads for a CLOSED dashboard.
- BFF/frontend focused suite: **273/273 passed** across the shared JVM client,
  JVM proxy, sheet
  import, client contract, running-balance helper, and cashflow shell. The
  suite includes a timed-out POST preflight assertion that the final JVM close
  mutation was never called, plus legacy, frozen, and project-mismatch evidence
  fixtures that contain sentinel live values and prove they are not exposed.
- Production build: **2,910 modules transformed**, successful.
- Stage data inventory on **2026-07-22 KST** found `0` monthly-close documents
  (`0` CLOSED/REOPEN_REQUESTED, `0` missing `openingBalances`, `0` missing
  `ledgerWeeks`). The legacy evidence-only path remains covered for future or
  migrated environments; no user document contents were printed during the
  read-only inventory.
- Two independent auditors found no remaining code blocker; the implementation
  audit is **100/100**. The overall Phase remains open because Stage browser QA
  has not run against this un-deployed build.

No Docker, Redis, response cache, or Live deployment is used for this Phase.
