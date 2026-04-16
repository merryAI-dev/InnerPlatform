# Portal Hardening Orchestration Model

Goal: keep portal hardening work in this repo split between one main agent that orchestrates and verifies, and subagents that each implement a single bounded slice.

## Operating Model

- Main agent owns scope, ordering, cross-file integration, final verification, and the decision to merge or re-slice.
- Subagents own implementation for one slice only and should not expand scope beyond the assigned files and acceptance checks.
- Documentation changes stay with the main agent unless a slice explicitly includes a doc update tied to the same change.

## Task Slicing

- Slice by one concern at a time: one route, one API contract, one harness fix, one release gate, or one doc update.
- Keep a slice small enough to review in one pass, usually 1 to 3 files.
- Do not combine read-model changes, write-path changes, and release-gate changes in the same slice.
- If a slice needs shared config or test harness work, split that into its own slice first.

## Ownership

- Main agent:
  - writes the slice brief
  - assigns the subagent
  - resolves conflicts across slices
  - performs final integration and release verification
  - owns the PR narrative and merge decision
- Subagent:
  - edits only the assigned files
  - adds or updates tests for the assigned slice
  - reports exact files changed and exact verification commands run
  - stops when the slice is complete or blocked

## Review Loop

1. Main agent writes a concrete slice brief with goal, files, and required metrics.
2. Subagent implements the slice and runs the requested checks.
3. Main agent reviews the diff, test output, and metric deltas.
4. If the slice is clean, it is merged into the working branch and the next slice starts.
5. If scope drift or a failing metric appears, the slice is re-scoped before more code lands.

## Required Test Metrics

- Targeted portal smoke passes for the affected route or flow.
- Console error count for the flow is zero.
- Firestore `Listen 400` count is zero on the affected surface.
- HAR or equivalent network budget is recorded before and after the slice.
- Unit or integration coverage exists for any regression the slice introduces or fixes.
- If a metric is not applicable, the PR notes why it was excluded.

## Canonical Validation Command

- Phase 0 target single source of truth:
  - `npm run phase0:portal:network-gate -- --json-out artifacts/portal-network-gate.json`
- CI is now wired to prefer that canonical command and publish the JSON artifact as `portal-network-gate`.
- CI now calls that canonical command directly and no longer keeps a conditional fallback lane in the workflow.
- The JSON artifact is the handoff object the main agent reads before claiming the phase 0 network/runtime gate is stable.
- Do not duplicate these commands in ad-hoc notes or subagent briefs. Reference the canonical script name and artifact path instead.

## Branch and PR Discipline

- Use one branch per slice or phase.
- Keep each PR scoped to a single slice and its verification artifacts.
- Rebase or refresh the branch before integration if the base branch moved.
- Do not mix implementation slices with unrelated doc cleanup in the same PR.
- Main agent owns final review, merge order, and rollback choice.

## Portal Hardening Rules

- Treat HAR regressions, Firestore listen churn, and route coupling as first-class acceptance failures.
- Prefer short-lived branches for portal hardening because the repo is actively changing in parallel.
- Never land a partial slice without the verification artifacts that prove the surface is stable.
- Keep the release story aligned with the metrics, not with the amount of code changed.
