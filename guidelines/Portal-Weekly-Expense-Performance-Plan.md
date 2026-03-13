# Portal Weekly Expense Performance Plan

Related issue: [#62](https://github.com/merryAI-dev/InnerPlatform/issues/62)

## Summary

This document defines the performance program for the portal weekly expense sheet so that it behaves closer to Google Sheets under real operating scale.

Target scale:

- 200 to 500 rows per project sheet
- repeated keyboard navigation
- drag selection and bulk paste
- evidence upload and sync in parallel
- Google Sheets migration usage during onboarding

The current product can perform the workflow functionally, but the editing experience degrades under scale because rendering, derived calculations, and Firestore writes are too tightly coupled.

This plan keeps the current Firebase and data model semantics where possible, and reduces interaction cost by introducing row windowing, local-first draft editing, batched persistence, and bounded recomputation.

## Current Architecture

### Primary files

- `src/app/components/portal/PortalWeeklyExpensePage.tsx`
- `src/app/components/cashflow/SettlementLedgerPage.tsx`
- `src/app/data/portal-store.tsx`
- `src/app/components/portal/GoogleSheetMigrationWizard.tsx`

### Current runtime flow

1. `PortalWeeklyExpensePage` loads project-scoped rows and sheet state.
2. `SettlementLedgerPage` renders the interactive sheet and manages selection, copy/paste, upload entry points, and inline editing.
3. Local edits mutate `ImportRow[]` in memory.
4. The page later persists the whole sheet snapshot through `saveExpenseSheetRows(...)`.
5. Drive upload, sync, migration preview, comments, and evidence review all accumulate around the same screen.

### Existing strengths

- Full sheet snapshot persistence already exists.
- Session draft cache already exists for some sheet flows.
- Drive upload and sync were already decoupled into separate actions.
- Google Sheets migration wizard was already lazy-loaded out of the main weekly page chunk.
- Spreadsheet-like clear helpers were started in `settlement-grid-actions.ts`.

### Current bottlenecks

#### 1. Rendering cost

- The grid still renders too much work per interaction.
- Complex row cells include select controls, drive controls, comment affordances, and evidence state.
- Even with memoization, many actions still churn too much UI work across the table.

#### 2. Derived computation cost

- `applyDerivedRows(...)` performs whole-row-array passes too often.
- Simple edits trigger recalculation beyond the minimum affected range.
- Sheet state and derived fields are coupled too early in the update path.

#### 3. Persistence cost

- Firestore persistence writes full sheet snapshots.
- This model is acceptable, but only if writes are infrequent.
- If local edit cadence and persistence cadence are too close, the grid feels network-bound.

#### 4. Feature accumulation on the same route

- Evidence dialogs, upload review, migration preview, parser helpers, and comments all add weight.
- Some of that code is already split, but the primary sheet route still carries too much responsibility.

## Product Goals

The weekly sheet should feel like a spreadsheet first, and a networked business application second.

The desired outcome is:

- editing remains immediate
- Drive actions are explicit and isolated
- data is safe even if the user refreshes or navigates away
- Firestore remains the persisted source of truth
- Google Sheets migration remains available without making the core editing route heavy

## Non-Goals

This plan does not include:

- replacing the sheet with a third-party enterprise grid
- real-time collaborative editing
- a new Firestore schema for sheets
- removing snapshot persistence semantics
- redesigning Google Drive authorization from scratch

## Success Criteria

### UX criteria

- Keyboard navigation and drag selection feel stable on 300-row sheets.
- Bulk paste no longer freezes the interface.
- Drive upload does not block normal editing.
- Users can continue editing before persistence completes.

### Technical criteria

- Table body rendering uses row windowing.
- Persistence is batched and never tied to every keystroke.
- Derived recomputation is bounded to the smallest necessary row range.
- Lazy features remain outside the hot edit path.
- Existing Firestore recovery behavior remains valid.

### Operational criteria

- We can explain exactly when a sheet is local-only, saving, saved, or out-of-sync.
- We can recover from failed writes without losing recent user edits.
- We can observe persistence frequency and performance regressions with logs or profiling hooks.

## Phased Delivery Plan

## Phase 0: Baseline and instrumentation

Before changing core behavior, lock down a performance baseline.

### Deliverables

- A repeatable QA scenario with a 300-row representative sheet
- Profiling notes for:
  - first paint / route interactivity
  - arrow-key navigation
  - 20x10 paste
  - range clear and multi-row delete
  - upload plus explicit sync
- counters for:
  - `applyDerivedRows(...)` duration
  - `saveExpenseSheetRows(...)` call count
  - render count for the sheet and row components

### Notes

This phase should produce evidence, not only intuition. Every later phase should compare against this baseline.

## Phase 1: Grid body windowing

Introduce row virtualization for the editable body while keeping the current table semantics intact.

### Scope

- Virtualize row rendering inside `SettlementLedgerPage`
- Keep the sticky header and current column definitions
- Preserve:
  - drag selection
  - keyboard focus
  - cell copy and paste
  - row menu actions

### Expected effect

- DOM size drops substantially on larger sheets
- scrolling and keyboard movement become smoother
- rerender cost becomes proportional to visible rows instead of total rows

### Design constraints

- Selection operates on logical row and column indexes, not rendered DOM positions
- Overscan should be large enough to avoid visible focus jitter
- Row virtualization must not break the active comment anchor, upload row action state, or select popovers

## Phase 2: Local-first draft model and batched persistence

Make the editing surface authoritative locally first, and flush to Firestore later.

### Scope

- Keep `expense_sheets` snapshot persistence
- Introduce a clearer draft lifecycle:
  - `dirty`
  - `saving`
  - `saved`
  - `save_failed`
- Flush on:
  - manual save
  - idle timer
  - blur / route transition
  - periodic safety flush

### Firebase contract

- Firestore continues to store the latest accepted snapshot
- browser cache stores newer local draft state until flush succeeds
- no cell-level writes
- no per-keypress transaction writes

### Expected effect

- typing and navigation stop feeling blocked by network timing
- fewer write conflicts and fewer network bursts
- better recovery after transient failures

## Phase 3: Partial recompute instead of full-sheet recompute

Reduce how much logic runs after each edit.

### Scope

- Split `applyDerivedRows(...)` into narrower update paths
- Recompute only the edited row when possible
- Use downstream range recompute only for dependent values like running balance
- Recompute evidence-derived text only when evidence-related columns change

### Expected effect

- less CPU time per edit
- lower paste latency
- less unnecessary object churn for memoized row components

## Phase 4: Feature isolation for the hot edit path

Keep non-core functionality available, but out of the main render path.

### Scope

- Further isolate:
  - evidence upload review
  - evidence sync affordances
  - comments drawer
  - migration preview helpers
  - PDF and XLSX related helpers
- Review dynamic imports and chunk boundaries

### Expected effect

- faster route entry
- smaller edit-path bundle
- lower memory pressure during long sessions

## Phase 5: Drive and migration workflow hardening

Preserve the feature set while keeping the sheet lightweight.

### Drive workflow

- Upload remains file-only
- Sync remains explicit
- Existing evidence folder per row is reused
- Upload and sync status stay visible in the row

### Migration workflow

- Migration wizard stays separate from the normal edit path
- Workbook scanning, preview, and apply steps remain full-screen but lazy-loaded
- Multi-tab migration can continue to evolve independently of the hot grid path

## Firebase and Firestore Considerations

## What should stay the same

- `expense_sheets` remains the persisted snapshot model
- project-scoped listeners remain the source of loaded sheet data
- the portal page still reconstructs sheet state from Firestore on initial load

## What should change

- local edit cadence and Firestore write cadence must be separated
- save metadata should become more explicit
- recovery rules should prefer:
  1. newer local draft if unsaved
  2. latest Firestore snapshot otherwise

## Failure modes to explicitly handle

- failed batch save
- stale snapshot overwrite
- route leave before flush
- refresh during dirty state
- conflicting writes after multi-tab editing

## Proposed State Model

Recommended sheet-level state:

- `rows`
- `dirty`
- `saving`
- `lastSavedAt`
- `lastSaveError`
- `pendingFlushReason`
- `draftVersion`

Recommended persistence metadata:

- `updatedAt`
- `updatedBy`
- `draftVersion`
- optional `lastFlushAt`

This keeps debugging and support easier without changing the domain model itself.

## Testing Strategy

### Unit / integration

- helper and reducer tests for row range clear, delete, and recompute
- bounded recompute coverage for balance and evidence fields
- persistence scheduler tests for dirty/save/flush state transitions

### Build and regression

- `npm run build`
- bundle diff review for the weekly page and root index chunk

### E2E

- Playwright flow for:
  - open weekly expense page
  - navigate with keyboard
  - paste range
  - clear range
  - delete selected rows
  - upload then explicit sync
  - refresh and verify saved or draft-restored state

## Risks

- Virtualization can easily break focus and drag selection if introduced too aggressively
- Batch saving can hide data-loss bugs if draft recovery is weak
- Partial recompute can break business invariants if dependencies are not mapped carefully
- Code splitting can make debugging harder if not well documented

## Rollout Recommendation

Use staged rollout rather than one large refactor.

Recommended order:

1. instrumentation and baseline
2. batched persistence and explicit dirty/save state
3. row windowing
4. partial recompute
5. bundle trimming and feature isolation

This order lowers the risk of shipping multiple invisible regressions at once.

## Immediate Next Steps

1. Land the spreadsheet-style clear/delete helpers in PR #61
2. Build a 300-row repeatable sample and capture a baseline profile
3. Implement the local-first draft scheduler without changing Firestore schema
4. Add row windowing behind a narrow internal implementation boundary
5. Re-profile and compare against baseline before moving to partial recompute
