# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

4. **`vercel --prod` 후 반드시 alias 확인**
   ```bash
   vercel alias <deployment-url> inner-platform.vercel.app
   ```

5. **새 Firebase 프로젝트 세팅 체크리스트**
   - [ ] Google Sign-In provider 활성화
   - [ ] Authorized domains에 production URL 추가
   - [ ] Firestore rules + indexes 배포
   - [ ] Storage bucket 초기화
   - [ ] members 컬렉션에 admin 사용자 등록 (새 UID로)

## Project Overview

MYSC 사업관리 통합 플랫폼 — an enterprise business management platform for a Korean social enterprise (MYSC). Manages projects, ledgers, transactions, payroll, cashflow, personnel, budgets, training, and career profiles. **All user-facing UI text is in Korean (한국어).**

## Commands

```bash
npm run dev              # Vite dev server (frontend, port 5173)
npm run build            # Production build
npm test                 # Unit tests (vitest run)
npm run test:watch       # Interactive test watch mode
npm run bff:dev          # Express BFF server on 127.0.0.1:8787
npm run bff:test:integration  # BFF integration tests (requires Firestore emulator)
npm run policy:verify    # RBAC policy-as-code verification
```

**Run a single test file:**
```bash
npx vitest run src/app/platform/rbac.test.ts
```

**Pre-PR gate:**
```bash
npm test && npm run bff:test:integration && npm run build
```

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
- **Backend:** Firebase/Firestore + Express BFF (`server/bff/`)
- **BFF language:** Plain JavaScript (`.mjs` files), not TypeScript
- **Testing:** Vitest + supertest (BFF integration); tests are co-located with source (`*.test.ts` next to implementation)
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

### BFF Server (`server/bff/`)

Express.js backend-for-frontend with: idempotency keys, outbox pattern with worker, work queue with projection rebuilds, audit chain hashing (append-only, tamper detection), PII encryption/rotation, RBAC policy enforcement, relation rules engine, transaction state machine, payroll auto-matching worker.

### RBAC & Permissions (`src/app/platform/rbac.ts`, `policies/rbac-policy.json`)

Roles: `admin`, `tenant_admin`, `finance`, `pm`, `viewer`, `auditor`, `support`, `security`. Permissions are `resource:action` strings (e.g., `project:write`, `transaction:approve`). The RBAC matrix lives in `policies/rbac-policy.json` and is loaded by both the frontend (`rbac.ts`) and the BFF (`rbac-policy.mjs`). Run `npm run policy:verify` to validate policy consistency.

### Relation Rules (`policies/relation-rules.json`)

Declarative rules that map entity mutations to affected projection views (used by the BFF work queue to rebuild projections after writes).

## Coding Conventions

- TypeScript, React function components, 2-space indentation
- Component/page files: `PascalCase.tsx` (e.g., `AdminPayrollPage.tsx`)
- Route segments/folders: lowercase/kebab (e.g., `expense-management`)
- Cross-cutting rules go in `src/app/platform/`; feature UI in `src/app/components/<feature>/`
- Lazy-load pages: use `React.lazy()` with named export unwrapping pattern (`.then(m => ({ default: m.PageName }))`)
- Each context provider lives in its own `*-store.tsx` file in `src/app/data/`; helper/pure logic goes in `*-helpers.ts` with a co-located `.test.ts`
- Conventional Commits: `feat(cashflow): ...`, `fix(rbac): ...`, `docs: ...`
- PRs should include screenshots for UI changes and ops notes when Firestore rules/indexes or Vercel envs change
