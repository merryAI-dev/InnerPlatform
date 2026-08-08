# Cashflow Formula Validation Contract

**Date:** 2026-07-28  
**Status:** Approved - weekly formulas, prior-year carry-forward, and explicit mismatch confirmation implemented
**Scope:** `cashflow(사용내역 연동)` fixed-format sheet, BFF transport, Spring JVM validation, sheet apply, month close  
**Out of scope:** variable `사용내역` sheet formulas and generic Excel formula execution

## 1. Purpose

The Google Sheet remains the operational input surface, but a broken formula or a manually overwritten derived cell must not silently become MYSCube accounting truth.

The Spring JVM therefore independently recalculates the fixed cashflow arithmetic and compares its results with the values displayed by the sheet. The system does not rewrite the source sheet and does not attempt to implement Excel itself.

The governing principle is:

> Sheet values are imported evidence. JVM calculations are independent validation evidence.

## 2. Reference workbook and fixed layout

Reference workbook:

`원본은 건들지 마시오 - 260701_ 사업비 관리 시트 (6).xlsx`

Reference tab:

`cashflow(사용내역 연동)`

Fixed read range:

`A1:BT60`

The financial periods are processed in the same left-to-right order as the sheet:

```text
2024 annual -> 2025 annual -> 2026 week 1..60 -> 2027 annual -> ... -> 2032 annual
```

The canonical blocks are:

| Mode | Inflow rows | Inflow total | Outflow rows | Outflow total | Balance |
| --- | --- | --- | --- | --- | --- |
| Projection | 15:21 | 22 | 23:31 | 32 | 33 |
| Actual | 38:44 | 45 | 46:54 | 55 | 56 |

There are 16 canonical accounting rows per mode: seven inflow rows and nine outflow rows. Derived total and balance rows are not source transactions.

## 3. Cell-state contract

Every imported accounting cell retains both its numeric meaning and its authoring state.

| Sheet content | JVM state | Arithmetic value | Meaning |
| --- | --- | ---: | --- |
| Empty | `EMPTY` | 0 | Not entered |
| `-` in Projection | `EMPTY` | 0 | Not entered |
| `-` in Actual | `ZERO` | 0 | Accounting number format renders 0 as `-`; confirmed zero (2026-08-08 결정) |
| Explicit `0` | `ZERO` | 0 | Entered and confirmed as zero |
| Whole-won positive or negative number | `VALUE` | Original amount | Entered amount |
| Decimal, malformed text, non-finite value | `INVALID` | None | Invalid source value |
| `#REF!`, `#VALUE!`, `#N/A`, `#DIV/0!` | `ERROR` | None | Spreadsheet calculation error |

`EMPTY` and `ZERO` must never be collapsed in persisted evidence, hashes, or month-close snapshots. Negative amounts are allowed because corrections and reversals can be legitimate. Currency calculations use exact whole-won arithmetic with zero tolerance.

## 4. JVM calculation formulas

Let `P` be a period in sheet order and `M` be `PROJECTION` or `ACTUAL`.

### 4.1 Inflow total

```text
inflowTotal[M,P]
  = prepayDirectCostIn[M,P]
  + prepayLaborIn[M,P]
  + prepayPurchaseVatIn[M,P]
  + salesIn[M,P]
  + salesVatIn[M,P]
  + teamSupportIn[M,P]
  + bankInterestIn[M,P]
```

Excel equivalents:

```excel
C22 = SUM(C15:C21)
C45 = SUM(C38:C44)
```

The formula is repeated for every period through `BR` and for the `BS` total column.

### 4.2 Outflow total

```text
outflowTotal[M,P]
  = prepayDirectCostOut[M,P]
  + prepayLaborOut[M,P]
  + directCostOut[M,P]
  + purchaseVatOut[M,P]
  + laborOut[M,P]
  + profitOut[M,P]
  + salesVatOut[M,P]
  + teamSupportOut[M,P]
  + bankInterestOut[M,P]
```

Excel equivalents:

```excel
C32 = SUM(C23:C31)
C55 = SUM(C46:C54)
```

### 4.3 Running balance and prior-year carry-forward

The first weekly period starts from the JVM sum of every prior-year canonical
source row. The reported annual balance cell is comparison evidence only and is
not used as an input. When the sheet has no earlier annual source rows, the
opening balance is zero:

```text
importedOpeningBalance[M]
  = SUM(prior-year inflow source rows[M])
  - SUM(prior-year outflow source rows[M])
```

```text
calculatedBalance[M,first]
  = importedOpeningBalance[M]
  + inflowTotal[M,first]
  - outflowTotal[M,first]
```

Every following period uses the JVM-calculated prior balance:

```text
calculatedBalance[M,P]
  = calculatedBalance[M,previous(P)]
  + inflowTotal[M,P]
  - outflowTotal[M,P]
```

Excel equivalents:

```excel
C33 = C22 - C32
D33 = C33 + D22 - D32
E33 = D33 + E22 - E32
BM33 = BL33 + BM22 - BM32
BN33 = BM33 + BN22 - BN32
BR33 = BQ33 + BR22 - BR32

C56 = C45 - C55
D56 = C56 + D45 - D55
E56 = D56 + E45 - E55
BM56 = BL56 + BM45 - BM55
BN56 = BM56 + BN45 - BN55
BR56 = BQ56 + BR45 - BR55
```

The JVM must not use a reported sheet balance as the next period's input. It uses its own calculated prior balance. This identifies the first broken period instead of propagating a broken displayed balance as trusted input.

Consequently, a 2025 ending balance of `2,000,000` won becomes the 2026 week-1 opening balance before the first 2026 movement is applied.

The BFF reuses annual cells already present in the pinned mirror. It performs no
additional Google Sheets or database read and does not calculate the opening
balance itself.

### 4.4 Projection minus Actual

```text
difference[P]
  = calculatedBalance[PROJECTION,P]
  - calculatedBalance[ACTUAL,P]
```

Excel equivalent:

```excel
C11 = C33 - C56
```

The formula repeats through the final period.

### 4.5 Row totals and grand totals

For every canonical line `L`:

```text
rowTotal[M,L] = SUM(amount[M,L,P] for every period P)
```

Excel equivalents:

```excel
BS15 = SUM(C15:BR15)
BS38 = SUM(C38:BR38)
```

Mode totals are calculated from the canonical line totals:

```text
grandIn[M]  = SUM(rowTotal[M,L] where direction(L) = IN)
grandOut[M] = SUM(rowTotal[M,L] where direction(L) = OUT)
grandNet[M] = grandIn[M] - grandOut[M]
```

Excel equivalents:

```excel
BS33 = BS22 - BS32
BS56 = BS45 - BS55
```

`BS` is a grand total, not the next running-balance period. It is therefore
validated independently and never receives `BR33` or `BR56` as an opening balance.

### 4.6 Deposit schedule total

Only the expected-deposit amount row is summed:

```text
expectedDepositTotal = SUM(expectedDepositAmount[P] for every period P)
```

Excel equivalent:

```excel
BS9 = SUM(C9:BR9)
```

Tax-invoice and deposit-date rows are validated as dates. Their spreadsheet total cells are not treated as financial formulas.

## 5. Explicit exclusions

### 5.1 Variable usage-ledger formulas

Actual source cells contain variable formulas such as:

```excel
SUMIFS('사용내역(...)'!$M:$M, ...)
```

The JVM does not reproduce these formulas and does not inspect the variable usage-ledger row structure. The effective Actual values produced by Google Sheets are treated as source cells. JVM validation begins at the fixed cashflow block and validates its downstream totals, balances, differences, and totals.

### 5.2 Generic formula engine

The implementation will not parse or execute arbitrary Excel formulas. Formula syntax, locale, shared formulas, volatile formulas, and external references are outside the contract.

### 5.3 Formula-presence enforcement

The reference workbook itself contains derived cells that have been replaced with fixed values in some periods. Therefore the first version will validate accounting results, not require a specific formula string in every derived cell.

The following are checked:

- displayed derived value equals JVM result;
- spreadsheet error values are rejected;
- formula text itself is not required when the result remains correct.

### 5.4 External budget reference

`BT9 = '예산총괄시트'!F27 - BS9` is not part of the cashflow formula engine. Project contract amount versus Projection Total remains a separate non-blocking project-data warning.

## 6. Layer ownership

```mermaid
flowchart LR
    A["Google Sheet A1:BT60"] --> B["BFF: map cells and preserve states"]
    B --> C["JVM: canonical calculation contract"]
    C --> D["JVM: compare reported and calculated values"]
    D --> E["JVM: apply ledger and persist evidence"]
    E --> F["BFF: compose response only"]
    F --> G["Frontend: display status and locations"]
```

### BFF

- Fetch the existing fixed range once.
- Normalize positions, labels, dates, amounts, and `EMPTY|ZERO|VALUE|INVALID|ERROR` states.
- Forward source and reported derived cells to the JVM.
- Do not calculate accounting totals or decide validity.

### Spring JVM

- Own the canonical row catalog and period order.
- Calculate totals, balances, differences, and carry-forward.
- Produce the authoritative validation result.
- Persist validation evidence with apply and month-close snapshots.
- Recheck calculation revision during month close.

### Frontend

- Never calculate finance values.
- Display the JVM status, first affected location, and affected-period count.
- Keep detailed diagnostics available without flooding the main dashboard.

## 7. Validation output contract

The public error-code surface is intentionally small.

### `CASHFLOW_SOURCE_VALUE_INVALID`

Source value is not an exact whole-won number. Sheet apply is blocked.

### `CASHFLOW_SHEET_ERROR_VALUE`

The source contains an explicit spreadsheet error such as `#REF!`. Sheet apply and month close are blocked.

### `CASHFLOW_CALCULATION_MISMATCH`

The `checkType` identifies the calculation:

- `DEPOSIT_TOTAL`
- `WITHDRAWAL_TOTAL`
- `RUNNING_BALANCE`
- `ROW_TOTAL`
- `GRAND_TOTAL`
- `PROJECTION_ACTUAL_DIFFERENCE`
- `DEPOSIT_SCHEDULE_TOTAL`

The result includes:

```text
mode
period or lineId
sourceCell
reportedAmount
calculatedAmount
differenceAmount
firstAffectedPeriod
affectedPeriodCount
```

Calculation mismatch does not prevent importing the canonical source rows. It records a warning and blocks month close until a corrected sheet is imported. The platform never silently replaces the displayed sheet result.

## 8. Persisted validation evidence

The JVM persists:

```text
contractVersion
sourceRevision
calculationRevision
checkedAt
checkedBy
overallStatus
source cell states and amounts
reported derived values
calculated derived values
validation findings
```

`calculationRevision` is a deterministic hash of the contract version, canonical inputs, reported outputs, and cell states. Month close requires the reviewed revision to match the current applied revision.

## 9. Performance contract

The calculation is a single ordered pass over two modes, 16 lines, and the fixed period columns. Its complexity is `O(modes * lines * periods)` with no database or network call inside the calculation.

- No Redis.
- No queue.
- No second Google Sheets read.
- No formula-parser dependency.
- BFF duplicate calculation is removed after JVM parity is proven.

The implementation records JVM validation duration and finding count. Performance claims are accepted only after measurement with the full reference workbook.

## 10. Implementation phases

### Phase 1 - Characterization

- Freeze the reference workbook as a test fixture or an equivalent extracted fixture.
- Capture current BFF outputs for valid and deliberately corrupted sheets.
- Add failing JVM tests for the formulas in Section 4.

### Phase 2 - JVM domain calculator

- Implement exact cell-state parsing at the JVM boundary.
- Implement ordered period calculation and row-level reconciliation.
- Return validation evidence without changing apply behavior.

### Phase 3 - Single-owner cutover

- Make apply and month close consume the JVM result.
- Remove BFF accounting calculations after response parity is verified.
- Keep BFF mapping and response composition only.

### Phase 4 - UI and audit

- Show compact warning text with first affected period and count.
- Before any write, return `409 cashflow_formula_mismatch_confirmation_required` with the affected week, mode, total type, sheet value, JVM value, and source cell.
- Keep the staged run `READY`; only retry the same staged run with `acceptFormulaMismatches=true` after the user selects `그래도 현재 시트값 반영`.
- Use human-readable Korean in the dialog. Keep the server code in developer logs only.
- Store actor, timestamp, source revision, calculation revision, and findings.
- Do not expose raw internal stack traces or duplicate warnings.

### Phase 5 - Stage QA

- Import an unchanged reference sheet.
- Import mutated sheets for every validation class.
- Verify apply, warning, correction, re-import, and month-close behavior.
- Deploy to Stage only after all acceptance criteria pass.

## 11. Required tests

1. Reference workbook arithmetic passes.
2. A prior-year `2,000,000` won balance carries into the selected year's first week.
3. Changing a source inflow by `100` won without changing the displayed total yields `DEPOSIT_TOTAL` mismatch.
4. Changing only a displayed balance yields `RUNNING_BALANCE` mismatch at the first affected period.
5. Changing only a row Total yields `ROW_TOTAL` mismatch.
6. Empty and explicit zero produce equal arithmetic but different revisions.
7. Negative corrections calculate correctly.
8. Decimal currency is rejected.
9. Spreadsheet error values are rejected.
10. Actual `SUMIFS` formulas are not reimplemented; their effective results are validated downstream.
11. Equal net amounts with different row allocation produce different revisions.
12. BFF and JVM outputs match before BFF accounting calculation is deleted.
13. Full reference-workbook validation duration is measured and logged.

## 12. Acceptance decisions

Implementation starts only after approval of all four decisions:

1. Validate accounting results without enforcing exact formula strings.
2. Exclude variable usage-ledger `SUMIF/SUMIFS` formulas.
3. Allow canonical source-row import on calculation mismatch, but block month close until corrected.
4. Keep project contract-amount mismatch as a separate non-blocking warning.

## 13. Implementation checkpoint

Implemented on 2026-07-28:

- BFF preserves explicit `0` as `ZERO` instead of collapsing it into a generic value.
- JVM independently recalculates five weekly inflow totals, outflow totals, and running balances for Projection and Actual.
- The first January opening balance is calculated from all 2024-through-prior-year canonical source rows; a missing year or source row is rejected.
- Every later week and month uses the prior JVM-calculated balance. Unchanged bridge months participate in calculation but are not rewritten or logged as applied months.
- JVM calculation results replace BFF comparison results in the apply response and persisted amendment evidence.
- Missing calculation evidence or a JVM response without ten weekly checks fails closed.
- Explicit `ZERO` survives the month-close BFF path and remains distinct from `EMPTY`.
- New month-close snapshots retain all 160 source cells and their states; amended and legacy amount maps infer `ZERO` only when an explicit zero-valued key exists.
- Sheet apply behavior remains unchanged; calculation mismatches are not blocking yet.

Verified by the full JVM module test suite and the BFF cashflow-sheet fixture tests. Row totals, grand totals, deposit-schedule totals, calculation revision persistence, and month-close blocking remain later phases. The existing dashboard-to-ledger `Projection - Actual 차이` table remains in place; moving its arithmetic authority fully into the JVM remains part of the later difference-validation phase.
