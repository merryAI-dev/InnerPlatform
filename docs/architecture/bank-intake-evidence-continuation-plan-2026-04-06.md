# Bank Intake Evidence Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bank triage wizard the primary place to classify new transactions and continue evidence uploads without blocking weekly projection.

**Architecture:** Keep `expense_intake` as the persisted workflow boundary, add shared wizard status resolvers plus an evidence-only projection patch path, and let pages consume grouped intake summaries instead of ad-hoc counts. The weekly sheet remains a projection, not the source of truth.

**Tech Stack:** React, TypeScript, Firebase/Firestore, Vitest, Playwright, existing portal store + settlement/evidence helpers.

---

## File Map

### Create

- `src/app/platform/bank-intake-surface.ts`
- `src/app/platform/bank-intake-surface.test.ts`

### Modify

- `src/app/data/types.ts`
- `src/app/data/portal-store.tsx`
- `src/app/data/portal-store.persistence.ts`
- `src/app/data/portal-store.persistence.test.ts`
- `src/app/components/portal/BankImportTriageWizard.tsx`
- `src/app/components/portal/PortalBankStatementPage.tsx`
- `src/app/components/portal/PortalWeeklyExpensePage.tsx`
- `src/app/platform/evidence-upload-flow.ts`
- `src/app/platform/evidence-helpers.ts`
- `src/app/data/portal-store.integration.test.ts`
- `tests/e2e/bank-upload-triage-wizard.spec.ts`
- `.github/workflows/ci.yml`
- `docs/architecture/bank-upload-triage-wizard-spec-2026-04-06.md`
- `docs/architecture/bank-upload-triage-wizard-roadmap-2026-04-06.md`
- `docs/architecture/product-release-gates-runbook-2026-04-05.md`

### Notes on responsibilities

- `bank-intake-surface.ts`: all UI-facing intake status resolution and grouped counts
- `portal-store.persistence.ts`: weekly projection patch helpers, including evidence-only patching
- `portal-store.tsx`: intake draft/project/evidence actions and coherence between intake docs and weekly projection
- `BankImportTriageWizard.tsx`: dense workflow UI for classify-project-continue-evidence
- portal pages: only summary/reopen surfaces, no bespoke intake logic

---

### Task 1: Define shared intake surface status helpers

**Files:**
- Create: `src/app/platform/bank-intake-surface.ts`
- Test: `src/app/platform/bank-intake-surface.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { groupExpenseIntakeItemsForSurface, resolveBankImportWizardStatus } from './bank-intake-surface';
import type { BankImportIntakeItem } from '../data/types';

function makeItem(overrides: Partial<BankImportIntakeItem> = {}): BankImportIntakeItem {
  return {
    id: 'intake-1',
    projectId: 'p-1',
    sourceTxId: 'bank:fp-1',
    bankFingerprint: 'fp-1',
    bankSnapshot: {
      accountNumber: '111',
      dateTime: '2026-04-06 09:00',
      counterparty: '코레일',
      memo: 'KTX',
      signedAmount: -15000,
      balanceAfter: 500000,
    },
    matchState: 'PENDING_INPUT',
    projectionStatus: 'NOT_PROJECTED',
    evidenceStatus: 'MISSING',
    manualFields: {},
    reviewReasons: [],
    lastUploadBatchId: 'batch-1',
    createdAt: '2026-04-06T00:00:00.000Z',
    updatedAt: '2026-04-06T00:00:00.000Z',
    updatedBy: 'pm',
    ...overrides,
  };
}

describe('resolveBankImportWizardStatus', () => {
  it('returns PROJECTED_PENDING_EVIDENCE when projection succeeded but evidence is missing', () => {
    expect(resolveBankImportWizardStatus(makeItem({
      matchState: 'AUTO_CONFIRMED',
      projectionStatus: 'PROJECTED_WITH_PENDING_EVIDENCE',
      evidenceStatus: 'MISSING',
      manualFields: {
        expenseAmount: 15000,
        budgetCategory: '여비',
        budgetSubCategory: '교통비',
        cashflowCategory: 'TRAVEL',
      },
    }))).toBe('PROJECTED_PENDING_EVIDENCE');
  });
});

describe('groupExpenseIntakeItemsForSurface', () => {
  it('groups intake items into classification, review, and evidence continuation buckets', () => {
    const grouped = groupExpenseIntakeItemsForSurface([
      makeItem(),
      makeItem({ id: 'review', matchState: 'REVIEW_REQUIRED', reviewReasons: ['collision'] }),
      makeItem({
        id: 'evidence',
        matchState: 'AUTO_CONFIRMED',
        projectionStatus: 'PROJECTED_WITH_PENDING_EVIDENCE',
        evidenceStatus: 'MISSING',
        manualFields: {
          expenseAmount: 15000,
          budgetCategory: '여비',
          budgetSubCategory: '교통비',
          cashflowCategory: 'TRAVEL',
        },
      }),
    ]);

    expect(grouped.needsClassification).toHaveLength(1);
    expect(grouped.reviewRequired).toHaveLength(1);
    expect(grouped.pendingEvidence).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/platform/bank-intake-surface.test.ts`

Expected: FAIL because `bank-intake-surface.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { BankImportIntakeItem } from '../data/types';
import { isBankImportManualFieldsComplete } from './bank-import-triage';

export type BankImportWizardStatus =
  | 'NEEDS_CLASSIFICATION'
  | 'READY_TO_PROJECT'
  | 'PROJECTED_PENDING_EVIDENCE'
  | 'PROJECTED_COMPLETE'
  | 'REVIEW_REQUIRED';

export function resolveBankImportWizardStatus(item: BankImportIntakeItem): BankImportWizardStatus {
  if (item.matchState === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';
  if (!isBankImportManualFieldsComplete(item.manualFields)) return 'NEEDS_CLASSIFICATION';
  if (item.projectionStatus === 'NOT_PROJECTED') return 'READY_TO_PROJECT';
  if (item.evidenceStatus !== 'COMPLETE') return 'PROJECTED_PENDING_EVIDENCE';
  return 'PROJECTED_COMPLETE';
}

export function groupExpenseIntakeItemsForSurface(items: BankImportIntakeItem[]) {
  const grouped = {
    needsClassification: [] as BankImportIntakeItem[],
    reviewRequired: [] as BankImportIntakeItem[],
    pendingEvidence: [] as BankImportIntakeItem[],
    completed: [] as BankImportIntakeItem[],
  };

  items.forEach((item) => {
    const status = resolveBankImportWizardStatus(item);
    if (status === 'REVIEW_REQUIRED') grouped.reviewRequired.push(item);
    else if (status === 'NEEDS_CLASSIFICATION' || status === 'READY_TO_PROJECT') grouped.needsClassification.push(item);
    else if (status === 'PROJECTED_PENDING_EVIDENCE') grouped.pendingEvidence.push(item);
    else grouped.completed.push(item);
  });

  return grouped;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/platform/bank-intake-surface.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/platform/bank-intake-surface.ts src/app/platform/bank-intake-surface.test.ts
git commit -m "feat(portal): add intake surface status helpers"
```

### Task 2: Add evidence-only projection patch helper

**Files:**
- Modify: `src/app/data/portal-store.persistence.ts`
- Test: `src/app/data/portal-store.persistence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('patches evidence fields without overwriting manual classification fields', () => {
  const result = patchExpenseSheetProjectionEvidenceBySourceTxId({
    rows: [
      {
        tempId: 'row-1',
        sourceTxId: 'bank:fp-1',
        cells: Array.from({ length: 27 }, () => ''),
      },
    ],
    sourceTxId: 'bank:fp-1',
    evidenceRequiredDesc: '출장신청서, 영수증',
    evidenceCompletedDesc: '출장신청서',
    evidenceStatus: 'PARTIAL',
  });

  expect(result.rows[0]?.cells[17]).toBe('출장신청서, 영수증');
  expect(result.rows[0]?.cells[18]).toBe('출장신청서');
  expect(result.rows[0]?.cells[19]).toBe('영수증');
  expect(result.rows[0]?.cells[5]).toBe('');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/data/portal-store.persistence.test.ts`

Expected: FAIL because `patchExpenseSheetProjectionEvidenceBySourceTxId` is missing.

- [ ] **Step 3: Write minimal implementation**

```ts
export function patchExpenseSheetProjectionEvidenceBySourceTxId(params: {
  rows: ImportRow[] | null;
  sourceTxId: string;
  evidenceRequiredDesc: string;
  evidenceCompletedDesc: string;
  evidenceStatus: EvidenceStatus;
}) {
  const rows = [...(params.rows || [])];
  const rowIndex = rows.findIndex((row) => row.sourceTxId === params.sourceTxId);
  if (rowIndex < 0) return { rows, patchedRow: null };

  const row = rows[rowIndex];
  const cells = [...row.cells];
  const checklist = resolveEvidenceChecklist({
    evidenceRequiredDesc: params.evidenceRequiredDesc,
    evidenceCompletedDesc: params.evidenceCompletedDesc,
    evidenceCompletedManualDesc: params.evidenceCompletedDesc,
    evidenceAutoListedDesc: '',
    evidenceDriveLink: '',
    evidenceDriveFolderId: '',
  });

  cells[17] = params.evidenceRequiredDesc;
  cells[18] = params.evidenceCompletedDesc;
  cells[19] = checklist.missing.join(', ');

  const patchedRow = {
    ...row,
    cells,
  };

  rows[rowIndex] = patchedRow;
  return { rows, patchedRow };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/data/portal-store.persistence.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/data/portal-store.persistence.ts src/app/data/portal-store.persistence.test.ts
git commit -m "feat(portal): add evidence-only weekly projection patch"
```

### Task 3: Split portal store actions for draft, project, and evidence continuation

**Files:**
- Modify: `src/app/data/types.ts`
- Modify: `src/app/data/portal-store.tsx`
- Modify: `src/app/data/portal-store.integration.test.ts`

- [ ] **Step 1: Write the failing tests**

Add one unit/integration assertion that:

```ts
it('updates intake evidence and projected weekly evidence fields without replacing the row', async () => {
  // Arrange intake item already projected
  // Act: call syncExpenseIntakeEvidence(...)
  // Assert: expense intake doc evidence fields updated
  // Assert: weekly row still exists with same sourceTxId and updated evidence cells
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/data/portal-store.integration.test.ts`

Expected: FAIL because `syncExpenseIntakeEvidence` does not exist.

- [ ] **Step 3: Write minimal implementation**

Implementation requirements:

- Add action signature in `PortalActions`:

```ts
syncExpenseIntakeEvidence: (id: string, updates: Partial<BankImportIntakeItem>) => Promise<void>;
```

- Inside `portal-store.tsx`:
  - locate current intake item
  - merge updates using `mergeBankImportIntakeItem`
  - recompute evidence checklist/status
  - persist intake doc
  - if `existingExpenseSheetId` exists, patch target weekly row via `patchExpenseSheetProjectionEvidenceBySourceTxId`
  - update local `expenseSheets`, `expenseSheetRows`, `expenseIntakeItems` in the same tick

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/data/portal-store.integration.test.ts src/app/data/portal-store.persistence.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/data/types.ts src/app/data/portal-store.tsx src/app/data/portal-store.integration.test.ts src/app/data/portal-store.persistence.ts
git commit -m "feat(portal): split intake evidence continuation actions"
```

### Task 4: Rebuild the wizard UI around classify-first, evidence-next continuation

**Files:**
- Modify: `src/app/components/portal/BankImportTriageWizard.tsx`
- Modify: `src/app/platform/evidence-upload-flow.ts`
- Modify: `src/app/platform/evidence-helpers.ts`

- [ ] **Step 1: Write the failing UI-oriented tests**

Add component-level expectations or narrow logic tests for:

```ts
it('shows a secondary evidence continuation card after manual fields are complete');
it('lets the user continue without blocking projection when evidence is still missing');
it('shows pending evidence items separately from classification-needed items');
```

If component tests are too expensive, encode the behavior in helper tests under `bank-intake-surface.test.ts` and `evidence-upload-flow.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/platform/bank-intake-surface.test.ts src/app/platform/evidence-upload-flow.test.ts`

Expected: FAIL on the new expectations.

- [ ] **Step 3: Write minimal implementation**

Implementation rules:

- Wizard left rail must split queue sections:
  - `분류 필요`
  - `검토 필요`
  - `증빙 미완료`
- Primary CTA text:
  - incomplete manual fields: `임시 저장`
  - ready to project: `주간 반영 후 다음 거래`
  - already projected pending evidence: `증빙 저장 후 다음 거래`
- Evidence section should include:
  - required checklist
  - completed checklist
  - missing checklist
  - upload action
  - non-blocking `증빙은 나중에`
- Keep a fixed footer height to avoid layout shift.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/platform/bank-intake-surface.test.ts src/app/platform/evidence-upload-flow.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/components/portal/BankImportTriageWizard.tsx src/app/platform/evidence-upload-flow.ts src/app/platform/evidence-helpers.ts src/app/platform/bank-intake-surface.ts src/app/platform/bank-intake-surface.test.ts
git commit -m "feat(portal): make bank triage evidence continuation primary"
```

### Task 5: Update bank statement and weekly surfaces to show resumable intake states

**Files:**
- Modify: `src/app/components/portal/PortalBankStatementPage.tsx`
- Modify: `src/app/components/portal/PortalWeeklyExpensePage.tsx`

- [ ] **Step 1: Write the failing test**

Add or extend Playwright expectations so pages show separate counts:

```ts
await expect(page.getByText('분류 필요 2')).toBeVisible();
await expect(page.getByText('증빙 미완료 1')).toBeVisible();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/bank-upload-triage-wizard.spec.ts --config playwright.harness.config.mjs`

Expected: FAIL because current summary collapses states together.

- [ ] **Step 3: Write minimal implementation**

Implementation requirements:

- Use `groupExpenseIntakeItemsForSurface(expenseIntakeItems)` in both pages
- `PortalBankStatementPage` summary card:
  - classification count
  - review count
  - pending evidence count
  - CTA pair: `신규 거래 처리 시작`, `증빙 이어서 하기`
- `PortalWeeklyExpensePage` queue strip:
  - same three counts
  - reopen wizard action
  - no generic “미처리 거래” phrasing

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/e2e/bank-upload-triage-wizard.spec.ts --config playwright.harness.config.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/components/portal/PortalBankStatementPage.tsx src/app/components/portal/PortalWeeklyExpensePage.tsx tests/e2e/bank-upload-triage-wizard.spec.ts
git commit -m "feat(portal): add resumable intake summary surfaces"
```

### Task 6: Add deterministic end-to-end coverage for project-first, evidence-later flow

**Files:**
- Modify: `tests/e2e/bank-upload-triage-wizard.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/architecture/product-release-gates-runbook-2026-04-05.md`
- Modify: `docs/architecture/bank-upload-triage-wizard-roadmap-2026-04-06.md`

- [ ] **Step 1: Write the failing E2E scenario**

Extend the spec with a second path:

```ts
test('project first and continue evidence later without losing projected values', async ({ page }) => {
  // upload bank rows
  // classify + project one row
  // close wizard with evidence still missing
  // reopen from weekly or bank page
  // add evidence
  // verify queue counts and weekly evidence fields update
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/e2e/bank-upload-triage-wizard.spec.ts --config playwright.harness.config.mjs`

Expected: FAIL because reopen/evidence continuation is incomplete.

- [ ] **Step 3: Write minimal implementation**

Implementation requirements:

- make wizard reopen target either:
  - first classification-needed item, or
  - first pending-evidence item when opened from `증빙 이어서 하기`
- ensure evidence upload updates weekly row without changing classification fields
- wire this E2E into `product-release-gates`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx playwright test tests/e2e/bank-upload-triage-wizard.spec.ts --config playwright.harness.config.mjs`

Run: `npx playwright test tests/e2e/migration-wizard.harness.spec.js tests/e2e/settlement-product-completeness.spec.ts tests/e2e/bank-upload-triage-wizard.spec.ts tests/e2e/product-release-gates.spec.ts --config playwright.harness.config.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/bank-upload-triage-wizard.spec.ts .github/workflows/ci.yml docs/architecture/product-release-gates-runbook-2026-04-05.md docs/architecture/bank-upload-triage-wizard-roadmap-2026-04-06.md
git commit -m "test(portal): lock intake evidence continuation flow"
```

### Task 7: Final verification and documentation sync

**Files:**
- Modify: `docs/architecture/bank-upload-triage-wizard-spec-2026-04-06.md`
- Modify: `docs/architecture/bank-upload-triage-wizard-roadmap-2026-04-06.md`
- Modify: `docs/architecture/bank-intake-evidence-continuation-spec-2026-04-06.md`
- Modify: `docs/architecture/bank-intake-evidence-continuation-plan-2026-04-06.md`

- [ ] **Step 1: Run the targeted verification matrix**

Run:

```bash
npx vitest run src/app/platform/bank-intake-surface.test.ts src/app/data/portal-store.persistence.test.ts src/app/data/portal-store.integration.test.ts src/app/platform/evidence-upload-flow.test.ts
```

Expected: PASS

- [ ] **Step 2: Run the E2E verification matrix**

Run:

```bash
npx playwright test tests/e2e/bank-upload-triage-wizard.spec.ts --config playwright.harness.config.mjs
```

Expected: PASS

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: exit code 0

- [ ] **Step 4: Update roadmap/spec status**

Make sure docs reflect:

- evidence continuation shipped
- release gate broadened
- remaining follow-up limited to drive setup and submission-time completeness enforcement

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/bank-upload-triage-wizard-spec-2026-04-06.md docs/architecture/bank-upload-triage-wizard-roadmap-2026-04-06.md docs/architecture/bank-intake-evidence-continuation-spec-2026-04-06.md docs/architecture/bank-intake-evidence-continuation-plan-2026-04-06.md
git commit -m "docs(portal): record intake evidence continuation rollout"
```
