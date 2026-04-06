# Server-Authoritative Spring Cutover Spec

날짜: 2026-04-06
목표 기간: 6~12개월
기준: 외부 스타트업이 자금 운영과 프로젝트 운영을 맡길 수 있는 엔터프라이즈 SaaS
리뷰 관점: `superpowers:brainstorming` + `codex-stack-autoplan` 기준을 수동 적용

## 1. 한 줄 결론

지금 제품의 핵심 리스크는 프론트엔드 기술이나 계산 언어가 아니라, `편집 상태`, `저장`, `동기화`, `재수화`의 권위가 분산돼 있다는 점입니다.

따라서 이번 전환의 목적은 `Node -> Spring` 자체가 아니라 아래를 강제하는 것입니다.

- 서버가 유일한 저장 권위가 된다.
- 브라우저는 draft와 interaction만 담당한다.
- 저장 이후 계산, 캐시플로 반영, 감사 추적은 서버 트랜잭션과 job orchestration으로 이동한다.
- Firestore direct subscription 모델은 6~12개월 안에 폐기한다.

## 2. 왜 지금 이 전환이 필요한가

현재 구조는 기능 개발 속도에는 유리했지만, 외부형 SaaS 신뢰에는 불리합니다.

- React 클라이언트가 Firestore를 직접 읽고 상태를 넓게 주도한다.
- BFF는 Express 보조 계층이지만 아직 authoritative application server는 아니다.
- 저장 직후 hydrate echo, sync 상태 갱신, derived recalculation이 UI 편집 경험과 너무 가깝다.
- 결과적으로 PM은 “방금 넣은 값이 다시 바뀔 수 있다”는 인상을 받는다.

외부 고객 관점에서 이 문제는 단순 UX 버그가 아니라 제품 신뢰 손상입니다.

## 3. 목표 상태

목표 아키텍처는 아래입니다.

1. `Spring Boot application platform`
2. `PostgreSQL source of truth`
3. `asynchronous job / workflow layer`
4. `audit + idempotency + outbox built into server write model`
5. `React client as draft editor + query consumer`

이 상태에서:

- 모든 핵심 변경은 Spring API를 통해서만 저장된다.
- 저장은 optimistic UI가 아니라 versioned command 처리로 본다.
- cashflow sync, evidence sync, payroll queue refresh는 background execution으로 이동한다.
- UI는 server projection을 읽되, dirty local draft와 persisted snapshot을 명확히 구분한다.

## 4. 어떤 전환 방식이 맞는가

### Option A. Big-bang rewrite

한 번에 Spring + Postgres로 옮기고 기존 Firestore/Express를 빠르게 폐기한다.

장점:
- 설계가 가장 깨끗하다.
- 팀이 한 모델만 보면 된다.

단점:
- 6~12개월 안에 운영 시스템 전체를 한 번에 갈아끼우는 건 실패 확률이 높다.
- cutover 직전까지 사용자 신뢰를 충분히 회복하기 어렵다.

### Option B. Endless hybrid

Firestore direct와 Spring을 오래 공존시킨다.

장점:
- 초기 전환 부담이 낮다.

단점:
- 가장 나쁜 선택이다.
- 권위가 두 개가 되고, drift와 운영 복잡도가 계속 커진다.

### Option C. Strangler with hard deadlines

초기 몇 달은 Express/Firestore와 Spring/Postgres가 공존하지만, 각 도메인마다 `authoritative owner`를 명확히 바꾸고 기존 경로의 종료 시점을 고정한다.

장점:
- 운영 위험을 낮추면서도 완전 치환 목표를 유지한다.
- 도메인별 cutover와 rollback 기준을 분명하게 만들 수 있다.

단점:
- migration discipline이 약하면 Option B로 타락한다.

## 5. 권장 결정

권장안은 `Option C. Strangler with hard deadlines` 입니다.

단, 다음 원칙이 강제돼야 합니다.

- 새 기능은 더 이상 Firestore direct model 위에 얹지 않는다.
- 각 tranche마다 “이번에 authoritative가 어디로 바뀌는지”를 문서로 명시한다.
- shadow read / dual write / dual run은 오직 cutover를 위한 일시적 장치로만 허용한다.
- Firestore direct read/write 폐기 날짜를 backlog가 아니라 roadmap에 박아둔다.

## 6. 기술 원칙

### 원칙 1. 서버 권위

`project`, `transaction`, `expense sheet`, `submission`, `payroll run`, `queue item`은 모두 서버 명령 처리와 version 관리 아래 있어야 한다.

### 원칙 2. DB 우선

Google Sheet, Drive, Firebase snapshot은 시스템 기록이 아니라 입출력 채널이다. source of truth는 PostgreSQL이다.

### 원칙 3. 동기/비동기 분리

- 동기: validation, command accept/reject, persisted version 반환
- 비동기: cashflow sync, evidence sync, derived projection refresh, notification, audit enrichment

### 원칙 4. 계산과 저장의 결합도 축소

정산 계산 엔진은 여전히 TypeScript authoritative reference에서 출발할 수 있다. 다만 저장 승인과 projection publish는 서버가 책임져야 한다.

### 원칙 5. 읽기 모델 분리

Write model과 read model을 구분한다.

- write model: commands, versions, workflow transitions
- read model: dashboard, queues, record summaries, audit timelines

## 7. 목표 기술 스택

권장 스택:

- Application: `Spring Boot 3.x`
- Language: `Kotlin` 우선, 필요 시 Java 혼용
- DB: `PostgreSQL`
- Migration: `Flyway`
- ORM/SQL: `jOOQ` 또는 `Spring Data JDBC`, JPA 남용 금지
- Auth: Firebase Auth 또는 Google Workspace identity를 server token verification 뒤 내부 principal로 정규화
- Async: 초기엔 Postgres outbox + worker, 필요 시 Kafka/SQS 계열 확장
- Cache/search: 1차 cutover 범위에서는 제외하고, read hot path 병목이 계측으로 확인될 때만 별도 tranche로 추가
- Frontend: 기존 React/Vite 유지

왜 Kotlin인가:

- Spring 생태계를 쓰면서도 도메인 모델을 더 단단하게 유지하기 좋다.
- nullability, data class, sealed class가 workflow domain에 잘 맞는다.

## 8. 우선 도메인

전환 순서는 `가장 신뢰를 해치는 경로`부터입니다.

### 1순위

- weekly expense save path
- settlement row persistence
- cashflow actual sync
- budget actual rollup

### 2순위

- submission workflow
- payroll schedule / payroll run
- evidence drive sync metadata

### 3순위

- project master / project readiness
- admin queues / audit surfaces

## 9. 폐기 대상

최종적으로 없애야 하는 것:

- broad Firestore direct subscription state as product authority
- client-originated persistence rules that bypass server command validation
- Express BFF as long-term application layer

남길 수 있는 것:

- Firebase Auth as identity provider
- 일부 Firebase/Google integration connector
- Rust parity/batch boundary
- React/Vite frontend

## 10. 성공 기준

이 전환이 성공했다고 부르려면 아래가 필요합니다.

- PM이 편집 중 넣은 값이 hydrate echo로 되돌아가지 않는다.
- 저장 성공과 동기화 완료가 서로 다른 상태로 명시적으로 관리된다.
- 주요 레코드는 server version과 audit trail을 가진다.
- queue와 dashboard는 read model에서 안정적으로 계산된다.
- Firestore direct read/write가 제품 핵심 경로에서 제거된다.

## 11. 실패 기준

다음은 실패 신호입니다.

- Spring을 붙였는데 Firestore direct authority가 계속 살아 있다.
- dual write가 3개월 이상 기본 운영 경로가 된다.
- command 모델 없이 기존 UI patch model만 서버로 옮긴다.
- job orchestration 없이 request/response에서 모든 sync를 계속 처리한다.

## 12. 경영 판단

이건 단순 backend modernization이 아닙니다.

이건 제품이 `내부 도구`에서 `운영 책임을 맡길 수 있는 외부 SaaS`로 가기 위한 기반 공사입니다.

투자 포인트는 아래입니다.

- 신뢰 회복
- 동시성 안정성
- 감사 가능성
- 향후 승인/회계/배치/리포트 확장성

Spring은 이 목적을 위한 좋은 도구입니다. 목적 그 자체는 아닙니다.
