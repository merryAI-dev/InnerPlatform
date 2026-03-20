# Observability Implementation Plan

## Decision

현재 아키텍처에서는 Kubernetes를 도입하지 않는다.

이유:
- 프론트는 Vercel에 적합한 정적/서버리스 구조다.
- 데이터는 Firebase/Firestore가 관리형으로 운영된다.
- BFF는 이미 Vercel serverless entrypoint와 Cloud Run 배포 경로를 모두 갖고 있다.
- 지금 운영 공백은 오케스트레이션이 아니라 관측성 부족이다.

따라서 우선순위는 `Kubernetes 도입`이 아니라 `Vercel + Firebase + Cloud Run` 위에 관제 스택을 정식으로 올리는 것이다.

## Current State

현재 이미 있는 기반:
- BFF request log: [server/bff/app.mjs](/Users/boram/InnerPlatform/server/bff/app.mjs)
- BFF health endpoint: [server/bff/app.mjs](/Users/boram/InnerPlatform/server/bff/app.mjs)
- Cloud Monitoring alert bootstrap: [scripts/setup_monitoring_alerts.sh](/Users/boram/InnerPlatform/scripts/setup_monitoring_alerts.sh)
- Request ID propagation: [src/app/platform/api-client.ts](/Users/boram/InnerPlatform/src/app/platform/api-client.ts)
- UI-level health panel: [src/app/components/dashboard/SystemHealthPanel.tsx](/Users/boram/InnerPlatform/src/app/components/dashboard/SystemHealthPanel.tsx)
- Existing SLO memo: [guidelines/Monitoring-SLO-Guide.md](/Users/boram/InnerPlatform/guidelines/Monitoring-SLO-Guide.md)

현재 부족한 것:
- 프론트 예외 수집 시스템 부재
- Firestore listen / Drive upload / BFF call 실패를 한 곳에서 추적 불가
- 사용자 화면 에러와 BFF requestId를 연결해 볼 수 없음
- 주요 사용자 플로우 synthetic monitoring 부재
- Slack/PagerDuty 같은 운영 채널과 알림 연결 미완료
- dashboard가 “운영용”이 아니라 “앱 내부 상태 요약” 수준에 머물러 있음

## Goals

이 플랜의 목표는 세 가지다.

1. 장애를 빨리 안다
- 앱 장애, BFF 장애, Firebase 장애, Drive 연동 장애를 5분 이내에 감지

2. 장애를 빨리 좁힌다
- “어디서 깨졌는지”를 프론트, BFF, Firestore, Drive 중 하나로 바로 압축

3. 장애를 빨리 설명한다
- requestId, projectId, transactionId 기준으로 재현과 추적이 가능

## Monitoring Domains

### 1. Frontend

관찰 대상:
- React rendering crash
- route-level exception
- Firestore offline / permission / index error
- Google Drive upload failure
- BFF API failure
- build/release regression

핵심 신호:
- JS exception count
- page-level error rate
- API client failure rate
- Firestore listener failure rate
- upload failure rate
- Web Vitals

### 2. BFF

관찰 대상:
- 5xx
- p95 latency
- auth failure
- version conflict spike
- Drive API error
- worker backlog / dead letter

핵심 신호:
- request count / error rate / latency
- errorCode distribution
- route-level failure count
- outbox/work_queue dead count

### 3. Firebase

관찰 대상:
- Firestore unavailable
- rules denial burst
- missing index recurrence
- auth popup/login failure
- storage failure

핵심 신호:
- Firestore read/write latency
- permission denied rate
- missing index occurrences
- auth success rate

### 4. Business Workflow

관찰 대상:
- bank statement import success
- weekly expense import/apply success
- evidence folder provision success
- evidence upload success
- evidence sync success

핵심 신호:
- import success rate
- apply success rate
- folder create success rate
- upload success rate
- sync success rate

## Recommended Stack

### Must Have

- Vercel Analytics / Speed Insights
- Google Cloud Monitoring for Cloud Run
- Firebase Console for Firestore/Auth/Storage
- Sentry for frontend exception capture

### Recommended

- Uptime checks for production URLs
- Slack notification channel for Monitoring alerts
- Sentry release tracking with deploy version
- log-based metrics for Drive failures and Firestore sync failures

### Not Needed Yet

- Kubernetes
- Prometheus/Grafana self-hosted stack
- service mesh
- distributed tracing backend beyond Sentry + Cloud Logging

## Phase Plan

## Phase 1. Fast Detection Baseline

목표:
- “죽었는지”와 “느린지”를 먼저 잡는다.

실행:
- Cloud Monitoring alert를 운영 채널에 연결
- 아래 alert를 활성화
  - BFF 5xx rate > 1%
  - BFF p95 latency > 2s
  - BFF version_conflict rate > 5%
- production uptime check 추가
  - `https://inner-platform.vercel.app`
  - `https://inner-platform.vercel.app/api/v1/health`
- notification channel을 Slack 또는 PagerDuty로 통일

완료 조건:
- 서비스 다운, API 에러 급증, 과도한 지연을 5분 내 탐지

## Phase 2. Frontend Error Capture

목표:
- 브라우저 콘솔에만 남는 에러를 운영 시스템으로 끌어올린다.

실행:
- Vite React app에 Sentry 추가
- release, environment, route, tenantId, actorId, requestId 태깅
- 아래 에러를 Sentry로 전송
  - ErrorBoundary uncaught error
  - API client HttpError
  - Firestore listener error
  - Drive upload failure
  - Google Sheet import/apply failure
- 기존 `console.error` 주요 경로를 공통 reporter로 감싼다
  - [src/app/components/layout/ErrorBoundary.tsx](/Users/boram/InnerPlatform/src/app/components/layout/ErrorBoundary.tsx)
  - [src/app/platform/api-client.ts](/Users/boram/InnerPlatform/src/app/platform/api-client.ts)
  - [src/app/data/portal-store.tsx](/Users/boram/InnerPlatform/src/app/data/portal-store.tsx)
  - [src/app/components/portal/PortalWeeklyExpensePage.tsx](/Users/boram/InnerPlatform/src/app/components/portal/PortalWeeklyExpensePage.tsx)
  - [src/app/components/portal/GoogleSheetMigrationWizard.tsx](/Users/boram/InnerPlatform/src/app/components/portal/GoogleSheetMigrationWizard.tsx)
  - [src/app/components/cashflow/SettlementLedgerPage.tsx](/Users/boram/InnerPlatform/src/app/components/cashflow/SettlementLedgerPage.tsx)

완료 조건:
- 운영 중 발생한 프론트 에러가 console이 아니라 Sentry 이슈로 남음
- 이슈에 route, user, requestId가 붙음

## Phase 3. BFF Structured Logging Hardening

목표:
- 서버 실패를 request 단위로 좁힐 수 있게 만든다.

실행:
- 현재 JSON request log를 유지하되 필드 보강
  - `routeName`
  - `projectId`
  - `transactionId`
  - `integration` (`drive`, `firestore`, `sheet_import`, `auth`)
  - `outcome` (`success`, `client_error`, `server_error`)
- 에러 응답 시 `errorCode`, `requestId`, `tenantId`, `actorId`가 항상 남도록 강제
- Drive/Google API 예외는 message만 남기지 말고 error type을 분류
  - `drive_permission_denied`
  - `drive_parent_not_found`
  - `drive_upload_failed`
  - `sheet_source_upload_failed`
- worker log도 JSON으로 정렬
  - [server/bff/outbox-worker.mjs](/Users/boram/InnerPlatform/server/bff/outbox-worker.mjs)
  - [server/bff/work-queue-worker.mjs](/Users/boram/InnerPlatform/server/bff/work-queue-worker.mjs)

완료 조건:
- “누가 어떤 route에서 무엇을 하다가 실패했는지”가 Cloud Logging에서 바로 보임

## Phase 4. Log-based Metrics and Alert Expansion

목표:
- 실제 운영 장애 유형을 기준으로 경보를 세분화한다.

추가할 log-based metrics:
- `bff_drive_upload_failures_count`
- `bff_drive_sync_failures_count`
- `bff_firestore_permission_denied_count`
- `bff_sheet_import_failures_count`
- `frontend_firestore_listener_failures_count`
- `frontend_drive_upload_failures_count`

추가 alert:
- Drive upload failure ratio > 5% for 10m
- Firestore permission denied burst > N/min
- frontend error spike > baseline x 3
- uptime check failure 2회 연속
- work_queue dead count > 0
- outbox dead count > 0

완료 조건:
- “앱은 살아있는데 특정 기능만 망가진 상황”도 알림으로 들어옴

## Phase 5. Business Flow Synthetic Checks

목표:
- 기술 지표가 아니라 사용자 플로우 기준으로 감지한다.

우선순위 synthetic checks:
1. 로그인 페이지 진입
2. production shell 렌더
3. `/api/v1/health` 응답
4. bank statement import preview
5. weekly expense import preview
6. evidence Drive folder create

실행 방식:
- Playwright + scheduled runner
- 또는 외부 synthetic monitoring 서비스

완료 조건:
- “사용자는 안 되는데 서버는 200인 상황”을 잡을 수 있음

## Dashboards

## 1. Exec Dashboard

대상:
- 대표 / 운영 책임자

구성:
- 서비스 상태
- 오늘 장애 여부
- BFF availability
- evidence upload success rate
- weekly import success rate
- open incident count

## 2. Operator Dashboard

대상:
- 실제 운영 담당

구성:
- Vercel deploy status
- BFF error rate / p95 latency
- Firestore permission/index/offline error count
- Drive upload / sync failure count
- work_queue / outbox backlog
- top failing routes
- recent releases

## 3. Debug Dashboard

대상:
- 개발자

구성:
- requestId 검색
- route별 errorCode 분포
- projectId / transactionId별 failure drilldown
- frontend Sentry issue trend
- release별 regression

## Alert Routing

severity 체계:
- `P1`: 전면 장애
- `P2`: 핵심 기능 장애
- `P3`: 부분 장애 / 운영자가 우회 가능
- `P4`: 관찰 필요

권장 라우팅:
- `P1`: Slack 긴급 채널 + 전화/PagerDuty
- `P2`: Slack 운영 채널 + 담당자 멘션
- `P3`: Slack dev-ops 채널
- `P4`: daily digest

권장 분류:
- `P1`
  - production 전체 다운
  - 로그인 불가
  - BFF 5xx 대량 발생
- `P2`
  - 증빙 업로드 전면 실패
  - Drive folder 생성 전면 실패
  - Firestore permission/index 이슈로 핵심 화면 마비
- `P3`
  - 특정 프로젝트에서만 import 실패
  - 특정 route latency 증가

## Concrete Implementation Order

1. notification channel 연결
2. uptime check 추가
3. `npm run monitoring:setup:alerts` 운영 채널 기준 재실행
4. Sentry frontend 도입
5. `console.error` 다발 구간을 공통 reporter로 정리
6. BFF route/error structured field 확장
7. log-based metric 추가
8. synthetic checks 추가
9. 운영 대시보드 링크/문서화

## Minimal File Touches For Phase 1-2

- [package.json](/Users/boram/InnerPlatform/package.json)
- [src/app/components/layout/ErrorBoundary.tsx](/Users/boram/InnerPlatform/src/app/components/layout/ErrorBoundary.tsx)
- [src/app/platform/api-client.ts](/Users/boram/InnerPlatform/src/app/platform/api-client.ts)
- [src/app/data/portal-store.tsx](/Users/boram/InnerPlatform/src/app/data/portal-store.tsx)
- [src/app/components/portal/PortalWeeklyExpensePage.tsx](/Users/boram/InnerPlatform/src/app/components/portal/PortalWeeklyExpensePage.tsx)
- [src/app/components/portal/GoogleSheetMigrationWizard.tsx](/Users/boram/InnerPlatform/src/app/components/portal/GoogleSheetMigrationWizard.tsx)
- [scripts/setup_monitoring_alerts.sh](/Users/boram/InnerPlatform/scripts/setup_monitoring_alerts.sh)

## Success Criteria

이 플랜이 완료되면 다음 질문에 바로 답할 수 있어야 한다.

- 지금 장애인가?
- 프론트인가 서버인가 Firebase인가?
- 어느 route / project / transaction에서 깨졌나?
- 언제 배포한 뒤부터 깨졌나?
- 운영자가 우회 가능한가?

## Immediate Recommendation

가장 먼저 할 일은 세 가지다.

1. Cloud Monitoring notification channel 실제 연결
2. production uptime check 추가
3. frontend Sentry 도입

이 셋만 해도 현재 가장 큰 공백인 `브라우저 콘솔에만 남는 장애`와 `production 침묵 장애`를 많이 줄일 수 있다.
