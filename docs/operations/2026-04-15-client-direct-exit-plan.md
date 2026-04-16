# 2026-04-15 Client-Direct Exit Plan

기준 문서:

- [client-direct-exit-decision-points-2026-04-15.md](../architecture/client-direct-exit-decision-points-2026-04-15.md)
- [portal-stabilization-hybrid-rfc-2026-04-15.md](../architecture/portal-stabilization-hybrid-rfc-2026-04-15.md)

## Locked Ballot

이 플랜은 아래 의사결정을 전제로 한다.

1. 안정화 범위: **포털 + admin summary 같이**
2. 데이터 최신성 기준: **포털 fetch-first, 10~60초 지연 허용**
3. summary 물리화 강도: **무거운 화면만 materialized summary**
4. command API 전환 강도: **핵심 쓰기만 먼저**
5. release gate 강도: **stable lane 강하게 / 예외 경로는 time-boxed 완화**
6. 중기 인프라 방향: **Firestore 유지 + BFF/API-first, 이후 AWS core backend 검토**

## Goal

8주 안에 포털과 포털 결합 summary surface에서 `client-direct architecture`를 실질적으로 종료한다.

종료 기준:

- 포털 핵심 읽기 화면이 raw Firestore query를 직접 조합하지 않음
- 포털 핵심 쓰기 경로가 command API를 통해서만 상태를 변경
- realtime은 allowlist만 남음
- stable lane은 authenticated session과 network budget을 기준으로 동작
- 예외 경로는 owner/expiry/remove condition이 있는 경우에만 time-boxed 허용

## Non-Goals

- Firestore 즉시 폐기
- PostgreSQL/Aurora 즉시 이전
- admin editing surface 전면 재작성
- 협업성 realtime surface 전면 제거
- 장애 시 ledger continuity를 자동 merge만으로 해결

## Delivery Model

이 플랜은 기본적으로 stable lane을 전제로 하고, 제한된 예외 경로만 허용한다.

### Stable Lane

- PM 핵심 경로와 정합성 민감 화면
- BFF/API-first 우선
- authenticated smoke, channel budget, HAR budget을 실제 gate로 사용

### Temporary Exception Path

- low-risk, read-mostly, feature-flagged internal experiment에 한해 허용
- 제한적 client-direct read만 허용 가능
- gate는 `build + targeted smoke + severe error 없음`
- owner/expiry/remove condition 없는 예외는 금지

## Execution Phases

### Phase 0. Freeze Line and Controls

기간:

- Week 1

목표:

- 새 client-direct 경로가 더 생기지 않게 freeze line을 만든다.

산출물:

- 포털/viewer direct read 금지 규칙
- temporary exception registry
- realtime allowlist 문서
- 신규 `onSnapshot` 차단 guard
- route/provider ambient state 추론 금지 규칙
- stable/exception path별 release gate 초안

완료 기준:

- 포털 경로에 새 direct listener가 추가되면 테스트나 리뷰에서 막힘
- 현재 direct read/write 위치 inventory 완료
- 예외 경로를 문서로 남기는 체계가 생김

### Phase 1. Read Boundary Cut

기간:

- Week 1~3

목표:

- 포털 핵심 읽기 화면을 BFF read model 기준으로 전환한다.

대상:

- `/portal`
- `/portal/project-select`
- `/portal/onboarding`
- `/portal/weekly-expenses`
- `/portal/bank-statements`
- `/portal/cashflow`
- `/portal/payroll`
- `/portal/submissions` summary surface

작업:

- entry surface의 direct path 제거 완료
- dashboard/submissions/payroll/bank/weekly-expense summary endpoint 구현
- 화면별 raw Firestore fallback 제거
- admin summary의 read-mostly surface만 같은 원칙으로 이동 시작
- 예외 경로는 임시 direct read를 유지할 수 있으나 inventory와 expiry를 반드시 기록

완료 기준:

- 위 화면들이 raw collection shape를 직접 해석하지 않음
- BFF schema contract test 존재

### Phase 2. Write Boundary Cut

기간:

- Week 3~5

목표:

- 핵심 쓰기 경로를 command API로 이동한다.

우선순위:

1. session project switch
2. onboarding / registration
3. weekly expense save
4. submission submit / close
5. bank statement handoff state update
6. cashflow projection update / close

작업:

- 각 경로에 command endpoint 추가
- 클라이언트의 persistence semantics 제거
- audit/event/status propagation을 서버 기준으로 정리
- outage 시 reviewed reconciliation import를 고려한 audit key 확정

완료 기준:

- 위 쓰기 경로에서 클라이언트가 authoritative state transition rule을 갖지 않음
- 어떤 예외 경로에서도 핵심 write 경로는 client-authoritative write를 허용하지 않음

### Phase 3. Heavy Summary Materialization

기간:

- Week 5~6

목표:

- live aggregation만으로 비싸거나 불안정한 summary를 materialize한다.

1차 후보:

- portal dashboard summary
- payroll summary
- export metadata summary

선정 기준:

- fan-out collection 수
- response latency
- recompute cost
- route transition 시 체감 churn

완료 기준:

- 최소 1개 이상의 heavy summary가 materialized path로 전환
- materialized path와 live path 중 무엇을 쓰는지 문서화

### Phase 4. Admin Summary Cutover

기간:

- Week 6~7

목표:

- admin의 summary 성격 화면만 같은 원칙으로 cutover한다.

대상:

- admin dashboard summary
- cashflow export surface metadata
- auth governance summary

완료 기준:

- admin summary 화면이 포털과 같은 read model/BFF contract 철학을 따름
- editing-heavy admin surface는 분리 유지

### Phase 5. Release Gate Hardening

기간:

- Week 7~8

목표:

- 구조가 다시 무너지지 않도록 release 기준을 강화한다.

Stable Lane gate:

- authenticated route smoke
- Firestore channel budget
- entry surface HAR budget
- console error budget
- route transition stability

Temporary Exception Path gate:

- build / unit smoke
- targeted route smoke
- severe console loop 없음
- known exceptions 문서화

완료 기준:

- stable lane은 build/test green만으로는 배포 불가
- 예외 경로는 허용이 가능하지만 expiry/owner 없이 merge 불가

## Weekly Milestones

### Week 1

- freeze line 문서화
- direct read/listener inventory
- allowlist/guard/review 규칙 초안
- temporary exception registry 초안
- GCS backup/restore plan 초안
- emergency ledger reviewed reconciliation plan 초안

### Week 2

- portal 핵심 read model endpoint 1차
- dashboard / submissions / payroll API-first 전환 시작

### Week 3

- weekly expense / bank statement summary read boundary 정리
- raw fallback 제거

### Week 4

- session project / onboarding / registration command API 고정
- authenticated smoke를 기본 gate에 포함

### Week 5

- weekly expense save / submission / bank handoff command API 이행

### Week 6

- cashflow close/update command API 이행
- heavy summary materialization 1차 적용
- backup/export freshness alert 연결

### Week 7

- admin summary cutover
- stable/exception path 분리 gate 정식화
- restore drill / outage review rehearsal 확정

### Week 8

- 남은 raw portal direct path 정리
- 다음 단계용 AWS core backend readiness review

## Deliverables

반드시 남아야 하는 산출물:

- direct read 금지 규칙
- temporary exception registry
- realtime allowlist 문서
- BFF schema contract tests
- authenticated smoke
- stable/exception path gate 문서
- HAR baseline / budget 문서
- command API list와 ownership 표
- materialized summary decision log
- Firestore + GCS backup/restore plan
- emergency ledger reviewed reconciliation plan

## Acceptance Criteria

아래를 만족하면 이번 플랜은 성공으로 본다.

1. 포털 핵심 화면은 BFF read model 기준으로만 렌더링됨
2. 포털 핵심 쓰기 경로는 command API 기준으로 동작함
3. 포털/viewer direct read는 stable lane에서 제거되고, 예외 경로는 레지스트리로 관리됨
4. entry surface에서 Firestore channel churn이 구조적으로 재발하지 않음
5. stable lane 운영 배포는 session/network gate 없이는 통과하지 않음
6. GCS backup freshness와 restore drill이 실제로 운영됨
7. outage 시 sheet CRUD 후 reviewed reconciliation import가 가능한 runbook이 있음

## Risks

1. hybrid가 임시 상태로 굳을 수 있음
2. BFF contract가 늘어나며 schema drift가 생길 수 있음
3. materialization을 너무 빨리 넓히면 운영 복잡도가 커짐
4. admin summary 범위를 과하게 잡으면 일정이 흔들릴 수 있음
5. 예외 경로가 관리되지 않으면 client-direct drift가 재발할 수 있음
6. backup은 있어도 restore drill이 없으면 실전에서 무력할 수 있음
7. emergency sheet가 reviewed import 없이 쓰이면 ledger overwrite risk가 생길 수 있음

## Guardrails

- 새 포털 기능은 원칙적으로 Firestore direct 금지
- 단, 예외 경로는 owner/expiry/remove condition이 있으면 제한적 허용
- 새 summary 화면은 BFF contract 없이 merge 금지
- 새 realtime은 allowlist 승인 없이는 금지
- 새 command API는 audit/status semantics 없이 merge 금지
- 장애 continuity는 sheet 자동 merge가 아니라 reviewed reconciliation import 기준으로만 허용
- release gate를 우회한 “빠른 머지” 금지
