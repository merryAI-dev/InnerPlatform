# Weekly Expense Firestore Inheritance and PostgreSQL Roadmap

Date: 2026-06-08

## Decision

For the weekly expense and cashflow refactor, inherit the current Firestore data
shape first. Do not force an immediate PostgreSQL cutover.

The near-term target is:

- keep the existing Firestore structure as the operational source while the
  backend authority layer is introduced
- move validation, calculation, state transitions, idempotency, and audit
  decisions to the server
- preserve existing document IDs, project IDs, sheet keys, row shape, and
  cashflow week semantics during the first backend cutover
- treat PostgreSQL as a later canonical-store candidate or mirror/read-model
  target after the server command model is stable

This is a risk decision. PostgreSQL can improve the final architecture, but it
does not directly fix instability if the write authority, validation authority,
and calculation authority remain split across frontend code, BFF adapters, and
storage-specific shortcuts.

## Observed Live Firestore Shape

Read-only inspection of `inner-platform-live-20260316`, org `mysc`, showed the
current weekly expense domain is already organized around these paths:

- `orgs/mysc/projects`: project master data
- `orgs/mysc/ledgers`: project ledger metadata
- `orgs/mysc/transactions`: normalized transaction-like settlement records
- `orgs/mysc/cashflow_weeks`: weekly projection/actual cashflow documents
- `orgs/mysc/weekly_submission_status`: weekly submission and close status
- `orgs/mysc/projects/{projectId}/expense_sheets/default`: weekly expense sheet
  document with a `rows` array
- `orgs/mysc/projects/{projectId}/bank_statements/default`: bank statement
  upload document with a `rows` array
- `orgs/mysc/projects/{projectId}/expense_intake/{lineId}`: bank upload
  candidate/handoff rows with `bankFingerprint`, `bankSnapshot`,
  `matchState`, `manualFields`, `existingExpenseSheetId`, and optional
  `existingExpenseRowTempId`
- `orgs/mysc/projects/{projectId}/budget_summary/default`,
  `budget_code_book/default`, and `budget_tree_v2/default`: budget and codebook
  sources used by weekly expense validation and selection

Observed counts at the time of inspection:

- projects: 55
- ledgers: 18
- transactions: 89
- cashflow weeks: 1422

Several project `expense_sheets/default` documents already contain spreadsheet
rows as a single large `rows` array. Several `bank_statements/default` documents
also store uploaded bank rows as a large `rows` array. That shape is not the
ideal final database model, but it is the existing operational contract and must
be inherited before it is decomposed.

## Why Firestore Inheritance First Is Safer

Immediate PostgreSQL replacement would require splitting large Firestore
document arrays into normalized row/cell tables while preserving:

- existing project IDs and sheet keys
- temporary row IDs and bank source identities
- bank upload to expense sheet handoff state
- weekly cashflow `projection` and `actual` map semantics
- PM submission and admin close status
- existing audit and export expectations

That migration is feasible, but it is not the lowest-risk first move. The first
move should reduce authority fragmentation:

1. Frontend sends explicit commands and renders backend results.
2. Server reads the inherited Firestore-shaped records.
3. Server validates cells, rows, weeks, amounts, budget categories, and evidence
   requirements.
4. Server calculates actual from persisted weekly expense rows.
5. Server reads projection from the agreed projection source.
6. Server writes audit events and export snapshots.

After those boundaries are stable, PostgreSQL migration becomes a data-model
upgrade instead of a simultaneous product, backend, and storage rewrite.

## PostgreSQL Expected Benefits

The long-term PostgreSQL direction is still valuable. The expected benefits are:

- row/cell-level unique constraints
- week, amount, budget category, and budget subcategory validation finalized
  inside a database transaction
- concurrent editing protection through row versioning and optimistic locking
- clearer actual/projection aggregation queries
- stronger audit export reproducibility from fixed snapshot tables
- fewer whole-document update conflicts caused by large array fields such as
  `expense_sheets.rows`

These are database and transaction benefits. They become meaningful when the
server is already the authority for commands, validation, calculation, and audit.

## Migration Strategy

Use a staged migration:

1. **Firestore-shaped server adapter**
   - Java backend reads and writes the existing Firestore-shaped concepts or a
     directly compatible representation.
   - Keep field names, project IDs, sheet keys, row identities, and cashflow week
     line IDs stable.

2. **Server authority**
   - Remove frontend write authority for weekly expense and cashflow actual.
   - Keep validation, calculation, idempotency, optimistic checks, and audit
     events in server commands.

3. **PostgreSQL mirror/read model**
   - Mirror rows, cells, projections, actuals, weekly status, bank import state,
     and audit exports into PostgreSQL.
   - Compare PostgreSQL aggregates against Firestore-derived aggregates before
     cutover.

4. **Dual-read verification**
   - Run stage/live read comparisons for projection, actual, weekly status, and
     audit export summary.
   - Block cutover if row counts, totals, week mapping, or audit counts diverge.

5. **Canonical PostgreSQL cutover**
   - Move canonical row/cell/projection/actual/status/audit tables to
     PostgreSQL only after migration scripts and comparison gates pass.
   - Keep Firestore backups and rollback mapping. Do not delete existing
     Firestore data as part of the cutover.

## Non-Negotiables

- Existing Firestore data must not be deleted during migration.
- PostgreSQL adoption must not create a second write authority.
- Frontend must not write weekly expense rows, cashflow actual, weekly status,
  bank apply state, or audit export artifacts directly.
- Any generated SQL/Firebase client must not bypass the server command boundary.
- Audit exports must be generated from backend-approved projection, actual, and
  audit summaries, not from frontend-local spreadsheet state.
- Stage must pass comparison and smoke gates before any production promotion.

## Current Architectural Implication

The immediate engineering direction is:

```text
React UI -> Java server command/read contracts -> inherited Firestore-shaped data
```

The later direction is:

```text
React UI -> Java server command/read contracts -> PostgreSQL canonical tables
```

The important part is not the storage engine first. The important part is that
the server owns the command boundary, validation, calculation, concurrency, and
audit trail.
