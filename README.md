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
- `npm run bff:work-queue:worker`: process projection work queue jobs (`work_queue/*`).
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

## Firestore Automation System (비개발자 운영 가이드)

이 프로젝트는 Firebase/Firestore 운영 작업을 "명령 1개" 단위로 실행할 수 있게 자동화했습니다.  
목표는 개발자가 아니어도, 체크리스트만 따라가면 초기 세팅부터 운영 점검까지 끝내는 것입니다.

### 1) 자동화가 해주는 일

- Firebase 로그인 세션 안정화(daemon 방식).
- 프로젝트/웹앱 자동 탐지 후 `.env`, `.firebaserc` 자동 생성.
- Firestore 보안 규칙/복합 인덱스 배포.
- 로컬 Emulator 준비 및 실행.
- 백업 스케줄 생성/갱신, 복구 리허설 실행.
- 운영 알림(5xx/지연/충돌 비율) 정책 생성.
- Vercel 환경에서 PII 키 생성/배포/로테이션 지원.

### 2) 최초 1회 준비

- Node 24 권장: `nvm use 24`
- 의존성 설치: `npm install`
- Firebase 로그인(권장: daemon):
  - `npm run firebase:login:daemon:start`
  - 브라우저 코드 발급 후 `npm run firebase:login:daemon:submit -- '<authorization-code>'`
- 로그인 확인: `npm run firebase:whoami`

### 3) 표준 실행 순서(운영용)

1. 원샷 세팅: `npm run firebase:autosetup`
2. Google 로그인 활성화(콘솔 이동): `npm run firebase:open:google-auth`
3. 인덱스만 재배포(스키마/쿼리 변경 시): `npm run firebase:deploy:indexes`
4. 앱 실행 확인: `npm run dev`

### 4) 자동화 메뉴판 (상황별)

| 상황 | 실행 명령 | 자동 처리 내용 | 성공 기준 |
| --- | --- | --- | --- |
| 신규 환경 세팅 | `npm run firebase:autosetup` | 프로젝트 탐지, 웹앱 확인/생성, `.env`/`.firebaserc` 생성, rules/indexes 배포 | `.env` 생성 + deploy 완료 로그 |
| 이미 `.env` 있음 | `npm run firebase:bootstrap` | `.env` 검증 후 rules/indexes 배포 | missing env 에러 없이 완료 |
| 인덱스만 반영 | `npm run firebase:deploy:indexes` | Firestore composite indexes만 배포 | indexes deploy 완료 |
| 콘솔 설정 이동 | `npm run firebase:open:google-auth` | Google provider 설정 페이지 오픈 | Firebase Console 페이지 열림 |
| 로컬 테스트 | `npm run firebase:emulators:start` | Auth/Firestore/Storage emulator 실행 | emulator listening 로그 확인 |
| 백업 정책 | `npm run firestore:backup:schedule` | 백업 스케줄 생성/보존기간 업데이트 | schedule list 출력 |
| 복구 리허설 | `npm run firestore:backup:rehearsal` | 최신 백업을 별도 DB로 restore | restore 요청 성공 로그 |

### 5) 반드시 사람이 해야 하는 것

- Firebase Console에서 Google 로그인 Provider 활성화(보안/정책 승인 이슈로 완전 자동화 불가).
- 운영 권한 승인(IAM, 결제, 조직 정책)은 관리자 계정에서 수행.
- Vercel 사용 시 환경변수 반영 후 재배포 실행.

### 6) 자주 나는 오류와 즉시 조치

- `Unable to verify client`
  - 원인: 로그인 URL/코드 만료 또는 세션 불일치.
  - 조치: `firebase:login:daemon:start`를 다시 실행하고 새 코드로 즉시 submit.
- `No authorized accounts`
  - 원인: Firebase CLI 미로그인.
  - 조치: `npm run firebase:login` 또는 daemon 로그인 재실행.
- `Could not resolve Firebase project id`
  - 원인: `.env`/`.firebaserc`에 project id 없음.
  - 조치: `npm run firebase:autosetup` 먼저 실행.
- `Java 21+ is required`
  - 원인: Firestore emulator 실행 조건 미충족.
  - 조치: `brew install openjdk@21` 후 재실행.

### 7) 운영 문서(권장 읽기 순서)

- `guidelines/Firestore-Automation-System-Guide.md`: 비개발자용 상세 운영 핸드북.
- `guidelines/TIL-Firebase-Daemon-Setup.md`: 자동화 메뉴판 + 타 프로젝트 재사용 템플릿.
- `guidelines/Operational-Hardening-Runbook.md`: 인덱스/백업/알림/PII/정책 운영런북.

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

- `guidelines/Firestore-Automation-System-Guide.md`
  - 비개발자용 Firestore 자동화 운영 핸드북
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
- `guidelines/User-Feature-Enhancement-Backlog.md`
  - 사용자 기능 관점(ServiceNow급) 우선순위 백로그

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
- `POST /api/internal/workers/outbox/run` (protected; worker secret required)
- `POST /api/internal/workers/work-queue/run` (protected; worker secret required)
- `POST /api/v1/write`
- `GET /api/v1/views/:viewName`
- `GET /api/v1/queue/jobs`
- `POST /api/v1/queue/replay/:eventId`
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

Authentication mode:
- `BFF_AUTH_MODE=headers`: trust request headers (local/default).
- `BFF_AUTH_MODE=firebase_optional`: verify `Authorization: Bearer <Firebase ID token>` when present, else fallback to headers.
- `BFF_AUTH_MODE=firebase_required`: require/verify Firebase ID token and reject header spoofing (`actor_mismatch`, `tenant_mismatch`).

State transitions also require:
- `expectedVersion` in request body

State transition RBAC (permission-based):
- `SUBMITTED`: `transaction:submit`
- `APPROVED`: `transaction:approve`
- `REJECTED`: `transaction:reject`

Comment/Evidence RBAC (permission-based):
- comments: `comment:read` / `comment:write`
- evidences: `evidence:read` / `evidence:write`

Role change endpoint requires:
- `x-actor-role` allowed by policy (`policies/rbac-policy.json`)

List endpoints support deterministic pagination:
- query: `?limit=50&cursor=<lastDocumentId>`
- response: `nextCursor` (null when done)

Single write pipeline:
- `POST /api/v1/write` writes a canonical entity document (`project`, `ledger`, `transaction`, `expense_set`, `change_request`, `member`) with version checks.
- Same transaction creates `orgs/{tenantId}/change_events/{eventId}` and queue jobs in `work_queue/{jobId}`.
- Queue jobs rebuild projection views in `orgs/{tenantId}/views/{viewName}`.
- Manual replay endpoint: `POST /api/v1/queue/replay/:eventId`.

Relation-rule policy (no hardcoded cross-entity wiring in route code):
- `policies/relation-rules.json`
- Optional override: `orgs/{tenantId}/relation_rules/*`

Internal worker auth:
- `BFF_WORKER_SECRET` or `CRON_SECRET` must be set.
- Send one of:
  - `x-worker-secret: <secret>`
  - `Authorization: Bearer <secret>`

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

## Worker Strategy (Vercel / External)

For production, keep both asynchronous pipelines alive:
- outbox worker (`npm run bff:outbox:worker`)
- projection queue worker (`npm run bff:work-queue:worker`)

### Option A: Vercel Cron + internal worker endpoints (recommended on Vercel)

1. Expose protected internal endpoints in BFF for one-shot processing.
2. Configure Vercel Cron:
   - work queue: every minute
   - outbox: every 1-5 minutes
3. In each run, process bounded batches and return counts.
4. This repo includes default cron schedules in `vercel.json` (Hobby-safe daily):
   - `/api/internal/workers/work-queue/run`: `15 2 * * *`
   - `/api/internal/workers/outbox/run`: `30 2 * * *`
5. For near-real-time processing (every minute/5 minutes), use Vercel Pro cron or an external always-on worker.

### Option B: External always-on worker

Run loop mode in a dedicated runtime:

```bash
BFF_OUTBOX_LOOP=true BFF_OUTBOX_INTERVAL_MS=2000 npm run bff:outbox:worker
BFF_WORK_QUEUE_LOOP=true BFF_WORK_QUEUE_INTERVAL_MS=2000 npm run bff:work-queue:worker
```

Detailed runbook:
- `guidelines/Operational-Hardening-Runbook.md`

## Vercel Deployment (TDD Gate)

Deploy only after all gates pass:

```bash
npm test
npm run bff:test:integration
npm run build
```

Set required runtime envs in Vercel:
- Firebase/Vite envs (`VITE_FIREBASE_*`, `VITE_PLATFORM_API_ENABLED`, etc.)
- BFF envs (`BFF_AUTH_MODE`, `BFF_ALLOWED_ORIGINS`)
- Worker secret (`CRON_SECRET` recommended, or `BFF_WORKER_SECRET`)
- Firebase Admin credentials for server runtime:
  - `FIREBASE_SERVICE_ACCOUNT_JSON` (recommended), or
  - `FIREBASE_SERVICE_ACCOUNT_BASE64`

Deploy:

```bash
vercel login
vercel link
vercel --prod
```

Post-deploy smoke checks:
- `GET /api/v1/health`
- `POST /api/internal/workers/work-queue/run` with worker secret
- `POST /api/internal/workers/outbox/run` with worker secret

If worker endpoints return `500` with `Could not load the default credentials`, add Firebase Admin credentials envs above and redeploy.

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
- This branch intentionally excludes workflow file due GitHub token scope (`workflow`) limitation.
- Add `.github/workflows/bff-ci.yml` in a follow-up PR with proper token scope.

## Local Emulator Prerequisite

Install Java before starting emulators:

```bash
brew install openjdk@21
java -version
```
