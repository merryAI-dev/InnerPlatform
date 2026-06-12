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
- The lab route reads Google Sheets through the MYSC system service account.
- A Sheet is allowed when it is shared with the MYSC system account. User-by-user Google Sheets authorization is not required.
- PM portal access is allowed for `workspace_user`, `pm`, `finance`, and `admin`.
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

## Golden Cashflow Template Evidence

User-provided CSV inspected:

```text
/Users/boram/Downloads/[2026년 탐나는인재 창업트랙]사업비 관리 시트 - cashflow(사용내역 연동).csv
```

The source file is a Google Sheets CSV export with quoted multi-line cells. Parsed as CSV records, it has:

- 65 records.
- 68 max columns.
- Projection section: rows 11-28.
- Actual section: rows 30-47.
- Week labels: row 12 for Projection, row 31 for Actual.
- In this sample, week value columns are D through BK, 60 weekly columns total.
- Week labels follow `YY-M-W`, for example `26-1-1` through `26-12-5`.
- Total column observed at BO.

These coordinates are sample evidence, not implementation constants. The mapper must scan each detected week row for `YY-M-W` labels and derive the first weekly column, last weekly column, and week count dynamically. A supported Sheet is not required to end at BK or contain exactly 60 week columns.

The section order is a template invariant, not a heuristic: the upper cashflow section is Projection and the lower cashflow section is Actual. The mapper should use this order to assign `mode`, then validate row labels and week labels inside each section.

The raw Sheet cell text is layout evidence only. Numeric cells from this CSV are not authoritative cashflow values and must not be parsed as ledger Actual or Projection.

### Section Structure

| Mode | Header row | Week row | Line rows | Derived rows |
| --- | ---: | ---: | --- | --- |
| Projection | 11 | 12 | 14-18, 20-26 | 19 입금 합계, 27 출금 합계, 28 잔액 |
| Actual | 30 | 31 | 33-37, 39-45 | 38 입금 합계, 46 출금 합계, 47 잔액 |

### Line Mapping

| Mode | Row | Label | Cashflow line id | Kind |
| --- | ---: | --- | --- | --- |
| Projection | 14 | MYSC 선입금(잔금 등 입금 필요 시) | `MYSC_PREPAY_IN` | line |
| Projection | 15 | 매출액(입금) | `SALES_IN` | line |
| Projection | 16 | 매출부가세(입금) | `SALES_VAT_IN` | line |
| Projection | 17 | 팀지원금(입금) | `TEAM_SUPPORT_IN` | line |
| Projection | 18 | 은행이자(입금) | `BANK_INTEREST_IN` | line |
| Projection | 19 | 입금 합계 | derived | total |
| Projection | 20 | 직접사업비(공급가액) | `DIRECT_COST_OUT` | line |
| Projection | 21 | 매입부가세 | `INPUT_VAT_OUT` | line |
| Projection | 22 | MYSC인건비 | `MYSC_LABOR_OUT` | line |
| Projection | 23 | MYSC수익(간접비등) | `MYSC_PROFIT_OUT` | line |
| Projection | 24 | 매출부가세(출금) | `SALES_VAT_OUT` | line |
| Projection | 25 | 팀지원금(출금) | `TEAM_SUPPORT_OUT` | line |
| Projection | 26 | 은행이자(출금) | `BANK_INTEREST_OUT` | line |
| Projection | 27 | 출금 합계 | derived | total |
| Projection | 28 | 잔액 (※ 중요) | derived | balance |
| Actual | 33 | MYSC선입금(입금필요시) | `MYSC_PREPAY_IN` | line |
| Actual | 34 | 매출액(입금) | `SALES_IN` | line |
| Actual | 35 | 매출부가세(입금) | `SALES_VAT_IN` | line |
| Actual | 36 | 팀지원금(입금) | `TEAM_SUPPORT_IN` | line |
| Actual | 37 | 은행이자(입금) | `BANK_INTEREST_IN` | line |
| Actual | 38 | 입금 합계 | derived | total |
| Actual | 39 | 직접사업비(공급가액) | `DIRECT_COST_OUT` | line |
| Actual | 40 | 매입부가세 | `INPUT_VAT_OUT` | line |
| Actual | 41 | MYSC인건비 | `MYSC_LABOR_OUT` | line |
| Actual | 42 | MYSC수익(간접비등) | `MYSC_PROFIT_OUT` | line |
| Actual | 43 | 매출부가세(출금) | `SALES_VAT_OUT` | line |
| Actual | 44 | 팀지원금(출금) | `TEAM_SUPPORT_OUT` | line |
| Actual | 45 | 은행이자(출금) | `BANK_INTEREST_OUT` | line |
| Actual | 46 | 출금 합계 | derived | total |
| Actual | 47 | 잔액 | derived | balance |

Phase 1 should turn this structure into mapping candidates, not a summary. The section mode comes from fixed template order: upper section is Projection, lower section is Actual. The join key inside each section is the weekly label row (`26-1-1`, `26-1-2`, etc.), not the merged month header. Phase 2 should harden this section into the first golden template contract.

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

## Phase 1 - Sheet Structure Mapping

Goal: prove that a user can paste a Google Sheet link and the app can remove irrelevant parts, detect the supported cashflow layout, and produce deterministic cell mapping candidates.

Scope:

- Add the lab route shell under BFF.
- Add client helper for `spreadsheetId` extraction and request typing.
- Add feature route/page shell for Cashflow Sheets Lab.
- Read Google Sheets through the configured MYSC service account.
- Place the first lab page in the PM portal cashflow area.
- Allow `workspace_user`, `pm`, `finance`, and `admin`.
- Parse the selected tab into normalized rows while preserving original row/column coordinates.
- Detect the two cashflow sections and assign mode by fixed order: upper section is `projection`, lower section is `actual`.
- Detect weekly columns by `YY-M-W` labels such as `26-1-1`; do not depend on merged month headers.
- Map row labels to existing `cashflow-policy.json` line ids.
- Separate derived rows such as deposit total, withdrawal total, and balance from cashflow line rows.
- Ignore guidance/notes and other rows outside the detected Actual/Projection sections.
- Return mapping candidates with `mode`, `lineId`, `yearMonth`, `weekNo`, `rowIndex`, `columnIndex`, `a1`, and `source: "sheet_layout"`.
- Display selected spreadsheet title, sheet tabs, detected sections, week columns, derived rows, ignored rows, mapping candidates, and access errors.

Out of scope:

- Java snapshot joining.
- DB writes.
- Sheet writes.
- User-by-user Google Sheets OAuth consent.
- Sheet numeric cells as Actual or Projection values.
- Full golden-template rejection rules beyond obvious unsupported/missing structure.

Completion criteria:

- Invalid link returns `spreadsheet_id_required`.
- Missing service account configuration returns `google_sheets_not_configured`.
- Sheet not shared with the MYSC system account returns a visible access error.
- Valid sheet returns title, tabs, selected tab, and matrix.
- Valid sheet returns exactly ordered Projection and Actual sections.
- Valid sheet returns weekly columns by scanning the detected week row for `YY-M-W` labels, without hardcoding the final column.
- The provided CSV-equivalent fixture returns 60 weekly columns and 720 mapping cells per mode, but this fixture count is not a global template limit.
- Valid sheet returns the detected cashflow line rows and mapping cell count for each mode.
- Derived rows are identified separately and are not assigned cashflow line ids.
- Rows outside the detected cashflow sections are ignored for mapping.
- A non-workspace actor cannot access the lab route.
- No mutation endpoint is introduced.

Recommended tests:

- `server/bff/google-sheets` extraction tests if missing coverage for target link forms.
- BFF route test with fake Google Sheets service.
- BFF route test proving service account config is required.
- BFF route test proving `workspace_user`, `pm`, `finance`, and `admin` are allowed.
- BFF route test proving external/non-workspace actors are denied.
- Client helper test for URL, raw ID, and bad input.
- CSV parser/normalizer test using a sanitized fixture derived from the real cashflow CSV structure.
- Week-label mapping test for a known CSV-equivalent fixture with `26-1-1` through `26-12-5`.
- Week-label mapping test where the final week column is not BK.
- Row-label mapping test against `cashflow-policy.json` aliases.
- Derived-row separation test.
- Component shell test for loading, error, and preview states.

## Phase 2 - Template Contract Hardening

Goal: convert the Phase 1 mapping candidates into a stricter supported-template contract and reject ambiguous or unsafe layouts.

Scope:

- Define the supported template contract:
  - required tab family is `CASHFLOW`.
  - required row labels include cashflow line labels from the existing policy.
  - required week columns are detected from `YY-M-W` labels; D through BK is only the first observed sample shape, not a dependency.
  - required columns can be matched to year-month/week labels.
  - Actual and Projection sections follow fixed order: upper section is Projection, lower section is Actual.
  - derived rows are recognized as totals/balance, not cashflow line ids.
- Build deterministic validator.
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
- Sanitized fixture test covering the real CSV row layout.
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
- Invalid link, missing service account config, Sheet not shared with system account, unauthorized actor, Java unavailable, and success states are smoke-tested against lab alias.
- Stage/live aliases remain unchanged.
- Issue #274 contains the deployed commit and verification summary.

## Error And Rescue Registry

| Error | User sees | System behavior | Rescue |
| --- | --- | --- | --- |
| Invalid Sheet link | "Google Sheet 링크를 확인해 주세요." | Stop before network call if possible | User edits link |
| Sheet not shared with system account | "MYSC 시스템 계정에 시트 읽기 권한이 없습니다." | No retry loop beyond request retry policy | User shares sheet with system account |
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
| Service account reads unintended Sheet | System account can read any Sheet shared with it | Treat system-account sharing as explicit allowlist and log every preview |
| Arbitrary project ID disclosure | Workspace user can preview another project's cashflow | PM portal project context and Java project authorization guard the project side |

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
| 7 | Eng | Use MYSC service-account Sheet access | Taste | Pragmatic | Internal SaaS users avoid per-user Sheets consent, and Sheet sharing becomes an operational allowlist | User-scoped Sheets OAuth |
| 8 | Eng | Allow PM portal workspace roles in Phase 1 | Mechanical | User outcome | This feature lives in PM portal and must work for `workspace_user`, `pm`, `finance`, and `admin` | Admin/finance-only lab |
| 9 | Eng | Extract shared Java weekly client before lab composition | Mechanical | DRY | Existing Java proxy helpers are private; duplication would create auth drift | Copying proxy logic |

## Review Scores

| Review | Score | Notes |
| --- | --- | --- |
| CEO | 8/10 | The plan solves the right first problem: safe preview before automation. It intentionally rejects writeback. |
| Design | 7/10 | UI scope is clear. Needs exact page placement and visual hierarchy in Phase 4 before implementation. |
| Eng | 8/10 | Existing code leverage is strong. Main risks are service-account sharing discipline, project disclosure, and private Java proxy reuse. |
| DX | 7/10 | Developer path is understandable. Needs typed contracts and error fixtures early to avoid guesswork. |

## Open Questions Before Coding

1. Template sample: which real Google Sheet tab should become the golden fixture?
2. Java validation boundary: keep deterministic layout validation in BFF first, or add Java validation endpoint immediately when semantics exceed layout?
3. Project disclosure rule: should PM portal preview be limited to the currently selected project only, or any project visible in the portal selector?

Recommendation:

- Start Phase 1 in the PM portal cashflow area.
- Use MYSC service-account Sheet read. No per-user Sheets OAuth.
- Allow `workspace_user`, `pm`, `finance`, and `admin`.
- Start Phase 1 without Java changes, except extracting shared Java weekly client helpers from the BFF proxy path.
- In Phase 2, if validator needs canonical cashflow semantics beyond labels and coordinates, move that logic to Java before shipping Phase 2.

## First Implementation Order

1. Extract shared Java weekly client helper from `server/bff/routes/jvm-weekly-api.mjs`.
2. Create lab API contract and client types.
3. Add BFF route with fake-service tests, service-account Sheets read, and PM portal workspace-role gate.
4. Add link helper and unit tests.
5. Add page shell under PM portal cashflow area.
6. Add Phase 1 UI states with source labeling.
7. Run targeted tests and guard dry-run.
8. Comment progress on issue #274.

## Outside Review Findings Applied

An adversarial read-only `codex exec` review flagged nine issues. We accepted the authority-boundary findings, then intentionally changed the Sheet authorization policy for internal SaaS convenience:

- Service-account Sheet access is the explicit policy, not a fallback.
- Sheets must be shared with the MYSC system account.
- PM portal users with `workspace_user`, `pm`, `finance`, or `admin` can use the lab.
- Sheet text is layout evidence only.
- Java values carry authoritative source labels.
- Java proxy helpers must be extracted before route composition.
- Template validation is constrained to layout facts unless moved to Java.
- Static scans explicitly fence legacy BFF cashflow mutation/export paths.
- Lab deploy requires smoke checks and stage/live alias inspection.
