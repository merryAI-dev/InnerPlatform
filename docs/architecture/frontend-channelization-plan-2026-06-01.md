# Frontend Channelization Plan

작성일: 2026-06-01

목표: 프론트엔드를 업무 판단/저장 주체가 아니라 사용자 intent를 제출하고 결과를 보여주는 채널로 낮춘다. BFF는 권한, tenant scope, write, audit의 관문이 되고 Rust/domain engine은 재현 가능한 계산, 파싱, 매칭을 담당한다.

운영 방식: 완료한 항목은 이 문서에서 제거한다. 남아 있는 항목이 곧 다음 작업 큐다.

선행 조건: production write path, Firestore rules, irreversible action을 바꾸기 전 [Data Backup And Sheet Export Policy](/Users/boram/InnerPlatform/docs/operations/2026-06-01-data-backup-and-sheet-export-policy.md)의 최소 백업 기준을 충족해야 한다.

## 원칙

- 프론트 권한 로직은 UX 표시용으로만 사용한다.
- 최종 권한 판정은 BFF가 한다.
- tenant/org scope는 프론트 localStorage나 선택값을 신뢰하지 않고 서버에서 확정한다.
- Firestore write는 점진적으로 BFF action으로 이동한다.
- audit log는 프론트가 직접 쓰지 않고 BFF action middleware에서 남긴다.
- Rust/domain engine은 정책 주인이 아니라 deterministic calculation/parse/match engine으로 둔다.
- 기존 기능을 통째로 되돌리거나 파일째 cherry-pick하지 않고, 작은 action 단위로 이동한다.
- 같은 작업 디렉토리에서 다른 에이전트가 작업 중일 수 있으므로 unrelated dirty changes를 건드리지 않는다.

## 정책 인벤토리 스냅샷

### Frontend 정책

- `policies/nav-policy.json`: admin shell route/nav visibility. `admin`은 full access, `finance`, `pm`, `viewer`는 route allow-list 기반.
- `policies/rbac-policy.json`: role -> permission mapping. `admin`, `finance`, `pm`, `viewer`만 정식 role로 정의되어 있고 `tenant_admin`은 포함되지 않음.
- `src/app/platform/rbac.ts`: frontend RBAC helper. `rbac-policy.json`을 읽어 `hasPermission`, `canAccessProject`, `canAccessTenant`를 제공.
- `src/app/platform/admin-nav.ts`: frontend route/nav helper. `nav-policy.json`을 읽어 `canShowAdminNavItem`, `canAccessAdminPath`를 제공.
- `src/app/platform/navigation.ts`: workspace 선택, post-login redirect, admin/portal entry 결정.
- `src/app/platform/request-context.ts`: BFF 호출용 표준 헤더 생성. `x-tenant-id`, `x-actor-id`, `x-actor-role`, `authorization`, `idempotency-key`를 프론트에서 조립.
- `src/app/platform/tenant.ts`: tenant id validation/path helper. 프론트가 tenant id를 검증하고 scoped path를 만들 수 있음.

### BFF 정책

- `server/bff/auth.mjs`: BFF 요청 identity 해석. production 기본은 Firebase token required, local 기본은 header mode. token tenant와 `x-tenant-id`가 다르면 403.
- `server/bff/rbac-policy.mjs`: BFF도 `policies/rbac-policy.json`을 읽어 `actorHasPermission`, `canActorAssignRole`을 제공.
- `server/bff/app.mjs`: BFF route mount와 공통 서비스 조립. `createAuditChainService`, idempotency, outbox, work queue, RBAC policy loader가 여기에서 연결됨.
- `server/bff/routes/*`: 이미 일부 action은 BFF화되어 있음. `projects`, `ledgers`, `transactions`, `members`, `cashflow-exports`, `audit`, `business-cards` route가 존재.
- `server/bff/runtime-safety.mjs`: deploy env, worker authorization, live/emulator guard.

### Firestore rules

- `firebase/firestore.rules`: 멤버십 기반 tenant isolation. `orgs/{orgId}/members/{uid}` 존재 여부가 tenant membership 기준.
- `members`: 최초 자기 등록은 `pm`으로만 허용. admin은 전체 write 가능.
- `audit_logs`, `contacts`, `business_card_imports`, `contact_events`, `notifications` 일부는 BFF-only 또는 제한됨.
- catchall은 `viewer` 제외 `admin`, `finance`, `pm`에게 write 허용. 이 때문에 아직 많은 프론트 직접 write가 가능함.

### Rust/domain engine

- `rust/spreadsheet-calculation-core`: settlement sheet calculation core. 정책/권한 엔진이 아니라 spreadsheet 계산 policy를 받는 deterministic calculation kernel 성격.
- 현재 action-level auth, tenant scope, Firestore write의 주체는 Rust가 아니라 frontend/BFF/Firestore rules에 분산되어 있음.

### 주요 갭

- `tenant_admin`은 일부 UI/BFF schema에서 언급되지만 `policies/rbac-policy.json`의 정식 role에는 없음.
- route/nav 정책과 action 권한 정책이 분리되어 있어 UI 노출과 실제 action 권한이 따로 움직일 수 있음.
- 프론트가 `x-tenant-id`와 actor headers를 구성하며, BFF는 token mode에서 검증하지만 header mode에서는 프론트/클라이언트 헤더를 신뢰함.
- Firestore catchall write가 넓어서 BFF로 옮기려는 write도 프론트에서 계속 가능함.
- BFF route가 이미 있는 영역과 프론트 직접 write 영역이 혼재되어 action boundary가 불분명함.

## Action Policy Manifest 스냅샷

- `policies/actions-policy.json`을 추가했다.
- 현재는 런타임 미연결 draft이며, BFF/frontend가 action-level policy를 공유하기 위한 기준 파일이다.
- 포함된 초기 action:
  - `tenant.create`
  - `tenant.delete`
  - `member.upsert`
  - `member.delete`
  - `project.approve`
  - `project.reject`
  - `migration.commit`
  - `bankReconciliation.confirm`
  - `payroll.confirm`
  - `monthlyClose.confirm`
- 각 action은 `roles`, `scope`, `permission`, `audit`, `irreversible`, `owner`, `status`를 가진다.

## 첫 번째 이동 후보

- 1순위는 멤버/테넌트 원장 write 이동이다.
- 이유:
  - 보안 민감도가 높고 blast radius가 비교적 작다.
  - BFF에는 이미 `server/bff/routes/members.mjs`가 있어 멤버 권한 변경, auth governance, audit chain 패턴을 재사용할 수 있다.
  - 테넌트 원장 write는 현재 `TenantManagementTab.tsx`에서 `tenants` top-level collection에 직접 `setDoc/deleteDoc`한다.
  - 멤버 원장 write는 현재 SettingsPage/useAppStore 경유로 Firestore 직접 write한다.
- 다음 구현 단위:
  - BFF `member.upsert`, `member.delete` route 추가 또는 기존 member route 확장
  - BFF `tenant.create`, `tenant.delete` route 추가
  - frontend API client 추가
  - `SettingsPage`와 `TenantManagementTab`의 직접 Firestore write 제거
  - BFF authorization/audit/idempotency 테스트 추가

## 남은 작업

### 1. 프론트 권한 격하

#### 목표

프론트의 권한 로직을 보안 경계가 아니라 UX 표시/탐색 보조 장치로 명확히 격하한다.

#### 작업

- `src/app/platform/rbac.ts` 주석과 테스트 이름에서 frontend RBAC가 UX guard임을 명시한다.
- `src/app/platform/admin-nav.ts`의 `canShowAdminNavItem`, `canAccessAdminPath`가 server enforcement가 아님을 명시한다.
- `SettingsPage`의 admin check는 유지하되, 서버 action 실패를 최종 권한 실패로 처리하는 구조를 만든다.
- `admin-nav.test.ts`와 관련 shell test 이름/설명을 visibility test로 정리한다.
- `policies/actions-policy.json`의 action permission과 `policies/nav-policy.json`의 route visibility가 다른 목적임을 문서화한다.

#### 완료 기준

- 프론트 정책 테스트가 "보여줄지"만 검증한다.
- BFF action authorization test가 "실제로 허용할지"를 검증한다.
- 권한 설명 문서에서 frontend guard와 BFF enforcement가 분리되어 있다.

### 2. Tenant/Org Scope 서버 확정

#### 목표

프론트가 선택한 tenant/org 값을 최종 신뢰하지 않고 BFF가 actor claim/session 기준으로 scope를 확정한다.

#### 작업

- 현재 tenant source 우선순위를 문서화한다.
  - Firebase custom claim
  - saved/localStorage tenant
  - env tenant
  - default tenant
- `TenantSwitcher`의 역할을 "active tenant request UI"로 제한한다.
- `src/app/platform/request-context.ts`에서 `x-tenant-id`가 target tenant 후보임을 주석으로 명시한다.
- `server/bff/auth.mjs`의 token tenant/header tenant mismatch 테스트를 action route에도 적용한다.
- header auth mode가 필요한 local/dev 범위를 문서화한다.
- production에서 `BFF_AUTH_MODE=firebase_required`가 아닌 경우 배포 전 실패하도록 runtime safety 확인을 강화한다.

#### 완료 기준

- BFF token mode에서 프론트가 임의 `x-tenant-id`를 보내도 claim과 다르면 403이다.
- local header mode의 위험과 사용 범위가 문서화되어 있다.
- tenant switch UI가 Firestore write 권한을 직접 의미하지 않는다.

### 3. 멤버/테넌트 원장 Write BFF 이동

#### 목표

관리자 원장 write를 프론트 직접 Firestore write에서 BFF action으로 이동한다.

#### 작업 A: BFF 멤버 원장 API

- `server/bff/routes/members.mjs`에 member upsert/delete action을 추가한다.
  - `POST /api/admin/members/upsert`
  - `DELETE /api/admin/members/:uid`
- `policies/actions-policy.json`의 `member.upsert`, `member.delete`와 role/permission을 맞춘다.
- `canActorAssignRole` 또는 action permission 검증을 적용한다.
- last admin lockout 방어를 delete에도 적용한다.
- audit chain에 `MEMBER_UPSERT`, `MEMBER_DELETE` action을 기록한다.
- idempotency를 mutation route에 적용한다.

#### 작업 B: BFF 테넌트 원장 API

- 새 route 파일을 만든다.
  - `server/bff/routes/tenants.mjs`
- API를 추가한다.
  - `GET /api/admin/tenants`
  - `POST /api/admin/tenants`
  - `DELETE /api/admin/tenants/:id`
- `tenant.create`, `tenant.delete` policy와 role/permission을 맞춘다.
- `mysc` 기본 tenant 삭제 금지, 활성 tenant 삭제 금지, tenant id validation을 BFF에서 강제한다.
- top-level `tenants/{id}` write와 필요 시 `orgs/{id}` bootstrap 여부를 명확히 결정한다.
- audit chain에 `TENANT_CREATE`, `TENANT_DELETE`를 기록한다.

#### 작업 C: 프론트 교체

- `src/app/platform/admin-ledger-api.ts` 또는 유사 client를 추가한다.
- `SettingsPage`의 `upsertMember`, `removeMember` 직접 store write 경로를 BFF API 호출로 교체한다.
- `TenantManagementTab.tsx`의 `getDocs/setDoc/deleteDoc` 직접 호출을 BFF API 호출로 교체한다.
- 에러 메시지는 BFF response code/reason을 표시한다.
- 성공 후 local store 또는 query를 refresh한다.

#### 완료 기준

- 멤버/테넌트 원장 write가 프론트 Firestore SDK 없이 동작한다.
- admin 외 role의 BFF write 호출은 403이다.
- BFF audit log가 남는다.
- 기존 설정/테넌트 원장 UI는 유지된다.

### 4. Irreversible Action BFF 이동

#### 목표

승인/반려/확정/commit처럼 되돌리기 어렵거나 회계/운영 상태를 바꾸는 action을 BFF로 이동한다.

#### 우선순위

1. `project.approve`
2. `project.reject`
3. `migration.commit`
4. `bankReconciliation.confirm`
5. `payroll.confirm`
6. `monthlyClose.confirm`

#### 공통 작업

- 각 action의 request/response schema를 `server/bff/schemas.mjs`에 추가한다.
- `policies/actions-policy.json`의 action과 BFF route를 매핑한다.
- BFF에서 auth, tenant scope, role/permission, idempotency, audit를 공통 처리한다.
- 프론트는 preview와 intent payload 생성까지만 담당한다.
- Firestore write는 BFF에서만 수행한다.
- 서버 validation 실패 사유를 UI toast/detail panel에 표시한다.

#### 완료 기준

- irreversible action은 프론트 Firestore SDK write 없이 완료된다.
- 같은 idempotency key로 중복 호출해도 중복 반영되지 않는다.
- audit chain과 outbox/work queue가 필요한 action에 연결된다.

### 5. Rust/Domain Engine 경계 정리

#### 목표

프론트에 있는 재현 가능해야 하는 계산/파싱/매칭 로직을 domain engine 경계로 분리한다.

#### 후보 분류

- Rust 우선 후보
  - settlement CSV parsing
  - bank statement parsing
  - bank reconciliation matching
  - cashflow calculation
  - payroll review/liquidity calculation
- TypeScript domain module 유지 후보
  - budget tree normalization
  - google sheet migration transform preview
  - UI 표시용 lightweight summary
- BFF 전담 후보
  - engine 호출
  - validation
  - 저장
  - audit

#### 작업

- `src/app/platform/*`에 있는 domain 함수 중 순수 함수와 side-effect 함수를 분리한다.
- Rust 이동 후보별 input/output JSON schema를 정의한다.
- BFF에서 Rust kernel 호출 방식을 결정한다.
  - node child process
  - wasm
  - 별도 service
- 먼저 read-only/preview 경로부터 engine 호출로 전환한다.
- commit/write 경로는 BFF action으로 묶은 뒤 engine 결과를 저장한다.

#### 완료 기준

- 같은 input에 대해 engine output이 deterministic하다.
- 프론트는 engine 결과를 표시하고 수정 intent만 만든다.
- 확정 저장은 BFF action으로만 수행된다.

### 6. Audit Log 서버화

#### 목표

감사 로그를 클라이언트가 작성하지 않고 서버가 실제 action 성공 시점에 기록하게 한다.

#### 작업

- 프론트 `src/app/platform/audit-log.ts`의 직접 write 사용처를 조사한다.
- 새 action route에는 BFF audit chain append를 필수화한다.
- audit event schema를 고정한다.
  - action
  - actorId
  - actorRole
  - actorEmailEnc
  - tenantId
  - target entity
  - requestId
  - idempotencyKey
  - before/after 또는 metadata
- 실패 action은 별도 security/error event로 남길지 결정한다.
- Firestore rules에서 `audit_logs` client write 금지 상태를 유지한다.

#### 완료 기준

- 새 BFF action은 성공 시 audit chain append를 수행한다.
- 프론트 직접 audit write 신규 사용이 생기지 않도록 테스트 또는 grep guard가 있다.
- audit log 생성 실패 시 action 실패/보류 정책이 명확하다.

### 7. Firestore Direct Write 축소

#### 목표

Firestore direct write를 위험도 순으로 줄이고 rules catchall write를 좁힌다.

#### 이동 순서

1. `tenants`
2. `members`
3. `auditLogs`
4. `projectRequests`
5. `projects`
6. `payrollRuns`
7. `monthlyCloses`
8. `transactions`
9. `ledgers`
10. `cashflowWeeks`

#### 컬렉션별 작업 템플릿

- 현재 프론트 write 사용처를 `rg "setDoc|updateDoc|deleteDoc|writeBatch|runTransaction"`으로 수집한다.
- write action을 `policies/actions-policy.json`에 등록한다.
- BFF route/schema/test를 추가한다.
- frontend API client로 교체한다.
- Firestore rules에서 해당 collection direct write를 좁힌다.
- emulator/integration test로 direct write 차단과 BFF write 성공을 확인한다.

#### 완료 기준

- 해당 collection의 신규 write는 BFF route를 통한다.
- Firestore rules가 direct client write를 차단하거나 필요한 self-service write만 허용한다.
- 기존 read path는 영향 없이 유지된다.

### 8. 회귀 테스트

#### 목표

UI orphan, 권한 mismatch, tenant scope 우회, direct write 회귀를 자동으로 잡는다.

#### 테스트 목록

- policy manifest contract test
  - `actions-policy.json` JSON/schema 검증
  - action permission이 `rbac-policy.json`에 존재하는지 검증
  - action role이 정식 role인지 검증
- frontend nav visibility test
  - admin만 원장 메뉴를 본다.
  - `/settings?tab=members`, `/settings?tab=tenants`가 fallback되지 않는다.
- BFF action authorization test
  - admin 성공
  - finance/pm/viewer 403
  - missing/invalid token 401
- tenant scope enforcement test
  - claim tenant와 header tenant mismatch 403
  - cross-tenant target 차단
- Firestore write wrapper test
  - migrated collection에 프론트 직접 write 신규 사용처가 없는지 grep/shell test
- audit log creation test
  - action 성공 시 audit chain append
  - audit metadata에 requestId/action/entity 포함

#### 완료 기준

- 새 action을 추가할 때 정책, BFF auth, frontend visibility, audit 테스트가 같이 추가된다.
- orphan route/tab/link를 shell test로 잡는다.

## 실행 순서

0. Firestore native export와 sheet snapshot backup gate 완료
1. 멤버/테넌트 원장 BFF API 구현
2. 멤버/테넌트 원장 프론트 API client 교체
3. 원장 write 관련 Firestore direct write 축소
4. 프론트 권한 UX guard 명명과 테스트 정리
5. tenant/org scope 서버 확정 테스트 강화
6. audit log 서버화 가드 추가
7. irreversible action을 우선순위대로 BFF action화
8. Rust/domain engine 경계 정리와 preview 경로부터 이동

## 첫 번째 권장 작업

1. 백업 실행 스크립트/런북을 먼저 구현
2. production Firestore native export와 tenant별 sheet snapshot 생성
3. manifest/redaction/sample restore 검증
4. 멤버/테넌트 원장 BFF API부터 구현
5. BFF authorization/audit/idempotency 테스트 추가
6. 프론트 원장 UI를 BFF API client로 교체
7. 해당 direct Firestore write 사용처를 제거
