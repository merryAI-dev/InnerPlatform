# Server-Authoritative Spring Cutover Roadmap

> 기준 문서: [server-authoritative-spring-cutover-spec-2026-04-06.md](/Users/boram/InnerPlatform/docs/architecture/server-authoritative-spring-cutover-spec-2026-04-06.md)

날짜: 2026-04-06
목표 기간: 6~12개월
리뷰 관점: `superpowers:writing-plans` + `codex-stack-autoplan` 기준을 수동 적용

## 1. 한 줄 전략

`Firestore direct product model`을 도메인별로 잘라내고, `Spring + Postgres + outbox worker`를 authoritative core로 세운 뒤, 마지막에 Express BFF와 direct Firestore 경로를 폐기합니다.

## 2. North Star

다음 문장을 제품/플랫폼 공통 목표로 고정합니다.

> 사용자가 보는 핵심 상태는 React local state나 Firestore listener가 아니라, Spring command 처리와 Postgres persisted version에서 나온다.

## 3. 4개 프로그램 트랙

### Track A. Platform Core

- Spring Boot app bootstrap
- Postgres schema foundation
- auth, tenancy, RBAC
- idempotency, audit, outbox, work queue

### Track B. Finance Domain Cutover

- weekly expense
- settlement persistence
- cashflow sync
- budget actuals
- payroll

### Track C. Product Surface Migration

- frontend query client / command client
- record shell / queue / trust surface
- dirty draft vs persisted version contract

### Track D. Data Migration & Operations

- Firestore to Postgres migration
- dual read / dual write windows
- observability
- rollback / cutover runbooks

## 4. Phase Roadmap

## Phase 0. Decision Freeze and Team Setup

기간: 1~2주

산출물:

- architecture freeze
- target stack decision
- team ownership map
- migration scorecard

해야 할 일:

- Kotlin vs Java를 확정한다. 권장: Kotlin.
- Postgres hosting, migration policy, secret policy를 확정한다.
- 도메인별 owner를 정한다.
- Express/Firestore direct 금지 규칙을 새 feature policy로 추가한다.

Gate:

- CTO/제품/플랫폼이 cutover spec 승인
- 새 기능이 더 이상 Firestore direct authority를 늘리지 않음

## Phase 1. Authoritative Platform Core

기간: 4~6주

목표:

- Spring core가 실제 command server로 서기 시작한다.

구현 범위:

- tenant-aware auth
- RBAC normalization
- request id / idempotency
- audit trail table
- outbox table + worker
- project / member / transaction 최소 aggregate 골격

데이터 모델 초안:

- `tenants`
- `users`
- `memberships`
- `projects`
- `project_versions`
- `transactions`
- `transaction_versions`
- `audit_events`
- `idempotency_keys`
- `outbox_events`

출구 기준:

- hello-world 수준이 아니라 실제 authenticated command가 Postgres에 versioned write를 남긴다.

## Phase 2. Weekly Expense Vertical Slice

기간: 6~8주

목표:

- 가장 문제를 크게 일으키는 weekly expense 흐름을 서버 권위로 옮긴다.

범위:

- expense sheet draft save
- settlement row snapshot persistence
- save result version response
- async cashflow sync trigger
- sync result projection

변경 후 UX:

- 편집 중 값은 local draft
- 저장 클릭 또는 autosave 시 Spring command 호출
- 성공 시 `persisted version` 반환
- cashflow sync는 background 상태로만 노출
- dirty 상태에서는 hydrate가 local edit를 덮지 않음

잠정 공존:

- Firestore snapshot은 shadow compare용으로만 유지
- authoritative read는 Spring projection 우선

출구 기준:

- weekly expense에서 Firestore direct authority 제거
- overwrite / save loop / hydration jitter 클래스의 버그 제거

## Phase 3. Budget + Cashflow Cutover

기간: 4~6주

목표:

- weekly expense와 연결된 downstream 계산을 서버 projection으로 일원화한다.

범위:

- budget actual rollup
- cashflow weekly actual projection
- review-required queue
- sync-failed queue

설계 원칙:

- 계산 reference는 당분간 TS authoritative engine 유지 가능
- 하지만 publish와 read model은 server projection이 책임짐

출구 기준:

- PM/Admin이 보는 budget/cashflow actual이 same-source projection에서 나온다

## Phase 4. Submission and Approval Workflow

기간: 4~6주

목표:

- 사람 승인 흐름을 client patch가 아니라 server workflow state machine으로 이동한다.

범위:

- submit / approve / reject / reopen commands
- allowed transition rules
- audit timeline
- notification outbox

출구 기준:

- submission state가 optimistic UI가 아니라 server workflow state로 설명 가능

## Phase 5. Payroll and Operating Queues

기간: 3~5주

목표:

- queue를 read model과 workflow 위에서 다시 세운다.

범위:

- payroll schedule / run aggregate
- liquidity queue server projection
- setup / review / blocked queues

출구 기준:

- 큐가 프론트 계산이 아니라 persisted operational read model에서 계산된다.

## Phase 6. Project Master and Record Shell Migration

기간: 3~5주

목표:

- 프로젝트를 진짜 record로 승격한다.

범위:

- project summary
- readiness
- linked flows
- audit/activity rail
- operational timeline/Gantt data feed

출구 기준:

- project detail이 server-backed record shell이 된다.

## Phase 7. Firestore Direct Shutdown

기간: 2~4주

목표:

- product authority로서의 Firestore direct access를 제거한다.

해야 할 일:

- direct subscription callsite inventory 정리
- shadow compare 종료
- Firestore writes 차단
- fallback flags 제거

출구 기준:

- 핵심 도메인에서 `onSnapshot` authority 제거
- React는 API/query client만 사용

## Phase 8. Express BFF Retirement

기간: 2~4주

목표:

- Express BFF를 connector/gateway 잔재만 남기고 실질 폐기한다.

선택지:

- 완전 종료
- 일부 Google/Firebase connector만 adapter service로 축소

출구 기준:

- 핵심 command/query path가 Spring으로 통합

## 5. Migration Mechanics

### 5.1 Dual-write 원칙

- 무기한 dual-write 금지
- domain cutover window 동안만 허용
- 최대 허용 기간: tranche당 2주~4주

### 5.2 Dual-read 원칙

- read compare는 shadow mode에서만
- 사용자 표면은 authoritative one-source만 보여야 함

### 5.3 Versioning

핵심 aggregate는 optimistic lock 가능한 version을 가져야 한다.

- `version`
- `updated_at`
- `updated_by`
- `command_id`

### 5.4 Audit

모든 주요 transition은 audit event로 남긴다.

- before
- after
- actor
- reason
- command correlation id

## 6. 권장 팀 구성

최소 구성:

- Platform lead: Spring core / auth / outbox / migration
- Finance domain lead: weekly expense / budget / cashflow domain
- Product frontend lead: query client / draft contract / record shell
- Ops/data lead: migration runbook / observability / cutover

## 7. KPI and Gates

### Product KPI

- weekly expense overwrite bug: 0
- save/sync trust complaints: 지속 감소
- PM task completion time: 감소
- support ticket volume: 감소

### Platform KPI

- command success rate
- queue lag
- projection freshness
- audit completeness
- cutover domain별 Firestore dependency 제거율

### Governance Gates

- Gate A: architecture compliance
- Gate B: domain cutover readiness
- Gate C: shadow parity confidence
- Gate D: user-visible trust gate
- Gate E: legacy shutdown gate

## 8. 90일 우선순위

가장 먼저 해야 할 세 가지:

1. Spring core skeleton + Postgres schema foundation
2. weekly expense authoritative save path
3. cashflow/budget downstream projection cutover

이 세 가지가 끝나야 제품 신뢰 문제가 “프론트 버그” 수준에서 “플랫폼 구조” 수준으로 내려갑니다.

## 9. 리스크

### 리스크 1. Half-migration inertia

가장 위험합니다. Spring을 도입했지만 핵심 화면은 계속 Firestore direct authority로 남는 상태입니다.

대응:

- domain-by-domain shutdown date를 roadmap에 박음

### 리스크 2. Server rewrite without product contract rewrite

백엔드만 바꾸고 dirty draft / persisted version / sync state 계약을 안 바꾸면 같은 문제가 다시 납니다.

대응:

- UI contract rewrite를 Track C로 별도 운영

### 리스크 3. Queue explosion

server-authoritative 전환을 핑계로 queue를 너무 많이 만들면 제품이 무거워집니다.

대응:

- queue는 operational risk 중심만 유지

### 리스크 4. Data migration correctness

Firestore historical data를 Postgres로 옮길 때 audit/version 의미가 깨질 수 있습니다.

대응:

- migration dry-run, replay log, reconciliation report 필수

## 10. 추천 다음 문서

바로 다음으로 필요한 건 구현용 세부 계획입니다.

1. `Spring core bootstrap + tenancy/auth/idempotency plan`
2. `weekly expense authoritative save path cutover plan`
3. `Firestore -> Postgres migration and reconciliation plan`

이 순서로 따로 쪼개야 실제 실행이 가능합니다.
