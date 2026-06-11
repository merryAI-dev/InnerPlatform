# Stage Baseline Context

Branch: `weekly-java-deployed-live-baseline`

Alias: `https://inner-platform-stage-merryai-devs-projects.vercel.app`

Purpose: stable stage QA for Java-owned weekly expense ledger, cashflow actual read model, projection read/write policy, and audit export flow.

## Authority Rules

- Weekly expense ledger save is the source event.
- Java validates row/cell data and recalculates actual.
- Cashflow actual is read from the Java read model.
- Frontend must not write cashflow actual.
- Spreadsheet integration code does not belong in this context unless it is read-only comparison UI already approved for stage.

## Allowed Deployment

Only run:

```bash
scripts/deploy_stage_vercel.sh
```

The script refuses to deploy when the working tree is dirty or local `HEAD` does not match `origin/weekly-java-deployed-live-baseline`.

Do not manually alias spreadsheet experiment previews to the stage URL.
