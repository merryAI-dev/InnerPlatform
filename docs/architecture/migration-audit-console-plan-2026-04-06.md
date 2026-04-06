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

- [ ] Add `cic?: string` to `Project` and `ProjectMigrationCandidate`
- [ ] Normalize `cic` from Firestore candidate docs
- [ ] Extend project-migration test fixtures to accept `cic`
- [ ] Add a unit test that CIC can flow through a candidate/project fixture without changing existing matching behavior
- [ ] Commit

### Task 2: Add queue/detail helper layer

**Files:**
- Create: `src/app/platform/project-migration-console.ts`
- Test: `src/app/platform/project-migration-console.test.ts`

- [ ] Implement console helper types for queue sections, selected record detail, and duplicate suggestions
- [ ] Implement CIC-aware filtering and section counts
- [ ] Implement “same CIC first, then similar name” duplicate suggestion ordering
- [ ] Add tests for:
  - queue grouping by status
  - CIC filtering
  - selected detail model
  - duplicate suggestion ordering
- [ ] Commit

### Task 3: Add quick-create project builder

**Files:**
- Create: `src/app/platform/project-migration-quick-create.ts`
- Test: `src/app/platform/project-migration-quick-create.test.ts`

- [ ] Implement `buildQuickMigrationProject(...)`
- [ ] Include stable defaults for required `Project` fields
- [ ] Use `candidate.businessName` as `officialContractName`
- [ ] Use quick-create `name` as `project.name`
- [ ] Use selected CIC as `project.cic`
- [ ] Add tests for:
  - required defaults
  - slug generation
  - contract name propagation
  - CIC propagation
- [ ] Commit

### Task 4: Split the page into UI components

**Files:**
- Modify: `src/app/components/projects/ProjectMigrationAuditPage.tsx`
- Create: `src/app/components/projects/migration-audit/MigrationAuditControlBar.tsx`
- Create: `src/app/components/projects/migration-audit/MigrationAuditQueueRail.tsx`
- Create: `src/app/components/projects/migration-audit/MigrationAuditDetailPanel.tsx`
- Create: `src/app/components/projects/migration-audit/MigrationAuditDenseTable.tsx`

- [ ] Move KPI + filters into `MigrationAuditControlBar`
- [ ] Add queue rail with `미등록 / 후보 있음 / 완료`
- [ ] Add detail panel with:
  - source info
  - current match
  - existing project connect action
  - quick-create action
- [ ] Move dense inspection table into `MigrationAuditDenseTable`
- [ ] Keep existing sync-approved-scope capability, but visually demote it
- [ ] Add `data-testid` hooks for the new console surfaces
- [ ] Commit

### Task 5: Implement quick-create + instant match in the page

**Files:**
- Modify: `src/app/components/projects/ProjectMigrationAuditPage.tsx`
- Reuse: `src/app/data/store.tsx`
- Reuse: `src/app/platform/project-migration-quick-create.ts`

- [ ] Wire quick-create submit to `addProject`
- [ ] After creation, immediately write `manualProjectId/manualProjectName/migrationUpdatedAt/migrationUpdatedBy` to candidate doc
- [ ] Keep the current selection stable after creation
- [ ] Refresh local state via existing project/candidate subscriptions rather than ad-hoc reload logic
- [ ] Show duplicate suggestions before create
- [ ] Require CIC selection if the current row is `미지정`
- [ ] Commit

### Task 6: Add tests for page behavior

**Files:**
- Modify: `src/app/platform/project-migration-audit.test.ts`
- Create or modify: page/component tests if present
- Modify: `tests/e2e/product-release-gates.spec.ts`

- [ ] Add helper-level tests for console model and quick-create
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
