# CSO x Ponytail Refactoring Dialogue

Date: 2026-06-15

Branch/worktree: detached `4b317b5` from `experiment/sheets-cashflow-projection-readonly`

Scope: Cashflow Sheets Lab refactoring diagnosis after the 2026-06-12 preview/apply work.

Participants:

- `CSO`: security and authority-boundary diagnosis.
- `Ponytail`: minimal refactoring pressure. YAGNI, delete before add, no new machinery unless the existing boundary cannot hold.

Grounding files:

- `docs/architecture/cashflow-sheets-lab-data-flow-census-2026-06-12.md`
- `server/bff/routes/cashflow-sheet-lab.mjs`
- `server/bff/routes/cashflow-sheet-lab.test.mjs`
- `server/bff/java-weekly-client.mjs`
- `server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/service/FirestoreWeeklyProjectExistenceRepository.java`
- `server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/service/WeeklyExpenseAuthorizationService.java`

## Executive Diagnosis

The refactor target is not "make Sheets import work." That framing is too broad and dangerous.

The real problem is this:

1. Preview is mostly the right shape. It reads the Google Sheet, maps layout, and overlays Java read-model values.
2. Apply is the unsafe seam. It parses Sheet numbers and sends them to Java as a write command.
3. The browser/BFF can point at one Firebase project while Java points at another Firestore project.
4. A user can see success while the write lands in a different authority context.
5. Friday's code has mixed intent: the census says cross-environment apply should be blocked, but the final test explicitly allows split Firestore apply.

Ponytail verdict: do not build a new sync engine. Delete or fence the apply path until one data-environment contract is true.

CSO verdict: cross-environment write success is the security and integrity risk. Treat it as an authority-boundary bug, not a UX bug.

## 50-Turn Dialogue

### 1. CSO

The first thing I care about is not the parser. It is the trust boundary. The census says the UI/BFF can read project data from `mysc-bmp-14173451` while Java reads and writes `inner-platform-qa-20260310`.

That means "success" can be true in the wrong database. Not great.

### 2. Ponytail

Then the lazy fix is not a mapper rewrite. The lazy fix is to stop write/apply when the projects do not match.

Preview can stay. Apply gets a hard gate.

### 3. CSO

The code already exposes `applyEnvironmentAligned` in the preview response at `server/bff/routes/cashflow-sheet-lab.mjs`. That is useful, but it is only reporting. It does not enforce the apply boundary in the current final state.

Reporting a loaded weapon is not the same as unloading it.

### 4. Ponytail

Smallest refactor: one helper.

`isApplyEnvironmentAligned(bffProjectId, javaFirestoreProjectId)`. Use it in preview for display and in apply for enforcement. No policy object. No new service.

### 5. CSO

The final test at `server/bff/routes/cashflow-sheet-lab.test.mjs` says "allows apply when BFF stores sheet config and Java owns cashflow read models in different Firestore projects." That test codifies the dangerous behavior.

If the product wants cross-env lab mode, it needs explicit lab labeling and no normal-user write path.

### 6. Ponytail

Delete that test or invert it.

The replacement is one test: split Firestore returns `409` or `422` on apply. Preview still returns `200` with `applyEnvironmentAligned: false`.

### 7. CSO

There is also a data-integrity issue in `buildApplyLines`. It takes formatted Sheet values, parses them, and sends them as authoritative amounts.

That violates the earlier branch principle that Sheet numeric cells are layout evidence only.

### 8. Ponytail

Exactly. We have two modes pretending to be one feature.

Read-only lab says Sheet values are evidence. Apply says Sheet values are input data. Pick one. Friday scope picked read-only.

### 9. CSO

If apply remains, it is not read-only anymore. It becomes an import command. Then it needs stronger proof: environment alignment, project existence in Java Firestore, role check, idempotency, and a user-facing warning that Sheet values replace source lines.

That is a different product.

### 10. Ponytail

So do not keep apply in Sheets Lab v1.

Rename nothing. Build nothing. Hide or remove the button, keep route blocked. Add one note in the UI: "Preview only."

### 11. CSO

`FirestoreWeeklyProjectExistenceRepository` now allows project existence if either the project doc exists or project-scoped data already exists. That keeps existing Java read models usable.

But it can also make orphan data look legitimate.

### 12. Ponytail

That code is trying to preserve old data. Fine.

Do not use it as proof for new writes. Reads can tolerate legacy shape. Writes should require the actual project doc unless explicitly migrated.

### 13. CSO

Good distinction. Read compatibility is different from write authorization.

For apply, Java should require canonical project existence, not "some cashflow rows exist."

### 14. Ponytail

Smallest Java change: split `exists` into `existsForRead` and `existsForWrite`.

But even that may be too much for v1. The BFF can block apply before Java.

### 15. CSO

BFF blocking is necessary but not sufficient. Attackers do not politely use the intended UI. If Java exposes `/api/v1/cashflow/{projectId}/sheet-lab/apply`, Java needs its own write-side check.

Defense in depth. Boring, required.

### 16. Ponytail

Then two-line policy in Java command handling, not a new framework.

For `CASHFLOW_SHEET_LAB_APPLY_COMMAND`, require real project doc. Existing read-model fallback stays read-only.

### 17. CSO

The role mapping is another concern. `isWorkspaceUser` maps any `@mysc.co.kr` email to `workspace_user`, and workspace mode allows a broad command set.

This may be fine for internal SaaS, but for write commands it is a wide gate.

### 18. Ponytail

Do not redesign RBAC today.

For this refactor, narrower: Sheets Lab apply requires `admin` or `finance`, not generic workspace user or PM. Preview can allow workspace user.

### 19. CSO

That maps to risk. Preview leaks less. Apply mutates financial read model state.

PM apply might be product-desired later, but it should come after project assignment checks and environment alignment.

### 20. Ponytail

Default now: preview for workspace users, apply off.

When apply comes back: `finance/admin` only. One product discussion later if PM needs it.

### 21. CSO

The legacy BFF mutation endpoints were identified as a P2 risk. The census says they now return `410 legacy_bff_cashflow_write_disabled` by default.

That is good. Keep it. Do not revive them to make Sheets work.

### 22. Ponytail

Agreed. Any solution that says "just call old BFF upsert" is dead on arrival.

No second cashflow authority.

### 23. CSO

The preview route has the better architecture. It reads BFF config, reads Google Sheets, calls Java snapshot, and labels `valueSource: java_cashflow_read_model`.

That is the boundary worth keeping.

### 24. Ponytail

So the refactor is mostly deleting ambiguity.

Make preview the feature. Make apply unavailable until the environment contract passes.

### 25. CSO

There is a subtle product bug here. The UI can show Sheet value `999` and Java amount `123`. If labels are weak, users may think Sheet value is what will be used.

This is how financial data gets corrupted by a well-meaning button.

### 26. Ponytail

UI copy fix. No new component.

Column labels: "Sheet text" and "Internal ledger value." The apply button should not sit next to the preview in v1.

### 27. CSO

The formatted amount parser is still useful if apply exists later. It handles won signs, commas, Unicode minus, and parentheses.

But parser correctness does not solve authority correctness.

### 28. Ponytail

Keep parser tests. Do not expand parser.

It is a support function, not the center of the refactor.

### 29. CSO

The biggest inconsistency is doc versus test. The census says cross-environment apply should be blocked. The final test says split Firestore apply is allowed.

That is a security smell because future engineers will trust the test.

### 30. Ponytail

First refactor PR should do only this:

1. Invert split Firestore apply test.
2. Add BFF apply guard.
3. Keep preview behavior unchanged.

That is the smallest honest diff.

### 31. CSO

Would you remove apply route entirely?

From a security posture angle, removing it is clean. But it may break planned experimentation.

### 32. Ponytail

No. Return a clear blocked response.

Deleting the route causes client churn. A blocked route makes the state explicit and cheap.

### 33. CSO

The route should return a reason payload: BFF Firestore project, Java Firestore project, and "apply requires aligned data environment."

Avoid leaking secrets. Project IDs are already surfaced in access policy.

### 34. Ponytail

Reuse the same access policy fields.

Do not invent a new diagnostics schema. The response already has the words.

### 35. CSO

What about allowing apply when either project ID is missing?

Security answer: no. Unknown is not aligned.

### 36. Ponytail

Yes. `Boolean(bff && java && bff === java)`.

That exact expression already exists in preview. Move it into a helper and use it.

### 37. CSO

For Java, I want one more guard. A direct call to Java apply should not bypass BFF.

If Java cannot know BFF project ID, it can still require canonical project document existence for apply.

### 38. Ponytail

Small Java follow-up, separate PR if needed:

`CASHFLOW_SHEET_LAB_APPLY_COMMAND` uses strict project existence. Do not touch read commands.

### 39. CSO

The user-facing failure mode matters. If finance sees "forbidden," they will assume permissions are broken.

The error should say this is a cross-environment lab and apply is blocked to avoid writing to the wrong database.

### 40. Ponytail

One sentence. No modal essay.

"Apply is disabled because this preview reads Firebase A but Java writes Firebase B."

### 41. CSO

There is another issue: the feature name "Lab" should remain visible. If this is a lab, the UI can tolerate preview-only behavior.

If it is promoted to normal workflow, write boundaries must be production-grade.

### 42. Ponytail

Keep "Lab" in nav and page title.

Do not rename to "Cashflow Import." That name would be a lie.

### 43. CSO

From STRIDE: the main categories are Tampering and Repudiation. Tampering because values can land in a different authority context. Repudiation because "success" audit logs are in Java QA while the user selected a BFF project elsewhere.

The audit trail becomes split.

### 44. Ponytail

Then the fix is not more logging first.

Stop the write. Logging a bad write just creates a more searchable mistake.

### 45. CSO

What should not be refactored?

Do not refactor Google Sheets service. Do not add AI analysis. Do not move cashflow calculation to BFF. Do not create a generic workbook sync engine.

### 46. Ponytail

Also do not touch `cashflow-sheet-template.mjs` unless a failing fixture says mapping is wrong.

The mapper is not the problem.

### 47. CSO

Security recommendation:

Block write/apply unless Browser Firebase, BFF Firestore, and Java Firestore resolve to the same data environment. Add Java write-side canonical project existence for direct calls.

### 48. Ponytail

Minimal implementation:

One helper. One guard. One inverted test. One UI disabled-state message.

That's the whole game.

### 49. CSO

Residual risk after that: preview can still compare BFF project config with Java data from another environment.

But preview is read-only and can show the mismatch explicitly. That is acceptable for a lab.

### 50. Ponytail

Final refactor plan:

1. Keep preview.
2. Block apply on environment mismatch.
3. Keep formatted number parser tests for future apply.
4. Do not build sync.
5. Do not add another cashflow authority.

Ship that first.

## Agreed Refactoring Recommendation

### Phase 1. Make The Existing Boundary True

Change the final behavior so the code matches the safer census rule:

- `preview` may run across environments, but must display `applyEnvironmentAligned: false`.
- `apply` must fail unless BFF and Java Firestore project IDs are both present and equal.
- If either project ID is missing, fail closed.
- Keep `cashflowSnapshotStatus` and `cashflowSnapshotError` behavior unchanged for preview.

Likely files:

- `server/bff/routes/cashflow-sheet-lab.mjs`
- `server/bff/routes/cashflow-sheet-lab.test.mjs`
- `src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.tsx`

### Phase 2. Keep Java Write-Side Honest

Java should not allow a direct `cashflow-sheet-lab.apply` command to create or mutate data for a project that only exists as orphan read-model rows.

Smallest clean version:

- Keep read compatibility for old project-scoped data.
- Require canonical `orgs/{tenantId}/projects/{projectId}` existence for new write commands, at least for `CASHFLOW_SHEET_LAB_APPLY_COMMAND`.

Likely files:

- `FirestoreWeeklyProjectExistenceRepository.java`
- `WeeklyExpenseAuthorizationService.java`
- `WeeklyExpenseAuthorizationServiceTest.java`

### Phase 3. Preserve The Parser, Do Not Center It

Keep `parseCashflowSheetAmount` and its tests. The parser fixed a real bug, but it is not the architectural answer.

Do not extend it until a real Sheet fixture fails.

### Phase 4. UI Copy, Not UI Architecture

The UI should say:

```text
Apply is disabled because this lab preview reads one Firebase project while Java writes another. Align the environments before enabling apply.
```

No new wizard. No separate diagnostics dashboard.

## What Not To Build

- No AI sheet analysis.
- No BFF cashflow calculator.
- No bidirectional sync.
- No Google Sheet writeback.
- No generic workbook abstraction.
- No second cashflow import pipeline.

## Security Posture Note

This is an AI-assisted CSO pass focused on the Sheets Lab refactoring seam, not a full professional security audit. It can catch common authority-boundary risks, but it is not a substitute for a qualified security review for production systems handling financial data or PII.
