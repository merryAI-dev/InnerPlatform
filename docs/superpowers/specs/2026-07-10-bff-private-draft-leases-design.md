# BFF Private Draft Leases Design

## Goal

- 프로젝트 등록·수정과 캐시플로우 편집을 프로젝트 단위로 잠근다.
- 한 세션이 편집권을 선점하면 다른 사용자와 같은 계정의 다른 탭은 최종본을 읽을 수만 있고, 임시저장·첨부·최종저장은 할 수 없게 한다.
- 임시저장본은 작성자 전용으로 유지하고, 최종 제출된 데이터만 관리자·재무 화면에 노출한다.
- 프론트엔드는 입력과 상태 표시를 담당하고, 권한·lease·버전·계산·최종 쓰기는 BFF와 JVM 서비스가 검증한다.
- Stage에서 두 사용자·두 세션 충돌을 검증한 뒤에만 병합한다. 이번 작업에서 Live 배포·Live Firebase 변경은 하지 않는다.

## Non-goals

- 실시간 공동 편집, 필드 단위 merge, 관리자 강제 선점은 만들지 않는다.
- 브라우저 heartbeat나 사용자 입력을 이유로 lease를 자동 연장하지 않는다.
- 원본 `File` 객체를 새로고침 뒤 복원하지 않는다. 업로드가 완료된 첨부파일 reference만 복원한다.
- 대용량 시트 적용을 여러 transaction으로 부분 성공시키지 않는다. 원자적 한도를 넘으면 쓰기 전에 `422`로 중단한다.
- 이번 Stage 검증이 끝나도 production workflow를 실행하거나 Live alias를 변경하지 않는다.

## Resource Identity And URLs

편집 lock은 기능 전체가 아니라 아래 canonical resource 단위다.

| 화면 | Canonical URL | Lease resource |
|---|---|---|
| 신규 프로젝트 등록 | `/portal/register-project/:draftId` | `project-registration:{draftId}` |
| 기존 프로젝트 수정 | `/portal/edit-project/:projectId` | `project-info:{projectId}` |
| 캐시플로우 | `/portal/cashflow/:projectId` | `cashflow:{projectId}` |
| 시트 연동 | `/portal/cashflow/:projectId/sheets-lab` | `cashflow:{projectId}` |

- 신규 등록은 아직 프로젝트가 없으므로 서버가 만든 opaque `draftId`를 identity로 사용한다.
- 캐시플로우 직접 편집과 시트 적용은 같은 canonical 데이터를 바꾸므로 동일한 `cashflow:{projectId}` lease를 사용한다.
- 서로 다른 `projectId` 또는 `draftId`는 동시에 편집할 수 있다.
- URL은 resource identity를 표시하지만 권한 근거는 아니다. BFF가 tenant, actor, route ID, lease ID, payload ID를 다시 대조한다.
- 기존 ID 없는 URL은 편집기를 mount하기 전에 SPA `replace`로 canonical URL에 보낸다. query/hash는 보존한다.

## Lease State Machine

Lease의 서버 수명은 획득 또는 수동 연장 시점부터 30분이다.

```text
AVAILABLE --acquire--> ACTIVE --release/final-submit--> AVAILABLE
     ^                    |
     |                    +--server time >= expiresAt--> EXPIRED
     |                                                  |
     +--------------------------next acquire------------+
```

### Rules

- BFF transaction이 서버 시각으로 획득·연장·저장·해제를 판단한다.
- `sessionId`는 탭 단위 UUID다. 같은 계정의 다른 탭도 다른 session으로 취급한다.
- 획득 시 monotonically increasing `fence`와 추측 불가능한 `leaseToken`을 발급한다.
- 모든 draft write, final write, sheet apply는 `sessionId + leaseToken + fence`가 현재 ACTIVE lease와 일치해야 한다.
- 같은 session의 acquire 재시도는 idempotent하게 기존 lease를 돌려준다.
- 다른 active session이 acquire하면 `423 Locked`와 holder display name, same-account 여부, 만료 시각만 돌려준다. 이메일·UID·token은 노출하지 않는다.
- 연장은 만료 전 현재 holder만 할 수 있고, 서버 현재 시각에서 다시 30분으로 설정한다.
- 임시저장, 입력, heartbeat는 만료 시각을 바꾸지 않는다.
- unload에서는 lease를 자동 해제하지 않는다. 최종저장 또는 명시적 `수정 종료`만 해제한다.
- 만료된 lease는 별도 삭제 job 없이 다음 status/acquire transaction에서 만료로 처리한다.

## Lease API

공통 route는 `project-registration | project-info | cashflow`만 허용하고, type별 접근 검증 뒤 서버가 resource key를 만든다.

- `POST /api/v1/project-registration-drafts` — 신규 private draft identity와 최초 lease 생성
- `GET /api/v1/edit-leases/:resourceType/:resourceId` — focus·visibility 복귀 전 status 확인
- `POST /api/v1/edit-leases/:resourceType/:resourceId/acquire` — lease 획득
- `POST /api/v1/edit-leases/:resourceType/:resourceId/extend` — 수동 30분 연장
- `POST /api/v1/edit-leases/:resourceType/:resourceId/release` — 명시적 수정 종료

Mutating request에는 `X-Edit-Session-Id`, `X-Edit-Lease-Id`, `X-Edit-Fence`, `Idempotency-Key`를 보낸다. 오류 contract는 다음과 같이 고정한다.

| Status | Code | Meaning |
|---|---|---|
| `409` | `draft_version_conflict` | 다른 저장으로 private draft revision이 바뀜 |
| `409` | `canonical_version_conflict` | draft의 base version보다 최종본이 앞섬 |
| `410` | `edit_lease_expired` | 30분 만료 또는 해제된 세션 |
| `423` | `edit_lease_held` | 다른 session이 선점 중 |
| `422` | `atomic_write_limit_exceeded` | 부분쓰기 없이 원자적 한도 초과 |

## Server Data Model

클라이언트 SDK에서 직접 접근하지 못하도록 Firestore catch-all 제외 컬렉션에 추가한다. Admin SDK를 쓰는 BFF만 기록한다.

### `orgs/{tenantId}/editLeases/{resourceDocumentId}`

- `resourceType`, `resourceId`
- `holderUid`, `holderDisplayName`, `sessionId`
- `leaseId`, `fence`, `state: ACTIVE | RELEASED`
- `acquiredAt`, `expiresAt`, `updatedAt`

`resourceDocumentId`는 정규화된 type과 ID의 충돌 없는 서버 인코딩이다. `leaseId`는 권한 자체가 아니라 actor·session과 함께 검사하는 stale-write 방지 식별자다.

### `orgs/{tenantId}/projectRequestDrafts/{draftId}`

현재 등록 draft 컬렉션을 재사용하되 클라이언트 직접 접근을 끄고 BFF-only로 전환한다. 기존 사용자 단일 draft는 owner 확인 후 opaque URL draft로 한 번만 이관한다.

- `resourceType: project-registration`, `resourceId: draftId`, `ownerUid`
- `draftRevision`, `payload`, `attachmentRefs`
- `status: ACTIVE | SUBMITTED | DISCARDED`
- `createdAt`, `updatedAt`, `submittedAt?`

### `orgs/{tenantId}/privateEditDrafts/{draftDocumentId}`

- `resourceType`, `resourceId`, `ownerUid`
- `draftRevision`, `baseCanonicalVersion`
- `payload`, `attachmentRefs`
- `status: ACTIVE | SUBMITTED | DISCARDED`
- `createdAt`, `updatedAt`, `submittedAt?`

- 두 draft 컬렉션 모두 읽기는 본인 BFF endpoint에서만 허용한다.
- lease timeout은 draft와 첨부 reference를 삭제하지 않는다.
- 다른 actor와 관리자 목록은 private draft를 읽지 않는다.
- final submit 뒤에는 immutable 제출 metadata만 남기고 canonical payload는 공개 컬렉션에서 읽는다.

## Private Draft And Final Save

### Temporary save

1. BFF가 resource 접근권한과 ACTIVE lease를 검증한다.
2. `expectedDraftRevision`을 transaction에서 비교한다.
3. private draft만 갱신하고 revision을 1 증가시킨다.
4. canonical project, project request, cashflow read model, 관리자 queue는 변경하지 않는다.

첨부파일은 lease를 검증하는 BFF upload endpoint로 private draft 경로에 저장한다. object 저장 뒤 metadata transaction까지 성공해야 클라이언트가 file input을 비우며, 실패하면 같은 탭에서 원본 `File`을 유지해 재시도한다. 제출 뒤 canonical 위치로 옮기는 외부 작업은 outbox가 담당한다.

### Project registration final submit

하나의 Firestore transaction에서 다음을 함께 처리한다.

1. 현재 lease와 fencing token 확인
2. private draft revision과 base canonical version 확인
3. idempotency result 확인 또는 예약
4. canonical project 생성
5. canonical `project_request` 생성
6. 최초 member assignment 생성 또는 병합
7. private draft를 `SUBMITTED`로 전환
8. lease 해제
9. Slack·Drive·후속 참여정보 처리를 위한 outbox enqueue

외부 호출은 transaction 안에서 실행하지 않는다. outbox worker가 retry하고, 최종 제출 응답은 canonical ID와 outbox 상태를 구분해 돌려준다.

### Project information final save

- 기존 BFF `expectedVersion`과 idempotency transaction을 재사용한다.
- 현재 lease와 draft revision을 같은 transaction에서 검사하고 canonical project version을 갱신한다.
- 성공 시 draft를 `SUBMITTED`로 전환하고 lease를 해제한다.

### Cashflow temporary/final save

- 임시저장은 owner 전용 snapshot이며 공개 cashflow를 바꾸지 않는다.
- 최종저장은 JVM service가 validation, calculation, canonical write plan을 만든다.
- BFF는 인증·resource 접근을 검증하고 JVM에 신뢰된 actor/tenant/project/session/lease/fence context를 전달한다.
- JVM의 canonical write transaction이 lease 문서를 다시 읽어 actor, session, lease ID, fence, 만료를 같은 transaction에서 검증한다. BFF 사전검사만으로 저장을 허용하지 않는다.
- Node BFF가 cashflow week 문서를 직접 쓰는 기존 경로는 제거하거나 Stage flag가 켜진 동안 명시적으로 거부한다.

## Spreadsheet And JVM Boundary

```text
Browser input
  -> BFF auth + project access + lease + idempotency
  -> Google Sheets adapter (read/normalize only)
  -> JVM finance validation/calculation/write plan
  -> atomic canonical write
  -> BFF response/read model
```

- 브라우저는 시트 URL·탭·범위와 사용자 선택만 보낸다.
- Google credential, sheet fetch, range normalization은 BFF adapter가 담당한다.
- 금액 파생·주차 mapping·validation·canonical cashflow write authority는 JVM에 둔다.
- 시트 preview는 read-only이고 lease 없이 볼 수 있다. apply와 final save는 동일한 cashflow lease를 요구한다.
- Firestore transaction 한도를 넘는 apply는 쓰기 전 `422`로 중단하고 예상 write 수를 응답한다.
- Stage의 기존 `/weekly-expenses/.../sheets` 500은 adapter/JVM endpoint contract 회귀 테스트로 고정한다.
- JVM은 등록된 cashflow line allowlist만 허용하고, actual namespace의 `sourceSheetKey`는 서버가 고정한다.

## Browser Session And UX

### Editing

- 화면 진입은 published 최종본 read-only로 시작한다.
- 사용자가 `수정`을 누를 때 lease를 획득한다.
- 획득 성공 후에만 input, 업로드, 임시저장, 최종저장을 활성화한다.
- 다른 holder가 있으면 `OOO님이 이 프로젝트를 수정 중입니다`를 표시한다.
- 같은 계정의 다른 탭이면 `현재 계정의 다른 탭에서 수정 중입니다`를 표시한다.

### Timeout

- 남은 5분에 한 번 경고하고 `30분 연장` 버튼을 제공한다.
- 자동 연장은 하지 않는다.
- `visibilitychange`, `focus`, `pageshow`, 임시저장, 최종저장 직전에 서버 status를 확인한다.
- 만료되면 input을 read-only로 바꾸고 다음 dialog를 표시한다.
  - 제목: `수정 세션이 종료되었습니다`
  - 설명: `30분이 지나 선점만 해제되었습니다. 입력 내용과 첨부파일은 임시저장본에 유지됩니다.`
  - 액션: `읽기 모드로 보기`, `다시 수정하기`

### Refresh and input preservation

- 첫 bootstrap 이후 background loading은 `<Outlet>`을 unmount하지 않고 overlay/status로 표시한다.
- auth effect는 token 객체 전체가 아니라 실제 identity/query key에만 의존한다.
- 프로젝트 전환은 dirty 확인과 route navigation이 승인된 뒤 active project를 바꾼다.
- 프로젝트 등록·수정에도 `beforeunload`와 router blocker를 적용한다.
- attachment upload 성공 직후 metadata draft를 즉시 저장한 뒤 input을 비운다.
- upload 또는 metadata save 실패 시 현재 탭에서 재시도할 수 있도록 `File` reference와 오류 상태를 유지한다.
- plain `<a href>` 등록 진입은 React Router `Link`로 바꿔 전체 page reload를 없앤다.
- preload 오류 자동 reload는 계속 금지한다.

## Stage-only Rollout

- 새 경로는 `DEPLOY_ENV=stage`와 explicit Stage feature flag가 모두 맞을 때만 활성화한다.
- 설정 누락 또는 Live runtime에서는 fail closed하고 기존 canonical write path를 자동으로 켜지 않는다.
- BFF와 JVM의 Firestore data project가 다르면 startup 또는 command 시 `409`로 중단한다. Auth project가 별도인 것은 허용하되 Stage data project는 양쪽이 동일해야 한다.
- 복구한 JVM은 기존 Cloud Run service를 덮지 않고 Stage 프로젝트의 새 service name으로 배포한다. 현재 service 소유권을 조회할 권한이 없으므로 기존 service 재배포는 금지한다.
- Stage deploy는 GitHub `stage-deploy.yml`의 preview target과 canonical Stage alias만 사용한다.
- production workflow, `--prod`, Live Firebase rules/index deploy는 실행하지 않는다.
- main 병합 전후 Live alias의 deployment ID/commit을 기록해 변경되지 않았음을 확인한다.

## Observability And Audit

- acquire, conflict, extend, expire, release, temporary save, final submit을 request ID와 함께 audit한다.
- 로그에는 resource type/ID, actor ID, session ID hash, fence, 결과 code만 남기고 raw lease token과 draft payload는 남기지 않는다.
- 지표는 active lease 수, conflict 수, expiry 수, draft conflict 수, final submit 실패 수, outbox retry 수를 Stage에서 확인한다.

## Acceptance Criteria

- 프로젝트 A를 선점해도 프로젝트 B와 다른 신규 draft는 편집 가능하다.
- 같은 프로젝트는 다른 사용자·같은 계정 다른 탭 모두 읽기만 가능하다.
- 30분 만료와 수동 연장이 서버 시각 기준으로 동작하고 자동 연장은 없다.
- sleep 복귀 시 만료가 즉시 감지되고 draft·첨부 reference는 보존된다.
- 임시저장은 관리자 queue와 published cashflow에 나타나지 않는다.
- stale draft와 stale fence로 canonical 데이터를 덮어쓸 수 없다.
- 프로젝트 등록 최종 제출은 project/request/member/draft/outbox가 원자적으로 일치한다.
- 시트 apply와 직접 cashflow save는 같은 lease를 요구하고 JVM 계산 contract를 거친다.
- token refresh, background loading, project switch가 편집 input과 attachment UI를 unmount하지 않는다.
- Stage 두 브라우저 context QA가 통과하고 Live deployment와 데이터는 바뀌지 않는다.
