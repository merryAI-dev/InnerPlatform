# Cashflow Sheets Lab Data Flow Census

Date: 2026-06-12

Branch: `experiment/sheets-cashflow-projection-readonly`

Status: investigation census, not a remediation plan.

Implementation follow-up in this branch:

- `cashflow-sheet-lab/apply` now blocks when BFF Firestore project and Java Firestore project are not explicitly aligned.
- Java weekly API now checks project document existence for project-scoped commands when the Firestore storage backend is active, while keeping `workspace_user` role relaxation.
- Legacy BFF cashflow mutation endpoints now return `410 legacy_bff_cashflow_write_disabled` by default.
- This document still preserves the original observed census so the root cause remains auditable.

## Purpose

This document maps the cashflow, weekly expense, bank statement, and Sheets Lab paths that can read or write cashflow Actual/Projection data.

The current risk is not one isolated parser bug. The risk is that the UI, BFF, Java API, and Firestore projects can disagree about which database is authoritative for the same `projectId`.

## Confirmed Environment Inventory

### Sheets Lab Vercel Preview

Alias:

```text
https://inner-platform-sheets-lab-merryai-devs-projects.vercel.app
```

Observed Vercel Preview env:

| Key | Observed value | Meaning |
| --- | --- | --- |
| `VITE_FIREBASE_PROJECT_ID` | `mysc-bmp-14173451` | Browser Firebase and same-origin BFF fallback project. |
| `FIREBASE_PROJECT_ID` | empty | BFF falls through to `VITE_FIREBASE_PROJECT_ID`. |
| `VITE_PLATFORM_API_ENABLED` | `true` | Frontend platform API calls are enabled. |
| `VITE_PLATFORM_API_BASE_URL` | `https://innerplatform-jvm-weekly-api-c3pm5gv7ia-du.a.run.app` | Direct Java API base URL for many platform calls. |
| `JVM_WEEKLY_API_BASE_URL` | `https://innerplatform-jvm-weekly-api-c3pm5gv7ia-du.a.run.app` | BFF Java client target. |
| `JVM_WEEKLY_AUTH_MODE` | `internal_saas_workspace` | `@mysc.co.kr` workspace user mapping. |
| `JVM_WEEKLY_WORKSPACE_EMAIL_DOMAIN` | `mysc.co.kr` | Workspace domain. |

### Java Weekly API Cloud Run

Service:

```text
innerplatform-jvm-weekly-api
https://innerplatform-jvm-weekly-api-c3pm5gv7ia-du.a.run.app
```

Observed Cloud Run env:

| Key | Observed value | Meaning |
| --- | --- | --- |
| `JVM_WEEKLY_STORAGE_BACKEND` | `firestore` | Java writes to Firestore. |
| `JVM_WEEKLY_PROJECT_ACCESS_BACKEND` | `disabled` | Project membership/existence access backend is disabled. |
| `JVM_WEEKLY_AUTH_MODE` | `internal_saas_workspace` | Workspace user policy. |
| `JVM_WEEKLY_FIRESTORE_PROJECT_ID` | `inner-platform-qa-20260310` | Java read/write Firestore project. |
| `JVM_WEEKLY_FIREBASE_PROJECT_ID` | `inner-platform-qa-20260310` | Legacy Firebase project value. |
| `JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID` | `mysc-bmp-14173451` | Firebase Auth project. |
| `JVM_WEEKLY_ALLOWED_ORIGINS` | stage, prod, sheets-lab aliases | CORS allowlist includes sheets-lab. |

## Confirmed Data Inventory

### `mysc-bmp-14173451`

| Item | Count / value |
| --- | ---: |
| Project documents | 40 |
| `cashflow_weeks` documents | 403 |
| Cashflow project ids | 25 |
| Orphan cashflow project ids | 0 |
| Projects with `cashflowSheetLab` config | `p1773817948751` |
| Sheet Lab source actual values | 0 keys |

AXR project in this DB:

| Field | Value |
| --- | --- |
| Project id | `p1773817948751` |
| Project name | `AXR프로젝트경비경` |
| Sheet title | `[2026년 탐나는인재 창업트랙]사업비 관리 시트` |
| Sheet tab | `cashflow(사용내역 연동)` |
| Spreadsheet id | `1dJLpTrDDJFzV-IDtENACyxGWahkL-lBWdjCc2Hze8Uk` |
| Week range | `26-1-1` to `26-11-2` |

### `inner-platform-qa-20260310`

| Item | Count / value |
| --- | ---: |
| Project documents | 28 |
| `cashflow_weeks` documents | 210 |
| Cashflow project ids | 3 |
| Orphan cashflow project ids | `p1773817948751`, `p1773994485543` |
| Projects with `cashflowSheetLab` config | none |
| Sheet Lab source actual values | 624 keys, 624 zero, 0 non-zero |

Recent Java audit rows in this DB:

| Command | Project | Count / detail |
| --- | --- | --- |
| `weeklyExpense.cashflowSheetLab.apply` | `p1773817948751` | 2 rows, actor `workspace_user`, Projection 624, Actual 624 |
| `weeklyExpense.bankStatement.importBatch` | `p1773994485543` | 2 recent rows |
| `weeklyExpense.bankStatement.applyItems` | `p1773994485543` | 2 recent rows |

## Census Table

| 화면/기능 | 호출 client | endpoint | 저장 DB | project existence check | actual/projection write 방식 | audit 위치 |
| --- | --- | --- | --- | --- | --- | --- |
| Portal project selection / Firebase project data | Browser Firebase SDK | Firestore reads under `orgs/{tenantId}/projects` | `mysc-bmp-14173451` in sheets-lab preview | Firestore doc existence by client query | No cashflow write | None |
| Cashflow Sheets Lab config load | Same-origin BFF client, `createSameOriginBffClient()` | `GET /api/v1/projects/:projectId/cashflow-sheet-lab/config` | BFF Firestore, currently `mysc-bmp-14173451` | Yes, BFF reads `orgs/{tenantId}/projects/{projectId}` | No cashflow write | None |
| Cashflow Sheets Lab config save | Same-origin BFF client | `PUT /api/v1/projects/:projectId/cashflow-sheet-lab/config` | BFF Firestore, currently `mysc-bmp-14173451` | Yes, BFF reads project doc first | Writes only `projects/{projectId}.cashflowSheetLab` | None |
| Cashflow Sheets Lab preview, layout only | Same-origin BFF client | `POST /api/v1/projects/:projectId/cashflow-sheet-lab/preview` with `includeValues=false` | Reads BFF Firestore config from `mysc-bmp-14173451`; reads Google Sheets | Yes, BFF reads project doc first | No cashflow write | None |
| Cashflow Sheets Lab preview, Java values | Same-origin BFF client, then BFF Java client | `POST /api/v1/projects/:projectId/cashflow-sheet-lab/preview` with `includeValues=true`; Java `GET /api/v1/cashflow/{projectId}` | Config from `mysc-bmp-14173451`; Java read model from `inner-platform-qa-20260310` | BFF project exists in `mysc-bmp`; Java project existence is not verified when access backend is disabled | No write, but preview compares sheet layout against Java QA read model | None |
| Cashflow Sheets Lab apply | Same-origin BFF client, then BFF Java client | BFF `POST /api/v1/projects/:projectId/cashflow-sheet-lab/apply`; Java `POST /api/v1/cashflow/{projectId}/sheet-lab/apply` | Config from `mysc-bmp-14173451`; Java writes to `inner-platform-qa-20260310` | BFF project exists in `mysc-bmp`; Java project existence is not verified when access backend is disabled | Projection: Java `saveProjection` upserts `cashflow_weeks.projection`; Actual: Java `replaceActualLines` rewrites source `cashflow-sheet-lab` actuals | Java `orgs/{tenantId}/weekly_api_audit_events` in `inner-platform-qa-20260310` |
| Cashflow page Java snapshot hydration | Frontend platform client via `createPlatformApiClient()` | `GET /api/v1/cashflow/{projectId}` | Java reads `inner-platform-qa-20260310` | Java project existence is not verified when access backend is disabled | No remote write; frontend hydrates local cashflow store from Java read model | None |
| Cashflow page projection edit | Frontend platform client via `createPlatformApiClient()` | `POST /api/v1/cashflow/{projectId}/projection` | Java writes `inner-platform-qa-20260310` | Java project existence is not verified when access backend is disabled | Projection upsert into `cashflow_weeks.projection`; Actual blocked in frontend store | Java `weekly_api_audit_events` in `inner-platform-qa-20260310` |
| Weekly expense sheet list/detail | Frontend platform client | `GET /api/v1/weekly-expenses/{projectId}/sheets`, `GET /sheets/{sheetKey}` | Java reads `inner-platform-qa-20260310` | Java project existence is not verified when access backend is disabled | No write | None |
| Weekly expense draft save | Frontend platform client | `POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetKey}/save-draft` | Java writes `inner-platform-qa-20260310` | Java project existence is not verified when access backend is disabled | Writes `projects/{projectId}/expense_sheets/{sheetKey}` and recomputes actuals by sheet source | Java `weekly_api_audit_events` in `inner-platform-qa-20260310` |
| Weekly expense cell/copy/paste/cut/row commands | Frontend platform client | `POST /api/v1/weekly-expenses/{projectId}/sheets/{sheetKey}/commands/*` | Java writes `inner-platform-qa-20260310` | Java project existence is not verified when access backend is disabled | Mutates Java weekly sheet data; actual impact depends on command and derived deltas | Java `weekly_api_audit_events` in `inner-platform-qa-20260310` |
| Bank statement import batch | Frontend platform client | `POST /api/v1/weekly-expenses/{projectId}/bank-statements/import-batch` | Java writes `inner-platform-qa-20260310` | Java project existence is not verified when access backend is disabled | Stages bank import lines; no direct projection write | Java `weekly_api_audit_events` in `inner-platform-qa-20260310` |
| Bank statement apply items | Frontend platform client | `POST /api/v1/weekly-expenses/{projectId}/bank-statements/apply-items` | Java writes `inner-platform-qa-20260310` | Java project existence is not verified when access backend is disabled | Appends/applies selected bank lines into weekly expense sheet and derived actuals | Java `weekly_api_audit_events` in `inner-platform-qa-20260310` |
| Weekly submit | Frontend platform client | `POST /api/v1/weekly-expenses/{projectId}/submit` | Java writes `inner-platform-qa-20260310` | Java project existence is not verified when access backend is disabled | Weekly status mutation, no direct projection write | Java `weekly_api_audit_events` in `inner-platform-qa-20260310` |
| Weekly close | Frontend platform client | `POST /api/v1/weekly-expenses/{projectId}/close` | Java writes `inner-platform-qa-20260310` | Java project existence is not verified when access backend is disabled | Weekly status close mutation, no direct projection write | Java `weekly_api_audit_events` in `inner-platform-qa-20260310` |
| Weekly audit export | Frontend platform client | `POST /api/v1/weekly-expenses/{projectId}/audit-export` | Java writes export metadata to `inner-platform-qa-20260310` | Java project existence is not verified when access backend is disabled | No actual/projection mutation expected; exports Java view of current data | Java `weekly_api_audit_events` or export collection in `inner-platform-qa-20260310` |
| Legacy BFF cashflow week upsert | Same-origin BFF route, if called | `POST /api/v1/projects/:projectId/cashflow-weeks/upsert` | BFF Firestore, currently `mysc-bmp-14173451` on sheets-lab preview | Yes, BFF checks project doc exists | Writes `cashflow_weeks` for `mode=projection` or `mode=actual` through BFF canonical store | No Java audit; BFF idempotency only |
| Legacy BFF actual sync | Same-origin BFF route, if called | `POST /api/v1/projects/:projectId/cashflow-actuals/sync` | BFF Firestore, currently `mysc-bmp-14173451` on sheets-lab preview | Yes, BFF checks project doc exists | Recomputes `cashflow_weeks.actual` from BFF expense sheets | No Java audit; BFF sync state |
| Cashflow workbook export | Frontend export helper | `POST /api/v1/cashflow-exports` | Intended BFF Firestore read path; exact runtime base URL needs separate verification because platform API base points to Java | BFF checks project doc for single export path | Export only, no cashflow write expected | None |

## Relationship Map

```text
Browser Firebase
  VITE_FIREBASE_PROJECT_ID=mysc-bmp-14173451
  |
  | reads project list and AXR project document
  v
AXR project p1773817948751 exists in mysc-bmp
  |
  | same-origin BFF config save/load
  v
BFF project config path also resolves to mysc-bmp
  |
  | BFF Java client / direct frontend Java client
  v
Java Weekly API
  JVM_WEEKLY_FIRESTORE_PROJECT_ID=inner-platform-qa-20260310
  |
  | writes/reads cashflow_weeks and weekly_api_audit_events
  v
QA Firestore has orphan cashflow rows for p1773817948751 and p1773994485543
```

## Confirmed Problem Nodes

### P1 - Split database authority

The same `projectId` can be selected from `mysc-bmp-14173451` while Java reads/writes `inner-platform-qa-20260310`.

User impact: a user can see a real project, press apply, receive "success", and still not update the same project data the UI originally loaded.

### P1 - Java orphan write

Java can write `cashflow_weeks` for a `projectId` that has no matching `projects/{projectId}` document in its Firestore storage project.

Observed orphan ids in `inner-platform-qa-20260310`:

- `p1773817948751`
- `p1773994485543`

### P1 - Actual source replacement can preserve bad payloads

`cashflow-sheet-lab` apply sends parsed Sheet values to Java. Java stores the received amounts. If BFF sends 624 zero Actual values, Java stores 624 zero Actual values under source `cashflow-sheet-lab`.

This is correct behavior for Java if the API contract says "apply these values." The weakness is that the boundary accepts a full Actual replacement without proving that the payload is from the same authority/database context as the project.

### P2 - Legacy BFF cashflow write endpoints remain

These endpoints still exist:

- `POST /api/v1/projects/:projectId/cashflow-weeks/upsert`
- `POST /api/v1/projects/:projectId/cashflow-actuals/sync`

They conflict with the current direction: Actual and Projection should flow through Java read model authority, not legacy BFF cashflow mutation.

### P2 - Mixed client policy

Two client patterns coexist:

- Same-origin BFF client for Sheets Lab.
- `VITE_PLATFORM_API_BASE_URL` client for Java direct calls.

This is not wrong by itself, but it is unsafe without an explicit environment contract proving both clients target the same data authority.

## What Is Not Fully Censused Yet

This document is not a full production security audit. The following still need proof before the census is complete:

1. Every Java command endpoint should be checked for project document existence behavior under `JVM_WEEKLY_PROJECT_ACCESS_BACKEND=disabled`.
2. Vercel Production env must be pulled and compared against Preview.
3. Stage alias env must be compared against sheets-lab alias env.
4. All frontend callers of `createPlatformApiClient()` should be classified as direct Java, BFF, or ambiguous.
5. The export path `POST /api/v1/cashflow-exports` needs runtime verification because the generic platform base URL points to Java in Preview.
6. `inner-platform-live-20260316` should be included in the same orphan/read-model census if any live alias can reach the same Java API.
7. Firestore rules are not part of this table. The observed Java/BFF server writes bypass client Firestore rules through service credentials.

## Completion Bar For True Census

Call this census complete only when all rows below are filled with evidence:

| Required check | Status |
| --- | --- |
| Vercel Preview env captured | done |
| Java Cloud Run env captured | done |
| `mysc-bmp-14173451` project/cashflow counts captured | done |
| `inner-platform-qa-20260310` project/cashflow counts captured | done |
| Orphan project ids in QA identified | done |
| All Java weekly command endpoints classified | partial |
| All BFF cashflow mutation endpoints classified | partial |
| All frontend platform API callers classified | partial |
| Vercel Production env compared | not done |
| Stage alias env compared | not done |
| Live Firestore read-model census compared | partial |
| Export path runtime target verified | not done |

## Immediate Design Rule Implied By Census

Before adding more Sheet Lab features, the environment contract must become explicit:

```text
For any deployed alias:
  Browser Firebase project
  Same-origin BFF Firestore project
  Java Weekly Firestore project
must either be the same data environment,
or the UI must clearly declare that it is a cross-environment lab and block write/apply.
```

For normal user-facing apply flows, cross-environment apply should be blocked.
