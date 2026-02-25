# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MYSC 사업관리 통합 플랫폼 — an enterprise business management platform for a Korean social enterprise (MYSC). Manages projects, ledgers, transactions, payroll, cashflow, personnel, budgets, training, and career profiles.

## Commands

```bash
npm run dev              # Vite dev server (frontend)
npm run build            # Production build
npm test                 # Unit tests (vitest run)
npm run test:watch       # Interactive test watch mode
npm run bff:dev          # Express BFF server on 127.0.0.1:8787
npm run bff:test:integration  # BFF integration tests (requires Firestore emulator)
npm run policy:verify    # RBAC policy-as-code verification
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

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite 6 + Tailwind CSS v4
- **UI:** MUI v7 + Radix UI + shadcn/ui patterns (in `src/app/components/ui/`)
- **Routing:** react-router v7 (browser router)
- **State:** React Context providers (no Redux/Zustand)
- **Forms:** react-hook-form + zod
- **Backend:** Firebase/Firestore + Express BFF (`server/bff/`)
- **Testing:** Vitest + supertest (BFF integration)
- **Node:** v24 (`.nvmrc`)
- **Module system:** ESM (`"type": "module"`)

Path alias: `@` → `./src`

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

## Coding Conventions

- TypeScript, React function components, 2-space indentation
- Component/page files: `PascalCase.tsx` (e.g., `AdminPayrollPage.tsx`)
- Route segments/folders: lowercase/kebab (e.g., `expense-management`)
- Cross-cutting rules go in `src/app/platform/`; feature UI in `src/app/components/<feature>/`
- Conventional Commits: `feat(cashflow): ...`, `fix(rbac): ...`, `docs: ...`
- PRs should include screenshots for UI changes and ops notes when Firestore rules/indexes or Vercel envs change
