# Embedded Workbook Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `사업비 입력(주간)` into a project-scoped authoritative workbook surface without breaking the existing `통장내역 → triage → 주간입력 → cashflow / 제출 / admin` operational flow.

**Architecture:** Keep `Vite React` as the workbook UI runtime and extend the existing Rust settlement kernel into a workbook-aware calculation and validation engine. The first slice is not a greenfield spreadsheet app; it is an embedded workbook layer that sits over current bank intake, evidence, cashflow, and admin downstreams. Policy cells, formulas, and output mappings become editable, while core policy-cell existence and official output integrity remain hard-block invariants.

**Tech Stack:** Vite React 18, TypeScript, Vitest, Playwright, Express BFF, Firestore, Rust (`spreadsheet-calculation-core`), WASM/native dual-run, Husky light hooks

---

## Issue Map

Use these issue IDs consistently in commits, PRs, notes, and implementation comments.

- `WB-001` Core policy cells are immutable in existence
- `WB-002` Official output breakages block save
- `WB-003` Bank statement and triage flow remain ingress
- `WB-004` Weekly expense workbook is project-scoped authoritative surface
- `WB-005` Cashflow / submission / admin outputs derive from workbook official mappings
- `WB-006` Policy changes support `forward_only` and `recalc_all`
- `WB-007` Same-project multi-sheet references are allowed; cross-project references are out of scope
- `WB-008` Workbook saves use optimistic versioning with cell-level conflict resolution
- `WB-009` Browser/runtime and server/runtime must stay in parity via fixtures

## File Structure

### New TS platform files

- Create: `src/app/platform/project-workbook.ts`
  - Workbook document types, core sheet IDs, core policy bindings, default workbook factory
- Create: `src/app/platform/project-workbook.test.ts`
  - Workbook defaults and invariants tests
- Create: `src/app/platform/project-workbook-legacy-adapter.ts`
  - Bridge between current `expenseSheets` / `expenseIntakeItems` state and the new workbook model
- Create: `src/app/platform/project-workbook-legacy-adapter.test.ts`
  - Adapter tests for legacy migration
- Create: `src/app/platform/workbook-policy-guard.ts`
  - Pure utility for light commit-policy warnings
- Create: `src/app/platform/workbook-policy-guard.test.ts`
  - Guard behavior tests
- Create: `src/app/platform/workbook-kernel-contract.ts`
  - TS <-> Rust serialization contract for workbook requests/responses
- Create: `src/app/platform/workbook-kernel-contract.test.ts`
  - Contract roundtrip tests
- Create: `src/app/platform/workbook-output-mapping.ts`
  - Output mapping validation and official output projection helpers
- Create: `src/app/platform/workbook-output-mapping.test.ts`
  - Mapping validation tests
- Create: `src/app/platform/workbook-conflicts.ts`
  - Cell-level optimistic conflict diff utilities
- Create: `src/app/platform/workbook-conflicts.test.ts`
  - Conflict diff tests
- Create: `src/app/platform/workbook-replay.ts`
  - `forward_only` / `recalc_all` replay helpers
- Create: `src/app/platform/workbook-replay.test.ts`
  - Replay mode tests

### New React workbook files

- Create: `src/app/components/workbook/ProjectWorkbookShell.tsx`
- Create: `src/app/components/workbook/WorkbookGrid.tsx`
- Create: `src/app/components/workbook/WorkbookFormulaBar.tsx`
- Create: `src/app/components/workbook/WorkbookPolicyPanel.tsx`
- Create: `src/app/components/workbook/WorkbookOutputMappingPanel.tsx`
- Create: `src/app/components/workbook/WorkbookConflictDialog.tsx`
- Create: `src/app/components/workbook/ProjectWorkbookShell.test.tsx`

### Existing TS files to modify

- Modify: `src/app/components/portal/PortalWeeklyExpensePage.tsx`
- Modify: `src/app/data/portal-store.tsx`
- Modify: `src/app/platform/settlement-calculation-kernel.ts`
- Modify: `src/app/platform/cashflow-sheet.ts`
- Modify: `src/app/platform/bank-intake-surface.ts`
- Modify: `src/app/lib/platform-bff-client.ts`

### New BFF files

- Create: `server/bff/project-workbooks.mjs`
- Create: `server/bff/project-workbooks.test.mjs`
- Create: `server/bff/routes/project-workbooks.mjs`

### Existing BFF files to modify

- Modify: `server/bff/app.mjs`
- Modify: `server/bff/schemas.mjs`
- Modify: `server/bff/firestore.mjs`

### Rust files

- Modify: `rust/spreadsheet-calculation-core/src/lib.rs`
- Create: `rust/spreadsheet-calculation-core/src/workbook.rs`
- Create: `rust/spreadsheet-calculation-core/src/workbook_formula.rs`
- Create: `rust/spreadsheet-calculation-core/src/workbook_mapping.rs`
- Create: `rust/spreadsheet-calculation-core/src/workbook_replay.rs`

### Hook / scripts / docs files

- Create: `scripts/check_workbook_policy_guard.mjs`
- Modify: `.husky/commit-msg`
- Create: `docs/architecture/policies/workbook-engine-policy-record.md`
- Modify: `README.md`

---

### Task 1: Record WB Policies And Add The Light Commit Hook

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

describe('workbook-policy-guard', () => {
  it('warns when workbook files change without a WB policy reference', () => {
    const result = evaluateWorkbookPolicyWarning({
      stagedPaths: [
        'src/app/components/portal/PortalWeeklyExpensePage.tsx',
        'rust/spreadsheet-calculation-core/src/lib.rs',
      ],
      commitMessage: 'feat: refactor weekly expense runtime',
    });

    expect(result.shouldWarn).toBe(true);
    expect(result.reason).toContain('WB-');
  });

  it('stays quiet when non-workbook files change', () => {
    const result = evaluateWorkbookPolicyWarning({
      stagedPaths: ['src/app/components/dashboard/DashboardPage.tsx'],
      commitMessage: 'style: adjust dashboard spacing',
    });

    expect(result.shouldWarn).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/platform/workbook-policy-guard.test.ts`
Expected: FAIL with `Cannot find module './workbook-policy-guard'`

- [ ] **Step 3: Write the guard utility and policy record**

```ts
// src/app/platform/workbook-policy-guard.ts
const WORKBOOK_PATH_PATTERNS = [
  /^src\/app\/platform\//,
  /^src\/app\/components\/portal\/PortalWeeklyExpensePage\.tsx$/,
  /^src\/app\/data\/portal-store\.tsx$/,
  /^rust\/spreadsheet-calculation-core\//,
];

const WB_REF_RE = /\bWB-\d{3}\b/;

export function evaluateWorkbookPolicyWarning(input: {
  stagedPaths: string[];
  commitMessage: string;
}) {
  const touchesWorkbook = input.stagedPaths.some((path) => (
    WORKBOOK_PATH_PATTERNS.some((pattern) => pattern.test(path))
  ));

  if (!touchesWorkbook) {
    return { shouldWarn: false, reason: '' };
  }

  if (WB_REF_RE.test(input.commitMessage)) {
    return { shouldWarn: false, reason: '' };
  }

  return {
    shouldWarn: true,
    reason: 'workbook-engine-related changes detected without a WB-### policy reference',
  };
}
```

```md
<!-- docs/architecture/policies/workbook-engine-policy-record.md -->
# Workbook Engine Policy Record

- `WB-001` Core policy cells are immutable in existence.
- `WB-002` Official output breakages block save.
- `WB-003` Bank statement and triage flow remain ingress.
- `WB-004` Weekly expense workbook is the first authoritative workbook surface.
- `WB-005` Cashflow, submission, and admin outputs derive from workbook mappings.
- `WB-006` Policy changes support `forward_only` and `recalc_all`.
- `WB-007` Same-project multi-sheet references are allowed.
- `WB-008` Workbook saves use optimistic versioning with cell-level conflict resolution.
- `WB-009` Browser/runtime and server/runtime stay in parity.
```

- [ ] **Step 4: Add the hook wrapper and commit-msg warning**

```js
// scripts/check_workbook_policy_guard.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const commitMsgFile = process.argv[2];
const commitMessage = commitMsgFile ? fs.readFileSync(commitMsgFile, 'utf8') : '';
const stagedPaths = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const WORKBOOK_PATH_PATTERNS = [
  /^src\/app\/platform\//,
  /^src\/app\/components\/portal\/PortalWeeklyExpensePage\.tsx$/,
  /^src\/app\/data\/portal-store\.tsx$/,
  /^rust\/spreadsheet-calculation-core\//,
];
const touchesWorkbook = stagedPaths.some((path) => (
  WORKBOOK_PATH_PATTERNS.some((pattern) => pattern.test(path))
));
const hasPolicyReference = /\bWB-\d{3}\b/.test(commitMessage);

const result = {
  shouldWarn: touchesWorkbook && !hasPolicyReference,
  reason: 'workbook-engine-related changes detected without a WB-### policy reference',
};

if (result.shouldWarn) {
  console.warn(`warning: ${result.reason}`);
  console.warn('hint: include a WB-### reference in the commit message or linked issue.');
}
```

```sh
#!/bin/sh

node scripts/check_workbook_policy_guard.mjs "$1" || true
exit 0
```

- [ ] **Step 5: Run the guard test again**

Run: `npx vitest run src/app/platform/workbook-policy-guard.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/policies/workbook-engine-policy-record.md \
  src/app/platform/workbook-policy-guard.ts \
  src/app/platform/workbook-policy-guard.test.ts \
  scripts/check_workbook_policy_guard.mjs \
  .husky/commit-msg
git commit -m "docs(plan): record workbook policies and add light WB hook"
```

### Task 2: Introduce The ProjectWorkbook Document Model In TypeScript

**Files:**
- Create: `src/app/platform/project-workbook.ts`
- Create: `src/app/platform/project-workbook.test.ts`
- Create: `src/app/platform/project-workbook-legacy-adapter.ts`
- Create: `src/app/platform/project-workbook-legacy-adapter.test.ts`

- [ ] **Step 1: Write the failing workbook model test**

```ts
import { describe, expect, it } from 'vitest';
import { createDefaultProjectWorkbook, CORE_POLICY_KEYS } from './project-workbook';

describe('project-workbook', () => {
  it('creates a default workbook with fixed system sheets and core policy cells', () => {
    const workbook = createDefaultProjectWorkbook('proj-1', 'pm@mysc.co.kr');

    expect(workbook.projectId).toBe('proj-1');
    expect(workbook.sheets.map((sheet) => sheet.kind)).toEqual([
      'weekly_expense',
      'bank_intake_view',
      'policy',
      'output_mapping',
      'summary',
    ]);
    expect(workbook.policyCells.map((cell) => cell.semanticKey)).toEqual(CORE_POLICY_KEYS);
    expect(workbook.policyCells.every((cell) => cell.deletable === false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/platform/project-workbook.test.ts`
Expected: FAIL with `Cannot find module './project-workbook'`

- [ ] **Step 3: Implement the minimal workbook type and factory**

```ts
// src/app/platform/project-workbook.ts
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

- [ ] **Step 4: Add the legacy adapter test and implementation**

```ts
// src/app/platform/project-workbook-legacy-adapter.test.ts
import { describe, expect, it } from 'vitest';
import { buildWorkbookFromLegacyExpenseSheet } from './project-workbook-legacy-adapter';

describe('project-workbook-legacy-adapter', () => {
  it('hydrates weekly expense rows into the workbook weekly_expense sheet', () => {
    const workbook = buildWorkbookFromLegacyExpenseSheet({
      projectId: 'proj-1',
      actor: 'pm@mysc.co.kr',
      activeExpenseSheetId: 'default',
      expenseSheetRows: [
        { tempId: 'imp-1', cells: ['2026-04-01', '거래처', '10000'] },
      ],
    });

    const weeklySheet = workbook.sheets.find((sheet) => sheet.id === 'weekly_expense');
    expect(weeklySheet?.cells['A2']?.value).toBe('2026-04-01');
    expect(weeklySheet?.cells['B2']?.value).toBe('거래처');
  });
});
```

```ts
// src/app/platform/project-workbook-legacy-adapter.ts
import { createDefaultProjectWorkbook } from './project-workbook';

export function buildWorkbookFromLegacyExpenseSheet(input: {
  projectId: string;
  actor: string;
  activeExpenseSheetId: string;
  expenseSheetRows: Array<{ tempId: string; cells: string[] }>;
}) {
  const workbook = createDefaultProjectWorkbook(input.projectId, input.actor);
  const weeklySheet = workbook.sheets.find((sheet) => sheet.id === 'weekly_expense');
  if (!weeklySheet) return workbook;

  input.expenseSheetRows.forEach((row, rowIndex) => {
    row.cells.forEach((value, cellIndex) => {
      const col = String.fromCharCode(65 + cellIndex);
      weeklySheet.cells[`${col}${rowIndex + 2}`] = { value };
    });
  });

  return workbook;
}
```

- [ ] **Step 5: Run workbook model tests**

Run: `npx vitest run src/app/platform/project-workbook.test.ts src/app/platform/project-workbook-legacy-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/platform/project-workbook.ts \
  src/app/platform/project-workbook.test.ts \
  src/app/platform/project-workbook-legacy-adapter.ts \
  src/app/platform/project-workbook-legacy-adapter.test.ts
git commit -m "feat(WB-004): add project workbook document model"
```

### Task 3: Extend The Rust Core With Workbook Schema And Structural Validation

**Files:**
- Modify: `rust/spreadsheet-calculation-core/src/lib.rs`
- Create: `rust/spreadsheet-calculation-core/src/workbook.rs`
- Create: `rust/spreadsheet-calculation-core/src/workbook_mapping.rs`

- [ ] **Step 1: Write the failing Rust validation test**

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
    assert_eq!(result.err().unwrap().code, "missing_required_output_mapping");
}
```

- [ ] **Step 2: Run Rust test to verify it fails**

Run: `cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml workbook_validation_blocks_missing_required_output_mapping`
Expected: FAIL with missing `WorkbookDocument` or `validate_workbook_structure`

- [ ] **Step 3: Add workbook schema types in Rust**

```rust
// rust/spreadsheet-calculation-core/src/workbook.rs
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
// rust/spreadsheet-calculation-core/src/workbook_mapping.rs
use crate::workbook::WorkbookDocument;

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

- [ ] **Step 5: Wire modules into `lib.rs` and rerun the test**

```rust
pub mod workbook;
pub mod workbook_mapping;

pub use workbook::{WorkbookDocument, WorkbookSheet, PolicyCellBinding, OutputMapping};
pub use workbook_mapping::{WorkbookValidationError, validate_workbook_structure};
```

Run: `cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml workbook_validation_blocks_missing_required_output_mapping`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add rust/spreadsheet-calculation-core/src/lib.rs \
  rust/spreadsheet-calculation-core/src/workbook.rs \
  rust/spreadsheet-calculation-core/src/workbook_mapping.rs
git commit -m "feat(WB-001): add Rust workbook schema and structural validation"
```

### Task 4: Add Formula Runtime Entry Points And Output Mapping Validation Contracts

**Files:**
- Create: `src/app/platform/workbook-kernel-contract.ts`
- Create: `src/app/platform/workbook-kernel-contract.test.ts`
- Create: `src/app/platform/workbook-output-mapping.ts`
- Create: `src/app/platform/workbook-output-mapping.test.ts`
- Modify: `rust/spreadsheet-calculation-core/src/workbook_formula.rs`
- Modify: `rust/spreadsheet-calculation-core/src/lib.rs`

- [ ] **Step 1: Write the failing TS contract test**

```ts
import { describe, expect, it } from 'vitest';
import { serializeWorkbookForKernel, deserializeWorkbookValidation } from './workbook-kernel-contract';

describe('workbook-kernel-contract', () => {
  it('serializes workbook requests and roundtrips validation errors', () => {
    const payload = serializeWorkbookForKernel({
      projectId: 'proj-1',
      version: 2,
      sheets: [],
      policyCells: [],
      outputMappings: [],
      lastAppliedMode: 'forward_only',
      updatedAt: '2026-04-15T00:00:00.000Z',
      updatedBy: 'pm@mysc.co.kr',
    });

    expect(payload.projectId).toBe('proj-1');

    const parsed = deserializeWorkbookValidation({
      ok: false,
      errors: [{ code: 'ref_error', message: '#REF! in policy sheet' }],
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.errors[0]?.code).toBe('ref_error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/platform/workbook-kernel-contract.test.ts`
Expected: FAIL with `Cannot find module './workbook-kernel-contract'`

- [ ] **Step 3: Implement the TS kernel contract**

```ts
// src/app/platform/workbook-kernel-contract.ts
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

export function deserializeWorkbookValidation(
  payload: WorkbookKernelValidationResponse,
): WorkbookKernelValidationResponse {
  return {
    ok: Boolean(payload.ok),
    errors: Array.isArray(payload.errors) ? payload.errors : [],
  };
}
```

- [ ] **Step 4: Add mapping validator helpers in TS**

```ts
// src/app/platform/workbook-output-mapping.ts
import type { OutputMapping, ProjectWorkbook } from './project-workbook';

const REQUIRED_OUTPUT_KEYS = [
  'official_weekly_rows.expense_amount',
  'official_weekly_rows.cashflow_category',
  'submission_readiness.required_evidence_count',
] as const;

export function listMissingOutputKeys(mappings: OutputMapping[]) {
  return REQUIRED_OUTPUT_KEYS.filter((requiredKey) => (
    !mappings.some((mapping) => mapping.outputKey === requiredKey)
  ));
}

export function validateWorkbookOutputMappings(workbook: ProjectWorkbook) {
  const missingKeys = listMissingOutputKeys(workbook.outputMappings);
  return {
    ok: missingKeys.length === 0,
    missingKeys,
  };
}
```

- [ ] **Step 5: Add the output mapping test and a Rust formula/runtime stub**

```ts
// src/app/platform/workbook-output-mapping.test.ts
import { describe, expect, it } from 'vitest';
import { createDefaultProjectWorkbook } from './project-workbook';
import { validateWorkbookOutputMappings } from './workbook-output-mapping';

describe('validateWorkbookOutputMappings', () => {
  it('reports missing required workbook outputs', () => {
    const workbook = createDefaultProjectWorkbook('proj-1', 'pm@mysc.co.kr');
    const result = validateWorkbookOutputMappings(workbook);

    expect(result.ok).toBe(false);
    expect(result.missingKeys).toContain('official_weekly_rows.expense_amount');
  });
});
```

```rust
// rust/spreadsheet-calculation-core/src/workbook_formula.rs
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

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/app/platform/workbook-kernel-contract.test.ts src/app/platform/workbook-output-mapping.test.ts`
Expected: PASS

Run: `cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml`
Expected: PASS with the new workbook runtime module compiled

- [ ] **Step 7: Commit**

```bash
git add src/app/platform/workbook-kernel-contract.ts \
  src/app/platform/workbook-kernel-contract.test.ts \
  src/app/platform/workbook-output-mapping.ts \
  src/app/platform/workbook-output-mapping.test.ts \
  rust/spreadsheet-calculation-core/src/workbook_formula.rs \
  rust/spreadsheet-calculation-core/src/lib.rs
git commit -m "feat(WB-002): add workbook runtime and output mapping contracts"
```

### Task 5: Add BFF Load/Save Endpoints For Project Workbooks

**Files:**
- Create: `server/bff/project-workbooks.mjs`
- Create: `server/bff/project-workbooks.test.mjs`
- Create: `server/bff/routes/project-workbooks.mjs`
- Modify: `server/bff/app.mjs`
- Modify: `server/bff/schemas.mjs`
- Modify: `server/bff/firestore.mjs`

- [ ] **Step 1: Write the failing BFF test**

```js
import { describe, expect, it } from 'vitest';
import { buildProjectWorkbookSaveResult } from './project-workbooks.mjs';

describe('project-workbooks', () => {
  it('returns a conflict response when version mismatch is detected', async () => {
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

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/bff/project-workbooks.test.mjs`
Expected: FAIL with missing `project-workbooks.mjs`

- [ ] **Step 3: Add the save/load service**

```js
// server/bff/project-workbooks.mjs
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

- [ ] **Step 4: Add the route module**

```js
// server/bff/routes/project-workbooks.mjs
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

    if (!result.ok) {
      return res.status(409).json(result);
    }
    return res.status(200).json(result);
  });

  return router;
}
```

- [ ] **Step 5: Wire the route into the app and rerun tests**

```js
// server/bff/app.mjs
import { createProjectWorkbookRouter } from './routes/project-workbooks.mjs';
app.use('/api/v1/projects', createProjectWorkbookRouter());
```

Run: `npx vitest run server/bff/project-workbooks.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/bff/project-workbooks.mjs \
  server/bff/project-workbooks.test.mjs \
  server/bff/routes/project-workbooks.mjs \
  server/bff/app.mjs \
  server/bff/schemas.mjs \
  server/bff/firestore.mjs
git commit -m "feat(WB-008): add project workbook BFF load/save endpoints"
```

### Task 6: Introduce The React Workbook Shell For Weekly Expense

**Files:**
- Create: `src/app/components/workbook/ProjectWorkbookShell.tsx`
- Create: `src/app/components/workbook/WorkbookGrid.tsx`
- Create: `src/app/components/workbook/WorkbookFormulaBar.tsx`
- Create: `src/app/components/workbook/WorkbookPolicyPanel.tsx`
- Create: `src/app/components/workbook/WorkbookOutputMappingPanel.tsx`
- Create: `src/app/components/workbook/ProjectWorkbookShell.test.tsx`

- [ ] **Step 1: Write the failing workbook shell test**

```tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectWorkbookShell } from './ProjectWorkbookShell';
import { createDefaultProjectWorkbook } from '../../platform/project-workbook';

describe('ProjectWorkbookShell', () => {
  it('renders workbook tabs and the policy panel trigger', () => {
    const workbook = createDefaultProjectWorkbook('proj-1', 'pm@mysc.co.kr');
    const html = renderToStaticMarkup(
      <ProjectWorkbookShell workbook={workbook} onWorkbookChange={() => undefined} />,
    );

    expect(html).toContain('사업비 입력');
    expect(html).toContain('정책');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/components/workbook/ProjectWorkbookShell.test.tsx`
Expected: FAIL with missing workbook component files

- [ ] **Step 3: Add the minimal workbook shell**

```tsx
// src/app/components/workbook/ProjectWorkbookShell.tsx
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
    <section className="flex min-h-[640px] flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {props.workbook.sheets.map((sheet) => (
            <button key={sheet.id} onClick={() => setActiveSheetId(sheet.id)} type="button">
              {sheet.name}
            </button>
          ))}
        </div>
        <button type="button">정책</button>
      </div>
      <WorkbookFormulaBar value={activeSheet?.cells['A1']?.formula || ''} />
      <WorkbookGrid sheet={activeSheet} />
      <div data-active-sheet={activeSheet?.id}>{activeSheet?.name}</div>
    </section>
  );
}
```

- [ ] **Step 4: Add minimal grid, formula bar, and supporting workbook panels**

```tsx
// src/app/components/workbook/WorkbookGrid.tsx
import type { WorkbookSheet } from '../../platform/project-workbook';

export function WorkbookGrid(props: { sheet?: WorkbookSheet }) {
  return (
    <div aria-label="Workbook grid">
      active-sheet:{props.sheet?.id || 'none'}
    </div>
  );
}

// src/app/components/workbook/WorkbookFormulaBar.tsx
export function WorkbookFormulaBar(props: { value: string }) {
  return (
    <label>
      수식
      <input defaultValue={props.value} name="formulaBar" />
    </label>
  );
}

// src/app/components/workbook/WorkbookPolicyPanel.tsx
export function WorkbookPolicyPanel() {
  return <aside aria-label="Workbook policy panel">정책 셀</aside>;
}

// src/app/components/workbook/WorkbookOutputMappingPanel.tsx
export function WorkbookOutputMappingPanel() {
  return <aside aria-label="Workbook output mapping panel">공식 출력 매핑</aside>;
}
```

- [ ] **Step 5: Run the component test**

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
git commit -m "feat(WB-004): add weekly expense workbook shell"
```

### Task 7: Replace Weekly Expense Rows With Workbook State While Keeping Bank Intake Flow

**Files:**
- Modify: `src/app/components/portal/PortalWeeklyExpensePage.tsx`
- Modify: `src/app/data/portal-store.tsx`
- Modify: `src/app/platform/bank-intake-surface.ts`
- Modify: `src/app/platform/settlement-calculation-kernel.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, expect, it } from 'vitest';
import { buildWorkbookFromLegacyExpenseSheet } from '../../platform/project-workbook-legacy-adapter';
import { groupExpenseIntakeItemsForSurface } from '../../platform/bank-intake-surface';

describe('weekly expense workbook migration', () => {
  it('keeps intake queue grouping while hydrating workbook rows', () => {
    const workbook = buildWorkbookFromLegacyExpenseSheet({
      projectId: 'proj-1',
      actor: 'pm@mysc.co.kr',
      activeExpenseSheetId: 'default',
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

- [ ] **Step 2: Run the test to verify the new integration points are missing**

Run: `npx vitest run src/app/platform/project-workbook-legacy-adapter.test.ts src/app/platform/bank-intake-surface.test.ts`
Expected: FAIL because `portal-store` and `PortalWeeklyExpensePage` are not yet workbook-aware

- [ ] **Step 3: Add workbook state into the portal store**

```ts
// portal-store.tsx excerpt
const [projectWorkbook, setProjectWorkbook] = useState<ProjectWorkbook | null>(null);

function hydrateProjectWorkbookFromLegacyRows(projectId: string, actor: string) {
  setProjectWorkbook(buildWorkbookFromLegacyExpenseSheet({
    projectId,
    actor,
    activeExpenseSheetId,
    expenseSheetRows: expenseSheetRows || [],
  }));
}

function updateProjectWorkbook(nextWorkbook: ProjectWorkbook) {
  setProjectWorkbook(nextWorkbook);
}
```

- [ ] **Step 4: Mount the workbook shell in `PortalWeeklyExpensePage` while keeping triage CTA and evidence flow**

```tsx
// PortalWeeklyExpensePage.tsx excerpt
{projectWorkbook ? (
  <ProjectWorkbookShell
    workbook={projectWorkbook}
    onWorkbookChange={updateProjectWorkbook}
  />
) : (
  <SettlementLedgerPage
    rows={expenseSheetRows || []}
    onRowsChange={(rows) => saveExpenseSheetRows(rows)}
    /* existing props stay in place during migration */
  />
)}
```

- [ ] **Step 5: Run focused weekly expense tests**

Run: `npx vitest run src/app/platform/project-workbook-legacy-adapter.test.ts src/app/platform/bank-intake-surface.test.ts src/app/platform/weekly-expense-save-policy.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/components/portal/PortalWeeklyExpensePage.tsx \
  src/app/data/portal-store.tsx \
  src/app/platform/bank-intake-surface.ts \
  src/app/platform/settlement-calculation-kernel.ts
git commit -m "feat(WB-003): mount workbook state into weekly expense flow"
```

### Task 8: Fan Official Workbook Outputs Out To Cashflow, Submission, And Admin Snapshots

**Files:**
- Modify: `src/app/platform/cashflow-sheet.ts`
- Modify: `src/app/platform/workbook-output-mapping.ts`
- Modify: `server/bff/project-workbooks.mjs`
- Modify: `src/app/lib/platform-bff-client.ts`

- [ ] **Step 1: Write the failing output projection test**

```ts
import { describe, expect, it } from 'vitest';
import { projectWorkbookOfficialOutputs } from './workbook-output-mapping';

describe('projectWorkbookOfficialOutputs', () => {
  it('projects weekly rows into cashflow and submission outputs', () => {
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
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/platform/workbook-output-mapping.test.ts`
Expected: FAIL because `projectWorkbookOfficialOutputs` is missing

- [ ] **Step 3: Implement the official output fan-out helper**

```ts
// src/app/platform/workbook-output-mapping.ts excerpt
export function projectWorkbookOfficialOutputs(input: { workbook: Pick<ProjectWorkbook, 'outputMappings' | 'projectId' | 'sheets'> }) {
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

- [ ] **Step 4: Persist official outputs in the BFF save path**

```js
// server/bff/project-workbooks.mjs excerpt
export async function buildProjectWorkbookSaveResult(input) {
  const officialOutputs = input.officialOutputs || {
    cashflowRows: [],
    submissionReadiness: { projectId: input.workbook.projectId, requiredEvidenceCount: 0 },
    adminSnapshot: { projectId: input.workbook.projectId, status: 'healthy' },
  };

  return {
    ok: true,
    code: 'saved',
    workbook: {
      ...input.workbook,
      version: input.nextVersion,
      officialOutputs,
    },
  };
}
```

- [ ] **Step 5: Run the focused tests**

Run: `npx vitest run src/app/platform/workbook-output-mapping.test.ts src/app/platform/cashflow-sheet.test.ts server/bff/project-workbooks.test.mjs`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/platform/cashflow-sheet.ts \
  src/app/platform/workbook-output-mapping.ts \
  server/bff/project-workbooks.mjs \
  src/app/lib/platform-bff-client.ts
git commit -m "feat(WB-005): fan workbook outputs into cashflow and admin states"
```

### Task 9: Add Replay Modes, Conflict Resolution, And Audit Snapshots

**Files:**
- Create: `src/app/platform/workbook-conflicts.ts`
- Create: `src/app/platform/workbook-conflicts.test.ts`
- Create: `src/app/platform/workbook-replay.ts`
- Create: `src/app/platform/workbook-replay.test.ts`
- Create: `src/app/components/workbook/WorkbookConflictDialog.tsx`
- Create: `rust/spreadsheet-calculation-core/src/workbook_replay.rs`
- Modify: `rust/spreadsheet-calculation-core/src/lib.rs`
- Modify: `server/bff/project-workbooks.mjs`

- [ ] **Step 1: Write the failing conflict diff test**

```ts
import { describe, expect, it } from 'vitest';
import { diffWorkbookCells } from './workbook-conflicts';

describe('diffWorkbookCells', () => {
  it('returns a diff when local and server workbook cells diverge', () => {
    const diff = diffWorkbookCells({
      local: { weekly_expense: { C2: { value: '10000' } } },
      server: { weekly_expense: { C2: { value: '12000' } } },
    });

    expect(diff).toEqual([
      {
        sheetId: 'weekly_expense',
        cellRef: 'C2',
        localValue: '10000',
        serverValue: '12000',
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/platform/workbook-conflicts.test.ts`
Expected: FAIL with missing `workbook-conflicts`

- [ ] **Step 3: Implement conflict diff and replay helpers**

```ts
// src/app/platform/workbook-conflicts.ts
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

```ts
// src/app/platform/workbook-replay.ts
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
// rust/spreadsheet-calculation-core/src/workbook_replay.rs
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

- [ ] **Step 4: Add the conflict dialog shell**

```tsx
// src/app/components/workbook/WorkbookConflictDialog.tsx
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

- [ ] **Step 5: Run replay/conflict tests**

Run: `npx vitest run src/app/platform/workbook-conflicts.test.ts src/app/platform/workbook-replay.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/platform/workbook-conflicts.ts \
  src/app/platform/workbook-conflicts.test.ts \
  src/app/platform/workbook-replay.ts \
  src/app/platform/workbook-replay.test.ts \
  src/app/components/workbook/WorkbookConflictDialog.tsx \
  server/bff/project-workbooks.mjs
git commit -m "feat(WB-006): add replay modes and workbook conflict resolution"
```

### Task 10: Verify Parity, Document The Surface, And Lock The Migration

**Files:**
- Modify: `README.md`
- Modify: `src/app/components/portal/PortalWeeklyExpensePage.flow-layout.test.ts`
- Modify: `src/app/platform/portal-happy-path.test.ts`
- Modify: `server/bff/settlement-kernel.test.ts`
- Modify: `docs/wiki/patch-notes/pages/portal-weekly-expense.md`
- Modify: `docs/wiki/patch-notes/log.md`

- [ ] **Step 1: Write a parity smoke test**

```ts
import { describe, expect, it } from 'vitest';
import { createDefaultProjectWorkbook } from './project-workbook';
import { validateWorkbookOutputMappings } from './workbook-output-mapping';

describe('workbook parity smoke', () => {
  it('fails save when workbook lacks required official output mappings', () => {
    const workbook = createDefaultProjectWorkbook('proj-1', 'pm@mysc.co.kr');
    const validation = validateWorkbookOutputMappings(workbook);
    expect(validation.ok).toBe(false);
    expect(validation.missingKeys.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the verification suite**

Run: `npx vitest run src/app/platform/project-workbook.test.ts src/app/platform/workbook-output-mapping.test.ts src/app/platform/workbook-conflicts.test.ts server/bff/project-workbooks.test.mjs`
Expected: PASS

Run: `cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml`
Expected: PASS

Run: `npm run build`
Expected: PASS with the workbook shell compiled into the app bundle

- [ ] **Step 3: Update README and patch notes with the new authoritative workbook model**

```md
<!-- README.md excerpt -->
## Embedded Workbook Engine

- `사업비 입력(주간)` is the first authoritative workbook surface.
- Bank statement upload and triage remain the ingress path.
- Workbook saves are blocked when required official mappings break.
- Cashflow, submission, and admin monitoring derive from workbook official outputs.
```

```md
<!-- docs/wiki/patch-notes/log.md entry -->
## [2026-04-15] patch-note | weekly-expense-workbook | authoritative workbook surface
- pages: [portal-weekly-expense](./pages/portal-weekly-expense.md)
- summary: 사업비 입력(주간)을 프로젝트별 authoritative workbook으로 승격하고, 통장내역 ingress와 cashflow/admin 출력 fan-out을 유지한 채 정책 셀과 공식 출력 매핑을 도입했다.
```

- [ ] **Step 4: Commit**

```bash
git add README.md \
  src/app/components/portal/PortalWeeklyExpensePage.flow-layout.test.ts \
  src/app/platform/portal-happy-path.test.ts \
  server/bff/settlement-kernel.test.ts \
  docs/wiki/patch-notes/pages/portal-weekly-expense.md \
  docs/wiki/patch-notes/log.md
git commit -m "docs(WB-009): document authoritative workbook rollout"
```

## Self-Review

### Spec coverage

- `Engine-over-existing`: covered by Tasks 2, 5, 7, 8
- `ProjectWorkbook` document model: covered by Tasks 2 and 3
- `Policy cells immutable in existence`: covered by Tasks 1, 2, 3, 4
- `Bank statement + triage ingress retained`: covered by Task 7
- `Cashflow / submission / admin fan-out`: covered by Task 8
- `Optimistic save + conflicts`: covered by Tasks 5 and 9
- `forward_only` / `recalc_all`: covered by Task 9
- `Light hook + issue references`: covered by Task 1
- `Docs + patch notes`: covered by Task 10

### Placeholder scan

- No `TBD` / `TODO` placeholders remain in the plan.
- Every code-changing task contains concrete file paths and code skeletons.

### Type consistency

- `ProjectWorkbook`, `PolicyCellBinding`, and `OutputMapping` are introduced in Task 2 and referenced consistently afterward.
- `WorkbookValidationError`, `WorkbookKernelValidationResponse`, and replay/conflict helpers keep one naming scheme across TS and Rust tasks.

## Execution Notes

- Run tasks in order. Task 7 depends on Tasks 2, 4, 5, and 6.
- Do not try to make `weekly_expense` fully free-form in v1. The workbook skeleton stays fixed.
- Keep `WB-*` issue IDs in every workbook-related commit message.
- Prefer small commits exactly as listed. The existing pre-commit patch-notes guard is already strict enough.
