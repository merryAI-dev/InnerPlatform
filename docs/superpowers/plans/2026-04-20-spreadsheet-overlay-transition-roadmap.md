# Spreadsheet Overlay Transition Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition InnerPlatform from a PM-first migration app into a spreadsheet-first overlay/governance system without throwing away the migration assets already built.

**Architecture:** Standardized spreadsheets and shared folders remain the canonical source. The application shifts toward a `crawler + normalized JSON/markdown compiler + admin agent console + thin PM viewer` architecture. Existing Firestore, portal, and admin assets are retained where they act as metadata, review, export, audit, and access-control layers rather than as the primary source of truth.

**Tech Stack:** Google Drive / spreadsheet sources, TypeScript/Vite React, Firestore, existing admin/portal surfaces, markdown wiki, normalized JSON compiler, bank intake/triage pipeline, export contracts

---

## Why This Plan Exists

The retrospective conclusion is not “delete the platform.” It is “stop forcing the platform to be the primary write system.”

This roadmap assumes:

- existing spreadsheets are already trusted by PMs
- migration friction is now a product risk
- the platform still has useful assets worth keeping
- the next winning move is to become the operating layer around spreadsheets, not a full replacement for them

## Five Execution Principles

1. **Keep spreadsheets as canonical source.**
   The platform should not try to become the first place where business truth is typed.

2. **Invest in translation before replacement.**
   Crawl, normalize, explain, compare, and publish before building more write UI.

3. **Put operations in admin, not in PM workflow training.**
   Admin becomes the agent console. PM gets a thin operational surface, not a new heavy workflow to learn.

4. **Treat Firestore as metadata, not truth.**
   Store audit state, comments, publish state, indexes, cache, and derived snapshots there.

5. **Cut over only with parity gates.**
   If the platform cannot explain differences against the source spreadsheet, it is not ready to replace anything.

## What We Keep vs Stop

### Keep and strengthen

- auth / RBAC
- admin cashflow export and related output contracts
- bank statement ingest and triage flows
- label / policy normalization work
- patch-note wiki and operational memory
- audit-style metadata and review history
- safe viewer aspects of current portal surfaces

### Freeze or reduce

- expanding PM write-heavy portal flows
- turning Firestore state into the authoritative source for business operations
- broad portal-shell productization for its own sake
- migration work whose only goal is “make users stop using spreadsheets”

### New investments

- shared-folder spreadsheet crawler
- normalized JSON compiler
- markdown explanation / diff compiler
- admin review, anomaly, publish, and audit console
- PM inbox / viewer / handoff surface

## Issue Tracks

### Issue 1: Source Governance Contract

**Problem:** The overlay strategy only works if the source spreadsheets are structurally predictable.

**Outcome:** A documented source contract covering template versions, required tabs, key table locations, named ranges, attachment rules, and publish rules.

**Suggested deliverables:**
- source template contract document
- allowed / forbidden spreadsheet mutations
- folder-level source discovery rules
- “official input” checklist for admins

**Exit gate:** A non-author engineer can identify which spreadsheet is canonical and what parts of its structure may not change.

### Issue 2: Shared Folder Crawler

**Problem:** Raw spreadsheets and attachments still require too much manual opening and interpretation.

**Outcome:** A crawler that scans the official folder structure, detects new or changed spreadsheets, fetches required files, and registers source metadata.

**Suggested deliverables:**
- source registry for discovered files
- change detection for spreadsheet revisions
- attachment fetch rules
- run log for successful / failed ingests

**Exit gate:** New source updates appear in a machine-readable queue without a human copying values into the app.

### Issue 3: Normalized JSON + Markdown Compiler

**Problem:** Source spreadsheets are readable to humans but not yet compiled into durable operational knowledge.

**Outcome:** Each official spreadsheet revision produces:
- normalized JSON for machine use
- markdown pages for human review
- field-level or concept-level diff summaries
- anomaly notes when structure or values look wrong

**Suggested deliverables:**
- source-to-JSON normalization layer
- markdown summary generator
- diff generation between revisions
- contradiction / anomaly flags

**Exit gate:** Admin can review the normalized output and understand the important changes without opening the raw spreadsheet first.

### Issue 4: Admin Agent Console

**Problem:** The admin surface still behaves like a mixed dashboard/product UI instead of a dedicated operations console.

**Outcome:** Admin becomes the place to:
- inspect changes
- review anomalies
- approve/publish source revisions
- trigger exports
- inspect audit history

**Suggested deliverables:**
- source revision queue
- anomaly review panel
- publish state and history
- export trigger and status view
- audit timeline linked to source revisions

**Exit gate:** The admin team can complete source review and export publication without requiring the PM portal as the primary work surface.

### Issue 5: PM Thin Viewer / Inbox

**Problem:** PMs are paying migration cost by being asked to adopt a new primary work surface too early.

**Outcome:** PM-facing surfaces become intentionally thin:
- current project state
- alerts and anomalies
- requests for action
- handoff into the right source or admin-reviewed flow

**Suggested deliverables:**
- project inbox / status page
- lightweight evidence and exception prompts
- viewer-first project summary
- links back to the canonical spreadsheet when write action is needed

**Exit gate:** PMs can follow what matters without learning a thick replacement workflow.

### Issue 6: Firestore Role Reduction

**Problem:** Firestore still pulls the architecture toward app-first truth and increases migration complexity.

**Outcome:** Firestore is narrowed to:
- metadata
- comments
- audit
- publish state
- cached read models
- alert state

**Suggested deliverables:**
- truth classification table by dataset
- removal list for app-owned business truth
- fallback / recovery rule from source spreadsheets
- cache invalidation and rebuild rules

**Exit gate:** If Firestore derived data is lost, the system can reconstruct operational state from source spreadsheets and compiler outputs.

## Milestone Sequence

### Milestone 1: Lock Source Governance

**Focus:** Stop hidden spreadsheet drift.

**Ships when:**
- canonical spreadsheet contract is documented
- folder structure and publish rules are fixed
- disallowed mutations are explicit

### Milestone 2: Build the Compiler Path

**Focus:** Turn spreadsheets into durable machine + human artifacts.

**Ships when:**
- crawler sees source changes
- normalized JSON is produced
- markdown summaries and diffs are generated

### Milestone 3: Shift Operations to Admin

**Focus:** Make admin the main review and publish console.

**Ships when:**
- admin can inspect revisions and anomalies
- publish/export runs from admin
- audit links back to source revisions

### Milestone 4: Thin the PM Surface

**Focus:** Reduce PM migration pain without losing visibility.

**Ships when:**
- PM has a viewer/inbox surface
- PM no longer needs thick portal write flows for the common path
- exception handoff is clear

### Milestone 5: Reduce App-Truth Dependence

**Focus:** Convert the platform into an overlay layer instead of a truth-owning app.

**Ships when:**
- Firestore truth classification is complete
- derived state rebuild is possible
- new work no longer assumes app-first business truth

## Recommended First Issue Order

1. `Source Governance Contract`
2. `Shared Folder Crawler`
3. `Normalized JSON + Markdown Compiler`
4. `Admin Agent Console`
5. `PM Thin Viewer / Inbox`
6. `Firestore Role Reduction`

## Go / No-Go Rule

Do **not** expand PM write workflows further unless all of the following are true:

- source spreadsheet contract is stable
- converter output is trusted by admins
- differences against source can be explained
- export behavior is preserved
- migration pain for PMs has clearly decreased rather than increased

## Short Version

The platform should evolve from:

- “a new place where PMs type business data”

to:

- “an agent-maintained operating layer that reads spreadsheets, compiles knowledge, supports review, and governs publication”

That shift preserves the useful parts of the current migration while stopping the architecture from doubling down on the wrong bet.
