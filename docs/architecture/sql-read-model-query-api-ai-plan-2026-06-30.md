# MYSCube SQL Read Model + Query API + AI Plan

날짜: 2026-06-30
상태: Proposed
범위: MYSCube 조회/검색/API/AI 활용 계층
관련 산출물:

- `outputs/MYSCube_SQL_ReadModel_QueryAPI_JPA_OKR_추진계획_2026-06-30.xlsx`
- `docs/architecture/firestore-query-readmodel-inventory-2026-06-30.md`

## 1. 한 줄 전략

MYSCube는 `JPA 기반 시스템`이 아니라 `SQL read model + Query API 기반 시스템`으로 설계한다.
Spring을 도입하더라도 JPA는 단순 조회/검색/페이지네이션 구현 보조로 제한하고, 복잡 집계/분석은 `SQL view`, `native query`, `jOOQ` 계층으로 분리한다.
AI는 DB나 JPA에 직접 접근하지 않고 허용된 Query API/tool만 호출한다.

## 2. 왜 지금 이 방향인가

현재 MYSCube에는 이미 다음 기반이 있다.

| 코드 근거 | 확인한 내용 | 계획 반영 |
| --- | --- | --- |
| `server/bff/app.mjs` | `/api/v1` Express BFF, request context, idempotency, worker, views route가 존재 | 새 외부/AI 호출도 BFF 계약과 보안 패턴을 재사용 |
| `server/bff/firestore.mjs` | Firebase Admin Firestore 초기화만 존재 | 현재 source of truth는 Firestore |
| `server/bff/schemas.mjs` | zod schema 기반 payload validation 존재 | Query API/tool schema도 contract-first로 정의 |
| `server/bff/bff-utils.mjs` | `createHttpError`, `parseLimit`, `parseCursor`, `buildListResponse` 공통 유틸 존재 | Query API도 기존 error/cursor 응답 규칙을 따른다 |
| `server/bff/projections.mjs` | `project_financials`, `approval_inbox`, `member_workload` read view 재계산 존재 | SQL mirror 전 단계의 read model 패턴으로 확장 |
| `server/bff/work-queue.mjs` | `change_events` -> `work_queue` -> view rebuild 구조 존재 | Firestore -> SQL mirror/replay worker에 활용 |
| `server/bff/cashflow-canonical-store.mjs` | `cashflow_weeks` canonical write, totals, source 관리 존재 | Cashflow를 첫 Query API/SQL read model MVP로 삼음 |
| `server/bff/routes/cashflow-exports.mjs` | cashflow export가 Firestore range query와 workbook 생성을 수행 | 대표 리포트/조회 API의 기존 로직 근거 |
| `server/bff/routes/cashflow-sheet-lab.mjs` | Google Sheet 연동, staging/apply, sync worker 존재 | 외부 데이터 입력은 이미 BFF/worker화되어 있음 |
| `scripts/etl/config/firestore-schema.ts` | LLM 프롬프트용 Firestore schema catalog 존재 | AI query planner의 출발점. 단, 실제 컬렉션명과 정합성 보정 필요 |
| `vercel.json` | `/api/v1` rewrite, worker cron 존재 | 운영 스케줄링과 BFF 배포 기반은 이미 있음 |

따라서 신규 작업은 “백엔드 처음 만들기”가 아니다.
이미 있는 BFF/worker/view 구조 위에 조회 전용 SQL read model과 안정적인 Query API를 얹는 작업이다.

## 3. 핵심 결정

### Decision 1. Firestore는 당장 source of truth로 유지한다

쓰기 흐름을 바로 SQL/JPA로 옮기지 않는다.
기존 cashflow, sheet sync, project, transaction, audit 흐름이 Firestore/BFF에 이미 붙어 있기 때문이다.

초기 목표는 SQL을 원본 DB로 삼는 것이 아니라, 조회/검색/분석/AI를 위한 read model로 두는 것이다.

### Decision 2. Query API contract를 DB 구현보다 먼저 고정한다

외부 호출자와 AI가 의존할 것은 JPA repository나 SQL이 아니라 Query API다.
API 계약이 먼저 고정되어야 내부 구현을 JPA, native SQL, jOOQ, SQL view 중 무엇으로 바꿔도 소비자를 깨지 않는다.

예상 API 형태:

```http
GET /api/v1/query/projects
GET /api/v1/query/projects/:projectId/cashflow-summary
GET /api/v1/query/projects/:projectId/cashflow-weeks
GET /api/v1/query/settlements
POST /api/v1/query/tools/:toolName
```

### Decision 3. JPA는 단순 조회에만 쓴다

JPA가 적합한 영역:

- 사업명/담당자/상태 검색
- 거래 목록 조회
- 정산 상태별 목록
- 필터 + 정렬 + 페이지네이션
- 단순 join 기반 상세 조회

JPA가 부적합하거나 조심해야 하는 영역:

- 기간별 cashflow 집계
- Actual/Projection 차이 랭킹
- 전월 대비 증감
- 예산 대비 위험도
- AI가 만든 동적 분석 조건

이 영역은 SQL view, materialized view, native query, jOOQ가 더 적합하다.

### Decision 4. AI는 실행자가 아니라 planner/orchestrator다

AI가 할 일:

- 자연어 질문의 의도 파악
- 허용된 Query API/tool 선택
- 필요한 인자 추출
- 결과를 사람이 읽기 쉽게 요약
- 개발자용 SQL 초안 추천

AI가 하면 안 되는 일:

- 운영 DB에 직접 SQL 실행
- `UPDATE`, `DELETE`, `INSERT`, DDL 생성 후 자동 실행
- tenant/project 권한을 우회한 조회
- raw query/prompt를 민감정보 포함 상태로 audit에 저장

## 4. 목표 구조

```txt
Firestore source of truth
  -> BFF change_events / work_queue
  -> SQL read model / views
  -> Query API
       -> simple query: Spring + JPA/QueryDSL optional
       -> complex analytics: SQL view / native query / jOOQ
       -> AI tools: allowlisted Query API calls only
  -> AI answer / document generation
```

## 5. OKR

### Objective 1. SQL read model을 MYSCube 조회/검색의 기준 계층으로 확정한다

| KR | Target | 시기 | 난이도 | 검증 |
| --- | --- | --- | --- | --- |
| Firestore 실제 컬렉션과 SQL read model 필드 매핑 확정 | `projects`, `transactions`, `cashflow_weeks`, `members`, `views` 매핑 100% | P0~P1 | 중 | schema drift test |
| Cashflow/Project/Transaction 조회 모델 설계 | 대표 질문 30개 중 25개 이상 read model로 응답 가능 | P1 | 중상 | query pack review |
| Firestore -> SQL mirror/backfill/replay 경로 구현 | 데이터 신선도 p95 15분 이하 | P2 | 상 | sync drift + replay test |

### Objective 2. Query API를 GPT API처럼 안정적으로 호출 가능한 계약으로 만든다

| KR | Target | 시기 | 난이도 | 검증 |
| --- | --- | --- | --- | --- |
| 읽기 전용 Query API와 tool schema를 contract-first로 정의 | MVP query/tool 10개 이상 | P2~P3 | 중 | contract test |
| Spring 도입 시 단순 조회를 JPA/QueryDSL로 구현 | 검색/필터/페이지네이션 endpoint 5개 이상 | P3 | 중 | repository/query test |
| 복잡 집계/분석은 SQL view/native/jOOQ로 분리 | 집계성 질문 15개 중 13개 이상 처리 | P3 | 중상 | explain plan + result test |
| tenant/project 권한, rate limit, audit 적용 | 권한 없는 조회 0건, raw query 저장 0건 | P3 | 상 | security/privacy tests |

### Objective 3. AI가 DB 구조를 보고 안전한 API 호출/SQL 초안을 제안하게 한다

| KR | Target | 시기 | 난이도 | 검증 |
| --- | --- | --- | --- | --- |
| AI용 schema catalog와 tool catalog를 실제 Query API 계약에서 생성 | schema drift 0건 | P4 | 중상 | schema snapshot test |
| 자연어 질문을 허용된 Query API/tool call로 변환 | 대표 질문 30개 중 27개 이상 정확 응답 | P4 | 상 | golden eval |
| 개발자용 SQL 추천은 dry-run/검토용으로만 제공 | write/delete/update SQL 실행 0건 | P4 | 중상 | blocked query tests |

### Objective 4. 운영 안정성과 비용 통제를 갖춘다

| KR | Target | 시기 | 난이도 | 검증 |
| --- | --- | --- | --- | --- |
| 무거운 조회/AI 반복 호출에 timeout/cache/rate limit 적용 | p95 latency와 월 비용 알림 운영 | P5 | 중상 | load/cost test |
| SQL mirror 장애 시 Firestore read view fallback 제공 | 핵심 5개 endpoint degraded mode 동작 | P5 | 상 | chaos test |
| ADR/API guide/AI query guide/운영 runbook 작성 | 문서 4종 완료 | P5 | 중 | launch checklist |

## 6. 로드맵

### P0. 현황 정밀화

기간: 1주

해야 할 일:

- 실제 Firestore 컬렉션/필드와 기존 `FIRESTORE_SCHEMAS` 대조
- 대표 자연어 질문 30개 수집
- Cashflow, Project, Transaction, Settlement 중 MVP 범위 확정

완료 기준:

- SQL read model 후보 목록 승인
- schema drift 항목 목록화
- 대표 질문 30개 문서화

### P1. SQL Read Model 설계

기간: 1~2주

해야 할 일:

- `project_summary`
- `transaction_search`
- `cashflow_week_lines`
- `cashflow_project_summary`
- `settlement_status`
- `query_audit_events`

완료 기준:

- 대표 질문 80% 이상이 read model로 설명 가능
- API contract 초안 작성
- drift checker 설계 완료

### P2. SQL Mirror MVP

기간: 2~3주

해야 할 일:

- Postgres vs BigQuery 결정
- DDL/migration 작성
- Firestore backfill job 작성
- `change_events`/`work_queue` 기반 증분 sync 작성
- replay/drift checker 작성

완료 기준:

- backfill row count reconciliation 통과
- drift checker 통과
- sync worker 재실행이 idempotent

### P3. Query API + Spring/JPA 경계

기간: 2주

해야 할 일:

- Query API contract 고정
- 단순 조회는 JPA/QueryDSL 후보로 구현
- 복잡 조회는 SQL view/native query/jOOQ로 구현
- tenant/project scope 적용
- rate limit, audit, query hash 적용

완료 기준:

- API contract tests 통과
- security scenario tests 통과
- slow query 예산 초과 없음

### P4. AI Query Assistant

기간: 2주

해야 할 일:

- Query API 기반 tool catalog 작성
- 자연어 -> tool call 변환
- SQL 추천은 dry-run으로 제한
- 답변에 기간, 필터, 원천 데이터를 표시

완료 기준:

- golden question eval 90% 이상
- write/delete/update SQL 차단 테스트 통과
- raw prompt/query 민감정보 저장 없음

### P5. 운영 안정화

기간: 2주

해야 할 일:

- cache/rate limit/timeout
- observability
- degraded fallback
- 비용 알림
- 운영 runbook
- rollback rehearsal

완료 기준:

- alert drill 통과
- chaos test 통과
- launch checklist 완료

## 7. 작업 분해

| Task | Phase | 작업 | Acceptance | Verify | Size |
| --- | --- | --- | --- | --- | --- |
| T01 | P0 | 실제 Firestore 컬렉션 인벤토리 | source-of-truth 컬렉션 확정 | schema inventory reviewed | M |
| T02 | P0 | 대표 자연어 질문 세트 정의 | golden questions 30개 | stakeholder review | S |
| T03 | P1 | 스키마 카탈로그 보정 | 실제 코드와 schema drift 0건 | schema snapshot test | M |
| T04 | P1 | Query read model 설계 | 대표 질문 80% 이상 커버 | query pack review | M |
| T05 | P1 | API/tool naming policy | tool schema 10개 | schema lint | S |
| T06 | P2 | SQL 저장소 선택 | Postgres/BigQuery ADR | ADR approved | S |
| T07 | P2 | Mirror table DDL | migration script | migration test | M |
| T08 | P2 | Firestore -> SQL sync worker | idempotent sync | replay/drift test | M |
| T09 | P2 | Backfill job | row count reconciliation | backfill rehearsal | M |
| T10 | P3 | Query API contract | endpoint 5개 + tool 5개 | contract test | M |
| T11 | P3 | Spring/JPA 단순 조회 구현 | 단순 조회 endpoint 5개 | repository/query test | M |
| T12 | P3 | 복잡 집계 SQL 계층 구현 | 집계 endpoint 5개 | explain plan + result test | M |
| T13 | P3 | Auth/RBAC/project scope | unauthorized 0건 | security tests | M |
| T14 | P3 | Query audit/rate limit | raw query 저장 0건 | privacy test | S |
| T15 | P4 | AI query planner | golden set 90% | eval test | M |
| T16 | P4 | SQL 추천 dry-run guard | write SQL 차단 | blocked query tests | S |
| T17 | P5 | Observability | latency/error/cost 대시보드 | alert drill | M |
| T18 | P5 | Fallback strategy | degraded mode 동작 | chaos test | M |
| T19 | P5 | 운영 문서화 | runbook/API guide/AI guide | release checklist | S |

## 8. JPA vs SQL Query Layer 역할 분리

| 구분 | JPA/QueryDSL | SQL view/native/jOOQ |
| --- | --- | --- |
| 주 역할 | 단순 조회 구현 | 복잡 집계/분석 |
| 예시 | 사업 검색, 거래 목록, 상태 필터 | cashflow 차이 랭킹, 월별 집계, 위험도 스코어 |
| 장점 | Spring 표준, 개발자 친숙, pagination 편함 | SQL이 명확, 성능 튜닝 가능, 복잡도 관리 쉬움 |
| 리스크 | N+1, lazy loading, Criteria/JPQL 복잡화 | SQL 관리 비용, DB 종속성 |
| MYSCube 판단 | 선택 도입 | 필수에 가까움 |

원칙:

- JPA entity graph를 분석/리포트 계층으로 확장하지 않는다.
- JPA repository에 복잡한 동적 분석 조건을 계속 추가하지 않는다.
- 집계/랭킹/차이 분석은 read model 또는 SQL view 이름으로 명시한다.
- AI가 생성한 SQL은 자동 실행하지 않는다.

## 9. Query API 초안

### 공통 계약

기존 BFF의 관성에 맞춰 Query API는 다음 계약을 먼저 고정한다.

성공 응답:

```json
{
  "items": [],
  "count": 0,
  "nextCursor": null
}
```

단건/요약 응답:

```json
{
  "data": {},
  "source": {
    "readModel": "cashflow_project_summary",
    "freshnessCheckedAt": "2026-06-30T00:00:00.000Z"
  }
}
```

에러 응답:

```json
{
  "error": "validation_error",
  "message": "Invalid query request",
  "requestId": "req_xxx",
  "details": {}
}
```

필수 원칙:

- list endpoint는 `pageSize`와 `cursor`를 받는다.
- 응답 필드는 camelCase로 고정한다.
- 새 필드는 additive/optional로만 추가한다.
- 모든 입력은 zod 또는 Spring validation으로 boundary에서 검증한다.
- 구현체가 JPA인지 SQL view인지 응답에 노출하지 않는다.
- AI tool endpoint는 사전에 등록된 `toolName`만 실행한다.

### `GET /api/v1/query/projects`

목적: 사업 목록 검색.

필터:

- `query`
- `status`
- `department`
- `managerId`
- `pageSize`
- `cursor`

구현 후보:

- JPA/QueryDSL 적합

### `GET /api/v1/query/projects/:projectId/cashflow-summary`

목적: 특정 사업의 cashflow 요약.

필터:

- `startYearMonth`
- `endYearMonth`
- `mode`

구현 후보:

- SQL view/native/jOOQ 적합

### `GET /api/v1/query/projects/:projectId/cashflow-weeks`

목적: 특정 사업의 주차별 Projection/Actual line 조회.

필터:

- `startWeek`
- `endWeek`
- `lineId`
- `mode`

구현 후보:

- read model + SQL view 적합

### `GET /api/v1/query/settlements`

목적: 정산 상태 검색.

필터:

- `projectId`
- `status`
- `ownerId`
- `overdueOnly`

구현 후보:

- 단순 필터는 JPA 가능
- overdue/risk score는 SQL view 권장

### `POST /api/v1/query/tools/:toolName`

목적: AI tool calling용 안정 인터페이스.

허용 방식:

- client/AI는 raw SQL을 보내지 않는다.
- `toolName`은 서버 allowlist에 있어야 한다.
- `arguments`는 tool별 schema로 검증한다.
- 결과는 사람이 볼 요약이 아니라 구조화된 데이터로 반환한다.

예시:

```json
{
  "toolName": "get_cashflow_summary",
  "arguments": {
    "projectId": "p1773817948751",
    "startYearMonth": "2026-01",
    "endYearMonth": "2026-12",
    "mode": "actual"
  }
}
```

## 10. 보안/운영 원칙

- 모든 Query API는 `tenantId`를 request context에서만 읽는다.
- client가 보낸 tenantId로 cross-tenant query를 만들지 않는다.
- project scope는 actor 권한과 membership 기준으로 제한한다.
- list endpoint는 pagination 필수.
- AI/tool endpoint는 allowlisted tool만 실행한다.
- SQL은 기본 `SELECT`만 허용한다.
- `UPDATE`, `DELETE`, `INSERT`, `DROP`, `ALTER`, `TRUNCATE` 자동 실행 금지.
- raw natural language query/prompt는 audit에 저장하지 않는다.
- query audit에는 hash, toolName, field list, duration, row count만 저장한다.
- heavy query에는 timeout, max rows, cache policy를 둔다.

## 11. 검증 게이트

### Gate 1. 계획 승인

- [ ] 이 문서가 팀에서 승인됨
- [ ] SQL 저장소 후보가 결정됨
- [ ] MVP 도메인이 Cashflow/Project/Transaction 중 확정됨

### Gate 2. Read Model 승인

- [ ] 대표 질문 30개 중 25개 이상 read model로 응답 가능
- [ ] Firestore schema catalog drift 0건
- [ ] backfill/replay 전략 승인

### Gate 3. Query API 승인

- [ ] API contract tests 통과
- [ ] RBAC/security tests 통과
- [ ] pagination/rate limit/audit 적용

### Gate 4. AI 연결 승인

- [ ] golden eval 90% 이상
- [ ] blocked write SQL tests 통과
- [ ] 답변에 필터/기간/출처가 표시됨

### Gate 5. Launch

- [ ] load test 통과
- [ ] drift checker 통과
- [ ] fallback chaos test 통과
- [ ] 운영 runbook 작성 완료

## 12. Open Questions

- SQL 저장소는 Postgres와 BigQuery 중 무엇으로 갈 것인가?
- Spring Boot를 별도 서비스로 둘 것인가, 기존 BFF 내부 query module을 먼저 확장할 것인가?
- JPA/QueryDSL을 도입할 경우 Java/Kotlin 중 무엇을 표준으로 할 것인가?
- AI tool calling은 내부 관리자용부터 시작할 것인가, 일반 사용자 화면까지 열 것인가?
- 대표 자연어 질문 30개는 누가 승인할 것인가?

## 13. 즉시 다음 액션

1. `T01` 실제 Firestore 컬렉션 인벤토리를 시작한다.
2. `T02` 대표 자연어 질문 30개를 수집한다.
3. `T03` `scripts/etl/config/firestore-schema.ts`를 실제 코드 기준으로 보정한다.
4. `T04` Cashflow 중심 read model 초안을 만든다.
5. 이후 SQL 저장소와 Spring/JPA 도입 여부를 ADR로 확정한다.

## 14. 실행 로그

### 2026-06-30 Slice 1

완료:

- `T01/T03`의 첫 검증 장치로 `npm run etl:verify:query-readmodel-schema`를 추가했다.
- `cashflowWeekSheets` stale collection 이름을 실제 canonical Firestore collection인 `cashflow_weeks`로 보정했다.
- `docs/architecture/firestore-query-readmodel-inventory-2026-06-30.md`에 Query API MVP 기준 collection inventory를 작성했다.
- 검증 범위는 첫 query read model MVP의 필수 collection인 `projects`, `transactions`, `cashflow_weeks`, `members`로 제한했다.

검증:

```bash
npm run etl:verify:query-readmodel-schema
```

결과:

```txt
query read model schema OK: projects, transactions, cashflow_weeks, members
```

남은 일:

- `T01`: participation/payroll/training 등 MVP 밖 collection inventory를 확장한다.
- `T02`: 대표 자연어 질문 30개를 수집한다.
- `T04`: Cashflow 중심 read model 필드 초안을 만든다.

### 2026-06-30 Slice 2

완료:

- `T10`의 첫 Query API endpoint로 `GET /api/v1/query/projects/:projectId/cashflow-summary`를 추가했다.
- `GET /api/v1/query/projects/:projectId/cashflow-weeks`를 추가해 주차별 Projection/Actual 조회 계약도 열었다.
- 구현은 SQL이 아니라 현재 canonical Firestore collection인 `cashflow_weeks`를 읽는 얇은 BFF route로 시작했다.
- 응답 계약은 `data`와 `source`를 분리하고, `source.readModel`은 `cashflow_weeks`로 고정했다.

검증:

```bash
npx vitest run server/bff/routes/query-api.test.mjs
npm run etl:verify:query-readmodel-schema
node -e "import('./server/bff/app.mjs').then(() => console.log('bff app import OK'))"
```

결과:

```txt
server/bff/routes/query-api.test.mjs: 4 passed
query read model schema OK: projects, transactions, cashflow_weeks, members
bff app import OK
```

남은 일:

- `T10`: `projects`, `settlements`, `tools/:toolName` endpoint를 이어서 추가한다.
- `T12`: 같은 계약 뒤에 SQL view/native/jOOQ 구현을 붙일 수 있게 read model DDL을 설계한다.
