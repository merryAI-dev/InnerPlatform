# Vercel Alias And Branch Boundary Policy

Date: 2026-06-11

This repository serves an ERP workflow where weekly expense ledger data, cashflow actuals, projections, and audit exports must not drift across branches. The deployment rule is simple: aliases are product contracts, not convenience links.

## Alias Ownership

| Alias | Purpose | Allowed branch | Script |
| --- | --- | --- | --- |
| `inner-platform.vercel.app` | Live production | production branch only | manual production release only |
| `inner-platform-stage-merryai-devs-projects.vercel.app` | Stage QA baseline | `weekly-java-deployed-live-baseline` | `scripts/deploy_stage_vercel.sh` |
| `inner-platform-sheets-lab-merryai-devs-projects.vercel.app` | Spreadsheet experiment lab | `experiment/sheets-cashflow-projection-readonly` | `scripts/deploy_sheets_lab_vercel.sh` |

## Non-Negotiable Rules

1. Spreadsheet experiments must never alias over stage or live.
2. Stage must represent the Java weekly ledger and cashflow read-model baseline.
3. Spreadsheet integration may read, compare, and export cashflow/projection data.
4. Spreadsheet integration must not mutate weekly ledger rows, cashflow actuals, or Java read models.
5. If an experiment needs to touch core ledger/cashflow authority, it is no longer a spreadsheet experiment and must move to a separate core-change branch.

## Deployment Guard

Use the guarded scripts instead of raw `vercel alias set`.

```bash
scripts/deploy_stage_vercel.sh
scripts/deploy_sheets_lab_vercel.sh
```

The scripts check the current Git branch before assigning an alias. This prevents a preview deployment from accidentally replacing the fixed stage QA URL.

Before Vercel deploy starts, the scripts also require:

- clean working tree, including untracked files
- local `HEAD` equals `origin/<allowed-branch>`
- fixed alias post-check through `vercel inspect`

Use `DRY_RUN=1` to verify these guards without deploying:

```bash
DRY_RUN=1 scripts/deploy_stage_vercel.sh
DRY_RUN=1 scripts/deploy_sheets_lab_vercel.sh
```

## Required PR Checks For Spreadsheet Work

- No frontend actual calculation.
- No frontend cashflow actual write.
- No weekly expense ledger write from spreadsheet code.
- No import from spreadsheet modules into Java read-model authority code.
- Spreadsheet values are displayed as comparison data only.

## Context Split

Use a separate Git worktree for spreadsheet work:

```bash
git worktree add ../InnerPlatform-sheets-lab -b experiment/sheets-cashflow-projection-readonly weekly-java-deployed-live-baseline
```

Work in `/Users/boram/InnerPlatform` for the stage baseline and `/Users/boram/InnerPlatform-sheets-lab` for spreadsheet experiments. Do not switch these branches in the same working directory during active QA.
