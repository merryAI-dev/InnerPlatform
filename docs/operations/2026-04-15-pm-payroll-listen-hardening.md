# 2026-04-15 PM Portal Payroll Listen Hardening

## Problem
Production PM portal still emits repeated Firestore Listen 400 errors after the cashflow listener hotfix. The remaining high-probability PM-global compound listeners are in `PayrollProvider`.

## Hypothesis
For PM users, these two live queries are still too production-sensitive:
- `payroll_runs` by `projectId` ordered by `plannedPayDate desc`
- `monthly_closes` by `projectId` ordered by `yearMonth desc`

## Change
- Keep admin/readAll behavior unchanged.
- For PM path, remove `orderBy` from Firestore live queries.
- Listen by `projectId` only, then sort client-side.
- Add helper coverage so this policy is explicit and regression-tested.

## Verification
- Unit tests for PM-side sorting helpers.
- Targeted provider tests if available.
- `npm run build`.
- Production deploy follow-up check for Listen 400 recurrence.
