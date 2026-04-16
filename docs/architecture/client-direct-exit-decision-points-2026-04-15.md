# Client-Direct Architecture Exit Decision Points

날짜: 2026-04-15  
대상 범위: PM 포털, viewer, 포털과 결합된 admin 운영 surface  
목적: `client-direct architecture`를 실제로 끝내기 위해 닫아야 할 의사결정 포인트를 한 문서에 고정

## 1. One-Line Goal

우리가 끝내려는 것은 “Firestore를 쓰는 것”이 아니라, **클라이언트가 직접 query/listener/provider/write policy를 조합하는 아키텍처**다.

이 문서의 역할은 다음 두 가지다.

- 어떤 결정을 내려야 `client-direct architecture`가 종료되는지 정의
- 각 결정을 `지금 결정`, `Phase 중 결정`, `후속 검토`로 나눠 실행 순서를 고정

## 2. Exit Definition

아래 네 가지가 동시에 성립해야 `client-direct architecture`가 끝났다고 본다.

1. 포털 핵심 화면이 raw Firestore query를 직접 조합하지 않는다.
2. 포털 핵심 쓰기 경로가 command API를 통해서만 상태를 바꾼다.
3. realtime은 explicit allowlist만 남고, route/provider self-inference는 제거된다.
4. 클라이언트는 화면 렌더링과 입력 수집에 집중하고, 데이터 접근 정책은 BFF/server가 가진다.

## 3. What Counts As Client-Direct

다음은 모두 `client-direct architecture`로 본다.

- 화면 컴포넌트가 Firestore `query/where/orderBy/onSnapshot/getDocs`를 직접 결정
- store/provider가 `pathname`, `window.location`, `role`을 조합해 realtime/fetch 정책을 자체 결정
- 화면이 raw collection shape를 직접 해석해 summary를 구성
- 쓰기 로직이 클라이언트에서 여러 문서/상태를 조합해 persistence semantics를 결정
- session active project, onboarding state, workspace scope 같은 제품 정책을 클라이언트가 authoritative 하게 계산

## 4. Decision Categories

의사결정은 여섯 묶음으로 나눈다.

1. **Read Boundary**
2. **Write Boundary**
3. **Realtime Policy**
4. **Session/Auth/Scope Authority**
5. **Caching/Invalidation/Derived Data**
6. **Release/Ownership/Governance**

## 4.1 Decision Ballot

아래 6개만 사람이 명시적으로 고르면 된다.  
나머지는 엔지니어링 기본값으로 밀 수 있다.

### B1. 안정화 범위

- A. 포털만 먼저
- B. 포털 + admin summary 같이
- C. 포털 + admin 전체

권장:

- **B**

이유:

- admin 전체를 같이 잡으면 범위가 커진다.
- 반대로 포털만 보면 admin summary가 다시 raw path를 유지해 경계가 어중간해진다.

### B2. 데이터 최신성 기준

- A. 포털은 fetch-first, 10~60초 지연 허용
- B. 핵심 숫자만 near-real-time
- C. 가능한 실시간 유지

권장:

- **A**

이유:

- 현재 목표는 실시간성보다 안정성이다.
- 포털 운영면은 fetch-first로도 충분하다.

### B3. summary 물리화 강도

- A. 처음엔 전부 live aggregation
- B. 무거운 화면만 materialized summary
- C. 처음부터 광범위하게 materialize

권장:

- **B**

이유:

- live aggregation만으로 가면 dashboard/payroll/export가 다시 병목이 될 수 있다.
- 처음부터 전면 materialization으로 가면 운영 복잡도가 너무 빨리 올라간다.

### B4. command API 전환 강도

- A. 핵심 쓰기만 먼저
- B. 포털 write 전부 한 번에
- C. 읽기만 먼저, 쓰기는 나중

권장:

- **A**

이유:

- session project, onboarding, weekly expense, submission, bank handoff, cashflow close만 먼저 옮겨도 구조 경계가 크게 개선된다.

### B5. release gate 강도

- A. stable lane은 강하게, 예외 경로는 time-boxed 완화
- B. 경고만 남기고 main 배포는 허용
- C. build/test만 유지

권장:

- **A**

이유:

- 이번 incident는 build green으로는 못 잡았다.
- 다만 1000명 규모 내부 SaaS라도 모든 low-risk 실험면까지 같은 gate를 일괄 강제하면 속도가 죽는다.
- 따라서 기본은 stable lane으로 두되, 아주 제한된 예외 경로만 time-boxed로 허용하는 것이 맞다.

### B6. 중기 인프라 방향

- A. Firestore 유지 + BFF/API-first, 이후 AWS core backend 검토
- B. AWS 이전을 지금부터 강하게 설계
- C. Cloudflare 중심 재편

권장:

- **A**

이유:

- 지금 필요한 건 저장소 교체가 아니라 client-direct 종료다.
- AWS는 다음 단계에서 더 유력한 코어 백엔드 옵션으로 남긴다.

### Recommended Ballot

현재 권장 세트:

- **B1-B**
- **B2-A**
- **B3-B**
- **B4-A**
- **B5-A**
- **B6-A**

## 4.2 Temporary Exception Policy

이 제품은 `1000명 규모 내부 production SaaS`이므로, 기본값은 stable lane이다.  
다만 low-risk 실험이나 read-only exploratory surface에 한해 제한된 예외를 허용한다.

### Temporary Exception Path에서 허용하는 것

- 새 exploratory 화면의 제한적 `client-direct read`
- summary가 아닌 low-risk, read-mostly surface의 raw Firestore read
- feature flag 뒤의 제한 rollout
- build + targeted smoke + severe error 없음 수준의 완화 gate

### Temporary Exception Path에서도 금지하는 것

- 무한 loop 또는 channel churn이 확인된 realtime path
- 핵심 사용자 경로에서의 silent overwrite
- 저장/제출/정산/승인 경로의 client-authoritative write
- route/provider ambient state self-inference 재도입
- owner/expiry/remove condition 없는 임시 direct path

### Exception Rule

예외를 허용하려면 아래 네 가지를 남긴다.

1. owner
2. expiry date
3. 제거 조건
4. stable lane 진입 조건

## 5. Decision Points

### D1. 어떤 화면까지 BFF read model로 옮길 것인가

질문:

- 어디까지를 “포털 핵심 화면”으로 정의할 것인가

결정:

- 아래는 모두 BFF read model 대상이다.
  - `/portal`
  - `/portal/project-select`
  - `/portal/onboarding`
  - `/portal/weekly-expenses`
  - `/portal/bank-statements`
  - `/portal/cashflow`
  - `/portal/payroll`
  - `/portal/submissions`에 남아 있는 summary 성격 surface

이유:

- 이 화면들은 제품 업무 경로이며, raw collection 해석을 클라이언트에 남기면 다시 drift가 생긴다.

상태:

- **지금 결정**

### D2. 어떤 화면만 Firestore direct를 허용할 것인가

질문:

- Firestore direct를 완전히 0으로 만들 것인가, allowlist를 둘 것인가

결정:

- 포털/viewer는 원칙적으로 direct read 금지
- admin에서도 협업성 실시간 surface만 제한적으로 허용
- 허용 후보:
  - 댓글
  - 알림 count
  - narrow collaboration thread

이유:

- direct path를 완전 금지하지는 않되, “기본 금지 + 명시적 예외”로 바꿔야 한다.

상태:

- **지금 결정**

### D3. read model의 authoritative owner는 누구인가

질문:

- BFF가 단순 passthrough 인가, 아니면 화면 read model의 authoritative owner 인가

결정:

- BFF가 authoritative owner다.
- 화면은 raw collection을 fallback으로 직접 읽지 않는다.

이유:

- BFF가 contract를 가지지 않으면 hybrid 상태가 영구히 굳는다.

상태:

- **지금 결정**

### D4. 어떤 쓰기 경로부터 command API로 옮길 것인가

질문:

- 모든 write를 한 번에 옮길 것인가, 아니면 우선순위 순으로 이동할 것인가

결정:

- 순차 이관한다.
- 우선순위:
  1. session project switch
  2. onboarding/registration
  3. weekly expense save
  4. submission submit/close
  5. bank statement handoff state update
  6. cashflow projection update/close

이유:

- 이 경로들이 현재 포털 UX와 데이터 일관성에 가장 직접적이다.

상태:

- **지금 결정**

### D5. command API가 어디까지 domain rule을 가져갈 것인가

질문:

- command API는 저장만 할 것인가, 아니면 상태 전이 규칙까지 책임질 것인가

결정:

- command API가 domain rule을 가진다.
- 클라이언트는 입력과 intent만 보낸다.

예:

- “제출 가능 여부”
- “현재 주차 기준본 반영”
- “bank statement handoff merge semantics”
- “projection close status propagation”

상태:

- **지금 결정**

### D6. session active project의 authoritative source는 무엇인가

질문:

- local state, browser storage, Firestore profile, 서버 session 중 무엇이 기준인가

결정:

- authoritative source는 서버/BFF session contract다.
- 브라우저 storage는 캐시 또는 hint 역할만 한다.

이유:

- 지금까지 active project 혼선은 client-side authority가 너무 컸기 때문이다.

상태:

- **지금 결정**

### D7. onboarding / project-select는 영구적으로 entry shell에 남길 것인가

질문:

- entry surface를 임시 우회가 아니라 별도 아키텍처로 고정할 것인가

결정:

- 예. entry shell은 영구 경계다.
- onboarding / project-select / public portal entry는 workspace shell로 다시 합치지 않는다.

상태:

- **지금 결정**

### D8. provider는 route shell이 주입한 policy만 소비할 것인가

질문:

- provider/store가 browser ambient state를 읽는 것을 완전히 금지할 것인가

결정:

- 예.
- provider/store는 `pathname`, `window.location`으로 policy를 추론하지 않는다.
- route shell 또는 data boundary layer가 policy를 주입한다.

상태:

- **지금 결정**

### D9. realtime allowlist는 어디서 관리할 것인가

질문:

- 코드상 암묵 규칙으로 둘 것인가, 아니면 명시적 목록으로 둘 것인가

결정:

- 명시적 allowlist 문서 + 테스트 + 리뷰 규칙으로 관리한다.

필수 산출물:

- allowlist 문서
- 신규 `onSnapshot` 차단 규칙
- route별 realtime contract test

상태:

- **지금 결정**

### D10. derived summary는 live aggregation인가, materialized summary인가

질문:

- BFF가 매 요청마다 raw collections를 fan-out 조회해 계산할 것인가
- summary 문서를 따로 materialize 할 것인가

결정:

- 1차는 BFF live aggregation
- 2차는 비용이 큰 화면만 materialized summary 문서로 전환

이유:

- 너무 빨리 materialization으로 가면 운영 복잡도가 급격히 올라간다.
- 하지만 dashboard/payroll/export summary는 결국 materialization 후보가 된다.

상태:

- **Phase 2~3에서 세부 결정**

### D11. cache/invalidation 전략은 무엇인가

질문:

- read model을 no-store로 둘 것인가, short TTL을 둘 것인가, tag invalidation을 둘 것인가

결정:

- entry surface와 session-sensitive read model은 no-store 또는 매우 짧은 TTL
- summary API는 짧은 TTL + explicit invalidation hook
- 정적 자산과 폰트는 immutable cache

상태:

- **지금 기본 방향 결정**
- **세부 TTL은 Phase 2에서 확정**

### D12. auth/permission 해석은 어디서 할 것인가

질문:

- role, workspace scope, project access를 클라이언트가 조합할 것인가

결정:

- BFF가 authoritative interpreter다.
- 클라이언트는 permission result만 소비한다.

상태:

- **지금 결정**

### D13. API contract versioning을 도입할 것인가

질문:

- read model/command API가 늘어날 때 shape drift를 어떻게 막을 것인가

결정:

- 최소한 schema contract test는 즉시 도입
- public-ish BFF contract는 `v1` namespace 유지
- 대규모 breaking change가 생길 때만 명시 버전 업

상태:

- **지금 기본 방향 결정**

### D14. release gate에 무엇을 추가할 것인가

질문:

- build/test green 외에 무엇이 있어야 운영 안정화라고 볼 수 있는가

결정:

- 필수 release gate:
  - authenticated route smoke
  - Firestore channel count budget
  - entry surface HAR budget
  - console error budget
  - route transition stability

상태:

- **지금 결정**

### D15. 어떤 HAR / 네트워크 지표를 제품 KPI처럼 볼 것인가

질문:

- 성능을 단순 Lighthouse 점수로 볼 것인가, 제품 네트워크 지표를 따로 둘 것인가

결정:

- 포털은 별도 KPI를 둔다.
- 최소 지표:
  - entry surface Firestore `Listen`
  - entry surface Firestore `Write`
  - initial request count
  - transferred JS/CSS/font bytes
  - route-change induced fetch burst

상태:

- **지금 결정**

### D16. admin는 어디까지 같은 원칙을 따를 것인가

질문:

- 포털만 API-first로 갈 것인가, admin도 같이 갈 것인가

결정:

- 포털이 우선
- admin는 summary surface부터 순차 cutover
- admin raw operational editing surface는 당분간 일부 direct path 허용 가능

상태:

- **지금 방향 결정**
- **화면별 범위는 Phase 4에서 확정**

### D17. 저장소 최종안은 언제 결정할 것인가

질문:

- Firestore 유지, AWS 이전, AWS+Cloudflare hybrid 중 최종안을 언제 닫을 것인가

결정:

- 지금은 저장소 최종안을 닫지 않는다.
- 먼저 API-first 경계를 만든다.
- 이후 아래 조건이 충족되면 코어 저장소 이전 결정을 내린다.

판단 기준:

- read model/command API가 충분히 자리잡았는가
- raw Firestore 의존이 핵심 운영면에서 제거됐는가
- summary/aggregation 비용이 Firestore에 계속 남는 게 불리한가

상태:

- **후속 아키텍처 결정**

### D18. 팀 운영 규칙을 어떻게 바꿀 것인가

질문:

- 이 구조가 다시 무너지지 않게 코드리뷰/문서/가드를 어떻게 고정할 것인가

결정:

- 필수 규칙:
  - 새 포털 화면은 Firestore direct 금지
  - 새 `onSnapshot`은 allowlist 승인 없이는 금지
  - 새 summary 화면은 BFF schema 없이 merge 금지
  - wiki/architecture doc 없이 경계 변경 금지

상태:

- **지금 결정**

## 6. Decisions We Should Lock Now

아래는 더 미루면 안 된다.

1. 포털/viewer direct read 금지
2. entry shell 영구 경계화
3. BFF read model authoritative owner화
4. command API 우선순위 고정
5. provider/store ambient state 추론 금지
6. realtime allowlist 운영 규칙 고정
7. release gate에 network/session 기준 추가

## 7. Decisions To Close During Execution

아래는 구현하면서 닫아야 한다.

1. summary별 materialization 필요 여부
2. API TTL / invalidation 세부값
3. admin summary surface cutover 범위
4. command API 도입 후 audit/event 모델 세부 구조

## 8. Decisions To Defer

아래는 지금 닫지 않는다.

1. Firestore 완전 폐기 여부
2. PostgreSQL/Aurora 전면 이전 시점
3. Cloudflare edge layer 실제 도입 범위
4. 전체 앱 단위의 infra replatform

## 9. Recommended Order

정리하면 순서는 이렇다.

1. `client-direct architecture`의 종료 조건을 문서와 리뷰 규칙으로 고정
2. entry surface와 portal summary를 BFF read model로 전환
3. critical write path를 command API로 이동
4. admin summary surface를 같은 원칙으로 cutover
5. 그 다음에야 저장소 최종안과 edge layer를 결정

## 10. Final Position

지금 가장 중요한 의사결정은 “AWS냐 Cloudflare냐”가 아니다.

지금 닫아야 할 결정은 이것이다.

- **클라이언트가 더 이상 데이터 접근 정책의 owner가 아니게 만들 것인가**

답은 `예`다.

이 문서의 나머지 의사결정 포인트는 모두 그 한 문장을 코드와 운영 규칙으로 변환하기 위한 세부 항목이다.
