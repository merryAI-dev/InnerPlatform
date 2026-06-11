# Sheets Lab Context

Branch: `experiment/sheets-cashflow-projection-readonly`

Alias: `https://inner-platform-sheets-lab-merryai-devs-projects.vercel.app`

Purpose: isolated spreadsheet integration lab for comparing spreadsheet outputs with cashflow projection and actual read models.

## Scope

Allowed:

- Google Sheet read-only adapter.
- Projection and actual comparison views.
- Export and audit-facing preview helpers.
- Data drift diagnostics between spreadsheet output and Java read model.

Forbidden:

- Weekly expense ledger mutation.
- Cashflow actual mutation.
- Java read-model mutation.
- Stage/live alias updates.
- New frontend calculation authority for actuals.

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
