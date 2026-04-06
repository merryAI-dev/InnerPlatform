# Bank Upload Triage Wizard Roadmap

## Summary

이 로드맵은 bank upload가 `expense_sheets` 전체를 교체하는 현재 구조를 중지하고, `expense_intake -> triage wizard -> projection upsert` 구조로 점진 전환하는 실행 계획이다. 전체 목표는 빠른 핫픽스가 아니라, Salesforce 같은 외부형 SaaS가 가져야 할 운영 신뢰를 만드는 것이다.

## Phase Order

- [x] Phase 1: Core domain contracts
- [x] Phase 2: Intake persistence layer
- [x] Phase 3: Non-destructive bank upload
- [x] Phase 4: Triage wizard UI
- [ ] Phase 5: Projection upsert by `sourceTxId`
- [ ] Phase 6: Non-blocking evidence integration
- [ ] Phase 7: QA and release gates

## Phase 1: Core Domain Contracts

**Status:** completed

**Files**
- `src/app/data/types.ts`
- `src/app/platform/bank-import-triage.ts`
- `src/app/platform/bank-import-triage.test.ts`

**Deliverables**
- `BankImportIntakeItem`
- `BankImportMatchState`
- `BankImportProjectionStatus`
- bank fingerprint helper
- match-state resolver
- projection-status resolver

**Tests**
- order-independent identity
- `PENDING_INPUT`
- `AUTO_CONFIRMED`
- `REVIEW_REQUIRED`
- non-blocking evidence projection

## Phase 2: Intake Persistence Layer

**Status:** completed

**Files**
- `src/app/data/portal-store.intake.ts`
- `src/app/data/portal-store.intake.test.ts`
- `src/app/data/portal-store.tsx`

**Deliverables**
- intake serialize/deserialize helpers
- `expenseIntakeItems` portal store state
- intake listen and update mutations

**Rules**
- JSON-safe persistence only
- manual fields preserved exactly
- optional evidence fields normalized consistently

**Verification**
- `npx vitest run src/app/data/portal-store.intake.test.ts src/app/data/portal-store.integration.test.ts`
- `npm run build`

## Phase 3: Non-Destructive Bank Upload

**Status:** completed

**Files**
- `src/app/platform/bank-statement.ts`
- `src/app/platform/bank-statement.test.ts`
- `src/app/data/portal-store.tsx`
- `src/app/data/portal-store.integration.test.ts`

**Deliverables**
- `saveBankStatementRows()` stops writing full `expense_sheets` snapshots
- upload writes `bank_statements/default` and `expense_intake`
- remove `index fallback`
- allow only narrow safe refresh for already projected rows

**Must-have regression**
- reupload in different order does not delete or reset manual weekly rows

**Verification**
- `npx vitest run src/app/platform/bank-statement.test.ts src/app/data/portal-store.intake.test.ts src/app/data/portal-store.integration.test.ts`
- `npm run build`

## Phase 4: Triage Wizard UI

**Status:** completed

**Files**
- `src/app/components/portal/BankImportTriageWizard.tsx`
- `src/app/components/portal/PortalBankStatementPage.tsx`
- `src/app/components/portal/PortalWeeklyExpensePage.tsx`

**Deliverables**
- large modal/sheet wizard
- left queue rail
- right detail panel
- progress header
- sticky footer
- minimize/resume
- bank upload summary card
- weekly page intake summary strip

**UX constraints**
- enterprise density
- no layout shift
- no hover-only controls
- evidence secondary, not primary

**Verification**
- `npx vitest run src/app/platform/bank-statement.test.ts src/app/data/portal-store.intake.test.ts src/app/data/portal-store.integration.test.ts`
- `npm run build`

## Phase 5: Projection Upsert By Source Identity

**Status:** in progress

**Files**
- `src/app/data/portal-store.persistence.ts`
- `src/app/data/portal-store.persistence.test.ts`
- `src/app/data/portal-store.tsx`

**Deliverables**
- `upsertExpenseSheetProjectionRowBySourceTxId()`
- wizard completion inserts or updates a single row
- `expenseSheets` and `expenseSheetRows` stay synchronized immediately

**Rules**
- update bank-origin fields from latest bank snapshot
- update manual fields from intake state
- never replace unrelated rows

## Phase 6: Evidence Integration Without Blocking Projection

**Files**
- `src/app/components/portal/BankImportTriageWizard.tsx`
- `src/app/platform/evidence-upload-flow.ts`
- `src/app/platform/evidence-helpers.ts`
- `src/app/platform/evidence-upload-flow.test.ts`

**Deliverables**
- inline evidence checklist inside wizard
- non-blocking projection even when evidence missing
- `PROJECTED_WITH_PENDING_EVIDENCE` state
- immediate completed/pending evidence list update

## Phase 7: QA And Release Gates

**Files**
- `tests/e2e/bank-upload-triage-wizard.spec.ts`
- `tests/e2e/product-release-gates.spec.ts`
- `.github/workflows/ci.yml`
- `docs/architecture/product-release-gates-runbook-2026-04-05.md`

**Required E2E**
- bank upload
- summary counts
- wizard open
- manual classification
- skip evidence
- weekly reflection
- reupload same rows in different order
- verify human-entered values survive

## Engineering Guardrails

- Do not use row index or row order as identity
- Do not let upload write full `expense_sheets` snapshots
- Do not make evidence completeness a reflection blocker
- Do not remove `ImportEditor`; demote it to exception editor
- Prefer persisted intake state over ephemeral React-only queue state

## Autoplan Review Summary

### CEO
- The wedge stays narrow: bank upload trust, not whole finance rewrite.
- The 10-star move is replacing destructive merge with an operational triage loop.

### Design
- Modal/sheet beats a new full page because users stay in upload context.
- Wizard should ask for decisions, not spreadsheet work.
- Evidence belongs in the same loop but must not lengthen mandatory dwell time.

### Engineering
- `expense_intake` is the new boundary that keeps current code and future server-authoritative migration compatible.
- `sourceTxId = bank:{fingerprint}` is the required identity anchor.

### QA
- The reupload-in-different-order scenario is a release blocker.
- If that scenario is not in CI, the rollout is not trustworthy.

## Recommended First Tranche

Start with Phase 1 through Phase 3 in one branch. That gives a working backend/data boundary without yet changing the full UI entry flow. Once upload no longer destructively rewrites weekly rows, ship Phase 4 through Phase 6 as the user-visible wizard tranche.
