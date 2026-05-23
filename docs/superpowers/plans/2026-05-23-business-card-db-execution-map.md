---
id: business-card-db-execution-map
status: planned
depends_on:
  - business-card-db-umbrella
unblocks:
  - business-card-db-live-verification
owners:
  - codex
last_reviewed_by:
  - gstack-plan-eng-review
  - gstack-plan-design-review
  - superpowers-writing-plans
---

# Business Card DB Execution Map

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the business card DB feature in low-conflict workstreams that can be tested independently before integration.

**Architecture:** A creates the route/PWA/capture shell, B creates server capabilities, C wires the user workflow, and D validates security/release readiness.

**Tech Stack:** Vite React 18, Express BFF, Firebase Admin, Vertex AI Gemini, Vitest, Playwright/manual QA

---

## Source Documents

- Parent: `2026-05-23-business-card-db-umbrella.md`
- A: `2026-05-23-business-card-db-a-pwa-shell.md`
- B: `2026-05-23-business-card-db-b-bff-storage-gemini.md`
- C: `2026-05-23-business-card-db-c-review-save-search.md`
- D: `2026-05-23-business-card-db-d-security-qa-release.md`

## Dependency Matrix

| Workstream | Can Start | Depends On | Unblocks | Main Risk |
| --- | --- | --- | --- | --- |
| A. PWA Shell | immediately | wiki specs | C | LAB route visible in production when LAB off |
| B. BFF Storage Gemini | immediately | data/API/Gemini specs | C, D | leaking public Storage URLs or trusting Gemini output |
| C. Review Save Search | after API/client types settle | A, B | D | canonical contact created without human confirmation |
| D. Security QA Release | after A-C integration | A, B, C | live deploy | privacy gap from org-wide search and retained images |

## Recommended Order

1. Implement B service and schemas first so frontend has a stable API contract.
2. Implement A route shell in parallel if using subagents.
3. Implement C after B route mocks pass.
4. Implement D last and block release until image privacy and audit checks pass.

## Task Checklist

### Task 1: A. PWA Shell

- [ ] Add LAB route visibility for `/business-cards` and `/portal/business-cards`.
- [ ] Add route entries to `src/app/routes.tsx`.
- [ ] Create `BusinessCardLabPage` scaffold with tabs and mobile upload field.
- [ ] Add PWA manifest and service worker registration.
- [ ] Add focused tests for LAB hidden/default behavior.

### Task 2: B. BFF Storage Gemini

- [ ] Add business card schemas to `server/bff/schemas.mjs`.
- [ ] Add private Storage helper.
- [ ] Add Gemini extraction helper with structured output validation.
- [ ] Add BFF routes and mount them in `server/bff/app.mjs`.
- [ ] Add BFF integration tests with mocked Storage and Gemini services.

### Task 3: C. Review Save Search

- [ ] Add client types/functions in `src/app/lib/platform-bff-client.ts`.
- [ ] Wire upload/process UI to BFF.
- [ ] Wire review/confirm UI to BFF.
- [ ] Add contact search UI and ranking result display.
- [ ] Add frontend tests for required field and low-confidence states.

### Task 4: D. Security QA Release

- [ ] Add RBAC permissions and audit event coverage.
- [ ] Add image endpoint privacy tests.
- [ ] Add manual QA checklist evidence.
- [ ] Run build and focused tests.
- [ ] Deploy and verify Vercel aliases.

## Verification Commands

```bash
npm run build
npx vitest run src/app/platform/shell-lab-visibility.test.ts
npx vitest run server/bff/app.integration.test.ts
```

## Live Smoke Checklist

- LAB off hides 명함 DB entry points.
- LAB on reveals 명함 DB entry points.
- Mobile capture/upload reaches `process`.
- Gemini draft appears as editable review fields.
- Confirm creates org-visible contact.
- Search finds contact by name, company, email, and phone.
- Image endpoint is not public.
- Vercel alias points to verified deployment.
