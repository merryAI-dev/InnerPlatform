# Embedded Workbook Engine Execution Map

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the embedded workbook migration as a sequence of small, reviewable, low-regret changes that preserve the existing bank intake and operations flow while making `사업비 입력(주간)` the first authoritative workbook surface.

**Architecture:** This execution map assumes the design in `docs/superpowers/specs/2026-04-15-embedded-workbook-engine-design.md` is approved and the higher-level plan in `docs/superpowers/plans/2026-04-15-embedded-workbook-engine.md` remains the architectural source. This file is the day-to-day implementation guide: issue map, dependency order, exact verification gates, and commit cadence.

**Tech Stack:** Vite React 18, TypeScript, Vitest, Playwright, Express BFF, Firestore, Rust (`spreadsheet-calculation-core`), WASM/native dual-run, Husky hooks

---

## How To Use This File

- Read the approved spec first.
- Use this file during implementation, not the broader plan.
- Do not skip gates. Each milestone ends with a verification checkpoint.
- Prefer one commit per task. If a task spills beyond one commit, split it.
- Keep `WB-*` issue IDs in workbook-related commit messages once the light hook is live.

## Source Documents

- Spec: `docs/superpowers/specs/2026-04-15-embedded-workbook-engine-design.md`
- Broad plan: `docs/superpowers/plans/2026-04-15-embedded-workbook-engine.md`
- Patch notes index: `docs/wiki/patch-notes/index.md`
- Weekly expense page note: `docs/wiki/patch-notes/pages/portal-weekly-expense.md`
- Policy record target: `docs/architecture/policies/workbook-engine-policy-record.md`

## Hard Invariants

These are not negotiable during implementation.

- `통장내역 → triage → 주간입력` ingress path survives. The workbook sits on top of it; it does not replace it.
- Core policy cells are editable in value/formula only. Their existence is immutable: no add/delete for protected policy cells.
- Broken official outputs hard-block save. No degraded save mode in v1.
- `cashflow`, `weekly submission`, and `admin monitoring` continue to derive from the same project-scoped authoritative state after the workbook cutover.
- Same-project multi-sheet references are in scope; cross-project references are out of scope.
- `사업비 입력(주간)` is the first workbook surface. Budget and standalone cashflow surfaces are follow-on migrations, not part of this slice.

## Concrete Runtime Boundaries

Lock these seams before implementation so the migration does not drift.

- Browser UI authority:
  - `src/app/components/workbook/*`
  - `src/app/components/portal/PortalWeeklyExpensePage.tsx`
  - `src/app/data/portal-store.tsx`
- Browser calculation/validation adapter:
  - `src/app/platform/project-workbook*.ts`
  - `src/app/platform/workbook-*.ts`
  - `src/app/platform/settlement-calculation-kernel.ts`
- Server authority:
  - `server/bff/project-workbooks.mjs`
  - `server/bff/routes/project-workbooks.mjs`
  - `server/bff/settlement-kernel.mjs`
- Rust authority:
  - `rust/spreadsheet-calculation-core/src/workbook*.rs`
- Recommended Firestore persistence targets:
  - workbook doc: `orgs/{tenantId}/projects/{projectId}/workbooks/default`
  - workbook outputs doc: `orgs/{tenantId}/projects/{projectId}/workbook_outputs/current`
  - keep existing ingress docs during migration: `expense_intake/*`, `expense_sheets/*`, `weeklySubmissionStatus/*`

## Regression Suites To Keep Green

Do not rely on ad-hoc confidence. These existing suites are the minimum guardrail set.

- Store and persistence:
  - `src/app/data/portal-store.intake.test.ts`
  - `src/app/data/portal-store.integration.test.ts`
  - `src/app/data/portal-store.persistence.test.ts`
  - `src/app/data/portal-store.settlement.test.ts`
- Weekly expense and intake flow:
  - `src/app/components/portal/PortalWeeklyExpensePage.flow-layout.test.ts`
  - `src/app/platform/bank-intake-surface.test.ts`
  - `src/app/platform/weekly-expense-save-policy.test.ts`
  - `src/app/platform/portal-happy-path.test.ts`
- Calculation parity:
  - `src/app/platform/settlement-calculation-kernel.test.ts`
  - `src/app/platform/settlement-rust-kernel.test.ts`
  - `src/app/platform/settlement-kernel-contract.test.ts`
- BFF:
  - `server/bff/app.test.ts`
  - `server/bff/app.integration.test.ts`
  - `server/bff/routes/projects.test.ts`
  - `server/bff/project-sheet-source-storage.test.ts`

## Rollout Sequence

Do not flip the workbook on for everyone at once.

1. Add a feature flag: `VITE_WEEKLY_EXPENSE_WORKBOOK_ENABLED`.
2. Shadow mode:
   - hydrate the workbook in store
   - keep `SettlementLedgerPage` as the visible editor
   - compare workbook-derived outputs with current settlement outputs in tests only
3. Opt-in mode:
   - render workbook shell only when the flag is enabled
   - keep existing bank triage and evidence actions around it
4. Default-on mode:
   - workbook shell becomes the default weekly expense editor
   - legacy ledger stays available only as a rollback path until parity sign-off
5. Cleanup is a separate plan:
   - no deletion of legacy structures in this execution map

## Issue Board

Create or maintain one issue per ID below. Use these titles.

- `WB-001` Core policy cells are immutable in existence
- `WB-002` Workbook save blocks on official output breakage
- `WB-003` Bank statement and triage remain the workbook ingress path
- `WB-004` Weekly expense workbook becomes project-scoped authoritative surface
- `WB-005` Cashflow / submission / admin outputs fan out from workbook mappings
- `WB-006` Policy changes support `forward_only` and `recalc_all`
- `WB-007` Same-project multi-sheet references are allowed
- `WB-008` Workbook saves use optimistic versioning and conflict resolution
- `WB-009` Browser and server workbook runtimes stay in parity

## Milestones

### Milestone 0: Policy / hygiene / issue scaffolding

- `WB-001`, `WB-002`, `WB-003`, `WB-004`, `WB-005`, `WB-006`, `WB-007`, `WB-008`, `WB-009` are written down in-repo
- commit-msg warning exists
- no runtime behavior changes yet

### Milestone 1: TS workbook domain model exists

- `ProjectWorkbook` types exist
- default workbook factory exists
- legacy `expenseSheetRows` can hydrate a workbook shell
- no user-visible UI swap yet

### Milestone 2: Rust workbook validation layer exists

- workbook schema exists in Rust
- structural validation exists
- runtime validation contract exists
- output mapping errors can be represented consistently

### Milestone 3: BFF persistence path exists

- load/save endpoints exist
- version mismatch returns structured conflicts
- workbook save path can carry official output placeholders

### Milestone 4: React workbook shell is mounted behind the weekly expense surface

- workbook tabs/formula bar/policy panel exist
- current triage/evidence flow is still present
- workbook state is hydrated from current data

### Milestone 5: Workbook save drives official output fan-out

- weekly authoritative rows derive from workbook mappings
- cashflow/submission/admin outputs derive from workbook save
- broken mappings block save

### Milestone 6: Conflict/replay/parity are locked in

- conflict dialog exists
- `forward_only` / `recalc_all` are implemented
- parity fixtures and smoke tests pass

## Dependency Order

Implement in this order:

1. Policy record + light hook
2. TS workbook model
3. Legacy adapter + store hydration
4. Rust workbook schema
5. Rust validation/runtime stubs
6. TS/Rust contract helpers
7. BFF load/save route
8. React workbook shell
9. Weekly expense mount
10. Output mapping panel + blocking save
11. Official output fan-out
12. Conflict + replay
13. Docs / patch notes / final verification

## Suggested PR Slices

Use this split unless implementation reveals a cleaner seam.

1. PR-1 Foundations
   - Task 1, Task 2, Task 3
   - Review focus: domain model shape, store hydration safety, no UI regression
2. PR-2 Kernel contracts
   - Task 4, Task 5, Task 6
   - Review focus: Rust schema, validation invariants, TS/Rust contract parity
3. PR-3 Persistence and mount
   - Task 7, Task 8, Task 9
   - Review focus: BFF route contract, feature flag rollout, weekly expense coexistence with intake/evidence flow
4. PR-4 Authoritative save
   - Task 10, Task 11
   - Review focus: output mapping UX, save blocking, downstream cashflow/submission/admin correctness
5. PR-5 Hardening and docs
   - Task 12, Task 13
   - Review focus: conflict handling, replay semantics, parity, docs and patch-note completeness

## Verification Commands

Use these repeatedly.

- Unit TS: `npx vitest run`
- Focused TS: `npx vitest run <file1> <file2>`
- Rust: `npm run rust:settlement:test`
- App build: `npm run build`
- BFF integration: `npm run bff:test:integration`
- E2E smoke: `npx playwright test tests/e2e/bank-upload-triage-wizard.spec.ts tests/e2e/settlement-product-completeness.spec.ts --config playwright.harness.config.mjs`

## Task 0: Create Or Update The Tracking Issues

**Files:**
- Modify: issue tracker only
- Reference: `docs/superpowers/specs/2026-04-15-embedded-workbook-engine-design.md`

- [ ] **Step 1: Create one issue per `WB-*` ID**

Use these titles exactly:

```text
WB-001 Core policy cells are immutable in existence
WB-002 Workbook save blocks on official output breakage
WB-003 Bank statement and triage remain workbook ingress
WB-004 Weekly expense workbook becomes authoritative surface
WB-005 Cashflow / submission / admin outputs fan out from workbook mappings
WB-006 Workbook policy changes support forward_only and recalc_all
WB-007 Same-project multi-sheet references are allowed
WB-008 Workbook saves use optimistic versioning and conflict resolution
WB-009 Browser and server workbook runtimes stay in parity
```

- [ ] **Step 2: Add the same acceptance skeleton to each issue**

```md
## Acceptance
- [ ] Tests added
- [ ] Existing bank intake flow preserved
- [ ] Weekly expense path still operable
- [ ] Workbook policy reference included in commit messages
```

- [ ] **Step 3: Stop and confirm the issue numbers are available**

Expected: You can reference each issue from commit messages, PR body, and comments during implementation.

## Task 1: Add The In-Repo Policy Record And Light Hook

**Issue:** `WB-001`

**Files:**
- Create: `docs/architecture/policies/workbook-engine-policy-record.md`
- Create: `src/app/platform/workbook-policy-guard.ts`
- Create: `src/app/platform/workbook-policy-guard.test.ts`
- Create: `scripts/check_workbook_policy_guard.mjs`
- Create: `.husky/commit-msg`

- [ ] **Step 1: Write the failing guard test**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateWorkbookPolicyWarning } from './workbook-policy-guard';

describe('evaluateWorkbookPolicyWarning', () => {
  it('warns when workbook files are staged without WB issue reference', () => {
    const result = evaluateWorkbookPolicyWarning({
      stagedPaths: [
        'src/app/components/portal/PortalWeeklyExpensePage.tsx',
        'src/app/data/portal-store.tsx',
      ],
      commitMessage: 'feat: mount workbook shell',
    });

    expect(result.shouldWarn).toBe(true);
  });

  it('does not warn when a WB reference exists', () => {
    const result = evaluateWorkbookPolicyWarning({
      stagedPaths: ['rust/spreadsheet-calculation-core/src/lib.rs'],
      commitMessage: 'feat(WB-001): add workbook runtime',
    });

    expect(result.shouldWarn).toBe(false);
  });
});
```

- [ ] **Step 2: Run only the guard test**

Run: `npx vitest run src/app/platform/workbook-policy-guard.test.ts`
Expected: FAIL because the module does not exist yet

- [ ] **Step 3: Add the policy record**

```md
# Workbook Engine Policy Record

- `WB-001` Core policy cells are immutable in existence.
- `WB-002` Workbook save blocks on official output breakage.
- `WB-003` Bank statement and triage remain workbook ingress.
- `WB-004` Weekly expense workbook becomes the first authoritative workbook surface.
- `WB-005` Cashflow, submission, and admin outputs derive from workbook mappings.
- `WB-006` Policy changes support `forward_only` and `recalc_all`.
- `WB-007` Same-project multi-sheet references are allowed; cross-project references are out of scope.
- `WB-008` Workbook saves use optimistic versioning with cell-level conflict resolution.
- `WB-009` Browser and server runtime parity is required.
```

- [ ] **Step 4: Add the guard utility**

```ts
const WORKBOOK_PATH_PATTERNS = [
  /^src\/app\/platform\//,
  /^src\/app\/components\/portal\/PortalWeeklyExpensePage\.tsx$/,
  /^src\/app\/data\/portal-store\.tsx$/,
  /^rust\/spreadsheet-calculation-core\//,
];

const WB_ISSUE_REF_RE = /\bWB-\d{3}\b/;

export function evaluateWorkbookPolicyWarning(input: {
  stagedPaths: string[];
  commitMessage: string;
}) {
  const touchesWorkbook = input.stagedPaths.some((path) => (
    WORKBOOK_PATH_PATTERNS.some((pattern) => pattern.test(path))
  ));

  return {
    shouldWarn: touchesWorkbook && !WB_ISSUE_REF_RE.test(input.commitMessage),
    reason: 'workbook-engine-related changes detected without WB issue reference',
  };
}
```

- [ ] **Step 5: Add the `commit-msg` hook**

```sh
#!/bin/sh
node scripts/check_workbook_policy_guard.mjs "$1" || true
exit 0
```

- [ ] **Step 6: Run the guard test again**

Run: `npx vitest run src/app/platform/workbook-policy-guard.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/policies/workbook-engine-policy-record.md \
  src/app/platform/workbook-policy-guard.ts \
  src/app/platform/workbook-policy-guard.test.ts \
  scripts/check_workbook_policy_guard.mjs \
  .husky/commit-msg
git commit -m "feat(WB-001): add workbook policy record and light commit hook"
```

## Task 2: Add The Core `ProjectWorkbook` Type

**Issue:** `WB-004`

**Files:**
- Create: `src/app/platform/project-workbook.ts`
- Create: `src/app/platform/project-workbook.test.ts`

- [ ] **Step 1: Write the failing model test**

```ts
import { describe, expect, it } from 'vitest';
import { CORE_POLICY_KEYS, createDefaultProjectWorkbook } from './project-workbook';

describe('createDefaultProjectWorkbook', () => {
  it('creates the fixed workbook skeleton', () => {
    const workbook = createDefaultProjectWorkbook('proj-1', 'pm@mysc.co.kr');

    expect(workbook.sheets.map((sheet) => sheet.id)).toEqual([
      'weekly_expense',
      'bank_intake_view',
      'policy',
      'output_mapping',
      'summary',
    ]);
    expect(workbook.policyCells.map((cell) => cell.semanticKey)).toEqual(CORE_POLICY_KEYS);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/app/platform/project-workbook.test.ts`
Expected: FAIL because `project-workbook.ts` does not exist yet

- [ ] **Step 3: Add the minimal workbook type**

```ts
export type WorkbookSheetKind =
  | 'weekly_expense'
  | 'bank_intake_view'
  | 'policy'
  | 'output_mapping'
  | 'summary';

export interface WorkbookCell {
  value: string;
  formula?: string;
}

export interface WorkbookSheet {
  id: string;
  kind: WorkbookSheetKind;
  name: string;
  cells: Record<string, WorkbookCell>;
}

export interface PolicyCellBinding {
  id: string;
  sheetId: string;
  cellRef: string;
  semanticKey: string;
  mutableFormula: boolean;
  mutableValue: boolean;
  deletable: false;
}

export interface OutputMapping {
  outputKey: string;
  sourceSheetId: string;
  sourceRef: string;
  kind: 'cell' | 'table-column';
}

export interface ProjectWorkbook {
  id: string;
  projectId: string;
  version: number;
  sheets: WorkbookSheet[];
  policyCells: PolicyCellBinding[];
  outputMappings: OutputMapping[];
  lastAppliedMode: 'forward_only' | 'recalc_all';
  updatedAt: string;
  updatedBy: string;
}
```

- [ ] **Step 4: Add the default workbook factory**

```ts
export const CORE_POLICY_KEYS = [
  'expense_amount_formula',
  'cashflow_category_formula',
  'submission_readiness_formula',
  'required_evidence_formula',
] as const;

export function createDefaultProjectWorkbook(projectId: string, actor: string): ProjectWorkbook {
  const now = new Date().toISOString();
  return {
    id: `workbook:${projectId}`,
    projectId,
    version: 1,
    sheets: [
      { id: 'weekly_expense', kind: 'weekly_expense', name: '사업비 입력', cells: {} },
      { id: 'bank_intake_view', kind: 'bank_intake_view', name: '통장내역 보기', cells: {} },
      { id: 'policy', kind: 'policy', name: '정책', cells: {} },
      { id: 'output_mapping', kind: 'output_mapping', name: '출력 매핑', cells: {} },
      { id: 'summary', kind: 'summary', name: '요약', cells: {} },
    ],
    policyCells: CORE_POLICY_KEYS.map((semanticKey, index) => ({
      id: `policy:${semanticKey}`,
      sheetId: 'policy',
      cellRef: `B${index + 2}`,
      semanticKey,
      mutableFormula: true,
      mutableValue: true,
      deletable: false as const,
    })),
    outputMappings: [],
    lastAppliedMode: 'forward_only',
    updatedAt: now,
    updatedBy: actor,
  };
}
```

- [ ] **Step 5: Run the focused test again**

Run: `npx vitest run src/app/platform/project-workbook.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/platform/project-workbook.ts src/app/platform/project-workbook.test.ts
git commit -m "feat(WB-004): add core ProjectWorkbook domain model"
```

## Task 3: Add The Legacy Adapter And Store Entry Point

**Issue:** `WB-004`

**Files:**
- Create: `src/app/platform/project-workbook-legacy-adapter.ts`
- Create: `src/app/platform/project-workbook-legacy-adapter.test.ts`
- Modify: `src/app/data/portal-store.tsx`
- Modify: `src/app/data/portal-store.integration.test.ts`
- Modify: `src/app/data/portal-store.persistence.test.ts`

- [ ] **Step 1: Write the failing adapter test**

```ts
import { describe, expect, it } from 'vitest';
import { buildWorkbookFromLegacyExpenseSheet } from './project-workbook-legacy-adapter';

describe('buildWorkbookFromLegacyExpenseSheet', () => {
  it('hydrates legacy weekly rows into workbook cells', () => {
    const workbook = buildWorkbookFromLegacyExpenseSheet({
      projectId: 'proj-1',
      actor: 'pm@mysc.co.kr',
      expenseSheetRows: [{ tempId: 'imp-1', cells: ['2026-04-01', '거래처', '10000'] }],
    });

    const weeklySheet = workbook.sheets.find((sheet) => sheet.id === 'weekly_expense');
    expect(weeklySheet?.cells['A2']?.value).toBe('2026-04-01');
    expect(weeklySheet?.cells['C2']?.value).toBe('10000');
  });
});
```

- [ ] **Step 2: Run the adapter test**

Run: `npx vitest run src/app/platform/project-workbook-legacy-adapter.test.ts`
Expected: FAIL because adapter file does not exist yet

- [ ] **Step 3: Add the adapter**

```ts
import { createDefaultProjectWorkbook } from './project-workbook';

export function buildWorkbookFromLegacyExpenseSheet(input: {
  projectId: string;
  actor: string;
  expenseSheetRows: Array<{ tempId: string; cells: string[] }>;
}) {
  const workbook = createDefaultProjectWorkbook(input.projectId, input.actor);
  const weeklySheet = workbook.sheets.find((sheet) => sheet.id === 'weekly_expense');
  if (!weeklySheet) return workbook;

  input.expenseSheetRows.forEach((row, rowIndex) => {
    row.cells.forEach((value, cellIndex) => {
      const colRef = String.fromCharCode(65 + cellIndex);
      weeklySheet.cells[`${colRef}${rowIndex + 2}`] = { value };
    });
  });

  return workbook;
}
```

- [ ] **Step 4: Add a narrow portal-store entry point**

```ts
// Add this state and hydrator to the existing portal-store module
const [projectWorkbook, setProjectWorkbook] = useState<ProjectWorkbook | null>(null);

function hydrateProjectWorkbook(projectId: string, actor: string) {
  setProjectWorkbook(buildWorkbookFromLegacyExpenseSheet({
    projectId,
    actor,
    expenseSheetRows: expenseSheetRows || [],
  }));
}
```

- [ ] **Step 5: Add store-level hydration assertions in the existing portal-store suites**

Add assertions to the existing store tests instead of creating a parallel store test file.

```ts
// Add this assertion to the existing portal-store.integration.test.ts suite
expect(buildWorkbookFromLegacyExpenseSheet({
  projectId,
  actor: 'PM 보람',
  expenseSheetRows: [makeRow()],
}).sheets.find((sheet) => sheet.id === 'weekly_expense')?.cells['K2']?.value).toBe('15,000');
```

```ts
// Add this assertion to the existing portal-store.persistence.test.ts suite
expect(stored.data()?.rows?.[0]?.cells?.[10]).toBe('15,000');
```

- [ ] **Step 6: Run the adapter and store tests again**

Run: `npx vitest run src/app/platform/project-workbook-legacy-adapter.test.ts src/app/data/portal-store.integration.test.ts src/app/data/portal-store.persistence.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/platform/project-workbook-legacy-adapter.ts \
  src/app/platform/project-workbook-legacy-adapter.test.ts \
  src/app/data/portal-store.tsx \
  src/app/data/portal-store.integration.test.ts \
  src/app/data/portal-store.persistence.test.ts
git commit -m "feat(WB-004): hydrate workbook state from legacy weekly rows"
```

## Task 4: Add Rust Workbook Schema Types

**Issue:** `WB-001`

**Files:**
- Create: `rust/spreadsheet-calculation-core/src/workbook.rs`
- Modify: `rust/spreadsheet-calculation-core/src/lib.rs`

- [ ] **Step 1: Write the failing Rust test**

```rust
#[test]
fn workbook_sheet_constructor_starts_with_empty_cells() {
    let sheet = WorkbookSheet::new("weekly_expense", "weekly_expense");
    assert_eq!(sheet.id, "weekly_expense");
    assert!(sheet.cells.is_empty());
}
```

- [ ] **Step 2: Run only that test**

Run: `cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml workbook_sheet_constructor_starts_with_empty_cells`
Expected: FAIL because workbook types do not exist

- [ ] **Step 3: Add the schema types**

```rust
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookCell {
    pub value: String,
    #[serde(default)]
    pub formula: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSheet {
    pub id: String,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub cells: BTreeMap<String, WorkbookCell>,
}

impl WorkbookSheet {
    pub fn new(id: &str, kind: &str) -> Self {
        Self {
            id: id.to_string(),
            kind: kind.to_string(),
            name: kind.to_string(),
            cells: BTreeMap::new(),
        }
    }
}
```

- [ ] **Step 4: Export the schema from `lib.rs`**

```rust
pub mod workbook;
pub use workbook::{WorkbookCell, WorkbookSheet};
```

- [ ] **Step 5: Run the Rust test again**

Run: `cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml workbook_sheet_constructor_starts_with_empty_cells`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add rust/spreadsheet-calculation-core/src/workbook.rs rust/spreadsheet-calculation-core/src/lib.rs
git commit -m "feat(WB-001): add Rust workbook schema primitives"
```

## Task 5: Add Rust Policy Cells And Structural Validation

**Issue:** `WB-001`, `WB-002`

**Files:**
- Create: `rust/spreadsheet-calculation-core/src/workbook_mapping.rs`
- Modify: `rust/spreadsheet-calculation-core/src/workbook.rs`
- Modify: `rust/spreadsheet-calculation-core/src/lib.rs`

- [ ] **Step 1: Write the failing validation test**

```rust
#[test]
fn workbook_validation_blocks_missing_required_output_mapping() {
    let workbook = WorkbookDocument {
        project_id: "proj-1".into(),
        version: 1,
        sheets: vec![WorkbookSheet::new("weekly_expense", "weekly_expense")],
        policy_cells: vec![PolicyCellBinding::core("expense_amount_formula", "policy", "B2")],
        output_mappings: vec![],
    };

    let result = validate_workbook_structure(&workbook);
    assert!(result.is_err());
}
```

- [ ] **Step 2: Run the Rust test**

Run: `cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml workbook_validation_blocks_missing_required_output_mapping`
Expected: FAIL because `WorkbookDocument` and `validate_workbook_structure` do not exist yet

- [ ] **Step 3: Add `PolicyCellBinding`, `OutputMapping`, and `WorkbookDocument`**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyCellBinding {
    pub semantic_key: String,
    pub sheet_id: String,
    pub cell_ref: String,
    pub deletable: bool,
}

impl PolicyCellBinding {
    pub fn core(semantic_key: &str, sheet_id: &str, cell_ref: &str) -> Self {
        Self {
            semantic_key: semantic_key.to_string(),
            sheet_id: sheet_id.to_string(),
            cell_ref: cell_ref.to_string(),
            deletable: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputMapping {
    pub output_key: String,
    pub source_sheet_id: String,
    pub source_ref: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookDocument {
    pub project_id: String,
    pub version: i64,
    pub sheets: Vec<WorkbookSheet>,
    pub policy_cells: Vec<PolicyCellBinding>,
    pub output_mappings: Vec<OutputMapping>,
}
```

- [ ] **Step 4: Add structural validation**

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbookValidationError {
    pub code: String,
    pub message: String,
}

pub fn validate_workbook_structure(doc: &WorkbookDocument) -> Result<(), WorkbookValidationError> {
    let required_output_keys = [
        "official_weekly_rows.expense_amount",
        "official_weekly_rows.cashflow_category",
        "submission_readiness.required_evidence_count",
    ];

    for output_key in required_output_keys {
        let found = doc.output_mappings.iter().any(|mapping| mapping.output_key == output_key);
        if !found {
            return Err(WorkbookValidationError {
                code: "missing_required_output_mapping".into(),
                message: format!("missing required output mapping: {output_key}"),
            });
        }
    }

    if doc.policy_cells.iter().any(|cell| cell.deletable) {
        return Err(WorkbookValidationError {
            code: "core_policy_cell_mutation".into(),
            message: "core policy cells cannot be deletable".into(),
        });
    }

    Ok(())
}
```

- [ ] **Step 5: Run the validation test again**

Run: `cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml workbook_validation_blocks_missing_required_output_mapping`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add rust/spreadsheet-calculation-core/src/workbook.rs \
  rust/spreadsheet-calculation-core/src/workbook_mapping.rs \
  rust/spreadsheet-calculation-core/src/lib.rs
git commit -m "feat(WB-002): add Rust workbook structural validation"
```

## Task 6: Add TS/Rust Workbook Validation Contracts

**Issue:** `WB-002`, `WB-009`

**Files:**
- Create: `src/app/platform/workbook-kernel-contract.ts`
- Create: `src/app/platform/workbook-kernel-contract.test.ts`
- Create: `src/app/platform/workbook-output-mapping.ts`
- Create: `src/app/platform/workbook-output-mapping.test.ts`
- Create: `rust/spreadsheet-calculation-core/src/workbook_formula.rs`
- Modify: `rust/spreadsheet-calculation-core/src/lib.rs`

- [ ] **Step 1: Write the failing TS contract test**

```ts
import { describe, expect, it } from 'vitest';
import { serializeWorkbookForKernel, deserializeWorkbookValidation } from './workbook-kernel-contract';

describe('workbook-kernel-contract', () => {
  it('roundtrips workbook validation payloads', () => {
    const payload = serializeWorkbookForKernel({
      projectId: 'proj-1',
      version: 3,
      sheets: [],
      policyCells: [],
      outputMappings: [],
      lastAppliedMode: 'forward_only',
      updatedAt: '2026-04-15T00:00:00.000Z',
      updatedBy: 'pm@mysc.co.kr',
    } as never);

    expect(payload.projectId).toBe('proj-1');

    const result = deserializeWorkbookValidation({
      ok: false,
      errors: [{ code: 'ref_error', message: '#REF!' }],
    });

    expect(result.errors[0]?.code).toBe('ref_error');
  });
});
```

- [ ] **Step 2: Run the TS contract test**

Run: `npx vitest run src/app/platform/workbook-kernel-contract.test.ts`
Expected: FAIL because the contract file does not exist yet

- [ ] **Step 3: Add the contract helpers**

```ts
import type { ProjectWorkbook } from './project-workbook';

export interface WorkbookKernelValidationError {
  code: string;
  message: string;
}

export interface WorkbookKernelValidationResponse {
  ok: boolean;
  errors: WorkbookKernelValidationError[];
}

export function serializeWorkbookForKernel(workbook: ProjectWorkbook) {
  return {
    projectId: workbook.projectId,
    version: workbook.version,
    sheets: workbook.sheets,
    policyCells: workbook.policyCells,
    outputMappings: workbook.outputMappings,
    lastAppliedMode: workbook.lastAppliedMode,
    updatedAt: workbook.updatedAt,
    updatedBy: workbook.updatedBy,
  };
}

export function deserializeWorkbookValidation(payload: WorkbookKernelValidationResponse) {
  return {
    ok: Boolean(payload.ok),
    errors: Array.isArray(payload.errors) ? payload.errors : [],
  };
}
```

- [ ] **Step 4: Add the TS mapping validator**

```ts
const REQUIRED_OUTPUT_KEYS = [
  'official_weekly_rows.expense_amount',
  'official_weekly_rows.cashflow_category',
  'submission_readiness.required_evidence_count',
] as const;

export function validateWorkbookOutputMappings(workbook: ProjectWorkbook) {
  const missingKeys = REQUIRED_OUTPUT_KEYS.filter((requiredKey) => (
    !workbook.outputMappings.some((mapping) => mapping.outputKey === requiredKey)
  ));

  return {
    ok: missingKeys.length === 0,
    missingKeys,
  };
}
```

- [ ] **Step 5: Add the Rust runtime stub**

```rust
use crate::workbook::WorkbookDocument;
use crate::workbook_mapping::{validate_workbook_structure, WorkbookValidationError};

#[derive(Debug, Clone)]
pub struct WorkbookValidationResult {
    pub ok: bool,
    pub errors: Vec<WorkbookValidationError>,
}

pub fn validate_workbook_runtime(doc: &WorkbookDocument) -> WorkbookValidationResult {
    match validate_workbook_structure(doc) {
        Ok(()) => WorkbookValidationResult { ok: true, errors: vec![] },
        Err(err) => WorkbookValidationResult { ok: false, errors: vec![err] },
    }
}
```

- [ ] **Step 6: Run TS and Rust tests**

Run: `npx vitest run src/app/platform/workbook-kernel-contract.test.ts src/app/platform/workbook-output-mapping.test.ts`
Expected: PASS

Run: `cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/platform/workbook-kernel-contract.ts \
  src/app/platform/workbook-kernel-contract.test.ts \
  src/app/platform/workbook-output-mapping.ts \
  src/app/platform/workbook-output-mapping.test.ts \
  rust/spreadsheet-calculation-core/src/workbook_formula.rs \
  rust/spreadsheet-calculation-core/src/lib.rs
git commit -m "feat(WB-009): add workbook TS/Rust validation contracts"
```

## Task 7: Add BFF Workbook Load/Save And Version Conflict Responses

**Issue:** `WB-008`

**Files:**
- Create: `server/bff/project-workbooks.mjs`
- Create: `server/bff/project-workbooks.test.mjs`
- Create: `server/bff/routes/project-workbooks.mjs`
- Modify: `server/bff/app.mjs`
- Modify: `server/bff/schemas.mjs`
- Modify: `server/bff/firestore.mjs`
- Modify: `server/bff/app.integration.test.ts`

- [ ] **Step 1: Write the failing BFF service test**

```js
import { describe, expect, it } from 'vitest';
import { buildProjectWorkbookSaveResult } from './project-workbooks.mjs';

describe('buildProjectWorkbookSaveResult', () => {
  it('returns a version conflict when the client version is stale', async () => {
    const result = await buildProjectWorkbookSaveResult({
      currentVersion: 5,
      nextVersion: 4,
      workbook: { projectId: 'proj-1', sheets: [] },
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('version_conflict');
  });
});
```

- [ ] **Step 2: Run the BFF test**

Run: `npx vitest run server/bff/project-workbooks.test.mjs`
Expected: FAIL because the service file does not exist yet

- [ ] **Step 3: Add the service**

```js
export async function buildProjectWorkbookSaveResult(input) {
  if (input.nextVersion <= input.currentVersion) {
    return {
      ok: false,
      code: 'version_conflict',
      message: 'Workbook version mismatch',
      conflicts: [],
    };
  }

  return {
    ok: true,
    code: 'saved',
    workbook: {
      ...input.workbook,
      version: input.nextVersion,
    },
  };
}
```

- [ ] **Step 4: Add the route**

```js
import express from 'express';
import { buildProjectWorkbookSaveResult } from '../project-workbooks.mjs';

export function createProjectWorkbookRouter() {
  const router = express.Router();

  router.post('/:projectId/workbook/save', async (req, res) => {
    const result = await buildProjectWorkbookSaveResult({
      currentVersion: Number(req.body.currentVersion || 0),
      nextVersion: Number(req.body.nextVersion || 0),
      workbook: req.body.workbook,
    });

    if (!result.ok) return res.status(409).json(result);
    return res.status(200).json(result);
  });

  return router;
}
```

- [ ] **Step 5: Persist against explicit workbook paths**

Use a dedicated workbook document instead of overloading `expense_sheets`.

```js
const workbookRefPath = `orgs/${tenantId}/projects/${projectId}/workbooks/default`;
const outputRefPath = `orgs/${tenantId}/projects/${projectId}/workbook_outputs/current`;
```

- [ ] **Step 6: Wire the route**

```js
import { createProjectWorkbookRouter } from './routes/project-workbooks.mjs';
app.use('/api/v1/projects', createProjectWorkbookRouter());
```

- [ ] **Step 7: Add an integration assertion in `server/bff/app.integration.test.ts`**

```js
const response = await request(app)
  .post('/api/v1/projects/proj-1/workbook/save')
  .send({
    currentVersion: 1,
    nextVersion: 2,
    workbook: { projectId: 'proj-1', sheets: [], outputMappings: [] },
  });

expect(response.status).toBe(200);
expect(response.body.workbook.version).toBe(2);
```

- [ ] **Step 8: Run the BFF test again**

Run: `npx vitest run server/bff/project-workbooks.test.mjs server/bff/app.integration.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add server/bff/project-workbooks.mjs \
  server/bff/project-workbooks.test.mjs \
  server/bff/routes/project-workbooks.mjs \
  server/bff/app.mjs \
  server/bff/schemas.mjs \
  server/bff/firestore.mjs \
  server/bff/app.integration.test.ts
git commit -m "feat(WB-008): add workbook load/save and version conflict responses"
```

## Task 8: Add The React Workbook Shell Without Replacing Weekly Expense Yet

**Issue:** `WB-004`

**Files:**
- Create: `src/app/components/workbook/ProjectWorkbookShell.tsx`
- Create: `src/app/components/workbook/WorkbookGrid.tsx`
- Create: `src/app/components/workbook/WorkbookFormulaBar.tsx`
- Create: `src/app/components/workbook/WorkbookPolicyPanel.tsx`
- Create: `src/app/components/workbook/WorkbookOutputMappingPanel.tsx`
- Create: `src/app/components/workbook/ProjectWorkbookShell.test.tsx`

- [ ] **Step 1: Write the failing shell test**

```tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectWorkbookShell } from './ProjectWorkbookShell';
import { createDefaultProjectWorkbook } from '../../platform/project-workbook';

describe('ProjectWorkbookShell', () => {
  it('renders workbook tabs and a policy affordance', () => {
    const workbook = createDefaultProjectWorkbook('proj-1', 'pm@mysc.co.kr');
    const html = renderToStaticMarkup(
      <ProjectWorkbookShell workbook={workbook} onWorkbookChange={() => undefined} />,
    );

    expect(html).toContain('사업비 입력');
    expect(html).toContain('정책');
  });
});
```

- [ ] **Step 2: Run the shell test**

Run: `npx vitest run src/app/components/workbook/ProjectWorkbookShell.test.tsx`
Expected: FAIL because workbook components do not exist

- [ ] **Step 3: Add the grid and formula bar stubs**

```tsx
import type { WorkbookSheet } from '../../platform/project-workbook';

export function WorkbookGrid(props: { sheet?: WorkbookSheet }) {
  return <div aria-label="Workbook grid">active-sheet:{props.sheet?.id || 'none'}</div>;
}

export function WorkbookFormulaBar(props: { value: string }) {
  return (
    <label>
      수식
      <input defaultValue={props.value} name="formulaBar" />
    </label>
  );
}
```

- [ ] **Step 4: Add the shell**

```tsx
import { useState } from 'react';
import type { ProjectWorkbook } from '../../platform/project-workbook';
import { WorkbookGrid } from './WorkbookGrid';
import { WorkbookFormulaBar } from './WorkbookFormulaBar';

export function ProjectWorkbookShell(props: {
  workbook: ProjectWorkbook;
  onWorkbookChange: (workbook: ProjectWorkbook) => void;
}) {
  const [activeSheetId, setActiveSheetId] = useState(props.workbook.sheets[0]?.id || 'weekly_expense');
  const activeSheet = props.workbook.sheets.find((sheet) => sheet.id === activeSheetId) || props.workbook.sheets[0];

  return (
    <section>
      <div>
        {props.workbook.sheets.map((sheet) => (
          <button key={sheet.id} onClick={() => setActiveSheetId(sheet.id)} type="button">
            {sheet.name}
          </button>
        ))}
        <button type="button">정책</button>
      </div>
      <WorkbookFormulaBar value={activeSheet?.cells['A1']?.formula || ''} />
      <WorkbookGrid sheet={activeSheet} />
    </section>
  );
}
```

- [ ] **Step 5: Run the shell test again**

Run: `npx vitest run src/app/components/workbook/ProjectWorkbookShell.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/components/workbook/ProjectWorkbookShell.tsx \
  src/app/components/workbook/WorkbookGrid.tsx \
  src/app/components/workbook/WorkbookFormulaBar.tsx \
  src/app/components/workbook/WorkbookPolicyPanel.tsx \
  src/app/components/workbook/WorkbookOutputMappingPanel.tsx \
  src/app/components/workbook/ProjectWorkbookShell.test.tsx
git commit -m "feat(WB-004): add workbook UI shell primitives"
```

## Task 9: Mount The Workbook Shell Inside `PortalWeeklyExpensePage`

**Issue:** `WB-003`, `WB-004`

**Files:**
- Modify: `src/app/components/portal/PortalWeeklyExpensePage.tsx`
- Modify: `src/app/data/portal-store.tsx`
- Modify: `src/app/platform/bank-intake-surface.ts`
- Modify: `src/app/config/feature-flags.ts`
- Modify: `src/app/config/feature-flags.test.ts`
- Modify: `src/app/components/portal/PortalWeeklyExpensePage.flow-layout.test.ts`

- [ ] **Step 1: Add a failing weekly expense migration smoke test**

```ts
import { describe, expect, it } from 'vitest';
import { buildWorkbookFromLegacyExpenseSheet } from '../../platform/project-workbook-legacy-adapter';
import { groupExpenseIntakeItemsForSurface } from '../../platform/bank-intake-surface';

describe('weekly expense workbook migration', () => {
  it('can hydrate workbook rows while keeping intake grouping intact', () => {
    const workbook = buildWorkbookFromLegacyExpenseSheet({
      projectId: 'proj-1',
      actor: 'pm@mysc.co.kr',
      expenseSheetRows: [{ tempId: 'imp-1', cells: ['2026-04-01', '거래처', '10000'] }],
    });

    const grouped = groupExpenseIntakeItemsForSurface([
      { matchState: 'PENDING_INPUT', projectionStatus: 'NOT_PROJECTED', evidenceStatus: 'MISSING', manualFields: {} },
    ]);

    expect(workbook.sheets.find((sheet) => sheet.id === 'weekly_expense')).toBeTruthy();
    expect(grouped.needsClassification).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the smoke test**

Run: `npx vitest run src/app/platform/project-workbook-legacy-adapter.test.ts src/app/platform/bank-intake-surface.test.ts`
Expected: PASS for adapter, existing surface tests remain green before UI mount

- [ ] **Step 3: Mount the workbook shell behind hydrated state**

```tsx
{featureFlags.weeklyExpenseWorkbookEnabled && projectWorkbook ? (
  <ProjectWorkbookShell
    workbook={projectWorkbook}
    onWorkbookChange={updateProjectWorkbook}
  />
) : (
  <SettlementLedgerPage
    rows={expenseSheetRows || []}
    onRowsChange={(rows) => saveExpenseSheetRows(rows)}
  />
)}
```

- [ ] **Step 4: Add the feature flag before switching the visible editor**

```ts
// feature-flags.ts
export interface FeatureFlags {
  weeklyExpenseWorkbookEnabled: boolean;
}

weeklyExpenseWorkbookEnabled: parseFeatureFlag(env.VITE_WEEKLY_EXPENSE_WORKBOOK_ENABLED, false),
```

```ts
// Add this assertion to the existing feature-flags.test.ts suite
expect(readFeatureFlags({ VITE_WEEKLY_EXPENSE_WORKBOOK_ENABLED: 'true' }).weeklyExpenseWorkbookEnabled).toBe(true);
```

- [ ] **Step 5: Keep existing triage/evidence UI around the shell**

Expected result:

- bank triage wizard button still appears
- intake queue summary still appears
- evidence CTA and drive provisioning still appear
- no user-visible regression in navigation guards

- [ ] **Step 6: Run focused weekly expense tests**

Run: `npx vitest run src/app/config/feature-flags.test.ts src/app/components/portal/PortalWeeklyExpensePage.flow-layout.test.ts src/app/platform/weekly-expense-save-policy.test.ts src/app/platform/portal-happy-path.test.ts src/app/platform/bank-intake-surface.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/components/portal/PortalWeeklyExpensePage.tsx \
  src/app/data/portal-store.tsx \
  src/app/platform/bank-intake-surface.ts \
  src/app/config/feature-flags.ts \
  src/app/config/feature-flags.test.ts \
  src/app/components/portal/PortalWeeklyExpensePage.flow-layout.test.ts
git commit -m "feat(WB-003): mount workbook shell inside weekly expense flow"
```

## Task 10: Add The Mapping Panel And Block Save On Broken Official Outputs

**Issue:** `WB-002`, `WB-005`

**Files:**
- Modify: `src/app/components/workbook/WorkbookOutputMappingPanel.tsx`
- Modify: `src/app/components/workbook/ProjectWorkbookShell.tsx`
- Modify: `src/app/platform/workbook-output-mapping.ts`
- Modify: `src/app/lib/platform-bff-client.ts`

- [ ] **Step 1: Write the failing mapping validation test**

```ts
import { describe, expect, it } from 'vitest';
import { createDefaultProjectWorkbook } from './project-workbook';
import { validateWorkbookOutputMappings } from './workbook-output-mapping';

describe('validateWorkbookOutputMappings', () => {
  it('reports required output mappings as missing by default', () => {
    const workbook = createDefaultProjectWorkbook('proj-1', 'pm@mysc.co.kr');
    const result = validateWorkbookOutputMappings(workbook);

    expect(result.ok).toBe(false);
    expect(result.missingKeys).toContain('official_weekly_rows.expense_amount');
  });
});
```

- [ ] **Step 2: Run the mapping test**

Run: `npx vitest run src/app/platform/workbook-output-mapping.test.ts`
Expected: PASS if already added; use it as a guard before wiring save

- [ ] **Step 3: Add a visible mapping panel**

```tsx
export function WorkbookOutputMappingPanel(props: {
  missingKeys: string[];
}) {
  return (
    <aside aria-label="Workbook output mapping panel">
      {props.missingKeys.length > 0 ? (
        <ul>{props.missingKeys.map((key) => <li key={key}>{key}</li>)}</ul>
      ) : (
        <p>공식 출력 매핑이 모두 연결되었습니다.</p>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Block save in the shell when mappings are broken**

```tsx
const mappingValidation = validateWorkbookOutputMappings(props.workbook);
const canSave = mappingValidation.ok;
```

Expected UI:

- save button disabled when mappings are broken
- missing output keys visible in the panel

- [ ] **Step 5: Run focused workbook tests**

Run: `npx vitest run src/app/platform/workbook-output-mapping.test.ts src/app/components/workbook/ProjectWorkbookShell.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/components/workbook/WorkbookOutputMappingPanel.tsx \
  src/app/components/workbook/ProjectWorkbookShell.tsx \
  src/app/platform/workbook-output-mapping.ts \
  src/app/lib/platform-bff-client.ts
git commit -m "feat(WB-002): block workbook save on broken official outputs"
```

## Task 11: Fan Workbook Official Outputs Out To Cashflow / Submission / Admin

**Issue:** `WB-005`

**Files:**
- Modify: `src/app/platform/workbook-output-mapping.ts`
- Modify: `src/app/platform/cashflow-sheet.ts`
- Modify: `src/app/platform/settlement-calculation-kernel.ts`
- Modify: `server/bff/project-workbooks.mjs`
- Modify: `src/app/lib/platform-bff-client.ts`

- [ ] **Step 1: Write the failing output fan-out test**

```ts
import { describe, expect, it } from 'vitest';
import { projectWorkbookOfficialOutputs } from './workbook-output-mapping';

describe('projectWorkbookOfficialOutputs', () => {
  it('builds downstream payload placeholders from workbook mappings', () => {
    const outputs = projectWorkbookOfficialOutputs({
      workbook: {
        projectId: 'proj-1',
        sheets: [],
        outputMappings: [
          { outputKey: 'official_weekly_rows.expense_amount', sourceSheetId: 'weekly_expense', sourceRef: 'C2', kind: 'cell' },
          { outputKey: 'official_weekly_rows.cashflow_category', sourceSheetId: 'weekly_expense', sourceRef: 'D2', kind: 'cell' },
          { outputKey: 'submission_readiness.required_evidence_count', sourceSheetId: 'summary', sourceRef: 'B2', kind: 'cell' },
        ],
      },
    } as never);

    expect(outputs.cashflowRows).toBeDefined();
    expect(outputs.submissionReadiness).toBeDefined();
    expect(outputs.adminSnapshot).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the output fan-out test**

Run: `npx vitest run src/app/platform/workbook-output-mapping.test.ts`
Expected: FAIL if helper not implemented yet

- [ ] **Step 3: Implement the fan-out helper**

```ts
export function projectWorkbookOfficialOutputs(input: {
  workbook: Pick<ProjectWorkbook, 'projectId' | 'sheets' | 'outputMappings'>;
}) {
  return {
    cashflowRows: [],
    submissionReadiness: {
      projectId: input.workbook.projectId,
      requiredEvidenceCount: 0,
    },
    adminSnapshot: {
      projectId: input.workbook.projectId,
      status: 'healthy',
    },
  };
}
```

- [ ] **Step 4: Persist official outputs from the BFF save path**

```js
const officialOutputs = input.officialOutputs || {
  cashflowRows: [],
  submissionReadiness: { projectId: input.workbook.projectId, requiredEvidenceCount: 0 },
  adminSnapshot: { projectId: input.workbook.projectId, status: 'healthy' },
};
```

- [ ] **Step 5: Thread fan-out through the existing settlement/cashflow helpers instead of bypassing them**

Required behavior:

- workbook `official_weekly_rows.*` feeds the weekly row projection shape the page already expects
- workbook cashflow outputs map onto existing `CashflowSheetLineId` lines, not an ad-hoc enum
- workbook submission outputs reuse existing weekly submission save/update calls where possible

- [ ] **Step 6: Run fan-out tests**

Run: `npx vitest run src/app/platform/workbook-output-mapping.test.ts src/app/platform/cashflow-sheet.test.ts src/app/platform/settlement-calculation-kernel.test.ts server/bff/project-workbooks.test.mjs`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/platform/workbook-output-mapping.ts \
  src/app/platform/cashflow-sheet.ts \
  src/app/platform/settlement-calculation-kernel.ts \
  server/bff/project-workbooks.mjs \
  src/app/lib/platform-bff-client.ts
git commit -m "feat(WB-005): fan workbook outputs into downstream operational states"
```

## Task 12: Add Conflict Resolution And Replay Mode Helpers

**Issue:** `WB-006`, `WB-008`

**Files:**
- Create: `src/app/platform/workbook-conflicts.ts`
- Create: `src/app/platform/workbook-conflicts.test.ts`
- Create: `src/app/platform/workbook-replay.ts`
- Create: `src/app/platform/workbook-replay.test.ts`
- Create: `src/app/components/workbook/WorkbookConflictDialog.tsx`
- Create: `rust/spreadsheet-calculation-core/src/workbook_replay.rs`
- Modify: `rust/spreadsheet-calculation-core/src/lib.rs`

- [ ] **Step 1: Write the failing conflict diff test**

```ts
import { describe, expect, it } from 'vitest';
import { diffWorkbookCells } from './workbook-conflicts';

describe('diffWorkbookCells', () => {
  it('returns local/server diffs at the cell level', () => {
    const result = diffWorkbookCells({
      local: { weekly_expense: { C2: { value: '10000' } } },
      server: { weekly_expense: { C2: { value: '12000' } } },
    });

    expect(result).toEqual([
      { sheetId: 'weekly_expense', cellRef: 'C2', localValue: '10000', serverValue: '12000' },
    ]);
  });
});
```

- [ ] **Step 2: Run the conflict test**

Run: `npx vitest run src/app/platform/workbook-conflicts.test.ts`
Expected: FAIL because helper does not exist

- [ ] **Step 3: Add the conflict helper**

```ts
export function diffWorkbookCells(input: {
  local: Record<string, Record<string, { value: string }>>;
  server: Record<string, Record<string, { value: string }>>;
}) {
  const diffs = [];
  for (const [sheetId, localCells] of Object.entries(input.local)) {
    const serverCells = input.server[sheetId] || {};
    for (const [cellRef, localCell] of Object.entries(localCells)) {
      const serverCell = serverCells[cellRef];
      if (!serverCell || serverCell.value !== localCell.value) {
        diffs.push({
          sheetId,
          cellRef,
          localValue: localCell.value,
          serverValue: serverCell?.value || '',
        });
      }
    }
  }
  return diffs;
}
```

- [ ] **Step 4: Add the replay helper in TS and Rust**

```ts
export function resolveWorkbookReplayMode(input: {
  requestedMode: 'forward_only' | 'recalc_all';
  hasHistoricalOutputs: boolean;
}) {
  return {
    mode: input.requestedMode,
    requiresAuditSnapshot: input.requestedMode === 'recalc_all' && input.hasHistoricalOutputs,
  };
}
```

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbookReplayDecision {
    pub mode: String,
    pub requires_audit_snapshot: bool,
}

pub fn resolve_workbook_replay_mode(mode: &str, has_historical_outputs: bool) -> WorkbookReplayDecision {
    WorkbookReplayDecision {
        mode: mode.to_string(),
        requires_audit_snapshot: mode == "recalc_all" && has_historical_outputs,
    }
}
```

- [ ] **Step 5: Add the conflict dialog shell**

```tsx
export function WorkbookConflictDialog(props: {
  open: boolean;
  conflicts: Array<{ sheetId: string; cellRef: string; localValue: string; serverValue: string }>;
}) {
  if (!props.open) return null;
  return (
    <div role="dialog" aria-label="Workbook conflicts">
      {props.conflicts.map((conflict) => (
        <div key={`${conflict.sheetId}:${conflict.cellRef}`}>
          <strong>{conflict.sheetId} / {conflict.cellRef}</strong>
          <div>내 값: {conflict.localValue}</div>
          <div>서버 값: {conflict.serverValue}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Run conflict and replay tests**

Run: `npx vitest run src/app/platform/workbook-conflicts.test.ts src/app/platform/workbook-replay.test.ts`
Expected: PASS

Run: `cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml`
Expected: PASS with replay helper compiled

- [ ] **Step 7: Commit**

```bash
git add src/app/platform/workbook-conflicts.ts \
  src/app/platform/workbook-conflicts.test.ts \
  src/app/platform/workbook-replay.ts \
  src/app/platform/workbook-replay.test.ts \
  src/app/components/workbook/WorkbookConflictDialog.tsx \
  rust/spreadsheet-calculation-core/src/workbook_replay.rs \
  rust/spreadsheet-calculation-core/src/lib.rs
git commit -m "feat(WB-006): add workbook replay and conflict helpers"
```

## Task 13: Lock The Migration With Documentation, Patch Notes, And Full Verification

**Issue:** `WB-009`

**Files:**
- Modify: `README.md`
- Modify: `docs/wiki/patch-notes/pages/portal-weekly-expense.md`
- Modify: `docs/wiki/patch-notes/log.md`

- [ ] **Step 1: Update README with the workbook model**

```md
## Embedded Workbook Engine

- `사업비 입력(주간)` is the first authoritative workbook surface.
- Bank statement upload and triage remain the ingress path.
- Workbook saves are blocked when required official mappings break.
- Cashflow, submission, and admin monitoring derive from workbook official outputs.
```

- [ ] **Step 2: Update weekly expense patch notes**

```md
## Recent Changes
- [2026-04-15] 사업비 입력(주간)을 프로젝트별 authoritative workbook surface로 승격하기 위한 shell, 정책 셀, 출력 매핑, save validation 경계를 도입했다.
```

- [ ] **Step 3: Append to patch notes log**

```md
## [2026-04-15] patch-note | weekly-expense-workbook | authoritative workbook surface
- pages: [portal-weekly-expense](./pages/portal-weekly-expense.md)
- summary: 기존 통장내역 ingress를 유지한 채 사업비 입력(주간)을 workbook 중심 surface로 옮기고, 공식 출력 매핑을 통해 cashflow / submission / admin downstream을 다시 연결했다.
```

- [ ] **Step 4: Run the final focused verification set**

Run: `npx vitest run src/app/platform/project-workbook.test.ts src/app/platform/project-workbook-legacy-adapter.test.ts src/app/platform/workbook-output-mapping.test.ts src/app/platform/workbook-conflicts.test.ts src/app/data/portal-store.integration.test.ts src/app/data/portal-store.persistence.test.ts src/app/components/portal/PortalWeeklyExpensePage.flow-layout.test.ts server/bff/project-workbooks.test.mjs server/bff/app.integration.test.ts`
Expected: PASS

Run: `npm run rust:settlement:test`
Expected: PASS

Run: `npm run bff:test:integration`
Expected: PASS

Run: `npx playwright test tests/e2e/bank-upload-triage-wizard.spec.ts tests/e2e/settlement-product-completeness.spec.ts --config playwright.harness.config.mjs`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md \
  docs/wiki/patch-notes/pages/portal-weekly-expense.md \
  docs/wiki/patch-notes/log.md
git commit -m "docs(WB-009): document workbook rollout and verification"
```

## Review Gates

Pause for review after these tasks:

- After Task 3: TS workbook model + store hydration entry point
- After Task 7: BFF load/save and conflict response
- After Task 9: workbook shell mounted into weekly expense
- After Task 11: official output fan-out
- After Task 12: conflict + replay helpers

## Stop Conditions

Stop and re-plan if any of these happen:

- Weekly expense ingress path requires deleting the bank triage wizard
- Core policy cells need literal insertion/deletion to support the design
- Cashflow/admin output fan-out cannot be expressed as workbook mappings
- Rust runtime and TS runtime diverge in a way that cannot be fixture-tested

## Final Checklist

- [ ] `WB-*` issue references are used in commits
- [ ] Policy record file exists and is linked from work
- [ ] Weekly expense still opens and shows bank-intake context
- [ ] Workbook save path can represent broken mappings
- [ ] Official output fan-out exists
- [ ] Replay mode helper exists
- [ ] Conflict diff helper exists
- [ ] Final docs and patch notes are updated
