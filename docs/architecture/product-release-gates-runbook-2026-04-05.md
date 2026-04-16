# Product Release Gates Runbook

Last updated: 2026-04-06

## Goal

Keep `main` and pull requests blocked on product-critical user flows, not only module/unit confidence.

## Owners

- Workflow owner: Platform application engineering
- Product acceptance owner: Platform PM / CPO

## Current CI Gate

Workflow: [`.github/workflows/ci.yml`](/Users/boram/InnerPlatform/.github/workflows/ci.yml)

Job: `product-release-gates`

Included flows:

1. Settlement import/edit/save/reload and weekly handoff
   - spec: [`tests/e2e/settlement-product-completeness.spec.ts`](/Users/boram/InnerPlatform/tests/e2e/settlement-product-completeness.spec.ts)
   - harness: [`tests/e2e/migration-wizard.harness.spec.js`](/Users/boram/InnerPlatform/tests/e2e/migration-wizard.harness.spec.js)
2. Bank upload triage wizard to weekly projection
   - spec: [`tests/e2e/bank-upload-triage-wizard.spec.ts`](/Users/boram/InnerPlatform/tests/e2e/bank-upload-triage-wizard.spec.ts)
   - coverage:
     - reupload in different order does not destroy projected weekly rows
     - PM can project first, resume later, and preserve evidence continuation draft state
3. Admin requested-route preservation across login
   - spec: [`tests/e2e/product-release-gates.spec.ts`](/Users/boram/InnerPlatform/tests/e2e/product-release-gates.spec.ts)
4. PM requested-route preservation across login
   - spec: [`tests/e2e/product-release-gates.spec.ts`](/Users/boram/InnerPlatform/tests/e2e/product-release-gates.spec.ts)
5. Admin project trash and restore
   - spec: [`tests/e2e/product-release-gates.spec.ts`](/Users/boram/InnerPlatform/tests/e2e/product-release-gates.spec.ts)

## Gate Policy

- A red `product-release-gates` job is release-blocking.
- Add only flows that are product-critical and deterministic in the dev auth harness.
- When a flaky flow is discovered, either fix the product/state contract or remove the flake source before broadening coverage.

## Local Reproduction

For the phase1 portal lane, use the canonical validation gate first:

```bash
npm run phase1:portal:validation-gate -- --json-out artifacts/phase1-portal-validation-gate.json
```

For the broader legacy product gate, run the Playwright specs directly:

Run the product gate Playwright specs:

```bash
npx playwright test tests/e2e/migration-wizard.harness.spec.js tests/e2e/settlement-product-completeness.spec.ts tests/e2e/bank-upload-triage-wizard.spec.ts tests/e2e/product-release-gates.spec.ts --config playwright.harness.config.mjs
```

## Next Gate Candidates

- Issue [#148](https://github.com/merryAI-dev/InnerPlatform/issues/148): broaden release gates outside settlement
- Candidate flows:
  - workspace selection preference persistence
  - portal onboarding and project-settings completion
  - admin-to-portal switching continuity
