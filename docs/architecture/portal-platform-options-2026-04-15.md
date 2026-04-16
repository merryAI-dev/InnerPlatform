# Portal Platform Options Comparison

날짜: 2026-04-15  
대상 범위: PM 포털, 포털과 결합된 운영 surface, 장기 백엔드/배포 아키텍처 결정  
비교 대상: `Firestore 유지안`, `AWS 이전안`, `AWS + Cloudflare hybrid`

## 1. Executive Summary

현재 포털 문제의 핵심은 “Firebase라서”가 아니라, 클라이언트가 직접 query, listener, route policy, bootstrap state write를 너무 많이 들고 있는 구조다.

따라서 인프라 교체만으로는 문제를 해결하지 못한다.  
장기적으로 가장 현실적이고 안정적인 방향은 아래다.

- 코어 업무 데이터와 read/write 정책은 `BFF/API-first`로 재편한다.
- 당장 모든 데이터를 옮기지 않고, 먼저 `entry surface -> portal summary -> critical write path` 순으로 서버 경계를 만든다.
- 이후 코어 저장소를 AWS로 옮길지 여부는 이 경계를 만든 뒤 판단한다.

권장안:

- **단기 0~8주:** `Firestore 유지 + BFF/API-first hybrid`
- **중기 2~6개월:** `AWS core backend + Cloudflare/Vercel edge delivery`로 확장 가능
- **비권장:** 지금 상태에서 `Cloudflare-first`로 바로 이동하거나, 클라이언트 구조를 유지한 채 DB만 교체

## 2. One-Line Answer

질문: “AWS나 Cloudflare로 옮기면 새로고침이나 안정성이 좋아질까?”

답:

- **그대로 옮기면 아니다.**
- **BFF/API-first 구조로 바꾼 뒤 AWS core backend로 옮기면 장기적으로 좋아질 가능성이 높다.**
- **Cloudflare는 edge/API 앞단에는 좋지만, 현재 포털의 코어 transactional backend 1순위로 두기엔 맞지 않는다.**

## 3. Evaluation Criteria

이번 비교는 아래 기준으로 본다.

1. 운영 안정성
2. query/listener 통제력
3. route/provider coupling 제거 가능성
4. 초기 페이지 성능과 캐시 전략
5. 데이터 모델링 유연성
6. 팀의 전환 비용
7. 6~8주 안의 실행 가능성

## 4. Option A: Firestore Direct 유지

정의:

- 프론트가 계속 Firestore를 직접 읽고 쓴다.
- store/provider가 화면별로 realtime/fetch 전략을 직접 결정한다.

장점:

- 당장 기능 개발 속도가 빠르다.
- 기존 코드와 운영 경험을 가장 많이 재사용할 수 있다.
- 초기 전환 비용이 작다.

단점:

- 지금 같은 `route/provider/query/realtime drift`가 반복되기 쉽다.
- read model이 화면마다 흩어지고, 권한과 query 정책이 클라이언트에 남는다.
- 특정 화면이 안정화돼도 다른 화면에서 다시 같은 종류의 문제가 터질 수 있다.
- 운영 surface가 늘수록 bootstrap과 state write 경계가 복잡해진다.

안정성 판단:

- 단기 봉합은 가능
- 장기 안정성은 낮음

추천 여부:

- **장기 기본안으로는 비추천**

## 5. Option B: AWS Full Replatform

정의:

- 코어 데이터 저장소를 PostgreSQL/Aurora 같은 AWS 기반으로 이동한다.
- 클라이언트는 API/BFF를 통해서만 읽고 쓴다.
- Firestore direct model은 단계적으로 제거한다.

장점:

- transaction, read model, write model, audit, indexing 전략을 더 명시적으로 통제할 수 있다.
- portal/admin 운영면을 서버 중심 도메인 모델로 재구성하기 좋다.
- 대규모 운영 화면, 집계, 권한 통제, 배치/리포트에 더 유리하다.
- 장기적으로 product surface가 커질수록 구조 이점이 커진다.

단점:

- 초기 이행 비용이 크다.
- 인증/권한/도메인/API/read model/write model을 같이 재설계해야 한다.
- 지금의 구조 문제를 먼저 자르지 않으면, 문제를 AWS로 옮기는 결과가 된다.
- 6~8주 내 “완전 이전”은 위험하다.

안정성 판단:

- 장기 잠재력은 가장 높음
- 하지만 지금 바로 전면 이전은 리스크가 큼

추천 여부:

- **장기 목표로는 유력**
- **즉시 전체 이전 기본안으로는 비추천**

## 6. Option C: AWS + Cloudflare Hybrid

정의:

- 코어 업무 백엔드는 AWS에 둔다.
- edge/API gateway/cache/static delivery는 Cloudflare를 활용한다.
- 프론트는 API-first로 동작한다.

예시 역할 분담:

- AWS:
  - Aurora/Postgres
  - app server / BFF / background jobs
  - IAM / secrets / queue / batch
- Cloudflare:
  - edge cache
  - lightweight edge routing
  - static/font/asset delivery
  - 일부 read-through cache

장점:

- 코어 데이터 안정성과 edge 성능을 동시에 가져갈 수 있다.
- 정적 자산, locale/font, entry shell, public routes는 더 빠르게 만들 수 있다.
- 포털 entry surface 같은 부분은 Cloudflare 계층에서 특히 이점이 크다.

단점:

- 운영 복잡도가 올라간다.
- AWS와 Cloudflare 양쪽 지식이 필요하다.
- 초기에 경계가 모호하면 오히려 디버깅이 어려워질 수 있다.

안정성 판단:

- 설계를 잘하면 가장 균형이 좋다.
- 다만 “하이브리드”는 구조가 정리된 뒤에 가야 이점이 산다.

추천 여부:

- **중장기 확장안으로 추천**
- **지금 당장 1차 안정화 기본안으로는 아직 이름만 큰 선택지**

## 7. Cloudflare-First가 아닌 이유

Cloudflare 자체가 나쁘다는 뜻은 아니다.  
문제는 현재 포털의 핵심 병목이 edge가 아니라 `data access architecture`라는 점이다.

Cloudflare-first가 지금 기본안이 아닌 이유:

- 현재 문제는 static delivery보다 state/query/listener 경계가 더 크다.
- core transactional backend와 read model 설계를 먼저 정리해야 한다.
- D1/Workers 중심으로 바로 틀면, edge는 좋아져도 core domain 안정성이 자동으로 좋아지지 않는다.

따라서 Cloudflare는:

- **delivery/edge/API acceleration 계층**으로는 좋다.
- **현재 포털 재설계의 1차 core backend 선택지**로는 아니다.

## 8. Recommendation

현재 기준 최적 의사결정은 아래다.

### Stage 1. 지금 바로

`Firestore 유지 + BFF/API-first hybrid`

이유:

- 가장 빨리 안정성을 올릴 수 있다.
- 현재 코드와 데이터 모델을 한 번에 버리지 않아도 된다.
- entry surface, dashboard summary, submission summary, critical write path를 순차적으로 옮길 수 있다.

### Stage 2. 구조가 잡히면

`AWS core backend`로 점진 이행

이유:

- 그 시점에는 클라이언트가 이미 API-first가 되어 있어 저장소 교체 비용이 크게 줄어든다.
- read/write contract가 안정되면 Firestore raw model 의존을 서서히 줄일 수 있다.

### Stage 3. 성능/글로벌/edge 최적화가 필요해지면

`AWS + Cloudflare hybrid`

이유:

- entry surface, public shell, 정적 자산, edge cache, 일부 read-through API 가속에 가장 잘 맞는다.

## 9. Recommended Migration Sequence

### Phase 1. 0~8주

- entry surface를 workspace shell과 분리
- BFF `entry-context`, `onboarding-context`, `session-project`, `registration` 고정
- `/portal` home, submissions, bank statement summary, weekly expense summary read model 추가
- critical write path를 command API로 이동 시작

목표:

- 클라이언트에서 listener/query policy를 직접 조합하지 않게 만들기

### Phase 2. 2~3개월

- portal/admin 핵심 read model을 서버 조합형으로 이관
- Firestore direct read allowlist 정리
- summary/aggregation 문서를 서버에서 관리
- audit/permission/project scope를 BFF 일원화

목표:

- Firestore가 앱 아키텍처의 중심이 아니라 저장소 중 하나가 되게 만들기

### Phase 3. 3~6개월

- AWS core backend 도입 여부 최종 결정
- 대상 예시:
  - project/workspace registry
  - submission summary
  - weekly settlement command path
  - payroll summary
  - export/report pipeline

목표:

- 운영 핵심 도메인을 서버 중심으로 전환

### Phase 4. 이후

- edge delivery, cache, route acceleration 최적화
- 필요 시 Cloudflare 계층 추가

목표:

- 안정성 위에 성능을 얹기

## 10. Decision Table

| 항목 | Firestore Direct 유지 | AWS Full Replatform | AWS + Cloudflare Hybrid |
| --- | --- | --- | --- |
| 단기 실행 속도 | 높음 | 낮음 | 낮음 |
| 현재 문제 재발 방지 | 낮음 | 중간 이상 | 중간 이상 |
| 장기 안정성 | 낮음 | 높음 | 높음 |
| 운영 복잡도 | 낮음 | 중간 | 높음 |
| 팀 전환 비용 | 낮음 | 높음 | 높음 |
| 6~8주 내 현실성 | 높음 | 낮음 | 낮음 |
| 포털 entry 성능 최적화 | 중간 | 중간 | 높음 |
| 코어 업무 백엔드 적합성 | 중간 | 높음 | 높음 |
| 지금 기본안 추천 여부 | 아니오 | 아직 아님 | 아직 아님 |

## 11. Final Decision

최종 권고:

- **지금 즉시 선택할 기본안:** `Firestore 유지 + BFF/API-first hybrid`
- **중기 목표 아키텍처:** `AWS core backend`
- **장기 성능/edge 확장안:** `AWS + Cloudflare hybrid`

즉, 답은 “AWS냐 Cloudflare냐”가 아니라:

- 먼저 `client-direct architecture`를 끝내고
- 그 다음 `AWS core backend`로 옮기며
- 필요하면 `Cloudflare`를 edge layer로 붙이는 것이다.

이 순서가 가장 리스크가 낮고, 안정성 개선 가능성이 가장 높다.
