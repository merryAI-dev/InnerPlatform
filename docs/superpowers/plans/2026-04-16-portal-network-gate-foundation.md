# Portal Network Gate Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make network/runtime correctness a first-class release blocker for stable portal routes before phases 2–5 land.

**Architecture:** Add a dedicated network-gate layer that defines route budgets, captures Playwright network/runtime artifacts, and promotes the canonical gate script from local helper to CI authority. The foundation is additive first, then replaces duplicated CI commands.

**Tech Stack:** TypeScript, Vitest, Playwright, GitHub Actions, existing Vite harness, Node scripts

---

## File Structure

### Files to Create

- `src/app/platform/portal-network-budgets.ts`
  - Stable route budget definitions and budget evaluation helpers.
- `src/app/platform/portal-network-budgets.test.ts`
  - Unit tests for budget matching and threshold evaluation.
- `tests/e2e/support/portal-network-artifact.ts`
  - Playwright helper that records requests, console errors, and Firestore channel signals.
- `tests/e2e/support/portal-network-artifact.test.ts`
  - Unit tests for artifact summarization logic.
- `scripts/portal_network_gate.ts`
  - Canonical phase 0 gate runner that calls test/build commands, reads generated artifacts, and enforces budgets.
- `src/app/platform/portal-network-gate.test.ts`
  - Tests for gate summary, budget enforcement, and failure conditions.
- `docs/operations/2026-04-16-portal-network-gate-foundation-slice-briefs.md`
  - Subagent dispatch briefs for the four phase 0 slices.

### Files to Modify

- `tests/e2e/platform-smoke.spec.ts`
  - Emit network/runtime artifact for stable portal routes.
- `tests/e2e/product-release-gates.spec.ts`
  - Emit network/runtime artifact for auth/project critical flow.
- `playwright.harness.config.mjs`
  - Ensure artifact output path and env vars are stable in CI.
- `package.json`
  - Add canonical phase 0 gate command.
- `.github/workflows/ci.yml`
  - Replace duplicated smoke/build commands with the canonical gate script and upload JSON artifacts.
- `docs/operations/2026-04-16-finance-grade-portal-stabilization-master-plan.md`
  - Mark phase 0 as underway once slice work starts.
- `docs/wiki/patch-notes/pages/shared-portal-architecture.md`
  - Capture that network/runtime/recovery evidence is now an enforced gate, not a guideline.
- `docs/wiki/patch-notes/log.md`
  - Add a patch-note entry for the gate foundation.

## Task 1: Route Budget Contract

**Files:**
- Create: `src/app/platform/portal-network-budgets.ts`
- Create: `src/app/platform/portal-network-budgets.test.ts`
- Modify: `docs/operations/2026-04-16-finance-grade-portal-stabilization-master-plan.md`

- [ ] **Step 1: Write the failing tests for route budgets**

```ts
import { describe, expect, it } from 'vitest';
import {
  PORTAL_STABLE_ROUTE_BUDGETS,
  classifyPortalRouteBudget,
  evaluatePortalRouteBudget,
} from './portal-network-budgets';

describe('classifyPortalRouteBudget', () => {
  it('maps stable portal routes to explicit budget entries', () => {
    expect(classifyPortalRouteBudget('/portal')).toMatchObject({
      routeId: 'portal-dashboard',
      maxFirestoreListenRequests: 0,
    });
    expect(classifyPortalRouteBudget('/portal/weekly-expenses')).toMatchObject({
      routeId: 'portal-weekly-expenses',
      maxFirestoreListenRequests: 0,
    });
  });
});

describe('evaluatePortalRouteBudget', () => {
  it('fails when firestore listen count exceeds the route budget', () => {
    const budget = PORTAL_STABLE_ROUTE_BUDGETS['portal-dashboard'];
    const outcome = evaluatePortalRouteBudget(budget, {
      consoleErrors: 0,
      firestoreListenRequests: 1,
      firestoreWriteRequests: 0,
      firestoreListen400s: 0,
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toContain('firestoreListenRequests');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/platform/portal-network-budgets.test.ts`  
Expected: FAIL because the route budget module does not exist yet.

- [ ] **Step 3: Write the minimal route budget contract**

```ts
export interface PortalRouteBudget {
  routeId: string;
  pathname: string;
  maxFirestoreListenRequests: number;
  maxFirestoreWriteRequests: number;
  maxFirestoreListen400s: number;
  maxConsoleErrors: number;
}

export const PORTAL_STABLE_ROUTE_BUDGETS: Record<string, PortalRouteBudget> = {
  'portal-dashboard': {
    routeId: 'portal-dashboard',
    pathname: '/portal',
    maxFirestoreListenRequests: 0,
    maxFirestoreWriteRequests: 0,
    maxFirestoreListen400s: 0,
    maxConsoleErrors: 0,
  },
  'portal-weekly-expenses': {
    routeId: 'portal-weekly-expenses',
    pathname: '/portal/weekly-expenses',
    maxFirestoreListenRequests: 0,
    maxFirestoreWriteRequests: 0,
    maxFirestoreListen400s: 0,
    maxConsoleErrors: 0,
  },
};

export function classifyPortalRouteBudget(pathname: string): PortalRouteBudget | null {
  return Object.values(PORTAL_STABLE_ROUTE_BUDGETS).find((budget) => budget.pathname === pathname) || null;
}

export function evaluatePortalRouteBudget(
  budget: PortalRouteBudget,
  observed: {
    consoleErrors: number;
    firestoreListenRequests: number;
    firestoreWriteRequests: number;
    firestoreListen400s: number;
  },
) {
  const failures: string[] = [];
  if (observed.consoleErrors > budget.maxConsoleErrors) failures.push('consoleErrors');
  if (observed.firestoreListenRequests > budget.maxFirestoreListenRequests) failures.push('firestoreListenRequests');
  if (observed.firestoreWriteRequests > budget.maxFirestoreWriteRequests) failures.push('firestoreWriteRequests');
  if (observed.firestoreListen400s > budget.maxFirestoreListen400s) failures.push('firestoreListen400s');
  return { passed: failures.length === 0, failures };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/app/platform/portal-network-budgets.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/platform/portal-network-budgets.ts src/app/platform/portal-network-budgets.test.ts
git commit -m "test: define portal route network budgets"
```

## Task 2: Playwright Network Artifact Capture

**Files:**
- Create: `tests/e2e/support/portal-network-artifact.ts`
- Create: `tests/e2e/support/portal-network-artifact.test.ts`
- Modify: `tests/e2e/platform-smoke.spec.ts`
- Modify: `tests/e2e/product-release-gates.spec.ts`
- Modify: `playwright.harness.config.mjs`

- [ ] **Step 1: Write the failing tests for artifact summarization**

```ts
import { describe, expect, it } from 'vitest';
import { summarizePortalNetworkArtifact } from './portal-network-artifact';

describe('summarizePortalNetworkArtifact', () => {
  it('counts firestore listen, write, and 400 responses', () => {
    const summary = summarizePortalNetworkArtifact({
      requests: [
        { url: 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel', status: 200 },
        { url: 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel', status: 200 },
        { url: 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel', status: 400 },
      ],
      consoleErrors: [{ text: 'boom', type: 'error' }],
    });
    expect(summary.firestoreListenRequests).toBe(2);
    expect(summary.firestoreWriteRequests).toBe(1);
    expect(summary.firestoreListen400s).toBe(1);
    expect(summary.consoleErrors).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/e2e/support/portal-network-artifact.test.ts`  
Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Add artifact helper and hook it into smoke specs**

```ts
export function summarizePortalNetworkArtifact(input: {
  requests: Array<{ url: string; status: number }>;
  consoleErrors: Array<{ text: string; type: string }>;
}) {
  return {
    firestoreListenRequests: input.requests.filter((entry) => entry.url.includes('Firestore/Listen/channel')).length,
    firestoreWriteRequests: input.requests.filter((entry) => entry.url.includes('Firestore/Write/channel')).length,
    firestoreListen400s: input.requests.filter(
      (entry) => entry.url.includes('Firestore/Listen/channel') && entry.status === 400,
    ).length,
    consoleErrors: input.consoleErrors.length,
  };
}
```

Smoke spec integration target:

```ts
const artifact = await recordPortalNetworkArtifact(page, async () => {
  await page.goto('/portal');
});
await writePortalNetworkArtifact('portal-dashboard', artifact);
```

- [ ] **Step 4: Run helper tests and smoke tests**

Run: `npm test -- tests/e2e/support/portal-network-artifact.test.ts`  
Expected: PASS.

Run: `CI=1 npx playwright test tests/e2e/platform-smoke.spec.ts tests/e2e/product-release-gates.spec.ts --config playwright.harness.config.mjs`  
Expected: PASS and artifact JSON files written to the configured output directory.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/support/portal-network-artifact.ts tests/e2e/support/portal-network-artifact.test.ts tests/e2e/platform-smoke.spec.ts tests/e2e/product-release-gates.spec.ts playwright.harness.config.mjs
git commit -m "test: capture portal network artifacts in smoke suites"
```

## Task 3: Canonical Phase 0 Network Gate

**Files:**
- Create: `scripts/portal_network_gate.ts`
- Create: `src/app/platform/portal-network-gate.test.ts`
- Modify: `package.json`
- Modify: `scripts/phase1_portal_validation_gate.ts`

- [ ] **Step 1: Write the failing tests for the network gate**

```ts
import { describe, expect, it } from 'vitest';
import { evaluatePortalNetworkGate } from './portal-network-gate';

describe('evaluatePortalNetworkGate', () => {
  it('fails when a route artifact violates its budget', async () => {
    const result = await evaluatePortalNetworkGate({
      artifacts: [{ routeId: 'portal-dashboard', firestoreListenRequests: 1, firestoreWriteRequests: 0, firestoreListen400s: 0, consoleErrors: 0 }],
    });
    expect(result.summary.failedCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/platform/portal-network-gate.test.ts`  
Expected: FAIL because the network gate module does not exist yet.

- [ ] **Step 3: Implement the gate and add package entrypoint**

Required behavior:

- Run the existing unit/contract suite.
- Run the Playwright smoke suite.
- Read produced network artifact JSON files.
- Apply route budgets from `portal-network-budgets.ts`.
- Fail on budget breach.
- Run `npm run build`.
- Write one consolidated JSON summary artifact.

Entry point:

```json
{
  "scripts": {
    "phase0:portal:network-gate": "npx tsx scripts/portal_network_gate.ts"
  }
}
```

- [ ] **Step 4: Run the gate tests and the real gate**

Run: `npm test -- src/app/platform/portal-network-gate.test.ts`  
Expected: PASS.

Run: `npm run phase0:portal:network-gate -- --json-out /tmp/portal-network-gate.json`  
Expected: PASS with route-level artifact summary printed and JSON written.

- [ ] **Step 5: Commit**

```bash
git add scripts/portal_network_gate.ts src/app/platform/portal-network-gate.test.ts scripts/phase1_portal_validation_gate.ts package.json
git commit -m "build: add canonical portal network gate"
```

## Task 4: CI Canonical Gate and Artifact Publishing

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/operations/2026-04-16-portal-hardening-orchestration-model.md`
- Modify: `docs/operations/2026-04-16-finance-grade-portal-stabilization-master-plan.md`
- Modify: `docs/wiki/patch-notes/pages/shared-portal-architecture.md`
- Modify: `docs/wiki/patch-notes/log.md`

- [ ] **Step 1: Write the failing contract test for CI wiring**

If there is no existing workflow contract test, add a lightweight one:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ci workflow', () => {
  it('calls the canonical portal network gate', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain('npm run phase0:portal:network-gate');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/app/platform/ci-workflow.contract.test.ts`  
Expected: FAIL because the workflow does not use the canonical gate yet.

- [ ] **Step 3: Replace duplicated CI smoke/build steps with the canonical gate**

Target workflow shape:

```yaml
- name: Portal network gate
  run: npm run phase0:portal:network-gate -- --json-out artifacts/portal-network-gate.json

- name: Upload portal gate artifact
  uses: actions/upload-artifact@v4
  with:
    name: portal-network-gate
    path: artifacts/portal-network-gate.json
```

- [ ] **Step 4: Run the contract test and local gate again**

Run: `npm test -- src/app/platform/ci-workflow.contract.test.ts`  
Expected: PASS.

Run: `npm run phase0:portal:network-gate -- --json-out /tmp/portal-network-gate.json`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml src/app/platform/ci-workflow.contract.test.ts docs/operations/2026-04-16-portal-hardening-orchestration-model.md docs/operations/2026-04-16-finance-grade-portal-stabilization-master-plan.md docs/wiki/patch-notes/pages/shared-portal-architecture.md docs/wiki/patch-notes/log.md
git commit -m "ci: enforce canonical portal network gate"
```

## Self-Review

### Spec coverage

- Network correctness is promoted ahead of command and recovery work.
- Route-level Firestore transport budget is explicit.
- CI becomes the source of truth for the canonical gate.
- Artifacts are stored, not just printed.
- The plan is broken into rollbackable slices.

### Placeholder scan

- No `TBD`, `later`, or undefined follow-up placeholders remain.
- Commands and expected outcomes are explicit for every task.

### Type consistency

- The plan consistently uses:
  - `PortalRouteBudget`
  - `summarizePortalNetworkArtifact`
  - `evaluatePortalNetworkGate`
  - `phase0:portal:network-gate`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-portal-network-gate-foundation.md`.

Recommended execution:

1. `Subagent-Driven`
   - Implement one task per fresh subagent.
   - Run spec review, then code-quality review, then integrate.

2. `Inline Execution`
   - Execute the tasks in this session with checkpoints.

For this repository and current service class, `Subagent-Driven` is the correct default.
