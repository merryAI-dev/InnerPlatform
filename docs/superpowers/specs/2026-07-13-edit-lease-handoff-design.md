# Edit Lease Handoff and Safe Exit Design

## Goal

프로젝트 등록과 캐시플로우에서 한 명만 수정할 수 있는 금융 업무용 선점 모델을 유지하면서, 같은 사용자가 다른 탭이나 새 세션에서 이전 임시저장을 안전하게 이어서 작성할 수 있게 한다. 임시저장과 최종저장은 분리하고, 최종저장은 별도 권한을 가진 사용자가 명시적 버튼을 눌렀을 때만 실행한다.

## Chosen Model

선점 소유권은 `tenantId + resourceType + resourceId + userId + sessionId + leaseId + fence`로 판단한다. 사용자 ID만으로 선점하지 않는다. 같은 사용자의 여러 탭도 서로 다른 세션으로 취급해 동시 저장을 차단한다.

세션 종료를 브라우저 이탈 이벤트에만 의존하지 않는다. 앱 내부 이동에서는 임시저장과 lease 해제를 기다린 뒤 이동하고, 강제 종료나 Sleep에서는 동일 사용자 인계와 30분 만료를 복구 경로로 사용한다.

## Conflict Dialog

다른 세션이 활성 lease를 보유하면 다음 내용을 표시한다.

- 제목: `{holderDisplayName}님이 수정 중입니다.`
- 설명: `지금은 수정할 수 없지만 읽기/조회는 가능해요!`
- 다른 사용자일 때 버튼: `읽기/조회로 보기`
- 같은 사용자일 때 버튼: `읽기/조회로 보기`, `이전 수정 이어서 하기`

`holderDisplayName`이 없을 때만 `다른 사용자`를 사용한다. `sameActor` 여부에 상관없이 실제 표시 이름을 우선한다.

### One-time acknowledgement

현재 버그는 `continueReadOnly()`가 `conflictOpen`만 닫고 확인 여부를 보존하지 않기 때문에 발생한다. 이후 `focus`, `pageshow`, `visibilitychange`에서 `getStatus()`가 ACTIVE/held 상태를 반환하면 `applyStatus()`가 팝업을 다시 연다.

controller는 사용자가 현재 화면 방문에서 충돌 안내를 확인했는지를 메모리에 보관한다.

- 같은 화면에서 held 상태를 다시 조회하면 읽기 모드는 유지하되 팝업을 열지 않는다.
- 선점자의 연장이나 상태 재조회로 holder 정보가 바뀌어도 팝업을 다시 열지 않는다.
- 페이지를 나갔다가 다시 들어와 controller가 새로 생성되면 다시 한 번 알린다.
- `acquire`, `takeover`, lease 만료 또는 release가 발생하면 acknowledgement를 초기화한다.

따라서 같은 화면에 머무는 동안 `읽기/조회로 보기`를 누른 뒤에는 포커스 복귀와 상태 재조회가 반복돼도 차단 팝업이 다시 나타나지 않는다.

## Same-user Handoff

같은 사용자만 `이전 수정 이어서 하기`를 실행할 수 있다. 서버는 하나의 Firestore transaction에서 다음을 수행한다.

1. 리소스 접근 권한과 현재 사용자 ID를 확인한다.
2. 기존 lease가 ACTIVE이고 `holderUid`가 현재 사용자와 같은지 확인한다.
3. 새 `leaseId`와 증가된 `fence`를 발급하고 `sessionId`를 현재 세션으로 교체한다.
4. 기존 private draft의 ID와 revision은 유지한다.
5. takeover 감사 기록을 남기고 새 ownership을 반환한다.

새 세션은 기존 private draft를 다시 열어 이어서 작성한다. 이전 탭은 다음 상태 확인 또는 저장 시 stale `leaseId/fence`로 423을 받고 읽기 전용으로 전환된다. 다른 사용자는 takeover할 수 없다.

## Safe Exit

### In-app navigation

활성 수정 세션에서 다른 앱 화면으로 이동하려 할 때 한 번만 확인한다.

- 제목: `수정 중인 내용이 있습니다`
- 설명: `임시저장하고 수정 세션을 종료할까요?`
- 버튼: `계속 작성`, `임시저장 후 나가기`

`임시저장 후 나가기`의 순서는 다음과 같다.

1. 현재 lease와 fence를 다시 확인한다.
2. private draft를 임시저장한다.
3. 저장 성공 후 lease를 release한다.
4. release가 확인된 뒤 원래 이동을 계속한다.

임시저장에 실패하면 이동과 release를 모두 중단하고 현재 화면에 남는다. 동일한 이동 요청이 중복 실행되지 않도록 하나의 pending navigation만 허용한다.

### Refresh, tab close, browser close

브라우저는 사용자 정의 비동기 저장 팝업을 보장하지 않으므로 `beforeunload`에서는 기본 이탈 경고만 사용한다. 새로고침은 같은 탭의 `sessionStorage` sessionId를 유지하므로 재진입 시 기존 ownership을 복원한다.

강제 종료로 저장 또는 release가 완료되지 않은 경우에는 다음 안전장치가 복구한다.

- 같은 사용자: `이전 수정 이어서 하기`
- 다른 사용자: 30분 lease 만료 후 acquire

브라우저 종료 시 최종저장은 절대 실행하지 않는다.

## Explicit Final Save Permission

임시저장 capability와 최종저장 capability를 분리한다.

- 임시저장: 활성 lease 보유자가 private draft에 저장한다.
- 최종저장: `project.finalize` 또는 기능별 동등 capability를 가진 사용자가 명시적인 `최종저장` 버튼을 눌렀을 때만 실행한다.
- UI 표시 여부만 신뢰하지 않고 BFF가 capability, 리소스 접근권한, sessionId, leaseId, fence, expected revision/version, idempotency key를 모두 확인한다.
- 최종저장은 canonical publish, 감사 기록, lease release를 하나의 원자적 작업으로 처리한다.
- 자동저장, 페이지 이탈, takeover는 최종저장을 호출할 수 없다.
- 최종저장된 데이터만 관리자와 후속 업무 화면에 공개한다.

역할 문자열을 화면에서 직접 검사하지 않고 BFF의 중앙 capability 함수에서 다음과 같이 매핑한다.

- `project-registration.finalize`: `pm`, `admin`, `tenant_admin`
- `project-info.finalize`: 프로젝트 담당 `pm`, `admin`, `tenant_admin`
- `cashflow.submit.finalize`: 프로젝트 담당 `pm`, `finance`, `admin`
- `cashflow.close.finalize`: `finance`, `admin`

`viewer`, `auditor`, `support`, `security`는 임시저장 또는 기존 조회 권한과 별개로 최종저장 capability를 받지 않는다. 향후 역할 변경은 이 중앙 매핑만 수정한다.

## Error Handling

- takeover 직전에 다른 세션이 lease를 바꾸면 409 또는 423으로 실패하고 최신 holder 상태를 다시 표시한다.
- stale 탭의 저장은 423으로 차단하고 임시저장 데이터를 덮어쓰지 않는다.
- lease가 만료됐으면 410과 종료 팝업을 표시한다.
- 임시저장 성공 후 release가 실패하면 이동하지 않고 재시도 안내를 표시한다.
- 최종저장 권한이 없으면 버튼을 숨기거나 비활성화하며, 직접 API 요청도 403으로 거부한다.

## Stage Save Failure Findings

### Projection final save 500

2026-07-13 Stage 요청 `req_1783909261610_2ee96c6b1cff4df2`는 JVM 비즈니스 로직까지 도달하지 못했다. Cloud Run 로그는 같은 시각에 HTTP 403과 빈 Authorization header를 기록했다. Stage JVM service의 IAM invoker bindings도 비어 있다.

BFF는 내부 서비스 토큰을 보내지만, Cloud Run IAM용 Google ID token은 보내지 못한다. Stage workflow에는 JVM URL과 내부 서비스 토큰만 있고 ID token audience 또는 BFF service-account credential이 없다. 또한 Cloud Run의 HTML/plain 403을 BFF가 `JSON.parse()`로 처리해 SyntaxError를 내므로, 사용자에게는 원래 403 대신 500으로 보인다.

해결은 Stage 전용 BFF invoker service account에 해당 Cloud Run service의 `roles/run.invoker`만 부여하고, Vercel Stage server runtime이 이 계정의 credential로 audience-bound Google ID token을 생성하게 하는 것이다. BFF는 내부 서비스 토큰과 Google ID token을 모두 보낸다. 응답 본문이 JSON이 아니어도 원래 HTTP status를 보존한다.

### Private draft save 409

cashflow private draft는 서버가 `expectedDraftRevision`을 비교해 stale write를 409 `draft_version_conflict`로 거부한다. 이 방어 자체는 유지한다. 현재 화면은 409 발생 후 최신 owner private draft를 읽고, 화면이 소유하는 `sheetLab` payload만 최신 payload에 병합해 한 번 재시도하는 경로가 없다. 따라서 다른 cashflow 화면 또는 늦게 도착한 저장이 revision을 올리면 작성자는 수동 재시작을 해야 한다.

해결은 private-draft mutation queue와 revision ref를 사용해 같은 화면의 저장을 직렬화하고, `draft_version_conflict`일 때만 최신 draft를 읽어 `sheetLab` namespace를 병합한 뒤 새 idempotency key로 한 번 재시도하는 것이다. 두 번째 충돌은 사용자에게 "다른 화면에서 임시저장이 갱신되었습니다"라고 알리고 읽기/재시도 선택을 제공한다. 서로 다른 payload namespace는 덮어쓰지 않는다.

## Test Coverage

### Controller tests

- held 팝업 확인 후 focus/pageshow/visibilitychange가 반복돼도 다시 열리지 않는다.
- 같은 화면에서 holder 정보가 바뀌거나 lease가 연장돼도 팝업이 다시 열리지 않는다.
- acquire, expiry, release 후 acknowledgement가 초기화된다.

### BFF integration tests

- 같은 사용자 takeover가 draft ID/revision을 유지하고 fence를 증가시킨다.
- 이전 세션의 저장은 423으로 실패한다.
- 다른 사용자의 takeover는 403 또는 423으로 실패한다.
- 임시저장과 release가 성공한 경우에만 앱 내부 이동이 완료된다.
- 최종저장은 별도 capability와 명시적 요청 없이는 실행되지 않는다.
- 최종 publish와 lease release가 중복 없이 원자적으로 완료된다.

### Stage browser QA

- 같은 계정 두 탭에서 두 번째 탭이 이전 draft를 이어받는다.
- 첫 번째 탭은 이후 읽기 전용으로 전환된다.
- 읽기 모드 확인 후 차단 팝업이 같은 방문 중 다시 뜨지 않는다.
- 앱 내부 이동 시 임시저장 후 lease가 해제된다.
- 새로고침 후 같은 탭에서 수정 세션이 복원된다.
- 최종저장 권한이 없는 사용자에게 최종저장이 노출되거나 실행되지 않는다.

## Out of Scope

- 자동 최종저장
- 사용자 ID만으로 동시 탭을 하나의 writer로 취급하는 방식
- 브라우저 강제 종료 시 비동기 저장 성공을 보장하는 방식
- Live 배포
