# Portal Entry Incident Postmortem

작성일: 2026-04-15  
문서 성격: 내부 운영/리더십 공유용 incident report + failure autopsy  
대상 범위: `/portal`, `/portal/project-select`, `/portal/onboarding`, PM 포털 진입면 전체

## 1. Executive Summary

이번 장애는 Firestore 자체의 단일 장애가 아니라, 포털 진입면이 workspace 아키텍처와 충분히 분리되지 않은 상태에서 화면 개편과 안정화 핫픽스가 빠르게 누적되며 발생한 구조적 실패였다.

사용자 관점에서는 세 가지가 동시에 보였다.

- `/portal` 또는 진입 후 초기 화면에서 Firestore `Listen` 오류와 network churn이 반복됐다.
- 포털 온보딩 카드에서 버튼을 눌러도 다음 화면으로 안정적으로 이동하지 않는 경우가 있었다.
- 브라우저가 번쩍이거나, 화면이 다시 로드되는 것처럼 보이는 체감이 발생했다.

이번 건의 핵심 교훈은 단순하다.

- `entry surface`는 `workspace shell`과 분리되어야 한다.
- store/provider는 route를 스스로 추론하면 안 된다.
- “배포됨”, “CI green”, “alias updated”는 운영 해결의 충분조건이 아니다.

## 2. What Users Experienced

사용자에게 실제로 관측된 현상은 아래와 같다.

### 2.1 Functional failures

- 온보딩 카드에서 `기존 사업 선택`, `증빙 업로드만 할게요`, `새 사업 등록` 버튼을 눌러도 기대한 다음 페이지로 안정적으로 이동하지 않았다.
- 포털 진입 후 `project-select`가 사업 선택 step이 아니라 무거운 workspace 초기화 비용을 같이 떠안았다.

### 2.2 Reliability failures

- Firestore `Listen` 요청이 반복적으로 열리고 닫히며, 400 에러 또는 channel churn이 관측됐다.
- 사용자는 “서버가 새로고침을 자주 한다”, “화면이 번쩍거린다”고 인지했다.

### 2.3 Performance failures

- HAR 기준 `/portal/project-select` 요청은 총 `102`개였다.
- 그 중 Firestore 요청이 `73`개였고, `Listen`이 `68`, `Write`가 `5`였다.
- Firestore 응답 바이트는 약 `2.316MB`, 앱 정적 자산은 약 `1.783MB`였다.
- Pretendard 관련 요청은 `18`개, 약 `511KB`였다.

이 숫자는 “사업 선택 entry page”에 허용 가능한 수준이 아니었다.

## 3. What Happened

2026-04-14부터 2026-04-15 사이 포털 안정화 작업은 아래 흐름으로 진행됐다.

### 3.1 Phase A: 증상별 hotfix

다음 종류의 수정이 순차적으로 들어갔다.

- 특정 Firestore listener 제거 또는 safe-fetch 전환
- route-aware realtime mode 보정
- onboarding 카드 navigation 복구
- route-scoped provider split

이 단계의 장점은 빠른 완화였다.  
단점은 root cause를 한 번에 제거하지 못하고, “어떤 listener가 문제인가”를 계속 부분 최적화하는 방식이 됐다는 점이다.

### 3.2 Phase B: root cause 재정의

이후 확인된 사실은 다음과 같았다.

- 진짜 문제는 “특정 listener 하나”가 아니라 `portal entry surface` 전체가 workspace architecture에 너무 깊게 물려 있었다는 점이었다.
- `project-select`와 `onboarding`이 실제로는 lightweight entry page가 아니라, portal shell/bootstrap/store policy와 얽힌 반쯤 workspace 화면처럼 동작했다.
- route/provider/query policy가 여러 군데로 흩어져 있어서, 어떤 보정이 들어가도 다른 경로에서 같은 종류의 churn이 다시 살아날 수 있었다.

### 3.3 Phase C: boundary fix

현재 기준으로 실제 구조 변경은 두 축으로 정리됐다.

- `project-select`를 lightweight entry shell + BFF `entry-context`/`session-project`로 분리
- `onboarding`을 같은 entry shell + BFF `onboarding-context`/`portal/registration`으로 분리

여기서부터 비로소 “진입면은 fetch-first”, “workspace는 별도 shell”이라는 경계가 코드에서 명시되기 시작했다.

## 4. Root Cause

이번 incident의 root cause는 아래 네 가지가 겹친 것이다.

### 4.1 Entry surface와 workspace surface가 분리되지 않았다

`/portal/project-select`와 `/portal/onboarding`은 사용자 기대상 entry page였다.  
하지만 실제 구조는 portal shell, portal store bootstrap, shared provider 정책과 충분히 분리되지 않았다.

결과:

- entry page가 workspace 수준의 상태/정책 비용을 같이 떠안았다.
- Firestore/network churn이 “진입 전”부터 발생할 수 있었다.

### 4.2 Data access policy가 클라이언트 전역에 분산돼 있었다

realtime/fetch 정책이 중앙 정책이 아니라 store/provider별 판단으로 퍼져 있었다.

결과:

- route 변경, role 변경, project 변경이 data access policy와 직접 얽혔다.
- 한 곳에서 고친 정책이 다른 경로에서는 그대로 남았다.

### 4.3 Bootstrap state write와 fetch scope가 서로를 다시 깨웠다

portal bootstrap이 `project catalog`, `current project scope`, `weekly submission scope`처럼 명시적으로 분리되지 않은 구간이 있었고, 같은 상태를 다시 쓰는 bootstrap self-trigger가 생겼다.

결과:

- fetch 루프
- unnecessary rerender
- 사용자 체감 flicker

### 4.4 검증 기준이 “green enough”에 머물렀다

우리는 몇 차례 아래를 근거로 안정화라고 판단했다.

- local tests 통과
- build 통과
- PR merge
- Vercel alias 업데이트

하지만 이건 운영 해결의 충분조건이 아니었다.  
실사용자 세션에서 중요한 건 아래였다.

- authenticated production route smoke
- HAR/network budget
- Firestore channel count
- route transition stability

이 기준이 release gate에 없었다.

## 5. Why Earlier Fixes Were Not Enough

초기 수정들이 틀렸다기보다, `insufficiently scoped`였다.

### 5.1 Listener-level fixes were necessary but not sufficient

cashflow, payroll, dashboard residual listeners를 줄이는 작업은 필요했다.  
하지만 이는 “workspace 내부의 hot path”를 정리한 것이지, entry surface 자체를 clean boundary로 만들지는 못했다.

### 5.2 Route-aware realtime gating reduced blast radius but not architecture leakage

route-aware safe fetch는 일부 증상을 줄였다.  
하지만 entry pages가 여전히 heavy shell 아래 있으면, 아키텍처 누수는 남는다.

### 5.3 Navigation fixes restored button intent but not boundary correctness

온보딩 버튼이 실제 경로로 가도록 복구한 것은 맞는 수정이었다.  
다만 그 다음 화면이 여전히 무거운 bootstrap 경로라면, 사용자는 “버튼은 눌리지만 전체 경험은 여전히 불안정하다”고 느낄 수밖에 없다.

## 6. Failure Modes We Missed

이번 건에서 놓친 failure mode는 아래와 같다.

### 6.1 Public page success != authenticated page success

public `/portal` boot가 정상이어도, 로그인된 PM 세션의 `/portal/project-select`와 `/portal/onboarding`이 안정적이라는 뜻은 아니다.

### 6.2 Alias correctness != product correctness

Vercel alias가 최신 배포를 가리키는 것은 중요하지만, 운영 해결 그 자체는 아니다.

### 6.3 Network 200 churn can still be a bug

400 에러만 bug가 아니다.  
`channel` 요청이 200으로 계속 반복돼도, entry surface에서는 명백한 구조 문제다.

### 6.4 Patch sequencing can hide the real boundary

증상별 fix를 연속으로 넣으면 “많이 고친 것처럼” 보인다.  
하지만 실제로는 동일한 boundary problem을 여러 면에서 두드리고 있을 수 있다.

## 7. What We Changed

현재까지 반영된 구조적 변경은 아래다.

### 7.1 Route-scoped providers

- App root broad provider tree 축소
- admin/portal route shell 분리
- explicit access policy 주입

### 7.2 Entry shell split

- `/portal/project-select`를 `PortalLayout` 밖으로 이동
- `/portal/onboarding`도 같은 entry shell로 이동

### 7.3 BFF-first entry contracts

- `GET /api/v1/portal/entry-context`
- `POST /api/v1/portal/session-project`
- `GET /api/v1/portal/onboarding-context`
- `POST /api/v1/portal/registration`

### 7.4 Static delivery hardening

- self-hosted `PretendardVariable.woff2`
- third-party font CSS import 제거
- `/assets/*`, `/fonts/*` immutable cache header 적용

## 8. What We Learned

이번 incident에서 도출한 운영 원칙은 아래다.

### 8.1 Entry surfaces are not “small workspace pages”

entry surface는 기능이 작아 보여도 architecture가 다르다.  
workspace shell 아래에 두면 안 된다.

### 8.2 Stores must not infer route policy from ambient browser state

`window.location`, pathname self-inference, implicit role-based branching은 장기적으로 drift를 만든다.  
route shell이 정책을 주입해야 한다.

### 8.3 Realtime should be allowlist-only

특히 `/portal`과 `/viewer`는 fetch-first가 기본이어야 한다.  
실시간은 narrow allowlist만 허용해야 한다.

### 8.4 Release criteria need network and session checks, not just unit/build checks

다음부터는 아래가 없으면 “해결”이라고 말하면 안 된다.

- authenticated production smoke
- HAR 비교
- Firestore channel count
- route transition validation

## 9. Corrective Actions

### Immediate

- portal entry surface를 lightweight shell로 유지
- onboarding/project-select의 direct store dependency 금지
- entry page에서 Firestore direct read/write 금지

### Next 1-2 weeks

- portal dashboard / submissions / weekly expense summary를 BFF read model로 전환
- entry HAR benchmark를 baseline으로 저장
- production smoke에 authenticated PM flow를 추가

### Next 3-6 weeks

- critical portal write path를 command API로 이동
- admin summary surface의 raw Firestore direct path 축소
- route/provider/query policy를 중앙 policy contract로 고정

## 10. Explicit Commitments

이번 incident 이후 아래 원칙을 운영 기준으로 채택한다.

1. `Fixed`는 build green이 아니라 production user-path 기준으로 선언한다.
2. entry surface는 workspace shell과 분리한다.
3. Firestore listener를 줄이는 hotfix만으로 incident close를 선언하지 않는다.
4. 같은 증상이 다시 보이면 listener hunting보다 boundary diagnosis를 먼저 한다.

## 11. Appendix: Relevant Change Sequence

구조 변경과 안정화의 주요 흐름:

- `fix: harden pm portal cashflow listener`
- `fix: harden pm payroll listeners`
- `fix: stabilize pm portal with safe fetch mode`
- `fix: remove residual portal realtime listeners`
- `fix: restore portal onboarding card navigation`
- `fix: make portal realtime mode route-aware`
- `refactor: scope portal providers and inject access policy`
- `perf: harden portal project-select entry surface`
- `refactor: move portal onboarding to entry shell`

이 sequence가 보여주는 점은 분명하다.  
우리는 listener와 navigation 증상을 먼저 줄였고, 마지막에야 entry boundary를 실제로 잘랐다.  
다음에는 이 순서를 뒤집어야 한다.
