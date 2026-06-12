# Sheets Lab Context

Branch: `experiment/sheets-cashflow-projection-readonly`

Alias: `https://inner-platform-sheets-lab-merryai-devs-projects.vercel.app`

Tracking issue: https://github.com/merryAI-dev/InnerPlatform/issues/274

Purpose: isolated spreadsheet integration lab for read-only verification of Google Sheet cashflow layouts against the Java cashflow projection and actual read model.

## Branch Goal

This branch proves a narrow internal SaaS workflow:

1. A workspace user pastes a Google Sheet link.
2. The app reads the sheet layout without mutating the original sheet.
3. The backend validates whether the layout matches the supported cashflow template.
4. Java provides the authoritative cashflow Actual and Projection values from the internal read model.
5. The frontend renders a read-only preview of how those values map onto the sheet layout.

The Google Sheet is a familiar viewing format, not a ledger and not a source of truth.

## Scope

Allowed:

- Google Sheet read-only adapter.
- Spreadsheet ID extraction from a Google Sheet link.
- Cashflow template preview and validation.
- Cell coordinate mapping display.
- Projection and actual comparison views.
- Data drift diagnostics between spreadsheet output and Java read model.
- User-facing errors for missing sheet access, unsupported templates, and empty read-model data.

Forbidden:

- Weekly expense ledger mutation.
- Cashflow actual mutation.
- Java read-model mutation.
- Google Sheet writeback.
- Bidirectional sync.
- Automatic template repair.
- Stage/live alias updates.
- New frontend calculation authority for actuals.
- BFF cashflow calculation authority.

## First Delivery Checklist

- Link input accepts a Google Sheet URL and extracts the spreadsheet ID.
- BFF reads Google Sheet metadata and values as a thin adapter.
- Java receives sheet layout data or normalized template evidence for validation.
- Java cashflow snapshot remains the only source for Actual and Projection amounts.
- UI shows the template status, mapped cells, and read-only preview values.
- Unsupported layouts stop with a clear explanation instead of auto-correction.
- No write occurs to Google Sheet, weekly ledger rows, cashflow actuals, or projection data.

## Phase Plan

Phase 0 - Boundary lock:

- Status: complete when this document, the GitHub issue, branch tracking, and guarded deploy script all agree on the same scope.
- Output: issue #274, bounded-module notes, and dry-run deployment guard verification.
- No product code is required in this phase.

Phase 1 - Sheet structure mapping:

- Link input, spreadsheet ID extraction, and BFF read-only Google Sheet access.
- Detect the two cashflow sections. The upper section is Projection and the lower section is Actual.
- Within each section, detect weekly labels such as `26-1-1`, cashflow line rows, derived rows, and ignored rows.
- Return layout mapping candidates with row/column/A1 coordinates. Do not treat Sheet numbers as cashflow values.

Phase 2 - Template contract hardening:

- Turn Phase 1 mapping candidates into stricter supported-template validation and unsupported-layout reasons.

Phase 3 - Java read model connection:

- Actual and Projection values come only from Java cashflow snapshot data.

Phase 4 - Read-only preview:

- Render mapped values on a sheet-like preview without writeback.

Phase 5 - Safety verification:

- Tests and scans proving no sheet write, no ledger mutation, and no BFF/frontend cashflow calculation authority.

Phase 6 - Sheets Lab deploy:

- Deploy only through the guarded sheets-lab Vercel alias script.

## Bounded Module

Keep experiment code inside:

```text
src/app/integrations/google-sheets/
src/app/features/cashflow-sheet-compare/
src/app/lib/sheets-cashflow-readonly-client.ts
```

If a change needs to edit core cashflow store, settlement ledger, or Java authority code, stop and move it into a separate core-change plan.

Phase 1 implementation should start by creating the client file listed above. Do not add spreadsheet-lab entrypoints under existing settlement ledger or cashflow authority modules.

## Allowed Deployment

Only run:

```bash
scripts/deploy_sheets_lab_vercel.sh
```

The script refuses to deploy when the working tree is dirty or local `HEAD` does not match `origin/experiment/sheets-cashflow-projection-readonly`.
