# Phase Contract: Cashflow Weekly Settlement Lock

**Date:** 2026-07-22

**Status:** complete — independent audit 100/100

**Gate:** 100/100 before UI work or Stage deployment

## Scope

- Reuse the existing Firestore command transaction and month-close authority.
- Upgrade weekly settlement completion into a server-enforced per-week lock.
- Bind each lock to the canonical financial snapshot, source/target revisions,
  SHA-256, actor, and server timestamp.
- Allow an active project participant to reopen a week before month close only
  with the current revision and a non-empty reason.
- Reject standalone weekly reopen after month close. Finance/Admin must use the
  existing month-reopen approval contract, which reopens that month's weekly
  locks atomically when approved.
- Enforce the lock at every JVM write boundary for sheet apply, Projection,
  Actual, and weekly status changes.
- Relay explicit year-month/week read, complete, and reopen contracts through
  the BFF without an edit lease.
- Record planning, execution, and measured evaluation in the cashflow README.

## Success criteria

- [x] A locked week does not block another week or an unchanged no-op.
- [x] A changed locked week is rejected for sheet, Projection, both Actual
  replacement paths, and weekly status writes.
- [x] Completion retries do not create duplicate versions or audit events.
- [x] Snapshot/hash, source/target revision, actor, and time are retained.
- [x] Reopen requires a reason and exact current revision.
- [x] Standalone weekly reopen is rejected after month close.
- [x] Finance/Admin month-reopen approval atomically opens that month's locked
  weeks and preserves actor, reason, source, and revision history.
- [x] An opened week can be modified and locked again at a later revision.
- [x] Existing month close, multi-month sheet apply, and annual totals remain
  green.
- [x] BFF/JVM contracts, real-format sheet regression, and production build
  pass without Docker.

## Failure criteria

- A weekly lock blocks a whole month, project, or feature.
- A frontend/BFF-only check leaves a JVM write path open.
- A drifted locked snapshot is treated as healthy.
- Emergency reopen destroys the prior snapshot or its reason.
- Weekly reopen bypasses the stronger month-close authority.
- A retry with the same semantic request produces another financial mutation.

## Out of scope

- Lock-state UI and ERP visual redesign.
- Redis, external queues, or a second lock service.
- Live deployment.
- Migration of legacy month-close collections.

## Required evidence

- Full JVM suite and focused storage regressions.
- Real Spring MVC mapping tests for read, complete, reopen, validation, and
  conflict propagation.
- BFF and TypeScript client contract tests.
- Sanitized 260701 full-year workbook parse/apply regression.
- Production Vite build.
- Read-only independent auditor score of exactly 100/100.

Measured evidence and the final audit decision are maintained in
`src/app/features/cashflow-sheet-compare/README.md` and
`docs/architecture/phase-gate-policy.md`.
