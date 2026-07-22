# Cashflow Sheet Fidelity Contract

**Original phase:** 2026-07-13
**Retrospective contract:** 2026-07-22
**Status:** COMPLETE — 100/100

## Current authority

This tracked contract supersedes the ignored `.gstack` draft where it conflicts
with later approved product decisions.

- Google Sheets is a read-only source. MYSCube never writes back to it.
- Import happens only after the user explicitly selects `시트 값 불러오기`.
- Imported Projection and Actual values are read-only in the cashflow screen.
- Cashflow sheet import does not acquire the 30-minute edit lease. The BFF pins
  and validates the sheet snapshot; Spring JVM owns canonical overwrite,
  permissions, revision checks, weekly locks, monthly locks, idempotency, and
  audit history.
- The 30-minute edit lease remains a separate project-registration concern.

## Required fidelity

- Screen order is `Projection - Actual 차이 → Projection → ACTUAL`.
- Projection and Actual retain the approved 16 canonical input/output line
  order and are never interleaved by item.
- Identical prepayment labels in input and output sections map to distinct line
  IDs by section context.
- Existing `MYSC_PREPAY_IN` remains the direct-cost prepayment input line.
- The server computes `Projection - Actual`; the frontend only displays it.
- Empty and explicit zero remain distinct.
- Two local, non-committed source workbooks have distinct roles and must remain
  read-only:
  - Formula/reference source `2026 사업비 관리 시트 _ 원본 (절대 건드리지 마시고 사본을 만들어서 써주세요 ㅠㅠ).xlsx`:
    `e3ce2a8640cf45ffda7f68fe79f4529c87548c44618ebd1474956ea2a5363ac1`.
  - Current 260701 layout source `원본은 건들지 마시오 - 260701_ 사업비 관리 시트 (2).xlsx`:
    `ab9944ba91a83b88c7a1951b72b7b30d6e1d9f94839a84c54d512cb6e694af87`.

## Failure conditions

- Any write back to Google Sheets or automatic background synchronization.
- Frontend/BFF becoming the canonical financial calculation or final-write
  authority.
- Line merge, reorder, duplicate totals, reversed variance, or loss of explicit
  zero.
- Cashflow sheet import unexpectedly requiring an edit-lease header.
- Original finance workbook mutation or Live deployment.

## Evidence required for 100/100

- BFF parser/route and JVM/Rust/TypeScript catalog regressions.
- Sanitized XLSX regression using the same Projection/Actual row labels and the
  complete 12-month, five-week header shape.
- Production build.
- Stage canary after deployment confirms the ordering, horizontal scrolling,
  read-only cells, explicit import, and no unexpected 4xx/5xx. This is a
  deployment acceptance check, not a reason to infer Stage success locally.

## 2026-07-22 remediation evidence

- The current 260701 layout source was opened read-only; its cashflow sheet has the approved
  Projection rows 12–34, ACTUAL rows 35–56, weekly columns E–BL, and annual
  summary columns before and after the weekly year.
- `cashflow-260701-sanitized-full-year.xlsx` is a privacy-safe 66-column XLSX
  fixture with all 12 months, 60 week headers, both sections, explicit zero,
  blanks, and synthetic amounts.
- Artifact-tool inspection/render verified `A1:BN57` and the visible row/header
  alignment before the fixture was added to the regression suite.

## Independent audit

- Contract/main path: 20/20
- Finance line/parser/variance semantics: 25/25
- JVM authority, one-way and lease-free import: 20/20
- Actual XLSX and blank/zero regression: 15/15
- Tests/build: 15/15
- Documentation/deployment boundary: 5/5

**Final score: 100/100.**
