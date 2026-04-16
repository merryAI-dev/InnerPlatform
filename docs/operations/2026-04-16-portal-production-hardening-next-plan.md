# 2026-04-16 Portal Production Hardening Next Plan

기준 문서:

- [portal-stabilization-hybrid-rfc-2026-04-15.md](../architecture/portal-stabilization-hybrid-rfc-2026-04-15.md)
- [client-direct-exit-decision-points-2026-04-15.md](../architecture/client-direct-exit-decision-points-2026-04-15.md)
- [2026-04-15-client-direct-exit-plan.md](./2026-04-15-client-direct-exit-plan.md)
- [2026-04-16-firestore-gcs-backup-restore-plan.md](./2026-04-16-firestore-gcs-backup-restore-plan.md)
- [2026-04-16-emergency-ledger-reviewed-reconciliation-plan.md](./2026-04-16-emergency-ledger-reviewed-reconciliation-plan.md)

## Goal

현재 문서로 고정한 `Firestore + BFF/API-first + GCS backup + reviewed reconciliation` 방향을 실제 구현 단계로 내려, 포털을 `1000명 규모 내부 production SaaS` 기준으로 안정화한다.

## Branch and Rollback Strategy

현재 기준점:

- current docs commit: `395c830`
- rollback branch: `rollback/perf-portal-entry-har-hardening-2026-04-16`

원칙:

- 모든 구현은 현 브랜치에서 바로 길게 누적하지 않는다.
- phase 단위로 짧은 구현 브랜치를 새로 딴다.
- 각 phase는 독립 rollback 가능한 단위로 land한다.

권장 브랜치 순서:

1. `feat/portal-read-model-phase1`
2. `feat/portal-command-api-phase1`
3. `feat/firestore-gcs-backup-automation`
4. `feat/emergency-ledger-reconciliation-mvp`
5. `feat/portal-release-gates-production`

rollback 원칙:

- phase merge 전 문제면 해당 feature branch 폐기
- phase merge 후 문제면 해당 PR revert
- 전체 흐름이 흔들리면 `rollback/perf-portal-entry-har-hardening-2026-04-16` 기준으로 재출발

## Priority Order

우선순위는 아래 순서로 고정한다.

### P0. 포털 read boundary

이유:

- 현재 가장 자주 사용자에게 체감되는 리스크가 route/provider/query coupling이다.
- read model 경계가 안 닫히면 이후 write, backup, emergency flow도 다 어중간해진다.

대상:

- `/portal`
- `/portal/weekly-expenses`
- `/portal/bank-statements`
- `/portal/payroll`

### P1. 핵심 command API

이유:

- 저장/제출/정산 경로가 클라이언트 authoritative 상태면 여전히 운영 리스크가 크다.

대상:

- weekly expense save
- submission submit / close
- bank statement handoff state update
- cashflow projection update / close

### P2. GCS backup automation

이유:

- 문서만 있고 실제 export/retention/alert가 없으면 backup plan은 완성되지 않는다.

대상:

- daily export
- retention
- alert
- restore staging runbook automation

### P3. Emergency ledger continuity

이유:

- ledger 성격상 장애 continuity가 반드시 있어야 한다.
- 다만 reviewed reconciliation이므로 core read/write boundary가 먼저 어느 정도 닫혀 있어야 한다.

대상:

- emergency sheet schema
- diff generator
- review queue
- import audit trail

### P4. Production gate hardening

이유:

- 위 단계가 들어간 뒤에야 gate를 강하게 걸 수 있다.
- 너무 먼저 걸면 구현 속도만 죽고, 너무 늦게 걸면 다시 사고가 난다.

대상:

- authenticated smoke
- Firestore channel budget
- HAR budget
- console error budget
- backup freshness gate

## Execution Sequence

### Phase 1. Portal Read Model Phase 1

기간:

- 1~2주

대상 결과:

- portal 핵심 read-mostly 화면이 Firestore direct fan-out 대신 BFF summary endpoint로 렌더링

완료 기준:

- `/portal` boot 시 broad Firestore churn 없음
- summary 화면이 raw collection shape 직접 해석 안 함

### Phase 2. Command API Phase 1

기간:

- 1~2주

대상 결과:

- 핵심 write path가 client patch semantics 없이 command API를 통해 동작

완료 기준:

- 저장/제출/handoff/close 경로에 서버 audit가 남음
- duplicate / conflict / failure 처리 기준이 서버로 이동

### Phase 3. GCS Backup Automation

기간:

- 1주

대상 결과:

- Firestore daily export 자동화
- retention 적용
- backup freshness alert 연결

완료 기준:

- 실제 GCS export path 생성
- 실패 alert 수신 확인

### Phase 4. Emergency Ledger Reconciliation MVP

기간:

- 1~2주

대상 결과:

- outage 시 시트 CRUD 허용
- 복구 시 reviewed diff import 가능

완료 기준:

- baseline snapshot 대비 create/update/delete candidate 생성
- reviewer 승인 후 import audit 저장

### Phase 5. Production Gates

기간:

- 1주

대상 결과:

- stable lane 배포는 session/network/backup 기준 없이는 통과 불가

완료 기준:

- build green만으로는 release 불가
- smoke, budget, backup freshness가 gate에 들어감

## Work Breakdown

### Track A. Application Boundary

- portal dashboard summary API
- weekly expense summary API
- bank statement handoff summary API
- payroll summary API
- raw fallback 제거

### Track B. Command Boundary

- weekly expense save command
- submission submit/close command
- bank handoff command
- cashflow close/update command

### Track C. Backup/Recovery

- Firestore export scheduler
- GCS retention policy
- alerting
- restore staging checklist

### Track D. Emergency Continuity

- emergency sheet template
- diff/reconciliation model
- review UI or review artifact
- import audit trail

### Track E. Operational Gates

- authenticated smoke suite
- channel/HAR/console budget baseline
- backup freshness check
- release checklist integration

## Review Points

각 phase 끝에서 반드시 보는 것:

1. 사용자 체감 개선이 있었는지
2. direct path가 실제로 줄었는지
3. rollback이 쉬운지
4. 다음 phase 선행조건이 닫혔는지

## Exit Criteria

이 플랜이 완료됐다고 보려면 아래가 필요하다.

1. 포털 핵심 read path가 API-first
2. 포털 핵심 write path가 command API-first
3. GCS backup이 자동으로 돈다
4. restore drill이 실제 수행된다
5. emergency ledger reviewed reconciliation이 운영 가능하다
6. stable lane release gate가 실제로 배포를 통제한다

## What Not To Do

- read boundary가 안 닫힌 상태에서 AWS 이전 논의부터 시작하지 않기
- backup export만 만들고 restore drill을 생략하지 않기
- emergency sheet를 자동 merge path로 만들지 않기
- feature를 이유로 direct Firestore path를 무기한 남기지 않기
