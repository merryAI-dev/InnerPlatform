# 2026-04-16 Emergency Ledger Reviewed Reconciliation Plan

대상:

- ledger 성격의 정산/사업비/제출/캐시플로 업무
- 플랫폼 장애 시 continuity 운영

## Goal

서비스가 다운돼도 운영을 멈추지 않게 하되, 복구 후 플랫폼 반영은 자동 merge가 아니라 `사람이 검토한 변경분`만 승인 반영되도록 만든다.

핵심 원칙:

- 장애 시 시트는 사용할 수 있다
- 시트에서는 CRUD를 허용한다
- 플랫폼 복귀는 자동 반영이 아니라 `reviewed reconciliation import`
- 플랫폼 내부에는 immutable audit를 남긴다

## Operating Model

### Normal Mode

- Firestore + BFF/API-first가 기준 경로
- platform이 authoritative system

### Outage Mode

- 지정된 `Emergency Ledger Sheet`가 임시 작업면
- 해당 기간/사업은 outage mode로 표시
- normal platform write는 동결 또는 read-only 전환

### Recovery Mode

- Emergency Sheet와 마지막 정상 snapshot을 비교해 change set 생성
- 사람 검토 후 승인된 변경만 platform에 반영

### Back To Normal

- reconciliation 완료
- smoke 완료
- 해당 기간 close 해제 또는 normal mode 복귀

## Emergency Ledger Sheet Rules

허용:

- 신규 row 생성
- 기존 row 수정
- row 삭제 표시
- evidence link 추가
- operator note 추가

금지:

- 어떤 변경이든 trace 없이 anonymous 수정
- stable row id 없는 수동 정리
- reconciliation 전 close 처리
- platform과 sheet의 동시 authoritative 편집

## Required Columns

- `ledger_row_id`
- `project_id`
- `week_id`
- `ledger_date`
- `entry_type`
- `direction`
- `amount`
- `account_code`
- `counterparty`
- `description`
- `evidence_url`
- `operator_email`
- `updated_at`
- `incident_id`
- `change_reason`
- `row_status`

추가 메타:

- `baseline_hash`
- `sheet_revision`
- `review_status`
- `import_batch_id`

## Baseline Freeze

장애 시작 시점에 아래를 고정한다.

- 마지막 정상 platform snapshot
- 대상 project/week 범위
- incident id
- emergency sheet URL

이 baseline이 있어야 diff를 계산할 수 있다.

## Change Set Model

복구 시 change set은 세 종류로 계산한다.

- `CREATE`
- `UPDATE`
- `DELETE`

`DELETE`는 시트에서 삭제처럼 보여도, platform import 전에는 항상 `delete candidate`로만 본다.

## Reviewed Reconciliation Import

자동 반영 금지 원칙:

- sheet 내용을 platform에 그대로 자동 merge하지 않는다.

필수 절차:

1. baseline snapshot과 current sheet 상태 비교
2. change set 생성
3. platform review 화면에서 diff 검토
4. reviewer 승인
5. 승인된 change만 import
6. import 결과와 reconciliation report 생성

## Review Screen Requirements

각 변경 건마다 아래가 보여야 한다.

- operation type: create / update / delete
- before value
- after value
- changed fields
- operator
- updated_at
- evidence link
- change_reason
- risk badge

review action:

- approve
- reject
- hold

## Import Rules

### Create

- 새 ledger row 생성
- emergency source metadata 저장

### Update

- before/after snapshot 저장
- changed fields audit 저장
- reviewer와 approved timestamp 저장

### Delete

- hard delete를 기본값으로 두지 않음
- soft-delete 또는 inactive marker 우선
- hard delete는 별도 승인 조건 필요

## Audit Requirements

import 후 반드시 남길 것:

- `import_batch_id`
- `source_sheet_row_id`
- `incident_id`
- `reviewed_by`
- `approved_at`
- `before_snapshot`
- `after_snapshot`
- `source_sheet_revision`

## Reconciliation Checks

import 전/후 비교:

- row count
- amount total
- project/week subtotal
- delete candidate count
- rejected changes count
- failed import row count

reconciliation이 끝나기 전까지:

- 해당 기간 close 금지
- downstream export 금지 또는 경고 표시

## Runbook

### During Outage

1. incident 선언
2. outage mode 전환
3. emergency sheet 링크 공지
4. 대상 project/week freeze
5. operator와 reviewer 지정

### Before Recovery

1. baseline snapshot 확인
2. sheet revision freeze
3. diff 생성
4. review queue 생성

### Recovery

1. reviewer가 change set 검토
2. 승인된 change import
3. reconciliation report 확인
4. smoke 실행
5. normal mode 복귀 승인

### After Recovery

1. incident close
2. import batch archive
3. unresolved rejected items follow-up
4. postmortem에 manual ledger workload 기록

## Controls

권한:

- sheet edit: 제한된 operator만
- review approve: reviewer role만
- final normal mode 복귀: engineering + product 승인

필수 보호:

- sheet 링크 접근 제어
- revision freeze 시점 기록
- duplicate import 방지
- partial import failure report

## Success Criteria

이 플랜이 충분하다고 볼 기준:

- 장애 중 ledger 업무를 완전히 멈추지 않아도 됨
- 복구 후 변경분을 사람 검토로 안전하게 반영 가능
- silent overwrite 없이 audit trail 유지
- delete/update/create가 모두 추적 가능
- reconciliation 완료 전 close/export가 잠김
