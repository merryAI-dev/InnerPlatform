# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **`AGENTS.md` holds the high-priority operating policies** (cashflow coordinate contract, deployment
> automation, Orca orchestration worker lifecycle, QA stage gates). Where the two files disagree,
> `AGENTS.md` wins. Read it before non-trivial work.

## Skills

커스텀 스킬은 `.claude/skills/`에 정의되어 있습니다.

| Skill | Purpose |
|-------|---------|
| `verify-git-policy` | PR/머지 전 브랜치 네이밍·커밋 컨벤션·PR 없는 미머지 브랜치 일괄 검증 |
| `merge-worktree` | 현재 worktree 브랜치를 main(또는 지정 브랜치)에 스쿼시 머지 |
| `manage-skills` | 세션 변경사항을 분석하여 verify 스킬 누락을 탐지하고 생성/업데이트 |
| `verify-implementation` | 등록된 모든 verify-* 스킬을 순차 실행하여 통합 검증 보고서 생성 |
| `verify-firebase` | Firebase 프로젝트 전환/배포 전 env, auth, rules, members 정합성 검증 |

## Firebase 운영 정책

배포 시 반드시 지켜야 할 사항:

1. **Vercel env 설정 시 `printf` 사용** — `echo`는 trailing newline이 들어감
   ```bash
   # ✅ 올바름
   printf 'value' | vercel env add VAR_NAME production
   # ❌ 틀림 — \n이 값에 포함됨
   echo "value" | vercel env add VAR_NAME production
   ```

2. **Firebase UID는 프로젝트마다 다름** — 프로젝트 전환 시 members 컬렉션에 새 UID 등록 필수
   ```bash
   # 현재 프로젝트의 UID 확인
   gcloud auth list  # 계정 확인
   # Firebase Auth에서 실제 UID 조회 후 members에 등록
   ```

3. **Firestore documentId() 쿼리에 빈 문자열 금지** — `.filter(Boolean)` 필수
   ```typescript
   // ✅ 올바름
   const ids = [...projectIds].filter(Boolean);
   // ❌ 빈 문자열이면 쿼리가 아무것도 안 반환
   where(documentId(), 'in', [''])
   ```

4. **로컬 `vercel --prod` 금지**
   ```bash
   # Production 배포는 GitHub Actions production environment에서만 진행
   # 로컬 CLI에서 production deploy를 직접 실행하지 않는다
   ```
   필요한 GitHub production environment secrets:
   - `VERCEL_TOKEN`
   - `VERCEL_ORG_ID`
   - `VERCEL_PROJECT_ID`

   로컬에서는 기존 deployment 검증만 허용합니다:
   ```bash
   node deploy-prod-align.mjs --verify-only <deployment-url-or-host>
   ```

5. **새 Firebase 프로젝트 세팅 체크리스트**
   - [ ] Google Sign-In provider 활성화
   - [ ] Authorized domains에 production URL 추가
   - [ ] Firestore rules + indexes 배포
   - [ ] Storage bucket 초기화
   - [ ] members 컬렉션에 admin 사용자 등록 (새 UID로)

## Project Overview

MYSC 사업관리 통합 플랫폼 — an enterprise business management platform for a Korean social enterprise (MYSC). Manages projects, ledgers, transactions, payroll, cashflow, personnel, budgets, training, and career profiles. **All user-facing UI text is in Korean (한국어).**

### UI Wording & Comments Policy
- Admin and portal screens must use the same Korean business terms for the same concept. Reuse shared label maps and domain types where possible.
- User-facing copy should explain the operational meaning in non-developer language. Avoid internal field names, unexplained acronyms, `X`, `N/A`, or temporary labels.
- Code comments should be short and reserved for intent, policy, or non-obvious dependencies. Do not add comments that simply restate the code.

## Commands

```bash
npm run dev              # Vite dev server (frontend, port 5173)
npm run dev:local        # Dev server with demo login + auth harness, Firebase off
npm run build            # Production build (vite — strips types, does NOT typecheck)
npm test                 # Unit tests (vitest run)
npm run test:watch       # Interactive test watch mode
npm run typecheck        # tsc --noEmit against typecheck-baseline.json (see below)
npm run policy:verify    # RBAC / JVM command roles / edge route / privacy policy verification
npm run bff:dev          # Express BFF server on 127.0.0.1:8787
npm run bff:test:integration  # BFF integration tests (requires Firestore emulator)
npm run test:e2e         # Playwright harness suite (tests/e2e)
mvn -f server/jvm-weekly-api/pom.xml test   # Spring Boot weekly API tests
npm run rust:settlement:test                # Rust calculation core tests
```

**Run a single test file:**
```bash
npx vitest run src/app/platform/rbac.test.ts
```

**Pre-PR gate** (mirrors `.github/workflows/ci.yml`):
```bash
npm test && npm run typecheck && npm run policy:verify && npm run build
npm run bff:test:integration
mvn -f server/jvm-weekly-api/pom.xml test
npm run test:settlement:integration
```

**Typecheck baseline:** `vite build` does not typecheck, so `npm run typecheck` is the gate that
catches undefined identifiers before they ship as runtime crashes. The repo carries pre-existing
`tsc` errors, so `scripts/verify-typecheck-baseline.mjs` compares per-file error counts against
`typecheck-baseline.json` and fails only where a file's count **grew**. Never run
`npm run typecheck:baseline` (which rewrites the baseline) to make a failure disappear — fix the
new error instead.

**Firebase/Vercel ops:**
```bash
npm run firebase:deploy:firestore   # Deploy Firestore rules + indexes
npm run firebase:autosetup          # One-shot Firebase setup
npm run firebase:emulators:start    # Start Firestore emulator
npm run etl:build:staging-json      # Build ETL staging JSON from Excel
npm run etl:sync:staging            # Sync staging data to Firestore
```

**Local dev without Firebase:** No `.env` file is needed. All feature flags default to `false`/off, so the app runs against local mock data (`src/app/data/mock-data.ts`) out of the box.

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite 6 + Tailwind CSS v4
- **UI:** MUI v7 + Radix UI + shadcn/ui patterns (in `src/app/components/ui/`)
- **Routing:** react-router v7 (browser router)
- **State:** React Context providers (no Redux/Zustand)
- **Forms:** react-hook-form + zod
- **Backend:** Firebase/Firestore + Express BFF (`server/bff/`) + Spring Boot JVM service (`server/jvm-weekly-api/`)
- **BFF language:** Plain JavaScript (`.mjs` files), not TypeScript
- **JVM service:** Java 21 / Spring Boot / Spring Data JPA / Flyway / Postgres (H2 in tests)
- **Calculation core:** Rust (`rust/spreadsheet-calculation-core/`) for settlement/spreadsheet math
- **Testing:** Vitest + supertest (BFF integration), Playwright (`tests/e2e`), JUnit via Maven (JVM); TS/JS tests are co-located with source (`*.test.ts` / `*.test.mjs` next to implementation)
- **Node:** v24 (`.nvmrc`)
- **Module system:** ESM (`"type": "module"`)

Path alias: `@` → `./src` (configured in both `vite.config.ts` and `vitest.config.ts`)

## Architecture

### Dual-Layout Routing (`src/app/routes.tsx`)

Two top-level route groups with separate layouts:
- **Admin routes** (`/`): `AppLayout` — dashboard, projects, cashflow, payroll, audit, settings, etc.
- **Portal routes** (`/portal`): `PortalLayout` — PM/user-facing portal for expenses, budget, career profile, training, etc.

All pages are lazy-loaded via `React.lazy()` except where static import is needed for reliability.

### Provider Tree (`src/app/App.tsx`)

Deeply nested context providers in fixed order:
```
FirebaseProvider → AuthProvider → HrAnnouncementProvider → PayrollProvider
→ CashflowWeekProvider → BoardProvider → CareerProfileProvider → TrainingProvider
```

### Tri-Modal Data Layer (`src/app/data/store.tsx`)

Controlled by feature flags, the store routes reads and mutations through three backends:
1. **BFF API** (when `platformApiEnabled`) — `src/app/lib/platform-bff-client.ts`
2. **Firestore direct** (when `firestoreCoreEnabled`) — `src/app/lib/firestore-service.ts`
3. **Local mock data** (fallback) — `src/app/data/mock-data.ts`

Additionally, `etlStagingLocalEnabled` loads data from `/data/etl-staging-ui.json`.

### Feature Flags (`src/app/config/feature-flags.ts`)

All flags read from `VITE_*` env vars via `import.meta.env`. Defaults are designed for local dev without Firebase:
- `firebaseAuthEnabled` (default: false)
- `firestoreCoreEnabled` (default: false)
- `firebaseUseEnvConfig` (default: true)
- `firebaseUseEmulators` (default: false)
- `platformApiEnabled` (default: false)
- `demoLoginEnabled` (default: false)
- `etlStagingLocalEnabled` (default: false)
- `tenantIsolationStrict` (default: true)

### Multi-Tenancy

All Firestore paths scoped under `orgs/{orgId}/...`. Default org: `mysc`. Tenant validation in `src/app/platform/tenant.ts`.

### Key Directories

| Path | Purpose |
|------|---------|
| `src/app/components/<feature>/` | Feature UI modules (projects, payroll, cashflow, etc.) |
| `src/app/components/ui/` | Reusable UI primitives (shadcn-style) |
| `src/app/data/` | Stores, providers, types, mock data |
| `src/app/platform/` | Cross-cutting logic: RBAC, tenant, audit, business-days, cashflow-sheet, nav |
| `src/app/lib/` | Firebase client, Firestore service, BFF client |
| `server/bff/` | Express BFF (idempotency, outbox, queue workers, audit chain, PII encryption) |
| `policies/` | Policy-as-code JSON (RBAC matrix, relation rules) |
| `scripts/etl/` | Excel-to-Firestore ETL pipeline (5-step: discover → map → extract → validate → load) |
| `firebase/` | Firestore rules + composite indexes |
| `server/jvm-weekly-api/` | Spring Boot weekly-expense authority (Java 21, JPA, Flyway) |
| `server/mcp/` | MCP server exposing platform tools (`npm run mcp:myscube`) |
| `api/` | Vercel serverless entrypoints (`bff.js` hosts the Express BFF) |
| `rust/spreadsheet-calculation-core/` | Rust settlement/spreadsheet calculation kernel |
| `tests/e2e/` | Playwright harness suite (`playwright.harness.config.mjs`) |
| `docs/architecture/contracts/` | Dated, binding design contracts — read before touching cashflow |
| `guidelines/` | Operational runbooks, cutover plans, feature maps |

### BFF Server (`server/bff/`)

Express.js backend-for-frontend with: idempotency keys, outbox pattern with worker, work queue with projection rebuilds, audit chain hashing (append-only, tamper detection), PII encryption/rotation, RBAC policy enforcement, relation rules engine, transaction state machine, payroll auto-matching worker.

### RBAC & Permissions (`src/app/platform/rbac.ts`, `policies/rbac-policy.json`)

Roles: `admin`, `tenant_admin`, `finance`, `pm`, `viewer`, `auditor`, `support`, `security`. Permissions are `resource:action` strings (e.g., `project:write`, `transaction:approve`). The RBAC matrix lives in `policies/rbac-policy.json` and is loaded by both the frontend (`rbac.ts`) and the BFF (`rbac-policy.mjs`). Run `npm run policy:verify` to validate policy consistency.

### Relation Rules (`policies/relation-rules.json`)

Declarative rules that map entity mutations to affected projection views (used by the BFF work queue to rebuild projections after writes).

### Server Authority: Browser → BFF → JVM

Weekly expense and cashflow logic is being moved out of the frontend into a server-authoritative
chain. Understand which layer owns a decision before changing it:

- **Frontend** — preview/immediacy only. Never the source of truth for amounts, close state, or roles.
- **BFF** (`server/bff/`) — request shaping, idempotency, audit chain, tenant/RBAC gate. Talks to the
  JVM through `server/bff/java-weekly-client.mjs` (auth in `java-weekly-auth.mjs`, route surface in
  `server/bff/routes/jvm-weekly-api.mjs`). The client is **bounded**: ~12s per attempt, ~24s total,
  max 2 sends, then a stable `jvm_weekly_api_unreachable` error — it must return before the browser's
  27s timeout. JVM 5xx normalizes to `jvm_weekly_api_internal_error`; success responses are
  re-validated (`ok`, `commandName`, `projectId`, source/target revision) before being treated as applied.
- **JVM** (`server/jvm-weekly-api/`) — the authority for weekly expense validation, row/actual
  recalculation, month-close state, close deadlines, idempotency, and audit records. Commands are
  named (`weeklyExpense.saveDraft`, `weeklyExpense.projection.upsert`, …) and role-gated; the role
  table is extracted and verified by `npm run policy:verify`.

`api/bff.js` is the Vercel serverless entrypoint that hosts the same BFF app in production.

### Frozen Contracts — do not "improve" these

Two areas are deliberately frozen. Changes here are rejected in review, and one is enforced by CI.

1. **Cashflow coordinate contract** — `server/bff/cashflow-coordinates.mjs` is the single source of
   truth for the company-wide fixed sheet layout: one weekly block at `E:BL` (60 columns, one weekly
   year per project), annual columns fixed at `C:D` (2 prior) and `BM:BR` (6 following), and line
   identity by **row index** (`LINE_ROWS`), never by label string. Data outside those coordinates does
   not exist. A different layout is *rejected* with `CashflowTemplateMismatchError` ("양식이 다릅니다."),
   never adapted to via fallbacks or inference. `EMPTY` and `ZERO` are distinct cell states and are
   never collapsed or back-derived from an amount. Rationale:
   `docs/architecture/contracts/2026-07-28-cashflow-formula-validation-contract.md`.
2. **Sheet Lab one-way pipeline** — `server/bff/routes/cashflow-sheet-lab.mjs` is frozen by a CI job
   (`cashflow-sheet-lab-one-way-freeze`); any diff to that file fails the build.

### Deployment

Production deploys are **automatic, not manual**. `Production Deploy` and `JVM Production Deploy` are
triggered by `workflow_run` when `CI` succeeds on `main`, and deploy
`github.event.workflow_run.head_sha` only while it is still `main`'s head. The JVM deploys only when
`server/jvm-weekly-api/**` actually changed. Do not hand-dispatch these workflows (a manual dispatch
25s after merge failed the `Verify CI succeeded` guard and left a merged commit unshipped);
`workflow_dispatch` exists for rollback/retry only. Local production deploy is forbidden — see the
Firebase 운영 정책 section above and `DEPLOYMENT-SAFETY.md`.

## Coding Conventions

- TypeScript, React function components, 2-space indentation
- Component/page files: `PascalCase.tsx` (e.g., `AdminPayrollPage.tsx`)
- Route segments/folders: lowercase/kebab (e.g., `expense-management`)
- Cross-cutting rules go in `src/app/platform/`; feature UI in `src/app/components/<feature>/`
- Lazy-load pages: use `React.lazy()` with named export unwrapping pattern (`.then(m => ({ default: m.PageName }))`)
- Each context provider lives in its own `*-store.tsx` file in `src/app/data/`; helper/pure logic goes in `*-helpers.ts` with a co-located `.test.ts`
- Conventional Commits: `feat(cashflow): ...`, `fix(rbac): ...`, `docs: ...`
- PRs should include screenshots for UI changes and ops notes when Firestore rules/indexes or Vercel envs change

## Code Intelligence

Use the Understand-Anything skill at
`/Users/boram/Understand-Anything/understand-anything-plugin/skills/understand/SKILL.md` for codebase
orientation, impact analysis, and architecture questions. Prefer the generated graph at
`.understand-anything/knowledge-graph.json` when present; refresh with
`/understand /Users/boram/InnerPlatform --language ko`.

**Do not use GitNexus** — no `gitnexus_*` MCP tools, no `npx gitnexus`, no `.claude/skills/gitnexus/`
skill files. This is a standing repository policy (`AGENTS.md`).

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.
