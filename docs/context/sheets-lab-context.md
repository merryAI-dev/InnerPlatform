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

## Bounded Module

Keep experiment code inside:

```text
src/app/integrations/google-sheets/
src/app/features/cashflow-sheet-compare/
src/app/lib/sheets-cashflow-readonly-client.ts
```

If a change needs to edit core cashflow store, settlement ledger, or Java authority code, stop and move it into a separate core-change plan.

## Allowed Deployment

Only run:

```bash
scripts/deploy_sheets_lab_vercel.sh
```

The script refuses to deploy when the working tree is dirty or local `HEAD` does not match `origin/experiment/sheets-cashflow-projection-readonly`.
