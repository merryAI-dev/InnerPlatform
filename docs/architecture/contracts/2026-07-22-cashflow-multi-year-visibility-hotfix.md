# Cashflow multi-year visibility hotfix

## Problem

The cashflow year read model returned only the registered contract years whenever
registration dates existed. Imported annual totals outside that stale or
single-year registration range were therefore stored but hidden from the
navigation and ledger.

## Contract

- Registered project years remain part of the cashflow view.
- Years present in the pinned sheet mirror, applied annual ledger, applied
  weekly ledger, or imported annual totals are unioned with registered years.
- A genuinely single-year project with no imported adjacent-year data remains
  single-year; the server does not invent prior or future years.
- The existing frontend places earlier annual totals before the selected year's
  weekly columns and later annual totals after week 12-5.
- Imported annual totals remain annual values and are never spread into fake
  weekly cells.

## Success criteria

1. A 2026-only registration with imported 2024-2028 sheet totals returns
   `availableYears=[2024,2025,2026,2027,2028]` and navigation
   `[2025,2026,2027]` for selected year 2026.
2. The year read model returns all five stored annual rows.
3. Existing BFF sheet-lab and frontend year-view tests pass.
4. Production build passes.
5. An independent read-only auditor scores the phase 100/100 before Stage.

## Out of scope

- Mutating project registration dates
- Inventing years absent from registration and imported data
- Changing cashflow amounts or sheet overwrite semantics
- Live deployment

## Evaluation

- Red test: a 2026-only registration with stored 2024-2028 annual values
  returned only `[2026]` before the fix.
- BFF cashflow sheet-lab: 56/56 tests passed, including the multi-year union
  and the single-year no-invention regression cases.
- Frontend cashflow shell and read-only year client: 38/38 tests passed.
- Full repository regression: 310 test files and 2,304 tests passed; 10 files
  and 222 emulator-dependent tests remained skipped by their existing setup.
- Production build: passed with 2,910 modules transformed.
- Policy verification and `git diff --check`: passed.
- The full suite was run with one worker and up to two retries because two
  pre-existing Supertest socket/auth cases were non-deterministic under the
  initial runs. No product assertion remained failing in the final run.
- Independent Stage gate audit: 100/100. Live deployment remains excluded.
