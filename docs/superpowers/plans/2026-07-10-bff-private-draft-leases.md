# BFF Private Draft Leases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development task-by-task. Every behavior change starts with a failing test and ends with a focused commit.

**Goal:** Make project registration/project editing and cashflow/sheet apply use project-scoped, server-owned 30-minute leases with private drafts, atomic final submit, canonical resource URLs, and Stage-only rollout without touching Live.

**Architecture:** The BFF owns authentication, project access, registration drafts, generic lease lifecycle, idempotency, and project final-submit transactions. The restored JVM weekly service validates the same cashflow lease inside its Firestore write transaction and owns finance calculations/canonical cashflow writes. React keeps form state mounted, renders lease state, and never writes the protected draft/lease/cashflow paths directly.

**Tech Stack:** React 18, React Router 7, TypeScript, Express/Node ESM, Firestore transactions/emulator, Java 21/Spring Boot/Maven, Vitest, Playwright, GitHub Actions, Vercel Preview, Cloud Run Stage.

**Approved:** `승인 1` on 2026-07-10. Worktree: `/Users/boram/MYSCube/.worktrees/bff-private-draft-leases`. Branch: `codex/bff-private-draft-leases`.

---

## Baseline Evidence

- Base SHA: `b40e0751d7700a8ad49097bfc677fcd9a14b34c2` (`origin/main`).
- `npm run build`: PASS.
- `npm run policy:verify`: PASS.
- `npm test`: first cold parallel run had Rust build/worker/500-row timeouts; all affected suites passed when rerun alone.
- `npm run bff:test:integration`: existing 4 contract mismatches before feature code:
  - response error code vs message assertion;
  - three stale `viewer` expectations while current role normalization returns `pm`.
- Stage read baseline:
  - cashflow snapshot 200;
  - weekly sheet endpoints 500;
  - real-looking fixture is read-only and must not be mutated.

## Commit Boundaries

1. `docs: define private draft lease architecture`
2. `test(bff): align integration baseline contracts`
3. `build(jvm): restore weekly service source ownership`
4. `feat(bff): add project scoped edit leases`
5. `feat(bff): add private project registration drafts`
6. `feat(jvm): fence authoritative cashflow writes`
7. `feat(portal): add canonical edit resource routes`
8. `feat(portal): preserve edit state across background refresh`
9. `feat(portal): use private registration draft sessions`
10. `feat(cashflow): enforce edit lease sessions`
11. `ci: gate stage finance write path`
12. `test: add edit lease stage regressions`

---

### Task 1: Freeze The Existing Contracts Before Feature Work

**Files:**
- Modify: `server/bff/app.integration.test.ts`
- Test: `server/bff/app.integration.test.ts`
- Test: `src/app/platform/role-normalization.test.ts` or the existing role helper test

- [ ] Confirm from the current role helper and RBAC policy whether `viewer` is intentionally normalized to `pm`.
- [ ] Add/adjust a focused role contract test first; do not change authorization merely to satisfy a stale assertion.
- [ ] Make the executive-review error assertion check the public `message` while preserving the machine-readable `error` code.
- [ ] Update only stale integration expectations that contradict the verified current contract.
- [ ] Run `npm run bff:test:integration`; expected PASS before lease code begins.
- [ ] Run `npm test -- server/bff/app.integration.test.ts` only if supported by the current Vitest config.
- [ ] Commit the baseline-only changes separately.

### Task 2: Restore The JVM Weekly Service As Owned Source

**Files:**
- Add: `server/jvm-weekly-api/**` from `origin/experiment/sheets-cashflow-projection-readonly@617213e`
- Modify: `.github/workflows/ci.yml`

- [ ] Verify the persistent repo's untracked `/Users/boram/MYSCube/server/jvm-weekly-api` remains untouched.
- [ ] Import only the remote `server/jvm-weekly-api/` subtree into this isolated worktree; do not merge or cherry-pick the divergent branch.
- [ ] Confirm `git diff --name-only` contains only the new subtree and intended docs/CI files.
- [ ] Run `mvn -f server/jvm-weekly-api/pom.xml test`; record the native baseline.
- [ ] Add Java 21 + Maven test as a blocking CI step.
- [ ] Commit the mechanical source restoration before behavior changes.

### Task 3: Build The Server-owned Lease Domain

**Files:**
- Create: `server/bff/edit-lease.mjs`
- Create: `server/bff/edit-lease.test.mjs`
- Create: `server/bff/routes/edit-leases.mjs`
- Create: `server/bff/routes/edit-leases.test.mjs`
- Create: `server/bff/edit-leases.integration.test.ts`
- Modify: `server/bff/app.mjs`
- Modify: `server/bff/schemas.mjs`
- Modify: `vitest.bff-integration.config.ts`

- [ ] Write failing unit tests for exact 1,800,000ms TTL, `now >= expiresAt`, idempotent same-session acquire without renewal, manual extension, release, and stale `leaseId/fence` rejection.
- [ ] Write a failing emulator concurrency test: two sessions acquire the same resource with `Promise.all`; exactly one succeeds, while different resources both succeed.
- [ ] Implement one `editLeaseService` using Firestore transactions and injected clock/UUID functions.
- [ ] Allow only `project-registration`, `project-info`, and `cashflow`; derive the document key server-side.
- [ ] Validate actor access before lease operations. A lease is an additional write condition, never an authorization grant.
- [ ] Return only holder display name, `sameActor`, and expiry on `423`; never return holder UID/email/lease ID/fence.
- [ ] Mount generic status/acquire/extend/release routes behind `BFF_EDIT_LEASES_ENABLED=true` and Stage runtime safety checks.
- [ ] Add structured audit events without raw lease IDs or draft payloads.
- [ ] Run focused unit and emulator tests, then commit.

### Task 4: Make Lease And Draft Collections BFF-only

**Files:**
- Modify: `firebase/firestore.rules`
- Modify: `src/app/platform/firestore-rules-policy.test.ts`
- Create: `server/bff/firestore-rules.edit-leases.integration.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] Write a failing policy test proving `editLeases`, `privateEditDrafts`, `projectRequestDrafts`, and legacy `cashflowEditLocks` are catch-all exclusions.
- [ ] Add the smallest rules-unit-test dependency only if the installed Firebase SDK cannot create authenticated rules test contexts.
- [ ] Write emulator rules tests proving owner, PM, finance, and admin client SDK writes are all denied on protected collections.
- [ ] Update rules so the Admin SDK BFF remains the only writer and no broader match grants access.
- [ ] Do not deploy rules yet; run local emulator tests and commit.

### Task 5: Add Private Project Registration Drafts And Atomic Submit

**Files:**
- Create: `server/bff/routes/project-registration-drafts.mjs`
- Create: `server/bff/routes/project-registration-drafts.test.mjs`
- Create: `server/bff/project-registration-drafts.integration.test.ts`
- Modify: `server/bff/idempotency.mjs`
- Modify: `server/bff/idempotency.test.mjs`
- Modify: `server/bff/routes/projects.mjs`
- Modify: `server/bff/outbox.mjs`
- Modify: `server/bff/app.mjs`
- Modify: `server/bff/schemas.mjs`

- [ ] Write failing tests for create/get/PATCH owner checks, active lease, expected draft revision, legacy owner-draft adoption, and 404 privacy for other users/admin.
- [ ] Write failing submit integration tests for the persisted invariants:
  - draft save: draft 1, active lease 1, project/request/member/outbox/admin queue 0;
  - submit: draft SUBMITTED, lease RELEASED, project/request/member/outbox exactly 1;
  - injected transaction failure: no canonical partial writes.
- [ ] Add atomic idempotency support whose fingerprint, command result, lease, draft, canonical records, assignment, and outbox are in one Firestore transaction. Do not use the existing three-transaction `createMutatingRoute` path for submit.
- [ ] Reuse existing project payload normalization and Slack payload formatting through minimal exports rather than duplicating them.
- [ ] Make submit read the stored private draft; do not trust a second final payload from the browser.
- [ ] Add an outbox handler for post-submit Slack/Drive/participation work. External calls never execute inside the transaction.
- [ ] Add BFF private attachment upload/register behavior: lease check, draft-scoped storage path, immediate metadata save, and cleanup/retry semantics.
- [ ] Run focused unit/emulator tests and commit.

### Task 6: Fence The JVM Cashflow Transaction

**Files:**
- Modify: `server/jvm-weekly-api/src/main/**`
- Modify: `server/jvm-weekly-api/src/test/**`
- Modify: `server/bff/routes/jvm-weekly-api.mjs`
- Modify: `server/bff/routes/jvm-weekly-api.test.mjs`
- Modify: `server/bff/java-weekly-client.mjs`
- Modify: `server/bff/routes/cashflow-sheet-lab.mjs`
- Modify: `server/bff/routes/cashflow-sheet-lab.test.mjs`

- [ ] Write failing Java tests for active actor/session/lease/fence validation inside the same Firestore transaction as canonical writes.
- [ ] Cover expiry, release, stale fence after reacquire, project mismatch, and BFF/JVM data-project mismatch.
- [ ] Add failing tests that reject unknown cashflow line IDs, caller-controlled actual `sourceSheetKey`, and imports exceeding the atomic write budget before any write.
- [ ] Implement the smallest transaction guard in the existing JVM command path.
- [ ] Make BFF strip caller actor/tenant context and forward only trusted request-context plus edit-session headers.
- [ ] Keep sheet preview/staging read-only in BFF, but route final apply through `java-weekly-client.mjs`.
- [ ] Remove or Stage-gate Node's direct multi-transaction cashflow apply so partial canonical writes are impossible.
- [ ] Run Maven tests, BFF route tests, and emulator read-back tests; commit.

### Task 7: Add Stable Tab Identity And Lease UI State

**Files:**
- Create: `src/app/platform/edit-session.ts`
- Create: `src/app/platform/edit-session.test.ts`
- Create: `src/app/lib/edit-lease-client.ts`
- Create: `src/app/lib/edit-lease-client.test.ts`
- Create: `src/app/components/editing/useEditLease.ts`
- Create: `src/app/components/editing/EditLeaseDialogs.tsx`
- Create: `src/app/components/editing/EditLeaseDialogs.test.tsx`

- [ ] Write failing tests for reload reuse and duplicated-tab collision. Because browsers may clone `sessionStorage`, use a native `BroadcastChannel` claim/response handshake and generate a new session ID when a live tab already owns the copied ID.
- [ ] Write failing fake-clock tests for 5-minute warning, no heartbeat extension, manual extend, and status checks on `visibilitychange`, `focus`, and `pageshow`.
- [ ] Implement a focused client and hook; do not add a global state framework.
- [ ] Implement accessible dialogs with exact approved copy and explicit read-only/reacquire actions.
- [ ] Verify timers only update display and never mutate `expiresAt`; commit.

### Task 8: Canonicalize URLs And Stop Editor Unmounts

**Files:**
- Modify: `src/app/routes.tsx`
- Modify: `src/app/platform/portal-project-selection.ts`
- Modify: `src/app/platform/portal-project-selection.test.ts`
- Modify: `src/app/data/portal-route-providers.tsx`
- Modify: `src/app/components/portal/PortalCashflowPage.tsx`
- Modify: `src/app/components/portal/PortalProjectEdit.tsx`
- Modify: `src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.tsx`
- Modify: `src/app/components/projects/ProjectRegisterRedirectPage.tsx`
- Modify: `src/app/components/projects/ProjectRegisterRedirectPage.shell.test.ts`
- Modify: `src/app/components/portal/PortalLayout.tsx`
- Modify: `src/app/data/portal-store.tsx`
- Add/Modify: focused mounted-component regression tests

- [ ] Write failing route tests for canonical deep links, route-param precedence, project switch ID replacement, legacy one-time SPA redirect, and provider scope for nested cashflow routes.
- [ ] Write a mounted regression test proving background `portalLoading` and token-only auth refresh preserve the same editor DOM node and input value.
- [ ] Register canonical routes and redirect wrappers before the editor mounts.
- [ ] Change the plain registration `<a href>` to React Router `Link`.
- [ ] Keep `<Outlet>` mounted after first bootstrap; show background refresh as overlay/status.
- [ ] Narrow PortalStore effects from the whole auth object to actual identity/query keys.
- [ ] Run dirty confirmation before changing `activeProjectId` or URL.
- [ ] Keep the existing preload auto-reload prohibition; commit.

### Task 9: Move Project Registration UI To Private BFF Drafts

**Files:**
- Modify: `src/app/components/portal/PortalProjectRegister.tsx`
- Modify: `src/app/components/projects/ProjectEditorWizard.tsx`
- Modify: `src/app/platform/project-request-draft.ts`
- Modify/Create: project registration component tests

- [ ] Write failing tests that the editor starts read-only until lease ownership, restores the same URL draft after reload, and never calls direct Firestore draft writes.
- [ ] Write failing tests that attachment input clears only after upload plus metadata save; on failure the `File` remains retryable.
- [ ] Replace user-global `registration-{uid}` with BFF-issued opaque `draftId` and canonical URL.
- [ ] Replace direct autosave with revisioned BFF PATCH; keep debounced text save but immediately persist attachment metadata.
- [ ] Add `beforeunload` and router blocker while dirty/uploading.
- [ ] Replace frontend project/request/member/Slack sequence with the single submit command and persisted read-back.
- [ ] Verify temporary drafts remain absent from admin queues; commit.

### Task 10: Enforce Leases In Cashflow And Sheet Lab UI

**Files:**
- Modify: `src/app/components/cashflow/CashflowProjectSheet.tsx`
- Modify: `src/app/components/cashflow/CashflowProjectSheet.shell.test.ts`
- Modify: `src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.tsx`
- Modify: `src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.shell.test.ts`
- Modify: cashflow BFF client/tests

- [ ] Write failing tests for same project conflict, different project independence, shared cashflow/sheet-lab resource, expired session dialog, and stale save rejection.
- [ ] Remove the client Firestore `cashflowEditLocks` implementation and 2-minute TTL.
- [ ] Acquire the BFF lease only when the user enters edit mode; locked viewers keep canonical read access.
- [ ] Split `임시저장` from `최종저장`; both require current server status, but only final save changes canonical cashflow and releases the lease.
- [ ] Require the same cashflow lease for sheet apply; preview remains available read-only.
- [ ] Ensure timeout releases only ownership and preserves the private draft/attachment references.
- [ ] Run focused component, BFF, and Java read-back tests; commit.

### Task 11: Add Blocking CI And Stage-only Deployment Guards

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/stage-deploy.yml`
- Create: `scripts/assert-stage-edit-lease-runtime.mjs`
- Create/Modify: Stage JVM build/deploy script or workflow
- Modify: `scripts/assert-safe-stage-deploy.mjs`

- [ ] Make CI block on `npm test`, `npm run bff:test:integration`, policy verification, build, and JVM Maven tests.
- [ ] Add a hard-coded Stage-only JVM deployment path using a new Cloud Run service name; never update the legacy service.
- [ ] Abort unless the resolved GCP/Firebase data project equals the verified current Stage BFF data project and is not `inner-platform-live-20260316`.
- [ ] Feed the new JVM URL and `BFF_EDIT_LEASES_ENABLED=true` into the Vercel Preview deployment artifact only.
- [ ] Add an explicit Stage rules deployment using an explicit project ID and Stage credential; never use the generic unqualified Firebase command.
- [ ] Assert Vercel target is preview and production workflow remains manual-only.
- [ ] Run workflow syntax/policy tests and commit.

### Task 12: Local Independent QA And Code Review

**Files:**
- Modify: targeted tests only when a defect is reproduced
- Record: QA evidence outside production source if ignored by repo policy

- [ ] Run `npm test` from a warm build and require a green exit, not only targeted reruns.
- [ ] Run `npm run bff:test:integration` and require green.
- [ ] Run `npm run policy:verify` and `npm run build`.
- [ ] Run `mvn -f server/jvm-weekly-api/pom.xml test`.
- [ ] Run targeted Playwright flows for edit session, registration, cashflow, and refresh preservation.
- [ ] Run independent code review and fix every correctness/security issue with a reproducing test.
- [ ] Run the GAN-style QA evaluator using `~/.gstack/evaluator-persona.md`, `~/.gstack/eval-criteria.md`, and relevant general items from `~/.gstack/qa-calibration.md`.

### Task 13: Merge To Main And Verify Stage Without Touching Live

- [ ] Before push, record Live read-only tuple: latest production workflow run ID, deployment ID, commit SHA, createdAt, root/asset hash. Do not authenticate to or mutate Live.
- [ ] Push `codex/bff-private-draft-leases`, open a PR, wait for every blocking check, and review the final diff against `origin/main`.
- [ ] Merge only after green CI. The main push may trigger Stage Preview and the new isolated Stage JVM service; do not dispatch production workflow.
- [ ] Create a disposable `qa-lease-<timestamp>` project/draft and sheet copy. Never write to the real-looking `p1773994485543` fixture.
- [ ] In two browser profiles/contexts, verify same-account different-tab and two-user same-resource conflicts, different-resource independence, private draft invisibility, final-submit visibility, cashflow/sheet shared lease, and canonical read-back.
- [ ] Run two parallel timeout fixtures: 31-minute idle expiry and 25-minute manual renewal. Confirm no auto-renew from typing/focus/status polls.
- [ ] Capture request IDs, `serverNow`, `expiresAt`, status codes, screenshots, console/network logs, persisted counts/versions, and JVM result digest.
- [ ] Confirm Stage workflow `headSha` equals merge SHA and Vercel target is not production.
- [ ] Re-read the Live tuple and require an exact match plus zero new Production Deploy runs.
- [ ] If second-user credentials, Stage deployment identity, or Stage-only cloud permissions are unavailable, stop before merge/deploy and report the precise missing authority; do not substitute a Live test.
