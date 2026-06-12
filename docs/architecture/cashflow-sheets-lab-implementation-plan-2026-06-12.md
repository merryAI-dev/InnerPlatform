# Cashflow Sheets Lab Implementation Plan

Date: 2026-06-12

Branch: `experiment/sheets-cashflow-projection-readonly`

Tracking issue: https://github.com/merryAI-dev/InnerPlatform/issues/274

Status: Phase 0 complete. This document plans Phase 1 through Phase 6.

## Executive Summary

This branch builds a read-only Cashflow Sheets Lab. A workspace user pastes a Google Sheet link, the app reads the sheet layout, validates that it matches a supported cashflow template, then previews Java Cashflow Read Model Actual and Projection values on that layout.

The Google Sheet is a viewing format only. It is not a ledger, not a source of truth, and not a write target in this phase.

## Non-Negotiable Principles

- Java remains the authority for cashflow Actual and Projection read model data.
- BFF remains a thin Google Sheet reader and Java proxy. It must not calculate cashflow.
- Frontend renders user input, validation state, mapping, and preview only.
- The lab route must use user-scoped Google access. It must not silently fall back to service-account Google Sheet access.
- Phase 1 is finance/admin-only until project-level disclosure rules are explicitly widened.
- No Google Sheet writeback.
- No weekly ledger mutation.
- No cashflow actual or read-model mutation.
- No stage/live alias update from this branch.
- Unsupported templates stop with a clear explanation. No automatic repair.

## Existing Code To Reuse

| Need | Existing code | Decision |
| --- | --- | --- |
| Spreadsheet ID extraction | `server/bff/google-sheets.mjs` `extractSpreadsheetId` | Reuse in BFF. Mirror a small client-side helper only for immediate UI feedback. |
| Google Sheet metadata and values | `server/bff/google-sheets.mjs` `previewSpreadsheet` | Reuse. Add a lab-specific route instead of changing migration route semantics. |
| Java cashflow snapshot proxy | `server/bff/routes/jvm-weekly-api.mjs` `GET /api/v1/cashflow/:projectId` | Reuse. Do not add a BFF cashflow calculator. |
| Workspace user policy | `server/bff/routes/jvm-weekly-api.mjs` workspace auth helpers and Java `InternalServiceTokenFilter` | Reuse. `@mysc.co.kr` user maps to `workspace_user`. |
| Cashflow line catalog and labels | `src/app/platform/cashflow-sheet.ts`, `src/app/policies/cashflow-policy.json` | Reuse labels. Do not create a second line catalog. |
| Export layout helpers | `src/app/platform/cashflow-export.ts` | Use as reference only. Do not expose export as a Phase 1-4 feature. |
| Workbook family detection | `src/app/platform/google-sheet-workbook-plan.ts` | Reuse classification ideas for detecting cashflow tabs. Do not use AI analysis in this lab path. |

## Architecture

```text
User
  |
  v
Cashflow Sheets Lab UI
  - link input
  - selected sheet tab
  - template status
  - cell mapping table
  - read-only preview
  |
  | POST /api/v1/projects/:projectId/cashflow-sheet-lab/preview
  v
BFF lab route
  - checks signed-in platform context
  - reads Google Sheet metadata and values
  - forwards raw layout evidence
  - reads Java cashflow snapshot through existing proxy/service path
  - does not calculate cashflow
  |
  +--> Google Sheets API, readonly
  |
  +--> Java weekly API
       GET /api/v1/cashflow/{projectId}
       - authoritative Actual
       - authoritative Projection
       - read model grouping
```

Preferred first implementation shape:

- `src/app/integrations/google-sheets/`
  - client-side link helper, sheet preview types, display-safe error normalization.
- `src/app/features/cashflow-sheet-compare/`
  - page components, template status components, preview table.
- `src/app/lib/sheets-cashflow-readonly-client.ts`
  - typed platform API client for the lab route.
- `server/bff/routes/cashflow-sheet-lab.mjs`
  - lab-specific route that composes existing Google Sheets service and Java snapshot client.
- `server/bff/cashflow-sheet-template.mjs`
  - layout-only template validation and mapping. No LLM, no auto repair.
- `server/bff/java-weekly-client.mjs`
  - shared Java weekly client extracted from the private proxy helpers in `server/bff/routes/jvm-weekly-api.mjs`.

Java extension should be deferred until Phase 2 unless the BFF template validation starts duplicating Java cashflow line rules. If validation requires canonical cashflow semantics, move that portion to Java instead of expanding BFF authority.

The BFF validator may identify layout evidence only: tab title, row labels, column coordinates, and A1 positions. It must not decide accounting meaning beyond mapping those labels to a versioned cashflow policy.

## Phase 1 - Sheet Link Intake

Goal: prove that a user can paste a Google Sheet link and get a safe, readable sheet preview.

Scope:

- Add the lab route shell under BFF.
- Extract shared Java weekly client helpers before composing Java data into the lab route.
- Add client helper for `spreadsheetId` extraction and request typing.
- Add feature route/page shell for Cashflow Sheets Lab.
- Display selected spreadsheet title, sheet tabs, selected tab, first N rows as non-authoritative layout evidence, and access errors.
- Require a user Google access token for the lab route. Do not use service-account fallback.
- Place the first lab page in the admin/finance cashflow area.

Out of scope:

- Cashflow mapping.
- Java snapshot joining.
- DB writes.
- Sheet writes.
- Portal-wide workspace access.

Completion criteria:

- Invalid link returns `spreadsheet_id_required`.
- Missing Google access token returns `google_access_token_required`.
- Missing Google permission returns a visible access error.
- Valid sheet returns title, tabs, selected tab, and matrix.
- A non-finance/non-admin actor cannot access the first lab route.
- No mutation endpoint is introduced.

Recommended tests:

- `server/bff/google-sheets` extraction tests if missing coverage for target link forms.
- BFF route test with fake Google Sheets service.
- BFF route test proving missing user Google token does not fall back to service-account Sheets access.
- BFF route test proving a non-finance/non-admin actor is denied in Phase 1.
- Client helper test for URL, raw ID, and bad input.
- Component shell test for loading, error, and preview states.

## Phase 2 - Template Validation And Cell Mapping

Goal: determine whether the selected sheet is a supported cashflow template and show exact cell mappings.

Scope:

- Define the supported template contract:
  - required tab family is `CASHFLOW`.
  - required row labels include cashflow line labels from the existing policy.
  - required columns can be matched to year-month/week labels.
  - Actual and Projection sections must be distinguishable.
- Build deterministic validator.
- Return mapping entries:
  - logical field
  - row index
  - column index
  - A1 notation
  - source line id
  - mode: `actual` or `projection`
- Show unsupported reasons in the UI.
- Return `policyVersion` with mapping results when cashflow labels are resolved.

Out of scope:

- Guessing new templates.
- Fixing headers.
- Writing corrected templates.
- Inferring accounting meaning from Sheet numbers.

Completion criteria:

- Supported template yields a mapping table.
- Unsupported template yields specific missing rows/columns.
- Mapping code uses existing cashflow policy labels.
- Sheet numeric cells are never parsed as ledger values.

Recommended tests:

- Validator tests for supported sample.
- Missing header test.
- Missing cashflow line test.
- Ambiguous duplicate label test.
- Week column parsing test.
- Conflicting Sheet value vs Java value fixture: preview must mark Sheet text as layout evidence and Java value as authoritative.

## Phase 3 - Java Read Model Join

Goal: use Java snapshot values as the only source of Actual and Projection preview amounts.

Scope:

- Fetch `GET /api/v1/cashflow/:projectId` through the existing platform path.
- Normalize Java read model into a display-only lookup:
  - `mode`
  - `yearMonth`
  - `weekNo`
  - `cashflowLine`
  - `amount`
- Join template mapping to Java values.
- Track empty read-model state separately from zero amounts.
- Include value source on every preview cell: `source: "java_read_model"` for authoritative values, `source: "sheet_layout"` for raw Sheet text.
- Include Java snapshot timestamp or response timestamp when available.

Out of scope:

- Frontend calculation.
- BFF calculation.
- `cashflow-weeks/upsert`.
- Projection mutation.

Completion criteria:

- Preview values originate from Java response only.
- Missing Java data is shown as `empty`, not silently treated as success.
- UI can show amount, zero, missing, and unsupported as different states.
- Stale Sheet numbers are not presented as cashflow values.

Recommended tests:

- Read model normalization test.
- Mapping join test for actual and projection.
- Missing line returns missing state.
- Zero amount remains a valid mapped value.
- Unauthorized project ID test.
- Stale or missing Java snapshot timestamp test.

## Phase 4 - Read-Only Preview UI

Goal: give finance/PM users a sheet-shaped preview that is useful without becoming another editor.

Scope:

- Build a single lab page with:
  - link input
  - tab selector
  - validation status
  - mapping table
  - sheet-like preview
  - error panel
- Use restrained operational UI, not a landing page.
- Hover details for mapped cells.
- No modal-heavy review loop.
- No export button.
- No save button.
- Strong source labeling: Sheet text is "layout evidence"; Java values are "internal ledger read model".

Completion criteria:

- User can tell which sheet tab was read.
- User can tell which cells are mapped.
- User can tell which Java values are present or missing.
- There is no affordance implying writeback or sync.
- A user cannot confuse Sheet-entered numbers with Java ledger values.

Recommended tests:

- Component test for successful preview.
- Component test for unsupported template.
- Component test for Google permission error.
- Accessibility smoke for form labels and keyboard tab order.

## Phase 5 - Safety Verification

Goal: prove the branch did not reintroduce the old authority leak.

Scope:

- Static scan for forbidden paths:
  - no call to Google Sheets write scopes.
  - no use of `spreadsheets.values.update`, `batchUpdate`, or Drive write in lab code.
  - no frontend cashflow actual save.
  - no BFF cashflow calculation in lab route.
- Static scan for forbidden client imports:
  - no import or call to `upsertCashflowProjectionViaPlatformApi`.
  - no call to `/cashflow-weeks/upsert`.
  - no call to `/cashflow-actuals/sync`.
  - no import of export workbook builders from lab modules.
- Unit and integration tests for the lab flow.
- Verify deploy guard still passes.

Completion criteria:

- `npm test -- --run` targeted tests pass.
- BFF route tests pass.
- `DRY_RUN=1 scripts/deploy_sheets_lab_vercel.sh` passes.
- `git diff weekly-java-deployed-live-baseline...HEAD --stat` shows changes scoped to lab modules, tests, docs, and explicit BFF route mounting.

Recommended checks:

```bash
rg -n "spreadsheets\\.values\\.(update|append)|batchUpdate|drive\\.files\\.update|cashflow-weeks/upsert" src server/bff
rg -n "upsertCashflowProjectionViaPlatformApi|cashflow-actuals/sync|cashflow-exports|buildCashflowExport" src/app/features/cashflow-sheet-compare src/app/integrations/google-sheets src/app/lib/sheets-cashflow-readonly-client.ts server/bff/routes/cashflow-sheet-lab.mjs
DRY_RUN=1 scripts/deploy_sheets_lab_vercel.sh
```

## Phase 6 - Sheets Lab Deploy

Goal: deploy only to the sheets-lab alias for user validation.

Scope:

- Clean tree.
- Upstream HEAD match.
- Guarded Vercel deploy.
- Post-alias inspect.
- Lab-only smoke checks.
- Stage/live alias inspect before and after lab alias update.
- Issue comment with deployed alias and tested commit.

Out of scope:

- Stage deploy.
- Live deploy.

Completion criteria:

- Alias updated only at `inner-platform-sheets-lab-merryai-devs-projects.vercel.app`.
- Invalid link, missing Google token, unauthorized actor, Java unavailable, and success states are smoke-tested against lab alias.
- Stage/live aliases remain unchanged.
- Issue #274 contains the deployed commit and verification summary.

## Error And Rescue Registry

| Error | User sees | System behavior | Rescue |
| --- | --- | --- | --- |
| Invalid Sheet link | "Google Sheet 링크를 확인해 주세요." | Stop before network call if possible | User edits link |
| Sheet not shared | "시트를 읽을 권한이 없습니다." | No retry loop beyond request retry policy | User shares sheet or uses accessible account |
| Google token missing | "Google Sheet 접근 권한을 확인할 수 없습니다." | Stop before Sheets request | User reconnects Google login |
| Service account missing | "시트 읽기 설정이 필요합니다." | 503 from BFF | Admin config fix |
| Unauthorized project | "이 프로젝트의 Cashflow를 볼 권한이 없습니다." | Stop before Sheet and Java join | User switches project or requests access |
| Unsupported template | Specific missing rows/columns | No auto repair | User selects correct tab or fixes template |
| Java snapshot unavailable | "내부 Cashflow 값을 불러오지 못했습니다." | Stop preview join | Retry after Java/API issue resolved |
| Empty read model | "내부 원장 기준값이 아직 없습니다." | Render empty state, not zeros | User checks project/week data |
| Mapping duplicate | "동일한 항목이 중복되어 매핑할 수 없습니다." | Stop mapping | User fixes duplicate labels |

## Failure Modes Registry

| Failure mode | Risk | Prevention |
| --- | --- | --- |
| BFF starts calculating cashflow | Recreates old authority split | Lab route may only join Java values to mapped cells |
| Frontend infers totals | Users see numbers not backed by Java | Frontend displays returned preview cells only |
| Unsupported template silently maps wrong cells | Audit preview becomes misleading | Fail closed on missing or duplicate labels |
| Zero and missing are conflated | Users trust incomplete data | Use separate `mapped_zero` and `missing_value` states |
| Lab deploy aliases over stage | Stage QA gets overwritten | Use `deploy_sheets_lab_vercel.sh` only |
| User token falls back to service account | User sees data they cannot personally access | Lab route requires user token and disables fallback |
| Arbitrary project ID disclosure | Workspace user can preview another project's cashflow | Phase 1 finance/admin-only, later membership check before portal access |

## NOT In Scope

- Google Sheet writeback.
- Export button.
- Two-way sync.
- Template auto-repair.
- AI sheet analysis.
- Ledger mutation.
- Actual/projection mutation.
- Java endpoint compatibility for legacy BFF `cashflow-weeks/upsert`.
- Stage/live deployment.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | CEO | Keep first release read-only | Mechanical | Choose completeness | This validates value without risking ledger corruption | Sheet writeback |
| 2 | Eng | Reuse existing BFF Google Sheets service | Mechanical | DRY | Existing adapter already handles ID extraction, metadata, values, and readonly auth | New Sheets client |
| 3 | Eng | Add lab-specific route instead of changing migration import route | Mechanical | Explicit over clever | Keeps migration semantics separate from cashflow preview | Overloading `google-sheet-import/preview` |
| 4 | Eng | Use Java cashflow snapshot as the only value source | Mechanical | Authority boundary | Matches agreed ledger policy and prevents frontend/BFF actual calculation | BFF actual/projection calculation |
| 5 | Design | No export/save/sync controls in Phase 1-4 | Mechanical | User clarity | Any write-looking affordance misleads users about read-only scope | Disabled export buttons |
| 6 | DX | Add explicit error codes and UI messages for all stop states | Mechanical | Completeness | Internal SaaS users need clear next action, not stack traces | Generic error toast |
| 7 | Eng | Require user-scoped Google Sheet access in lab route | Mechanical | Authority boundary | Prevents service-account fallback from reading Sheets the actor cannot access | Silent service-account fallback |
| 8 | Eng | Start admin/finance-only until project disclosure rules are designed | Taste | Pragmatic | This is safer for a lab that combines arbitrary Sheet links with project cashflow data | Broad workspace-user lab access |
| 9 | Eng | Extract shared Java weekly client before lab composition | Mechanical | DRY | Existing Java proxy helpers are private; duplication would create auth drift | Copying proxy logic |

## Review Scores

| Review | Score | Notes |
| --- | --- | --- |
| CEO | 8/10 | The plan solves the right first problem: safe preview before automation. It intentionally rejects writeback. |
| Design | 7/10 | UI scope is clear. Needs exact page placement and visual hierarchy in Phase 4 before implementation. |
| Eng | 8/10 | Existing code leverage is strong. Main risks are Google auth fallback, project disclosure, and private Java proxy reuse. |
| DX | 7/10 | Developer path is understandable. Needs typed contracts and error fixtures early to avoid guesswork. |

## Open Questions Before Coding

1. Template sample: which real Google Sheet tab should become the golden fixture?
2. Java validation boundary: keep deterministic layout validation in BFF first, or add Java validation endpoint immediately when semantics exceed layout?
3. Portal widening: after Phase 1, should workspace users access only selected/assigned projects or all stage projects?

Recommendation:

- Start Phase 1 with admin/finance-only route placement.
- Start Phase 1 without Java changes, except extracting shared Java weekly client helpers from the BFF proxy path.
- In Phase 2, if validator needs canonical cashflow semantics beyond labels and coordinates, move that logic to Java before shipping Phase 2.

## First Implementation Order

1. Extract shared Java weekly client helper from `server/bff/routes/jvm-weekly-api.mjs`.
2. Create lab API contract and client types.
3. Add BFF route with fake-service tests, user Google token requirement, and admin/finance gate.
4. Add link helper and unit tests.
5. Add page shell under admin/finance cashflow area.
6. Add Phase 1 UI states with source labeling.
7. Run targeted tests and guard dry-run.
8. Comment progress on issue #274.

## Outside Review Findings Applied

An adversarial read-only `codex exec` review flagged nine issues. The plan now applies the required fixes:

- User-scoped Google Sheet access is required for the lab route.
- Service-account fallback is forbidden in the lab route.
- Phase 1 starts admin/finance-only.
- Sheet text is layout evidence only.
- Java values carry authoritative source labels.
- Java proxy helpers must be extracted before route composition.
- Template validation is constrained to layout facts unless moved to Java.
- Static scans explicitly fence legacy BFF cashflow mutation/export paths.
- Lab deploy requires smoke checks and stage/live alias inspection.
