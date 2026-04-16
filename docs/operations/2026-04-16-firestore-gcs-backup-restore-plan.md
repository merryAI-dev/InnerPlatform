# 2026-04-16 Firestore + GCS Backup & Restore Plan

대상:

- 1000명 규모 내부 production SaaS
- 포털, 정산, 제출, 캐시플로, payroll, admin summary와 연결된 핵심 business data

## Goal

Firestore를 source of truth로 유지하되, 서비스 장애나 운영 실수 시 복구 가능한 상태를 만든다.

핵심 원칙:

- 운영 백업의 기준 저장소는 `Google Cloud Storage`
- `Google Drive`는 사람 공유용 보조 채널이지, 백업 기준 저장소가 아님
- 백업은 export만이 아니라 `restore drill`까지 포함해야 완성이다

## Architecture

Primary store:

- Firestore

Primary backup store:

- GCS bucket

Optional secondary analytics/export sink:

- BigQuery

People-facing archive:

- Google Drive shared folder

원칙:

- Firestore export는 GCS 기준으로 보관
- Drive에는 운영팀이 읽을 snapshot copy 또는 보고용 산출물만 공유
- 복구는 항상 GCS snapshot 기준으로 수행

## Data Classification

백업 대상:

- project / workspace / portal profile
- weekly expense / submission / cashflow / payroll 관련 핵심 상태
- command audit / reconciliation audit
- read model 재생성에 필요한 원본 business data

백업 비대상:

- rebuild 가능한 임시 캐시
- 재생성 가능한 프런트 전용 projection
- 테스트 fixture / disposable draft

## Backup Policy

### Daily

- Firestore managed export를 하루 1회 GCS로 저장

### Weekly

- 주 1회 장기보관 snapshot 생성

### Monthly

- 월 1회 archive snapshot 생성

### Retention

- daily: 35일
- weekly: 12주
- monthly: 12개월

### Naming

- `gs://<bucket>/firestore-exports/YYYY/MM/DD/<timestamp>/`

### Integrity

- export completion marker 보관
- manifest 존재 여부 검증
- export job failure 시 alert 발송
- snapshot 크기 급변 시 warning 발송

## Recovery Targets

RPO:

- 기본 24시간

RTO:

- 핵심 서비스 임시 복구 4시간 이내
- 전체 데이터 복구 1영업일 이내

## Restore Strategy

원칙:

- production direct overwrite 금지
- 항상 restore staging environment에서 먼저 검증
- 검증 후 승인된 범위만 production에 반영

절차:

1. 장애 시점과 복구 목표 시점 결정
2. 가장 가까운 valid GCS export 선택
3. staging Firestore project로 restore
4. 데이터 무결성 검증
5. product/engineering 승인
6. production partial restore 또는 reconciliation import 수행
7. smoke test와 reconciliation 보고서 확인
8. restore log와 incident log 기록

## Verification Checklist

반드시 검증:

- project count
- active project/profile count
- 최근 7일 command audit 존재 여부
- 핵심 summary document 재생성 가능 여부
- `/portal`, `/portal/weekly-expenses`, `/portal/bank-statements`, `/portal/cashflow` smoke

## Restore Drill

주기:

- 월 1회

방식:

- 최근 production snapshot을 staging에 restore
- restore 후 portal/admin 핵심 경로 smoke 실행
- 예상과 실제 RTO 기록
- 수동 개입 단계 기록

성공 기준:

- 문서화된 절차만으로 복구 가능
- 핵심 경로 smoke 통과
- RTO 목표 이내 완료

## Alerts

Critical:

- backup 미생성
- export job failure
- restore drill failure

Warning:

- export 지연
- retention cleanup 실패
- backup size anomaly

## Ownership

Engineering owner:

- platform/backend owner

Product approver:

- product owner

Ops review cadence:

- 주간 backup freshness 확인
- 월간 restore drill 리뷰

## Exit Criteria

아래가 되면 “backup plan exists”가 아니라 “backup system works”라고 본다.

- GCS daily export 자동화 완료
- retention policy 적용 완료
- restore staging 절차 검증 완료
- 월 1회 drill이 실제 수행됨
- 장애 시 복구 owner와 승인 경로가 문서화됨
