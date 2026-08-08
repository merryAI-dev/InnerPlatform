# Repository Guidelines

## Project Structure
- `src/`: Vite + React + TypeScript frontend.
  - `src/app/routes.tsx`: admin (`/`) and portal (`/portal`) routing.
  - `src/app/components/`: feature UIs (projects, payroll, board, cashflow, portal).
  - `src/app/data/`: client stores/providers and shared types (`src/app/data/types.ts`).
  - `src/app/platform/`: shared “policy/logic” helpers (RBAC, tenant, business-days, cashflow week buckets).
- `server/bff/`: Express BFF used by `/api/v1/*` (idempotency, outbox, queue workers, audit chain).
- `api/bff.js`: Vercel Serverless entrypoint for the BFF.
- `firebase/`: Firestore rules + composite indexes.
- `policies/`: policy-as-code JSON (RBAC, relation rules).
- `scripts/` + `guidelines/`: Firebase automation + operational runbooks.

## Build, Test, Run
- `npm run dev`: local frontend.
- `npm run build`: production build.
- `npm test`: unit tests (Vitest).
- `npm run bff:dev`: local BFF on `127.0.0.1:8787`.
- `npm run bff:test:integration`: Firestore emulator + BFF integration tests.

Recommended gate before PR:
```bash
npm test
npm run bff:test:integration
npm run build
```

## Coding Style & Naming
- TypeScript, React function components, 2-space indentation.
- Components/pages: `PascalCase.tsx` (example: `AdminPayrollPage.tsx`).
- Route segments/folders: lowercase/kebab (example: `expense-management`).
- Keep cross-cutting rules in `src/app/platform/`; keep feature UI in `src/app/components/<feature>/`.
- UI wording must use the same Korean business terms across admin and portal. Prefer domain labels already used in `src/app/data/types.ts` or shared label maps; avoid one-off labels like `X`, `N/A`, or developer-only shorthand in user-facing screens.
- User-facing helper text should explain the operational meaning, not the implementation. Example: say "구성원 원장에서 사업 담당자를 선택합니다" instead of "registeredById 값을 설정합니다".
- Code comments should be rare and explain why a rule exists or why a non-obvious dependency is necessary. Do not comment what the next line mechanically does.

## Commit & PR Guidelines
- Prefer Conventional Commits: `feat(cashflow): ...`, `fix(rbac): ...`, `docs: ...`.
- PRs should include:
  - What/why, screenshots for UI changes (admin + portal), and test results.
  - Ops notes when Firestore rules/indexes or Vercel envs change.

## Firebase/Vercel Ops (Common)
- Deploy Firestore rules/indexes: `npm run firebase:deploy:firestore`.
- One-shot Firebase setup (writes `.env`, `.firebaserc`, deploys): `npm run firebase:autosetup`.
- Vercel preview deploy: `vercel deploy`.
- Production deploy: use the GitHub Actions `Production Deploy` workflow on `main` only.
- Local production deploy is forbidden. `vercel --prod` and `node deploy-prod-align.mjs` must not be used from a local worktree.
- Local production verification only: `npm run deploy:prod:verify -- <deployment-url-or-host>`.

## High-Priority Operating Policies
These policies override lower-priority workflow suggestions when they apply.

### ERP Minimum-Scope Implementation
- Treat this repository as a production ERP: implement only the behavior explicitly requested by the user.
- Reuse the existing data path, helper, type, and UI pattern before adding code. Do not add speculative features, configuration, abstractions, or unrelated refactors.
- Keep the changed files and diff as small as practical, and ensure every changed line is traceable to the request.
- Minimum scope must not remove trust-boundary validation, authorization, audit/history integrity, idempotency, data-loss protection, accessibility basics, or required error handling.
- Fix shared root causes once when multiple requested callers use the same flow; do not patch only a visible symptom or duplicate the fix across screens.
- Verify the affected persisted data path and its user-visible readback. A successful build or cosmetic UI change alone is not completion.

### QA Stage Gates
- For implementation work that can affect users, data, integrations, permissions, deployment, or cross-screen behavior, run the work with an independent QA lens based on `/Users/boram/gstack/.agents/skills/gstack-qa/SKILL.md`.
- Where subagents are available, assign a separate QA subagent to define stage pass criteria and challenge the implementation. If subagents are unavailable, perform a separate QA pass in the main thread using the same criteria.
- Before coding, QA must decide whether the proposed fix is superficial or proves real behavior. It must identify the actual data path being affected: UI state, API/BFF calls, Firestore/store writes, sync jobs, persisted reads, and cross-screen visibility.
- QA defines the pass criteria for each stage independently. Do not advance to the next stage until the current stage passes or a blocker is explicitly reported.
- Required stages:
  1. Intent/data-path gate: define what real data or integration should change and where it should be observable.
  2. Implementation gate: make the smallest scoped change that affects the real data path, not only labels, mock state, or cosmetic UI.
  3. Verification gate: prove the behavior with user-like browser flow when relevant, plus targeted tests/builds/API checks as appropriate.
  4. Regression gate: check adjacent states such as loading, disabled, empty, error, auth/permission, and repeated-save/sync cases.
- Evidence must be independent of implementer assertions: command output, tests, screenshots/snapshots, console checks, persisted records, API responses, logs, or deployment/workflow results.
- If QA concludes the work is only cosmetic while the task requires persistence, sync, or integration, stop and fix the real data path before proceeding.
- For docs-only or non-UI tasks, use lightweight QA criteria and state why browser QA is not required.
- If the worktree is dirty, do not revert unrelated user changes. Run full `/qa` only when the tree can be made safe; otherwise still apply the QA stage-gate policy to the scoped work.

### Understand-Anything Code Intelligence
- Use `/Users/boram/Understand-Anything/understand-anything-plugin/skills/understand/SKILL.md` for codebase understanding, impact analysis, and architecture orientation.
- Prefer the generated knowledge graph at `.understand-anything/knowledge-graph.json` when it exists. Refresh it with:

```bash
/understand /Users/boram/InnerPlatform --language ko
```

- Use Understand-Anything outputs to identify likely owners, affected flows, dependencies, and test scope before broad or risky edits.
- Do not use GitNexus commands, MCP resources, skill files, or `npx gitnexus` workflows for this repository.
