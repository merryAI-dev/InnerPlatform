# Business Management Platform

Business Management Platform frontend bundle (Vite + React + TypeScript).
Original design source: https://www.figma.com/design/HUL2PbwDK68w46Nzl5sVCn/Business-Management-Platform.

## Getting Started

```bash
nvm use 24 # or install Node 24 first
npm install
cp .env.example .env
npm run dev
```

## Scripts

- `npm run dev`: start local Vite server.
- `npm run build`: production build.
- `npm test`: run unit tests (Vitest).
- `npm run bff:dev`: start local BFF API server (`/api/v1/*`) on `127.0.0.1:8787`.
- `npm run bff:seed:demo`: seed demo project/transaction documents for BFF validation.
- `npm run bff:test:integration`: run Firestore emulator + BFF integration tests (real writes/reads).
- `npm run bff:cleanup:idempotency`: delete expired idempotency keys.
- `npm run bff:outbox:worker`: process outbox events with retry/dead-letter status updates.
- `npm run bff:deploy:cloud-run`: build/push/deploy BFF to Cloud Run (requires gcloud/docker auth).
- `npm run firebase:whoami`: check Firebase CLI login status.
- `npm run firebase:login`: login to Firebase CLI.
- `npm run firebase:login:daemon:start`: start persistent login flow and auto-open browser URL.
- `npm run firebase:login:daemon:submit -- '<authorization-code>'`: submit code without needing an active terminal prompt.
- `npm run firebase:login:daemon:status`: inspect daemon/login state.
- `npm run firebase:open:google-auth`: open Firebase Console Google provider page for current project.
- `npm run firebase:autosetup`: auto-detect project/app, write `.env` and `.firebaserc`, deploy Firestore rules/indexes.
- `npm run firebase:bootstrap`: validate `.env`, generate `.firebaserc`, and deploy Firestore rules/indexes when logged in.
- `npm run firebase:deploy:firestore`: deploy only Firestore rules/indexes.
- `npm run firebase:deploy:indexes`: deploy only Firestore composite indexes.
- `npm run firebase:fill-env -- '<firebaseConfig-json>'`: fill `.env` from copied Firebase web config JSON.
- `npm run firebase:emulators:prepare`: generate `.env.local` + `.firebaserc` for local emulator mode.
- `npm run firebase:emulators:start`: run Auth/Firestore/Storage emulators with local overrides.
  - Requires Java 21+ for Firestore emulator.
- `npm run firestore:backup:schedule`: create/update managed Firestore backup schedule.
- `npm run firestore:backup:rehearsal`: restore latest backup into rehearsal database for recovery drill.
- `npm run monitoring:setup:alerts`: create/update 5xx/latency/version-conflict alert policies.
- `npm run pii:rotate`: rotate encrypted PII fields to current key.
- `npm run pii:setup:vercel`: generate/push Vercel-ready local PII keys (no GCP KMS).
- `npm run policy:verify`: verify RBAC policy-as-code file integrity.

## Firebase Runtime Configuration

Set Firebase runtime values in `.env`:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Feature flags:

- `VITE_FIREBASE_AUTH_ENABLED=true`: enable Google Auth login flow.
- `VITE_FIRESTORE_CORE_ENABLED=true`: enable Firestore-backed core data store.
- `VITE_FIREBASE_USE_ENV_CONFIG=true`: prioritize env config over local saved config.
- `VITE_DEFAULT_ORG_ID=mysc`: default org scope path (`orgs/{orgId}/...`).
- `VITE_FIREBASE_USE_EMULATORS=false`: when true, app connects to local Firebase emulators.
- `VITE_TENANT_ISOLATION_STRICT=true`: strict validation for tenant ids and scoped paths.
- `VITE_FIREBASE_EMULATOR_HOST=127.0.0.1`
- `VITE_FIRESTORE_EMULATOR_PORT=8080`
- `VITE_FIREBASE_AUTH_EMULATOR_PORT=9099`
- `VITE_FIREBASE_STORAGE_EMULATOR_PORT=9199`
- `VITE_PLATFORM_API_ENABLED=false`: route selected mutations through BFF (`/api/v1`).
- `VITE_PLATFORM_API_BASE_URL=http://127.0.0.1:8787`

## Firestore Rules

Security rules/index templates were added under `firebase/`:

- `firebase/firestore.rules`
- `firebase/firestore.indexes.json`

## Firebase Auth Quick Link

Enable Google login provider:

```bash
npm run firebase:open:google-auth
```

Reference doc:

- `guidelines/TIL-Firebase-Daemon-Setup.md`
  - Firebase 자동화 메뉴판 + 타 프로젝트 재사용 가이드
- `guidelines/Platform-Foundation-Roadmap.md`
  - 멀티테넌시/RBAC/Audit 기반 구현 현황 + 다음 실행 블록
- `guidelines/Data-Stability-Backlog.md`
  - 데이터 안정성 강화 우선순위 백로그(P0~P2)
- `guidelines/Data-Stability-Implemented.md`
  - 이번 구현에서 실제 반영된 P0 안정성 항목
- `guidelines/Operational-Hardening-Runbook.md`
  - 인덱스/아웃박스/백업/알림/PII/정책 운영 런북

## Platform Foundation (Q1)

Implemented core enterprise foundation modules under `src/app/platform/`:

- `tenant.ts`: tenant ID validation + safe org path helpers.
- `request-context.ts`: standard request headers (`x-request-id`, `x-tenant-id`, `x-actor-id`) and idempotency key generation.
- `api-client.ts`: fetch wrapper for API v1-style requests with consistent metadata, retry/backoff, and timeout handling.
- `rbac.ts`: claim parsing and permission/tenant access helpers.
- `audit-log.ts`: normalized audit event schema used by Firestore service writes.

## BFF Flow (Option 2 + 1)

Run BFF first, then execute real-data integration tests:

```bash
npm run bff:dev
npm run bff:seed:demo
npm run bff:test:integration
```

## BFF API Surface

- `GET /api/v1/health`
- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/ledgers`
- `POST /api/v1/ledgers`
- `GET /api/v1/transactions`
- `POST /api/v1/transactions`
- `PATCH /api/v1/transactions/:txId/state`
- `GET /api/v1/transactions/:txId/comments`
- `POST /api/v1/transactions/:txId/comments`
- `GET /api/v1/transactions/:txId/evidences`
- `POST /api/v1/transactions/:txId/evidences`
- `GET /api/v1/audit-logs`
- `GET /api/v1/audit-logs/verify`
- `PATCH /api/v1/members/:memberId/role`

Mutating endpoints require:
- `x-tenant-id`
- `x-actor-id`
- `idempotency-key`

State transitions also require:
- `expectedVersion` in request body

Role change endpoint requires:
- `x-actor-role` allowed by policy (`policies/rbac-policy.json`)

BFF runtime env template:
- `server/bff/.env.example`

## Data Hardening (P0 + Ops)

- Audit log chain hashing:
  - append-only logs with `chainSeq`, `prevHash`, `hash`
  - tamper check endpoint: `GET /api/v1/audit-logs/verify`
- Outbox pattern:
  - mutation events are persisted to `outbox/*` in the same write transaction/batch
  - worker retries and moves exhausted events to `DEAD`
- PII encryption and rotation:
  - `PII_MODE=local|kms|auto|off`
  - local keyring (`PII_LOCAL_KEYRING`) or Cloud KMS (`PII_KMS_KEYS`)
  - rotation script: `npm run pii:rotate`
- Policy-as-code:
  - RBAC role-change policy stored at `policies/rbac-policy.json`
  - verifier in CI: `npm run policy:verify`
- Monitoring:
  - alert setup script provisions 5xx ratio, p95 latency, version-conflict ratio alerts
- Backup/recovery rehearsal:
  - schedule backups and run restore drills via `firestore:backup:*` scripts

## Cloud Run Deployment

Local deploy script:

```bash
export FIREBASE_PROJECT_ID=<gcp-project-id>
export REGION=asia-northeast3
npm run bff:deploy:cloud-run
```

Cloud Build pipeline file:
- `cloudbuild.bff.yaml`

Container build source:
- `server/bff/Dockerfile`

GitHub CI workflow:
- `.github/workflows/bff-ci.yml`

## Local Emulator Prerequisite

Install Java before starting emulators:

```bash
brew install openjdk@21
java -version
```
