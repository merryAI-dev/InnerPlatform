# JVM/BFF 채널 감사와 JVM 서비스의 정체

**Date:** 2026-07-27

**Status:** 조사 완료 — 수정 착수 전
**Scope:** `server/bff` ↔ `server/jvm-weekly-api` 채널. 데이터 마이그레이션이나 서비스 제거는 이 문서의 범위가 아니다.

## 왜 이 문서를 쓰는가

2026-07-13부터 07-27까지 14일간 캐시플로우 월 결산 영역에 61개 커밋이 들어갔고 그중 46%가 `fix`였다. 같은 기간에 만들었다가 몇 시간 만에 삭제된 서브시스템이 셋이다(정산주차 쓰기잠금 2시간 38분, 연간합계 컬럼 19분, edit-lease 펜싱 13일에 걸쳐 해체).

되돌리기는 한 번도 `git revert`로 하지 않았다. 전부 손으로 역방향 커밋을 썼기 때문에 **"이미 시도했다가 실패한 접근"이라는 신호가 히스토리에 남지 않는다.** 다음 작업자는 그걸 모른 채 같은 시도를 반복한다.

그리고 이 기간에 아무도 던지지 않은 질문이 하나 있다. **이 규모에 JVM 서비스가 왜 있는가.**

이 문서는 그 답과, 그 답이 설명하는 장애들을 기록한다. 실패한 시도를 히스토리에 남기지 못한 대가를 더 치르지 않기 위해서다.

## 발견 1 — JVM은 Postgres 시절의 잔재다

### 근거

`server/jvm-weekly-api/pom.xml`이 선언하는 의존성:

```
spring-boot-starter-data-jpa
postgresql
postgres-socket-factory
flyway-core
flyway-database-postgresql
h2
```

- JPA 엔티티 **12개** (`server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/domain/*Entity.java`)
- Flyway 마이그레이션 **4개** (`src/main/resources/db/migration/V1~V4__*.sql`)
- 기본 저장소 설정도 JPA — `src/main/resources/application.yml:24`

```yaml
storage-backend: ${JVM_WEEKLY_STORAGE_BACKEND:jpa}
```

그런데 실제 배포는 `cloudbuild.jvm-weekly-api.yaml`에서 이렇게 덮는다:

```
JVM_WEEKLY_STORAGE_BACKEND=firestore
```

그리고 **배포 설정에 Cloud SQL 연결이 없다.** Postgres 인스턴스가 붙어 있지 않다.

현재 프로덕션에서 실제로 동작하는 구현 클래스의 이름이 이 사실을 그대로 말한다:

```
FirestoreInheritedWeeklyExpensePersistence
```

### 따라서 실제 구조는 이렇다

```
React ──▶ Node BFF ──▶ Java Spring ──▶ Firestore
             │                            ▲
             └────────────────────────────┘
                  (같은 DB를 직접 읽고 쓴다)
```

JVM은 데이터를 독점하지 않는다. 다른 저장소를 쓰지도 않는다. **BFF와 JVM이 같은 Firestore를 각자 본다.**

### 이것이 설명하는 것

`GET /api/v1/cashflow/{id}/month-close`가 콜드 14.58초, 웜 4.15초, 응답 270KB다(2026-07-27 스테이지 실측). 원인은 페이로드가 아니라 읽기 증폭이다. 한 달치를 요청하는데 프로젝트 전체 히스토리를 무필터로 스캔한다:

| 대상 | 위치 |
|---|---|
| `cashflow_weeks` 전체 | `FirestoreInheritedWeeklyExpensePersistence.java:1905` |
| `monthly_closes` 전체 (정수 2개를 얻으려고 snapshot 통째로 든 문서를 전부 읽음) | `:2616`, `:2630` |
| `cashflow_year_totals` 전체 | `:1882` |

쿼리 형태가 이렇다:

```java
query(cashflowWeeks(tenantId).whereEqualTo("projectId", projectId))
```

`yearMonth` 필터도 `limit`도 없다. 그리고 이 형태는 단발이 아니다. 같은 파일에서 `cashflowWeeks(tenantId).whereEqualTo("projectId", projectId)` 만으로 **7곳**이 나온다(`:1427`, `:1611`, `:1905`, `:3197`, `:3574`, `:3659`, `:3675`).

**이것은 Postgres에 쓰는 코드다.** SQL에서는 인덱스를 걸고 DB가 걸러 주므로 자연스러운 형태다. Firestore로 옮겨오면서 이 형태가 그대로 남아, 문서를 전부 읽어 메모리에 올리는 코드가 되었다.

`firebase/firestore.indexes.json`에는 이 쿼리를 빠르게 만들 복합 인덱스가 **이미 선언되어 있다**:

```json
{ "collectionGroup": "cashflow_weeks",
  "fields": [ {"fieldPath":"projectId"}, {"fieldPath":"yearMonth"}, {"fieldPath":"weekNo"} ] }
```

쿼리가 `yearMonth`를 쓰지 않으므로 이 인덱스는 사용되지 않는다. 인프라는 준비되어 있고 쿼리만 Postgres 형태로 남아 있다.

이전 성능 작업 `7247ce2`("fix: stabilize cashflow dashboard loading")가 효과를 내지 못한 이유도 여기 있다. 그 커밋은 BFF→JVM HTTP 홉 하나를 없앴을 뿐 **Firestore 쿼리를 하나도 건드리지 않았다.** 지배적 비용은 홉이 아니었다. 같은 커밋이 `findings` 배열을 추가해 응답은 오히려 커졌다.

## 발견 2 — 채널의 실패 지점

BFF는 Vercel 서버리스 함수이고(`vercel.json:11-15`, `maxDuration: 60`), JVM은 Cloud Run이다(`cloudbuild.jvm-weekly-api.yaml:54-70`). 이 배치가 아래 항목 여럿의 전제다.

### 2-1. `editSession`이 시트 반영 3개 경로에서 유실된다

호출부는 넘긴다:

- `server/bff/routes/cashflow-sheet-lab.mjs:2146` — `applyCashflowSheetLab({ ..., editSession: monthEditSession })`
- `:2180` — `applyCashflowSheetBatch({ ..., editSession: monthEditSession })`
- `:2257` — `applyCashflowSheetAnnualTotal({ ..., editSession: yearEditSession })`

받는 쪽은 구조분해에 `editSession`이 없다:

- `server/bff/java-weekly-client.mjs:244` — `applyCashflowSheetLab({ context, projectId, idempotencyKey, sourceRevision, targetRevision, yearMonth, cells, calculationChecks, replaceAllActualSources, settledWeekChangeConfirmation, closedMonthChangeReason })`
- `:294`, `:342` — 동일

JavaScript 구조분해라 **에러 없이 조용히 버려진다.** `requestJson`은 `editSession`을 받아(`:134`, `:185`) 리스 헤더로 변환하는데(`java-weekly-auth.mjs:94-98`), 그 경로에 값이 도달하지 않는다.

JVM은 그 헤더를 읽는다(`WeeklyExpenseController.java:939`). 스테이지는 `JVM_WEEKLY_EDIT_LEASES_ENABLED=true`다(`cloudbuild.jvm-weekly-api.yaml:71`).

결과가 두 겹이다:

1. `x-edit-lease-id` 부재, `x-edit-fence`가 0 → 펜스 검증 거부
2. `x-edit-finalize`가 전송되지 않음 → **리스가 만료 전까지 해제되지 않고 누적**

두 번째가 "가끔 되다가 어느 시점부터 계속 실패"라는 증상을 만든다.

**로그 확인법:** JVM 요청 로그에서 `/sheet-lab/apply`, `/sheet-lab/batch/apply`, `/sheet-lab/annual/apply` 경로에 `x-edit-lease-id`가 100% 부재인지 확인한다.

### 2-2. 모든 5xx 메시지가 하나의 영어 문자열로 뭉개진다

`server/bff/app.mjs:1559`:

```js
const message = statusCode >= 500 ? 'Internal server error' : (error?.message || 'Request failed');
```

`java-weekly-client.mjs`에 작성된 한국어 5xx 메시지는 전부 도달하지 않는다. 살아남는 것은 기계용 `code` 필드뿐이고, 캐시플로우 UI 컴포넌트 중 그 코드를 읽는 곳은 없다.

`src/app/platform/api-client.ts:396`은 서버 메시지를 읽어 `responseMessage`에 담지만 던지는 `PlatformApiError`에 넣지 않는다(`:418-423`). devtools 로그에만 남는다.

그래서 아래가 전부 화면에서 동일하게 보인다:

| 실제 원인 | 성질 | 사용자가 보는 것 |
|---|---|---|
| 환경변수 미설정 | 영구 | `Internal server error` |
| 토큰 발급 실패 | 일시/영구 | `Internal server error` |
| 네트워크 타임아웃 | 일시 | `Internal server error` |
| 라우트 데드라인 초과 | 일시 | `Internal server error` |

**영구 장애와 일시 장애를 구분할 수 없다.** 아래 항목 대부분의 진단이 서버 로그 고고학을 요구하는 이유가 이것이다.

### 2-3. 브라우저 타임아웃이 BFF 예산보다 짧다

| 계층 | 값 | 위치 |
|---|---|---|
| 브라우저, 대부분의 JVM 호출 | 12,000ms, 재시도 0 | `src/app/lib/platform-bff-client.ts:2455` 외 |
| BFF 1회 시도 | 12,000ms | `java-weekly-client.mjs:127-128` |
| BFF 재시도 | 기본 1회 추가 | `java-weekly-client.mjs:138` |

BFF의 12초는 TLS와 Vercel 콜드스타트 뒤에 시작되므로, **BFF의 첫 시도가 브라우저 마감 전에 끝날 수 없다.** 따라서:

- BFF 재시도는 항상 헛일이다. 클라이언트는 이미 끊겼다.
- 그러나 쓰기는 실제로 두 번 실행된다.
- 사용자는 BFF가 준비한 응답을 결코 보지 못한다.

월 결산 경로만 정합하다(브라우저 27초 > 라우트 26초 > 사전점검 14초 + 변경 12초). 이 경로에는 검토가 있었고 나머지에는 없었다.

`proxyMutation`(`routes/jvm-weekly-api.mjs:1878-1916`)은 `retry`를 지정하지 않아 기본 재시도를 쓴다. 배치 경로만 `retry: false`로 막혀 있다(`java-weekly-client.mjs:325`). 즉 작성자는 위험을 인지했으나 한 경로에만 적용했다. 안전성은 모든 변경 경로의 JVM 멱등키 처리가 정확하다는 미검증 가정에 걸려 있다.

### 2-4. 설정 오류가 조용히 통과하거나 타임아웃으로 위장한다

**audience 누락 시 무인증 전송.** `java-weekly-auth.mjs:41`:

```js
if (!audience) return '';
```

빈 문자열이 반환되면 `if (identityToken)`(`:107`)이 거짓이 되어 **`authorization` 헤더 없이 요청이 나간다.** 경고도 로그도 없다. 같은 파일에서 service token은 누락 시 명시적으로 실패시키는 것과 대조된다(`:79`).

Cloud Run이 이를 403(비-JSON)으로 막고, BFF는 `Java weekly API request failed with 403`이라는 문자열로 표시한다. IAM/audience 문제라는 단서가 없다.

**Vercel에서 도달 불가능한 폴백.** `java-weekly-auth.mjs:52`는 서비스계정 JSON이 없을 때 GCP 메타데이터 서버로 폴백한다:

```js
const tokenUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=...`;
```

BFF는 Vercel에서 실행되므로 이 호스트는 존재하지 않는다. 연결이 매달리다 AbortController가 발화한다. **영구 설정 오류가 일시적 타임아웃으로 위장된다.**

**배포 경로가 둘이고 서로 다르다.** `cloudbuild.bff.yaml:39`의 `--set-env-vars`에 `JVM_WEEKLY_*` 변수가 하나도 없다. 게다가 `--set-env-vars`는 환경 전체를 교체한다. 실제 동작하는 설정은 `.github/workflows/stage-deploy.yml:44-47, 111-114`(Vercel)에만 있다.

`.env.example`에 `JVM_WEEKLY_*` 항목이 없어, 새 환경을 세우는 사람이 필요한 변수 목록을 발견할 방법이 없다.

**audience와 base URL의 일치를 아무도 검증하지 않는다.** 둘은 별개의 GitHub 변수이고(`stage-deploy.yml:44,46`) 워크플로는 각각이 비어있지 않은지만 확인한다(`:86,88`). Cloud Run IAM은 둘의 일치를 요구한다. JVM 서비스를 재배포해 URL이 바뀌면 조용히 깨진다.

**공통점:** 위 항목 전부 시작 시점에는 조용하고 첫 요청에서야 드러난다. BFF에는 채널에 대한 시작 시 검증이 없다. JVM 쪽은 반대로 명시적으로 실패한다(`InternalServiceTokenFilter.java:45`).

### 2-5. 공유 시크릿 경로는 actor/role 헤더를 검증하지 않는다

`InternalServiceTokenFilter.java:66-70`:

```java
String suppliedToken = request.getHeader(HEADER_NAME);
if (internalApiTokenEnabled && tokensMatch(internalApiToken, suppliedToken)) {
    filterChain.doFilter(request, response);
    return;
}
```

시크릿 비교 자체는 `MessageDigest.isEqual`로 상수 시간이다. 문제는 통과 방식이다. Firebase 경로는 `filterChain.doFilter(withTrustedActorHeaders(request, actor), response)`로 요청을 감싸지만(`:92`), 이 경로는 **원본 요청을 그대로** 넘긴다. 하위 컨트롤러는 `x-tenant-id`, `x-actor-id`, `x-actor-role`을 검증 없이 읽는다. 권한 승격 가드(`:163-169`)는 Firebase 경로에만 있다.

브라우저는 이 홉에 헤더를 심을 수 없으므로 현재 외부에서 악용 가능한 상태는 아니다. 다만 **actor 모델 전체의 안전성이 `JVM_WEEKLY_INTERNAL_API_TOKEN` 하나의 비밀 유지에 걸려 있다**는 점은 기록해 둔다.

또한 BFF가 보내는 Google ID 토큰은 **애플리케이션이 검증하지 않는다.** `FirebaseBearerTokenVerifier`는 Firebase ID 토큰 검증기이고, 서비스계정 ID 토큰은 그 검증을 통과하지 못한다. 이 토큰은 Spring 앞단의 Cloud Run IAM에만 의미가 있다. 즉 **독립적으로 실패할 수 있는 인증 체계가 둘**이다.

### 2-6. 설정 오류가 401로 보고된다

`InternalServiceTokenFilter.java:86-89`는 인증 과정의 모든 `RuntimeException`을 401 `weekly_expense_firebase_auth_required`로 변환한다. `FirebaseBearerTokenVerifier.auth()`는 설정 실패 시 `IllegalStateException`을 던진다(`weekly.firebase-auth-project-id must be configured...`). **영구 설정 오류가 로그인 문제로 보고된다.**

JVM에는 `@ExceptionHandler(Exception.class)`가 없다. 처리되지 않은 예외는 Spring 기본 `/error`로 떨어져 `code`도 `message`도 없는 본문을 낸다. BFF는 이를 503 `jvm_weekly_api_internal_error`로 바꾸고, 사용자는 2-2에 따라 `Internal server error`를 본다.

## 결정

**JVM 서비스를 유지한다.**

규모가 근거는 아니다. 이 저장소에서 재무 불변식을 실제로 검증하는 코드가 JVM에 있다는 것이 근거다. 실제 Firestore 트랜잭션과 MockMvc 기반 테스트 약 40개가 원자성, 스냅샷 불변성, 멱등성, 결산 기한, 카운터 오버플로를 검증한다. 반면 프론트엔드 `CashflowProjectSheet.shell.test.ts`는 288개 단언이 전부 소스 코드 문자열 검사다(`expect(source).toContain(...)`). `@testing-library`를 쓰는 파일은 저장소에 0개다.

즉 **"JVM이 문제의 원인"과 "지금 JVM을 걷어낸다"는 별개의 판단이다.** 15,737줄을 옮기는 일은 호수가 아니라 바다이고, 그 과정에서 잃을 보증이 현재 가장 잘 지켜지는 보증이다.

## 다음 작업

| 순서 | 작업 | 근거 |
|---|---|---|
| 1 | `editSession` 3개 경로 전달 복구 | 2-1. 확인된 결함이고 수정 범위가 작다 |
| 2 | 내부 생성 5xx의 `code`를 화면까지 노출 | 2-2. 이것이 있어야 나머지 진단이 스크린샷으로 가능해진다 |
| 3 | 브라우저/BFF 타임아웃 정합, `proxyMutation` 재시도 명시 | 2-3. 헛수고와 이중 쓰기 제거 |
| 4 | audience 누락 시 시작 실패, Vercel에서 메타데이터 폴백 차단, `.env.example` 보강 | 2-4. 조용한 오설정 제거 |
| 5 | `month-close` 쿼리에 `yearMonth` 필터 | 발견 1. 인덱스는 이미 존재한다 |

2번의 레버리지가 가장 크다. 현재는 모든 진단이 서버 로그 고고학을 요구하며, 이는 사용자도 지원 담당자도 수행할 수 없다.

5번은 "성능 개선"이 아니라 **"Postgres 접근 패턴 청산"**이라는 이름으로 다루는 편이 정확하다. 그래야 같은 형태가 다른 쿼리에 남아 있는지 함께 보게 된다.

## 이 문서를 남기는 이유

`origin/codex/cashflow-apply-adr`는 시트 반영/결산 설계를 글로 정리하려던 유일한 시도였고(2026-07-23, +156줄), 머지되지 않았다. 그 커밋 5분 뒤 `be4845d`가 main에 들어가면서 연간합계 삭제→복원 churn이 시작됐다.

같은 기간의 모든 **코드** 브랜치는 머지됐다. 머지되지 않은 것은 문서 브랜치 둘뿐이다.
