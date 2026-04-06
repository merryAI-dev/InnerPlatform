# Migration Audit Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the admin migration-audit page into a CIC-aware operating console with queue-first UX and in-place quick project creation + instant matching.

**Architecture:** Keep the existing source of truth (`projectDashboardProjects` + platform `projects`) and add a derived console model on top. Split the current large page into focused components: control bar, queue rail, detail panel, dense table, and a helper layer that computes CIC grouping, queue sections, selected detail state, and duplicate suggestions. Add lightweight `cic` fields to migration candidates and projects so the console can filter, create, and match inside a CIC context without redesigning the whole project domain.

**Tech Stack:** React, TypeScript, Firestore, Vitest, Playwright, existing shadcn/ui primitives

---

### Task 1: Add CIC to domain types and candidate normalization

**Files:**
- Modify: `src/app/data/types.ts`
- Modify: `src/app/data/project-migration-candidates.ts`
- Test: `src/app/platform/project-migration-audit.test.ts`

- [x] Add `cic?: string` to `Project` and `ProjectMigrationCandidate`
- [x] Normalize `cic` from Firestore candidate docs
- [x] Extend project-migration test fixtures to accept `cic`
- [x] Add a unit test that CIC can flow through a candidate/project fixture without changing existing matching behavior
- [x] Commit

### Task 2: Add queue/detail helper layer

**Files:**
- Create: `src/app/platform/project-migration-console.ts`
- Test: `src/app/platform/project-migration-console.test.ts`

- [x] Implement console helper types for queue sections, selected record detail, and duplicate suggestions
- [x] Implement CIC-aware filtering and section counts
- [x] Implement “same CIC first, then similar name” duplicate suggestion ordering
- [x] Add tests for:
  - queue grouping by status
  - CIC filtering
  - selected detail model
  - duplicate suggestion ordering
- [x] Commit

### Task 3: Add quick-create project builder

**Files:**
- Create: `src/app/platform/project-migration-quick-create.ts`
- Test: `src/app/platform/project-migration-quick-create.test.ts`

- [x] Implement `buildQuickMigrationProject(...)`
- [x] Include stable defaults for required `Project` fields
- [x] Use `candidate.businessName` as `officialContractName`
- [x] Use quick-create `name` as `project.name`
- [x] Use selected CIC as `project.cic`
- [x] Add tests for:
  - required defaults
  - slug generation
  - contract name propagation
  - CIC propagation
- [x] Commit

### Task 4: Split the page into UI components

**Files:**
- Modify: `src/app/components/projects/ProjectMigrationAuditPage.tsx`
- Create: `src/app/components/projects/migration-audit/MigrationAuditControlBar.tsx`
- Create: `src/app/components/projects/migration-audit/MigrationAuditQueueRail.tsx`
- Create: `src/app/components/projects/migration-audit/MigrationAuditDetailPanel.tsx`
- Create: `src/app/components/projects/migration-audit/MigrationAuditDenseTable.tsx`

- [x] Move KPI + filters into `MigrationAuditControlBar`
- [x] Add queue rail with `미등록 / 후보 있음 / 완료`
- [x] Add detail panel with:
  - source info
  - current match
  - existing project connect action
  - quick-create action
- [x] Move dense inspection table into `MigrationAuditDenseTable`
- [x] Keep existing sync-approved-scope capability, but visually demote it
- [x] Add `data-testid` hooks for the new console surfaces
- [x] Commit

### Task 5: Implement quick-create + instant match in the page

**Files:**
- Modify: `src/app/components/projects/ProjectMigrationAuditPage.tsx`
- Reuse: `src/app/data/store.tsx`
- Reuse: `src/app/platform/project-migration-quick-create.ts`

- [x] Wire quick-create submit to `addProject`
- [x] After creation, immediately write `manualProjectId/manualProjectName/migrationUpdatedAt/migrationUpdatedBy` to candidate doc
- [x] Keep the current selection stable after creation
- [x] Refresh local state via existing project/candidate subscriptions rather than ad-hoc reload logic
- [x] Show duplicate suggestions before create
- [x] Require CIC selection if the current row is `미지정`
- [x] Commit

### Task 6: Add tests for page behavior

**Files:**
- Modify: `src/app/platform/project-migration-audit.test.ts`
- Create or modify: page/component tests if present
- Modify: `tests/e2e/product-release-gates.spec.ts`

- [x] Add helper-level tests for console model and quick-create
- [ ] Add page-level test coverage where practical for selection and quick-create state
- [ ] Add Playwright release gate that:
  - opens `/projects/migration-audit`
  - selects a `미등록` row
  - creates a project by name
  - sees the row become connected
- [ ] Commit

### Task 7: Verify and land

**Files:**
- Modify: `docs/architecture/migration-audit-console-design-2026-04-06.md` only if implementation semantics changed

- [ ] Run targeted Vitest suites
- [ ] Run targeted Playwright gate
- [ ] Run `npm run build`
- [ ] Review diff for accidental scope creep
- [ ] Commit final polish if needed
