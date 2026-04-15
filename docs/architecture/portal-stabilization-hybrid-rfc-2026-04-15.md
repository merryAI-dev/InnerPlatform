# Portal Stabilization Hybrid RFC

날짜: 2026-04-15  
목표 기간: 6~8주  
기본안: `Firestore 유지 + BFF/API-first hybrid`  
대상 범위: PM 포털, 포털과 결합된 운영 read model, 일부 admin 운영 surface

## 1. 한 줄 결론

지금 포털의 핵심 리스크는 Firestore 자체보다 `클라이언트가 데이터 접근 정책을 너무 많이 가지고 있다`는 점이다.

따라서 장기적으로는 다음 방향으로 전환한다.

- Firestore는 당분간 source of truth로 유지한다.
- 포털과 운영 대시보드의 기본 읽기 경로는 BFF/API-first로 전환한다.
- 클라이언트는 route/provider/query/realtime 정책을 직접 조합하지 않는다.
- realtime은 댓글, 알림, 일부 협업 surface처럼 진짜 실시간성이 필요한 좁은 영역으로 제한한다.

이 RFC의 목표는 Firebase를 버리는 것이 아니라, `Firestore direct app`에서 `BFF-mediated SaaS`로 제품 구조를 바꾸는 것이다.

## 2. 왜 지금 바꿔야 하는가

최근 포털 불안정 이슈의 공통 원인은 아래로 수렴한다.

- 앱 루트에 전역 provider가 많이 붙어 있다.
- 각 provider가 Firestore realtime/fetch 정책을 자체적으로 결정한다.
- route 전환, role 전환, active project 전환이 query 정책과 얽혀 있다.
- `/portal` 같은 PM 화면도 admin 기준 realtime 판단의 영향을 받는다.
- 결과적으로 하나의 판단 누락이 반복 `Listen 400`, flicker, stale data, navigation regression으로 이어진다.

이 구조는 속도는 빠르지만, 장기 운영 안정성은 낮다.

## 3. 옵션 비교

### Option A. Firestore direct 유지

프론트엔드가 Firestore를 계속 직접 읽고, 각 store/provider가 realtime과 fetch 전략을 고른다.

장점:
- 변경량이 가장 작다.
- 단기 기능 추가 속도는 빠르다.

단점:
- 지금 같은 route/provider coupling이 계속 재발한다.
- 권한, query, realtime 정책이 계속 프론트에 분산된다.
- 운영 화면이 늘수록 불안정성도 같이 커진다.

판단:
- 장기적으로 비추천

### Option B. Hybrid: Firestore 유지 + BFF/API-first

Firestore는 저장소로 유지하고, 포털과 운영 화면의 읽기 모델은 BFF가 조합해서 내려준다.

장점:
- 현재 스택을 버리지 않고 안정성을 크게 올릴 수 있다.
- route별 query 정책을 서버와 BFF에서 통제할 수 있다.
- 화면은 `몇 개의 명시적 API 응답`만 기준으로 렌더링하게 된다.
- 이후 PostgreSQL/application server로 더 전환할 여지도 남긴다.

단점:
- 6~8주 동안 read model, API contract, cache 전략을 같이 정리해야 한다.
- 한동안은 Firestore raw model과 BFF read model이 함께 존재한다.

판단:
- 권장안

### Option C. 전면 재플랫폼

PostgreSQL + application server 중심으로 한 번에 넘어간다.

장점:
- 최종 통제력이 가장 높다.

단점:
- 지금 구조 문제를 정리하지 않으면 문제를 다른 인프라로 옮길 뿐이다.
- 이번 범위에서는 비용과 리스크가 너무 크다.

판단:
- 지금 RFC의 비교안으로만 유지

## 4. 권장 결정

권장안은 `Option B. Hybrid: Firestore 유지 + BFF/API-first`다.

즉:

- Firestore는 source of truth로 유지한다.
- 포털과 핵심 운영 화면은 BFF read model로 전환한다.
- 클라이언트는 화면 렌더링과 입력에 집중한다.
- critical write path는 순차적으로 BFF command API로 이동한다.
- Firestore realtime은 explicit allowlist surface만 남긴다.

## 5. 목표 상태

6~8주 후 목표 상태는 아래와 같다.

### 5.1 클라이언트

- `/portal`은 route-scoped provider만 마운트한다.
- 포털의 기본 데이터 로딩은 BFF API fetch로 동작한다.
- 포털 화면은 raw Firestore query를 직접 조합하지 않는다.
- `onSnapshot`은 협업성 surface 외에는 새로 추가하지 않는다.

### 5.2 BFF

- 포털 홈, 제출 현황, 주간 사업비, 통장내역 요약, 캐시플로 요약, payroll summary에 대한 read model endpoint를 가진다.
- read model은 화면이 필요한 shape로 조합돼 있다.
- role, active project, workspace scope는 BFF에서 일관되게 해석한다.

### 5.3 저장소

- Firestore는 source of truth를 유지한다.
- raw collections는 유지하되, 화면은 직접 raw shape에 의존하지 않는다.
- 필요한 경우 derived summary document 또는 server aggregation cache를 추가한다.

## 6. 설계 원칙

### 원칙 1. 포털은 fetch-first

`/portal`과 `/viewer`는 기본적으로 fetch-first다.

- 기본값: one-shot fetch
- 예외: 명시적 allowlist realtime surface

### 원칙 2. realtime은 allowlist만

realtime은 “필요한 곳만 허용”으로 바꾼다.

허용 후보:
- 댓글
- 알림 count
- 일부 협업 thread

비허용 기본값:
- 포털 홈
- 제출 현황
- 통장내역
- 사업비 입력
- 예산 요약
- payroll summary

### 원칙 3. 화면은 read model만 본다

운영 화면은 raw collection shape가 아니라 BFF read model을 기준으로 렌더링한다.

예:
- portal dashboard summary
- weekly submission overview
- bank statement handoff summary
- weekly expense tab summary

### 원칙 4. route/provider coupling 제거

앱 루트에 전역 provider를 광범위하게 마운트하지 않는다.

- route layout별 provider tree 분리
- portal 전용 provider
- admin 전용 provider
- global provider 최소화

### 원칙 5. query policy 중앙화

각 store가 알아서 realtime/fetch를 고르지 않는다.

정책은 중앙화한다.

- route policy
- workspace policy
- role policy
- realtime allowlist

## 7. 범위

### In Scope

- PM 포털의 read path
- 포털과 직접 연결된 shared provider
- 포털 홈/주간제출/주간사업비/통장내역/캐시플로/payroll summary read model
- admin 일부 summary surface의 fetch-first 전환
- route-scoped provider tree 분리

### Out of Scope

- PostgreSQL 전환
- Firestore 전체 폐기
- 모든 write flow의 즉시 서버 전환
- board/comment/alarm 같은 협업 realtime surface의 전면 제거

## 8. 단계별 전환안

### Phase 0. Freeze Line and Observability (Week 1)

목표:
- 더 이상 포털에 무분별한 direct Firestore access가 늘어나지 않게 한다.

산출물:
- portal/viewer realtime allowlist 문서화
- `onSnapshot` 신규 사용 금지 rule
- provider별 route-awareness 검사
- production console error / Listen 400 / route flicker 계측 baseline

종료 기준:
- `/portal`에서 어떤 provider가 realtime을 쓰는지 목록화 완료
- 새 direct listener를 막는 lint/test/guard 존재

### Phase 1. Provider Boundary Split (Week 1~2)

목표:
- App 루트 전역 provider를 route-scoped provider tree로 나눈다.

변경:
- `App.tsx`의 broad provider tree 축소
- portal layout 전용 providers
- admin layout 전용 providers
- route 변경에 따라 mount/unmount가 명시적으로 보이도록 정리

종료 기준:
- `/portal` 진입 시 불필요한 admin/shared provider가 mount되지 않음
- provider mount 수와 initial network burst 감소

### Phase 2. Portal Read Model API (Week 2~4)

목표:
- 포털 핵심 화면 읽기를 BFF read model로 옮긴다.

우선 화면:
- portal dashboard
- submissions summary
- weekly expense summary
- bank statement handoff summary
- payroll summary

예상 endpoint:
- `GET /api/portal/dashboard`
- `GET /api/portal/submissions/summary`
- `GET /api/portal/weekly-expenses/summary`
- `GET /api/portal/bank-statements/summary`
- `GET /api/portal/payroll/summary`

종료 기준:
- 위 화면들이 raw Firestore reads 없이 렌더 가능
- 포털 홈이 Firestore network churn 없이 부팅 가능

### Phase 3. Direct Write Edge Reduction (Week 4~6)

목표:
- 운영 리스크가 큰 write path부터 command API로 이동한다.

우선순위:
- weekly expense save
- weekly submission submit/close
- cashflow projection update/close
- bank statement handoff state update

종료 기준:
- 핵심 저장 경로가 client patch + direct Firestore write에 의존하지 않음
- audit, validation, conflict handling이 BFF 기준으로 정리됨

### Phase 4. Admin Summary Surface Hybrid Cutover (Week 6~8)

목표:
- admin 일부 summary surface도 read model 중심으로 줄인다.

후보:
- admin dashboard summary
- cashflow export summary metadata
- auth governance summary

종료 기준:
- admin summary와 portal summary가 같은 raw collection fan-out을 반복하지 않음

## 9. 실행 리스크

### 리스크 1. Hybrid 상태가 오래 고착됨

대응:
- 각 phase의 종료 기준을 명확히 잡는다.
- raw Firestore read가 남은 화면 목록을 주간 단위로 관리한다.

### 리스크 2. 새 기능이 다시 direct path로 들어옴

대응:
- `onSnapshot` 신규 사용 rule
- code review checklist
- patch-note/wiki에 shared architecture 변경 누적

### 리스크 3. read model drift

대응:
- endpoint contract test
- derived schema fixtures
- 화면별 smoke test

## 10. 이번 주부터 바로 시작할 것

- route-scoped provider split
- portal/viewer realtime allowlist 고정
- direct listener guard 추가
- portal dashboard/submissions/payroll read model contract 초안 작성
