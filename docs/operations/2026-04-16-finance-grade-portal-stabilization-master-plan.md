# 2026-04-16 Finance-Grade Portal Stabilization Master Plan

상태:

- classification: finance-grade execution plan
- intended service class: `100+ active users`, `finance / ledger-bearing internal SaaS`
- supersedes: [2026-04-16-portal-production-hardening-next-plan.md](./2026-04-16-portal-production-hardening-next-plan.md)

기준 문서:

- [portal-stabilization-hybrid-rfc-2026-04-15.md](../architecture/portal-stabilization-hybrid-rfc-2026-04-15.md)
- [client-direct-exit-decision-points-2026-04-15.md](../architecture/client-direct-exit-decision-points-2026-04-15.md)
- [2026-04-16-firestore-gcs-backup-restore-plan.md](./2026-04-16-firestore-gcs-backup-restore-plan.md)
- [2026-04-16-emergency-ledger-reviewed-reconciliation-plan.md](./2026-04-16-emergency-ledger-reviewed-reconciliation-plan.md)
- [2026-04-16-portal-hardening-orchestration-model.md](./2026-04-16-portal-hardening-orchestration-model.md)

## Why This Plan Exists

이 서비스는 더 이상 prototype이 아니다. `finance / ledger` 성격의 업무를 담고 있고, 장애 시 운영 중단과 사후 정합성 문제가 직접 발생한다.

따라서 이번 계획은 다음 관성을 버린다.

- `화면이 뜨면 된다`
- `smoke만 green이면 된다`
- `문서에 원칙이 있으면 나중에 gate로 붙이면 된다`
- `phase별 구현 속도가 우선이다`

대신 아래를 강제한다.

- `네트워크/복구/감사 기준이 코드와 CI에 자동화되어야 한다`
- `핵심 read/write/recovery path는 phase별로 rollback 가능해야 한다`
- `phase가 끝났다고 말하려면 fresh gate evidence가 있어야 한다`

## External Review Standard

이 계획은 아래 기준을 통과하도록 작성한다.

- `gstack /plan-eng-review`
  - architecture, edge cases, performance, rollback, execution discipline
- `gstack /review`
  - 구조적 리스크, side effect, hidden coupling
- `superpowers /verification-before-completion`
  - evidence before claims
- `superpowers /subagent-driven-development`
  - fresh subagent per slice, spec review first, quality review second

## Success Bar

이 계획이 만족해야 할 최소 기준은 아래다.

### Service Stability

- stable routes에서 uncontrolled Firestore realtime churn `0`
- `/portal` 계열 stable routes에서 hidden realtime transport `0`
- boot/network regression이 CI artifact로 남음
- degraded dependency 상태에서도 loop/flicker/reconnect storm 없음

### Finance Correctness

- 핵심 write path는 command API를 통해서만 authoritative state를 바꿈
- overwrite / duplicate submit / replay ambiguity 방지
- 감사 추적이 `who / when / why / before / after` 수준으로 남음

### Recovery

- GCS export 자동화
- retention / manifest / freshness alert 자동화
- staging restore runbook 자동화
- 월 1회 restore drill
- outage 중 emergency ledger continuity 가능
- 복구 후 reviewed reconciliation import 가능

### Operational Enforcement

- canonical validation gate가 CI source of truth
- HAR budget / console budget / Firestore channel budget / backup freshness가 release blocker
- phase별 rollback path가 명시되고 검증됨

## Program Rules

### Rule 1. No Phase Lands Without a Gate

모든 phase는 아래 세 가지를 동시에 만족해야 한다.

1. code path complete
2. automated verification complete
3. rollback path documented and testable

셋 중 하나라도 비면 phase는 `in progress`다.

### Rule 2. No Shared Mega Branch

phase 2~5는 하나의 프로그램으로 병렬 진행할 수 있지만, 하나의 long-lived landing branch에 누적하지 않는다.

필수 브랜치 구조:

1. `feat/portal-read-model-phase1`
2. `feat/portal-network-gate-foundation`
3. `feat/portal-command-api-phase1`
4. `feat/firestore-gcs-backup-automation`
5. `feat/emergency-ledger-reconciliation-mvp`
6. `feat/portal-release-gates-production`

### Rule 3. Main Agent Does Orchestration Only

main agent 책임:

- slice 정의
- dependency 정리
- subagent brief 작성
- cross-slice integration
- final gate 실행
- PR / merge 판단

subagent 책임:

- 단일 slice 구현
- 자기 slice 테스트 실행
- 변경 파일 / 위험 / 남은 이슈 보고

### Rule 4. Two-Stage Review Per Slice

각 slice는 아래 순서를 강제한다.

1. implementer subagent
2. spec compliance review
3. code quality review
4. integration by main agent
5. canonical gate 또는 slice gate 실행

## Phase Graph

### Phase 0. Gate and Network Correctness Foundation

이 phase는 더 이상 `마지막 polish`가 아니다. 나머지 phase를 신뢰하려면 먼저 들어가야 한다.

현재 상태:

- status: `in progress`
- Slice A/B/C/D로 분해해 병렬 구현 중이다.
- Slice D 기준으로 CI와 문서는 canonical gate cutover를 완료했다.
- CI는 이제 `phase0:portal:network-gate`만 실행하고 `artifacts/portal-network-gate.json`을 release evidence로 업로드한다.
- legacy release-gate fallback path는 workflow source of truth에서 제거됐다.

목표:

- CI가 canonical validation script를 직접 호출
- HAR budget 자동 수집
- console error budget 자동 수집
- Firestore `Listen / Write / 400` count 자동 수집
- route별 connection budget 파일화

완료 기준:

- stable routes별 connection budget 문서와 테스트 존재
- CI artifact에 route network summary 저장
- `build green` 단독으로는 merge 불가
- canonical gate가 legacy duplicated steps를 완전히 대체함

merge blocker:

- network metrics가 수동 확인에만 의존
- Firestore channel count가 CI에 남지 않음

rollback:

- gate는 additive change이므로 revert 가능
- 기존 smoke path 유지 상태에서 점진 cutover

### Phase 1. Portal Read Boundary Completion

현재 상태:

- dashboard / payroll / weekly-expenses / bank-statements read model phase1이 부분 완료

남은 목표:

- portal workspace bootstrap fan-out 제거
- `/portal/submissions` 포함한 stable summary surface 정리
- stable route는 BFF summary-first를 강제

완료 기준:

- stable portal routes에서 raw Firestore summary fan-out 제거
- stable portal routes에서 route boot connection budget 충족
- fallback path는 write context나 explicit refresh로만 남음

merge blocker:

- provider/store가 ambient browser state로 policy 추론
- stable route에서 hidden Firestore realtime path 존재

rollback:

- page별 summary endpoint 단위 revert 가능
- route shell/provider split은 유지

### Phase 2. Command API Authority

대상:

- weekly expense save
- submission submit / close
- bank statement handoff
- cashflow update / close

목표:

- client patch semantics 제거
- 서버 authoritative command로 정합성, validation, audit 이동

완료 기준:

- 각 command가 idempotency key 또는 equivalent replay guard 보유
- duplicate / conflict / validation failure contract 명시
- audit event 저장
- UI는 command result contract만 소비

merge blocker:

- client가 authoritative final state를 직접 계산
- duplicate submit / replay ambiguity 방치
- before/after audit가 없음

rollback:

- command별 PR로 분리
- 기존 path feature flag 또는 clear revert path 확보

### Phase 3. Firestore + GCS Backup Automation

목표:

- Firestore managed export 자동화
- retention / manifest / integrity 확인
- backup freshness alert
- staging restore script + runbook

완료 기준:

- daily export 실제 생성
- freshness failure alert 실제 발송 확인
- staging restore 성공 증적 확보

merge blocker:

- backup이 문서만 있고 scheduler가 없음
- restore가 runbook 없이 사람 기억에 의존

rollback:

- backup automation은 read-only / additive
- alerting failure는 feature-level rollback 가능

### Phase 4. Emergency Ledger Continuity and Reconciliation

목표:

- outage 중 sheet CRUD 허용
- restore 후 diff 생성
- 사람이 reviewed reconciliation import 승인
- platform audit trail 보존

완료 기준:

- baseline snapshot 고정 방식 존재
- `CREATE / UPDATE / DELETE candidate` diff 생성 가능
- reviewer 승인 UI 또는 artifact 존재
- approved import만 platform 반영
- reviewed_by / approved_at / source_row / before_after_snapshot 저장

merge blocker:

- sheet에서의 변경이 자동 반영됨
- delete가 hard delete로 즉시 처리됨
- row identity / baseline freeze / review gate가 없음

rollback:

- reconciliation import는 feature flag behind
- emergency artifact 생성과 import apply를 분리

### Phase 5. Production Enforcement and Reliability Operations

목표:

- 위 phase들을 실제 운영 규율로 고정
- release gate / restore drill / incident response를 운영 루틴으로 만듦

완료 기준:

- stable lane merge는 canonical gate 없이는 불가
- backup freshness gate가 CI 또는 deploy blocker에 연결
- restore drill cadence와 결과 기록 체계 존재
- incident template / comms / postmortem 규칙 고정

merge blocker:

- 운영 절차가 사람 기억과 슬랙 메시지에만 존재
- canary / smoke / restore evidence가 남지 않음

rollback:

- gate policy는 warning -> blocking 단계로 승격
- release enforcement는 staged rollout

## Landing Order

순서 고정:

1. `Phase 0`
2. `Phase 1 remaining read-boundary closure`
3. `Phase 2 command API`
4. `Phase 3 backup automation`
5. `Phase 4 reconciliation MVP`
6. `Phase 5 enforcement`

이 순서를 바꾸지 않는 이유:

- Phase 0 없이 나머지를 검증할 수 없다.
- Phase 2 없이 finance correctness를 주장할 수 없다.
- Phase 3 없이 recovery를 주장할 수 없다.
- Phase 4 없이 ledger continuity를 주장할 수 없다.
- Phase 5 없이 운영 안정성을 유지할 수 없다.

## Subagent Work Program

### Wave A. Foundation

slice:

- route connection budget spec + tests
- canonical CI gate wiring
- HAR metrics collector
- console / Firestore channel metrics collector

landing rule:

- foundation branch가 먼저 land해야 나머지 phase branch가 의미 있음

### Wave B. Finance Authority

slice:

- weekly expense command
- submission command
- bank handoff command
- cashflow command

landing rule:

- command 하나당 하나의 rollback 가능한 PR

### Wave C. Recovery

slice:

- export scheduler
- retention and manifest
- restore staging automation
- emergency sheet schema
- diff generator
- review artifact
- import audit trail

landing rule:

- backup automation은 reconciliation보다 먼저
- import audit trail은 command contract 이후

### Wave D. Enforcement

slice:

- backup freshness gate
- deploy canary rules
- stable lane policy enforcement
- incident drill checklist automation

## Acceptance Matrix

### A. Stable Route Acceptance

stable route:

- `/portal`
- `/portal/submissions`
- `/portal/weekly-expenses`
- `/portal/bank-statements`
- `/portal/payroll`

pass 조건:

- hidden realtime `0`
- route boot budget within threshold
- console severe error `0`
- canonical smoke pass

### B. Command Acceptance

각 command pass 조건:

- idempotent or equivalent replay-safe
- audit logged
- validation failure typed
- duplicate path tested
- rollback path documented

### C. Recovery Acceptance

pass 조건:

- fresh GCS export exists
- restore staging succeeds
- restore checklist passes
- outage sheet diff import dry-run succeeds

### D. Finance Audit Acceptance

pass 조건:

- who changed what
- when
- why
- before/after
- imported from where

이 다섯 개가 남지 않으면 acceptance 실패다.

## Exit Criteria For “Stable Enough”

아래를 모두 만족해야 `100명 finance SaaS 운영에 충분하다`고 말할 수 있다.

1. stable routes are BFF summary-first and transport-bounded
2. core finance writes are command-authoritative
3. backup is automated and drill-backed
4. emergency ledger continuity exists with human-reviewed return path
5. CI blocks releases on network/runtime/recovery failures

하나라도 비면 아직 `hardening in progress`다.

## Immediate Next Step

다음 작업은 코딩이 아니라 아래다.

1. `feat/portal-network-gate-foundation` 브랜치 생성
2. Phase 0 slice brief를 4개로 분해
3. 각 slice를 subagent에 할당
4. slice별 spec review와 quality review를 강제
5. foundation gate가 land된 뒤에만 phase 2~5 코드 구현 시작
