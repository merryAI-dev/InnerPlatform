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
| `verify-firebase` | Firebase 프로젝트 전환/배포 전 env, auth, rules, members 정합성 검증 (알려진 실패 유형 10가지) |

두 가지 주의:
- 5개 스킬 모두 `disable-model-invocation: true` 입니다. **Claude 가 알아서 부를 수 없고**, 사용자가
  명시적으로 호출해야만 실행됩니다. 필요하면 "이 스킬을 돌려주세요" 라고 제안하세요.
- `verify-implementation` 과 `manage-skills` 의 스킬 레지스트리가 비어 있습니다
  (`(아직 등록된 검증 스킬이 없습니다)`). 그래서 `verify-implementation` 은 현재 **아무것도 실행하지
  않습니다** — 통합 검증을 돌렸다고 보고하면 안 됩니다.

`.claude/settings.json` 은 `SessionStart` 훅으로 `.claude/hooks/load-recent-changes.sh` 를 돌려
`docs/CHANGELOG.md` 마지막 20줄 + `git log --oneline -10` 을 세션 컨텍스트에 주입합니다
(`python3` 필요). 워크트리에서도 맞도록 `$CLAUDE_PROJECT_DIR` 대신 `git rev-parse --show-toplevel`
를 씁니다.

`.mcp.json` 이 등록하는 MCP 서버는 **`slack-qa` 하나뿐**입니다 (`SLACK_BOT_TOKEN` 을 셸에 export
해야 동작). 이 저장소 자체의 MCP 서버(`server/mcp/`, `npm run mcp:myscube`)는 등록되어 있지 않습니다.

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

`README.md` is a Korean **end-user/PM onboarding guide**, not developer setup — it documents
workflows and deadlines, not prerequisites or env vars. For configuration, read `.env.example`.

### Domain rules that look like formulas but are not

- `공급가액 = 통장금액 × 10/11` and `매입부가세 = 통장금액 − 공급가액` are **human-review candidates,
  not authoritative rules**. Never promote them to an automatic calculation, and never let a check
  pass on "수식 일치" alone — a matching formula is not a verified amount.
- PM weekly submission deadline is **Friday 18:00**; bank-statement upload accepts `.csv` / `.xlsx` /
  `.xls`.
- Before porting any spreadsheet calculation rule into code, run
  `npm run workbook:extract:formulas -- <workbook.xlsx>` to fix the SHA-256 workbook freeze line and
  generate the formula inventory. Porting from an unfrozen workbook is how silent drift starts.

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

**Pre-PR gate.** `.github/workflows/ci.yml` has **three** jobs, not one:

```bash
# job: test-and-build
npm test && npm run typecheck && npm run policy:verify && npm run build

# job: product-release-gates — needs JDK 21 (temurin) on PATH
npm run bff:test:integration
mvn -f server/jvm-weekly-api/pom.xml test
npm run test:settlement:integration
```

The third job, `edge-security-smoke`, runs `npm run security:edge-smoke:strict` and is **push-to-main
only** — it hits live Cloudflare and cannot be reproduced pre-PR.

CI does **not** run Playwright (`npm run test:e2e`) or the Rust tests
(`npm run rust:settlement:test`). Those are local-only gates, so a regression there ships green.

Test-runner boundaries worth knowing:
- `vitest.config.ts` only includes `src/**/*.test.ts` and `server/**/*.test.{ts,mjs}` — `npm test`
  **never touches `tests/`**.
- `npm run test:e2e` self-starts its own dev server (port 4173, `VITE_DEV_AUTH_HARNESS_ENABLED=true`)
  via Playwright's `webServer`. Do not start `npm run dev` first.
- `npm run bff:test:integration` **refuses to run unless `FIREBASE_PROJECT_ID` starts with `demo-`**
  (default `demo-bff-it`) — a deliberate prod-safety guard. It runs two emulator passes (firestore,
  then auth+storage) single-worker, and auto-relocates busy ports 8080/9099/9199.

**Typecheck baseline:** `vite build` does not typecheck, so `npm run typecheck` is the gate that
catches undefined identifiers before they ship as runtime crashes. The repo carries pre-existing
`tsc` errors, so `scripts/verify-typecheck-baseline.mjs` compares per-file error counts against
`typecheck-baseline.json` and fails only where a file's count **grew**. Never run
`npm run typecheck:baseline` (which rewrites the baseline) to make a failure disappear — fix the
new error instead. Two sharp edges: a file **absent** from the baseline is allowed 0 errors, and the
check compares **counts, not identities** — swapping one error for a different one in the same file
passes silently.

### Git hooks — `git commit` runs blocking gates

`.husky/pre-commit` can reject a commit for reasons unrelated to your code. In order:

1. **`scripts/check_patch_notes_guard.mjs`** — if you stage a mapped surface file (portal weekly
   expense, portal store, bank statement, budget, submissions, portal dashboard, payroll store,
   participation, dashboard, …), you must also stage the matching
   `docs/wiki/patch-notes/pages/*.md` **and** `docs/wiki/patch-notes/log.md`. Escape hatch:
   `SKIP_PATCH_NOTES_GUARD=1`.
2. **`scripts/qa_understand_gate.mjs --staged`** — fires when staged paths touch
   `src/app/components/{settings,projects,cashflow,portal}`, `project-department*`,
   `project-{cic,editor,change-request}*`, or `firebase/firestore.rules`.
3. Commit-size warnings at 500 / 1500 LOC — non-blocking.
4. **Auto-test**: for each staged `.ts`/`.tsx` non-test file it runs the co-located `*.test.*` via
   vitest and blocks on failure.

`.husky/post-commit` is informational only (fix/feat ratio stats). There is **no pre-push hook**, so
nothing catches a bad push locally — CI is the next gate.

Use `--no-verify` only when you can say which gate you are skipping and why.

**Firebase/Vercel ops:**
```bash
npm run firebase:deploy:firestore   # Deploy Firestore rules + indexes
npm run firebase:autosetup          # One-shot Firebase setup
npm run firebase:emulators:start    # Start Firestore emulator
npm run etl:build:staging-json      # Build ETL staging JSON from Excel
npm run etl:sync:staging            # Sync staging data to Firestore
```

### Worktrees — you are probably not in the main checkout

This repo is worked on through **many git worktrees at once** (`git worktree list` shows a dozen+
under `/Users/boram/orca/...`). The primary checkout is `/Users/boram/orca/MYSCube`; directories
under `/Users/boram/orca/workspaces/` and `/Users/boram/orca/.worktrees/` are worktrees of it.

- **`node_modules` is a symlink** to `/Users/boram/orca/MYSCube/node_modules` — it is **shared by
  every worktree**. Running `npm install` / `npm ci` in one worktree changes dependencies for all of
  them. Do not install to "fix" a local failure without saying so.
- Another Claude session may be live in a sibling worktree. Before broad edits, `git worktree list`
  and check whether your branch overlaps someone else's.
- `.canonical-deploy-repo` records that the canonical production repo is `inner-platform` at
  `/Users/boram/InnerPlatform`. Deploy tooling reads it; do not point it at a worktree.
- Branches are squash-merged, so `git branch --merged` under-reports what has actually shipped.

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

### Routing (`src/app/routes.tsx`)

Three top-level groups, not two:
- **Admin routes** (`/`): `AppLayout` — dashboard, projects, cashflow, payroll, audit, settings, etc.
- **Portal routes** (`/portal`): `PortalLayout` — PM/user-facing portal for expenses, budget, career
  profile, training, etc.
- **Layout-less routes**: `/login`, `/workspace-select`, `/mcp/authorize`, `/install`,
  `/install/ios`, `/install/android`, `/mobile-entry`. These render outside both layouts, so they
  get none of the route-scoped providers below.

`/` is not simply the dashboard — `MobileAwareAdminHome` serves `BusinessCardLabPage` on mobile and
`FeatureSearchPage` otherwise.

All pages are lazy-loaded via `React.lazy()` except where static import is needed for reliability.
Lazy loading goes through `src/app/platform/lazy-route.ts` + `preload-recovery.ts`, which catch the
stale-chunk-after-deploy failure and show the "새 버전이 배포되었습니다" reload prompt. If you change
how routes are imported, keep that recovery path intact.

### Route-Scoped Providers — not a global tree

`src/app/App.tsx` holds only the two providers every route needs:
`FirebaseProvider → AuthProvider → RouterProvider`. Everything else is mounted **per route**, and
`src/app/routes.provider-scope.test.ts` fails the build if an operational provider reappears at the
app root. Do not "simplify" by hoisting one back into `App.tsx`.

- `src/app/data/admin-route-providers.tsx` (`AdminRouteProviders`, wraps `AppLayout`)
- `src/app/data/portal-route-providers.tsx` (`PortalRouteProviders`, wraps `PortalLayout`)

Each computes a **scope from `location.pathname`** and mounts only the providers that scope needs
(`HrAnnouncement`, `Payroll`, `CashflowWeek`, `Board`, `Training`, plus `CareerProfile` on portal).
Adding a page that needs a store means extending `resolveAdminProviderScope` /
`resolvePortalProviderScope` — not wrapping the app.

Both wrappers end in `FirestoreRouteModeProvider`, and the mode differs by surface:
**admin runs `admin-live`** (realtime Firestore listeners) while **portal runs `portal-safe`**
(safe-fetch, no broad listeners). Portal regressions that look like "data not updating" are usually
this by design; see `docs/operations/2026-04-15-portal-direct-listen-safe-fetch.md`.

The two big data stores are mounted **inside the layouts**, one level deeper still: `AppProvider`
(`src/app/data/store.tsx`) inside `AppLayout`, and `PortalProvider`
(`src/app/data/portal-store.tsx`) inside `PortalLayout`. Admin and portal therefore do **not** share
a store instance.

### Data Layer (`src/app/data/store.tsx`) — reads and writes do not use the same switch

This is often described as a 3-way backend switch. It is not. Writes and reads resolve separately:

**Writes** (`src/app/data/store-write-strategy.ts`) are a strict precedence:
`platformApiEnabled → 'bff'` (with `mirrorRemoteWritesLocally`), else `firestoreCoreEnabled →
'firestore'`, else `'local'`.

**Reads** are a hybrid, and the Firestore branch has a *runtime* condition:
`firestoreEnabled = firestoreCoreEnabled && isOnline && !!db` — the flag alone is not enough. With
both BFF and Firestore on, **projects** read from the BFF and fall back to Firestore on failure,
while the other collections read Firestore directly. Debugging "why is this stale" starts here.

Mock seeding (`src/app/data/mock-data.ts`) applies only when
`!platformApiEnabled && !firestoreCoreEnabled`. `etlStagingLocalEnabled` is not a fourth mode — it
overlays projects/members from `/data/etl-staging-ui.json` only when Firestore reads are off.

### Feature Flags (`src/app/config/feature-flags.ts`)

These 8 typed flags are **not** the whole config surface — ~35 `VITE_*` vars are read across `src/`,
most of them outside this file (auth proxy `VITE_FIREBASE_AUTH_PROXY_*`, per-emulator toggles and
ports, `VITE_ALLOWED_EMAIL_DOMAINS`, `VITE_BOOTSTRAP_ADMIN_EMAILS`, `VITE_DEFAULT_ORG_ID`,
`VITE_PLATFORM_API_BASE_URL`, `VITE_DEV_AUTH_HARNESS_ENABLED`, `VITE_SENTRY_*`). `.env.example` is
the only complete list; grep it before assuming a knob doesn't exist.

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
| `src/app/features/<feature>/` | Newer home for feature code (currently `cashflow-sheet-compare`). Two conventions coexist — follow whichever the feature already uses |
| `src/app/integrations/` | External system adapters (`google-sheets/`) |
| `src/app/data/` | Stores, providers, types, mock data (`store.tsx` = admin, `portal-store.tsx` = portal) |
| `src/app/platform/` | ~230 files of cross-cutting logic — see below |
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
| `docs/operations/` | Dated runbooks, governance decisions, and postmortems |
| `guidelines/` | Operational runbooks, cutover plans, feature maps |
| `docs/wiki/patch-notes/` | Required companion edits for mapped surfaces (enforced by pre-commit) |

**The cashflow contracts are ordered by date and the latest one wins.** As of 2026-08 the active
direction is `docs/architecture/contracts/2026-08-18-cashflow-read-path-contract.md` — *JVM owns
writes, BFF owns reads*, collapsing the double assembly (JVM `dashboard-source` + BFF
`composeCashflowMonthDashboard`) that made the month-close screen take ~8.6s live. Its stated success
measure is **lines removed, not added**, and it explicitly targets the "if CLOSED, read the
snapshot" branch on the read side. Do not add a new layer here; read the contract first.

### `src/app/platform/` — the modules you will actually hit

Beyond RBAC/tenant/business-days, these are load-bearing and easy to break unknowingly:

| Module | Why it matters |
|--------|----------------|
| `observability.ts` | Sentry init, global handlers, tenant/user context, and forwarding client errors to `POST /api/v1/client-errors`. Most stores report through it. |
| `request-context.ts` | `buildStandardHeaders` / `createRequestId` — the tenant + actor + request-id header contract on every BFF call. |
| `api-client.ts` | The HTTP transport under `lib/platform-bff-client.ts`: timeouts, idempotency keys, retry set `{408,425,429,500,502,503,504}`. |
| `lazy-route.ts`, `preload-recovery.ts` | Stale-chunk-after-deploy recovery (see Routing above). |
| `settlement-calculation-kernel.ts` + `settlement-kernel-contract.ts` | TypeScript mirror of the Rust kernel, held to parity by tests. Change one side and you must change both. |
| `policies/cashflow-policy.ts` | Nested policy sub-directory — policy code is not all at the top level. |

### BFF Server (`server/bff/`)

Express.js backend-for-frontend with: idempotency keys, outbox pattern with worker, work queue with projection rebuilds, audit chain hashing (append-only, tamper detection), PII encryption/rotation, RBAC policy enforcement, relation rules engine, transaction state machine, payroll auto-matching worker.

Structure notes that save time:
- `app.mjs` is the composition root (~1700 lines of wiring); `server.mjs` is just the local listener.
- **Not every route lives in `routes/`.** `guide-chat.mjs` and `claude-sdk-help.mjs` mount their own
  routes from the BFF root. Grepping only `routes/` will miss them.
- **The product calls LLMs from the BFF.** `@anthropic-ai/sdk` in `guide-chat.mjs` /
  `claude-sdk-help.mjs`, and Gemini in `business-card-gemini-ai.mjs`,
  `google-sheet-migration-ai.mjs`, `project-request-contract-ai.mjs`.
- `edit-lease.mjs` + `routes/edit-leases.mjs` implement 30-minute collaborative edit locks over
  project-registration / project-info / cashflow. That is the concurrency model — don't invent another.
- `mcp-oauth.mjs` is an OAuth authorization server for the MCP integration, paired with the
  `/mcp/authorize` route.

**Workers are cron-triggered, not long-running.** Four workers — outbox, work-queue, payroll,
client-errors — are driven by **Vercel crons** in `vercel.json` hitting
`/api/internal/workers/<name>/run`. `server/bff/runtime-safety.mjs` enforces `BFF_WORKERS_ENABLED` and
`BFF_SCHEDULER_OWNER` (`manual|vercel|k8s|disabled`) and hard-refuses invalid combinations — e.g.
`manual` is blocked for a live BFF, and standalone worker processes are refused when the owner is
`vercel`. Production runs `true` / `vercel`; the Dockerfile ships `false` / `disabled`. Starting a
worker by hand in production is not a fallback, it is a blocked configuration.

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

### Constrained Contracts — do not "improve" these

These areas are deliberately constrained. Changes here are rejected in review.

1. **Cashflow coordinate contract** — `server/bff/cashflow-coordinates.mjs` is the single source of
   truth for the company-wide fixed sheet layout: one weekly block at `E:BL` (60 columns, one weekly
   year per project), annual columns fixed at `C:D` (2 prior) and `BM:BR` (6 following), and line
   identity by **row index** (`LINE_ROWS`), never by label string. Data outside those coordinates does
   not exist. A different layout is *rejected* with `CashflowTemplateMismatchError` ("양식이 다릅니다."),
   never adapted to via fallbacks or inference. `EMPTY` and `ZERO` are distinct cell states and are
   never collapsed or back-derived from an amount. Rationale:
   `docs/architecture/contracts/2026-07-28-cashflow-formula-validation-contract.md`.
2. **Sheet Lab one-way pipeline** — `server/bff/routes/cashflow-sheet-lab.mjs` (~206 KB) is the
   sheet→platform ingest. It is **no longer frozen by a CI job**; the guard is now its paired test
   `server/bff/routes/cashflow-sheet-lab.test.mjs` (~211 KB, same order of magnitude on purpose).
   Any behavior change must land in the pair together — a diff to the route with no matching test
   change is the review signal. The pipeline stays one-way: platform state never writes back to the
   sheet.

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
- Each context provider lives in its own `*-store.tsx` file in `src/app/data/`; helper/pure logic goes in `*-helpers.ts` with a co-located `.test.ts`. (Known exception: `FirestoreRouteModeProvider` lives in `src/app/data/firestore-realtime-mode.ts`.)
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
