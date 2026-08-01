# Sprint Contract: Live 캐시플로 runtime alignment
**날짜:** 2026-08-01
**예상 소요:** 2~3시간
**상태:** APPROVED

## 구현할 것
- 정상 캐시플로 쓰기는 BFF·JVM·Firestore project가 현재 배포 환경과 일치할 때 허용한다.
- 주간 정산, 월 결산, 재오픈, 시트 반영이 같은 `assertCashflowMutationRuntime` 판정을 사용한다.
- route와 JVM client에 남은 중복 Stage-only 쓰기 조건을 제거한다.
- BFF와 JVM의 edit lease를 Live에서 함께 활성화하고 재오픈의 Stage 전용 guard를 제거한다.
- UI·BFF·JVM·배포 설정·운영 스크립트에서 Stage QA 시계를 삭제하고 KST 서버 시각만 사용한다.
- maintenance read-only는 비상 정지 스위치로만 유지하고 정상 Live 배포는 쓰기 가능 상태를 검증한다.

## 성공 기준
- [x] 정합한 Live 환경에서 주간 정산 완료 POST가 JVM까지 정확히 한 번 전달된다.
- [x] 주간 정산·월 결산·재오픈·시트 반영이 같은 project alignment 실패 코드를 반환한다.
- [x] BFF와 JVM Firestore project가 다르거나 Live가 승인되지 않은 project를 바라보면 네트워크 호출 전에 차단된다.
- [x] 주간·월 결산 대상일은 저장된 QA clock 없이 KST 서버 시각으로 계산된다.
- [x] 기존 RBAC·idempotency·16주/256칸 검증·canonical JVM transaction을 우회하지 않는다.
- [x] 집중 테스트, JVM 전체 테스트, production build와 독립 QA gate가 통과한다.

## 실패 기준
- [ ] 특정 route의 503만 숨기거나 성공으로 간주한다.
- [ ] 프론트 host 또는 role만으로 서버 쓰기 가능 여부를 추론한다.
- [ ] project alignment 검증을 제거해 Stage/Live 데이터 교차 쓰기가 가능해진다.
- [ ] QA clock 같은 개발 전용 기능을 업무 기능으로 다시 연다.
- [ ] DB schema, 기존 데이터 또는 Google Sheet 값을 변경한다.

## 범위 밖
- Firestore 데이터 마이그레이션 및 기존 문서 수정
- Google Sheet 원본 또는 mirror 데이터 변경
- Stage 배포 파이프라인 삭제

## 평가 방법
- Live/Stage/misaligned runtime matrix 단위 테스트
- BFF route → JVM client의 path/body/data-project/idempotency contract 테스트
- 주간 정산 완료 후 canonical read 일치 검증
- maintenance mode, 권한 거부, 중복 요청, JVM 409/503 회귀 검증
- 운영 배포 전 DB·Sheet write 없는 read-only smoke
- 배포 후 JVM candidate의 동일 이미지·환경·권한을 검증하고 read-only latency를 측정한 뒤에만 리전 전환 판단
