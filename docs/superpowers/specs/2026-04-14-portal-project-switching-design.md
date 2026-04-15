# Portal Project Switching Design

## Goal
- `사업 배정 수정` 화면을 `내 사업 선택 + 주사업 지정` 전용 화면으로 단순화한다.
- 로그인 후 PM 포털 진입 시 항상 한 번 `사업 선택` step을 거치게 해 현재 작업 사업을 명시적으로 정하게 만든다.
- 포털 상단 `빠른 검색`은 메뉴 이동용 command palette가 아니라 `사업 전환` palette로 바꾼다.

## Current Problems
- [PortalProjectSettings.tsx](/Users/boram/InnerPlatform/.worktrees/portal-project-settings-redesign/src/app/components/portal/PortalProjectSettings.tsx:343) 는 `사업 선택`, `주사업 지정`, `최근 사용 사업`, `상태 필터`, `증빙 드라이브 연결`이 한 화면에 섞여 있어 핵심 작업이 흐려진다.
- [PortalLayout.tsx](/Users/boram/InnerPlatform/.worktrees/portal-project-settings-redesign/src/app/components/portal/PortalLayout.tsx:916) 의 상단 검색은 포털 메뉴 이동과 사업 이동을 같이 섞고 있어, 사용자가 “지금 보고 있는 사업을 바꾸는 도구”로 인지하기 어렵다.
- 현재 [portal-store.tsx](/Users/boram/InnerPlatform/.worktrees/portal-project-settings-redesign/src/app/data/portal-store.tsx:2497) 의 `setActiveProject()` 는 사실상 `주사업(projectId)`를 바꾸는 저장 동작과 같은 의미로 동작해, 로그인 때 고른 사업과 저장된 주사업이 구분되지 않는다.

## UX Direction
- `사업 배정 수정`은 “내가 접근 가능한 사업을 고르고, 그중 주사업을 지정하는 곳”으로만 남긴다.
- `증빙 드라이브 연결`은 이 화면에서 제거한다. 이번 설계에서는 위치 이동까지는 다루지 않고, 최소한 `사업 배정 수정` 표면에서는 뺀다.
- PM 포털 진입은 항상 `공간 선택 -> 사업 선택 -> 포털` 순서를 거친다.
- 포털에 진입한 뒤 상단 검색은 “다른 사업으로 바꾸기”에 집중한다.

## Core State Model

### 1. Stored Primary Project
- 기존 `portalUser.projectId` 는 계속 `주사업(primary project)` 의미로 유지한다.
- `사업 배정 수정` 저장은 이 값과 `projectIds` 를 Firestore/member profile 에 반영한다.

### 2. Session Active Project
- 새로 `session active project` 개념을 도입한다.
- 이 값은 로그인 직후 사업 선택 화면과 상단 검색에서 바뀌는 현재 작업 컨텍스트다.
- 이 값은 `주사업`을 덮어쓰지 않는다.
- 페이지 렌더링, 포털 홈, 예산/사업비/캐시플로 같은 포털 실무 화면은 이 `session active project` 를 우선 기준으로 읽는다.

### 3. Bootstrap Rule
- 세션 active project 의 초기값은 아래 순서로 잡는다.
  - 로그인 직후 선택한 사업
  - 이미 세션에 살아 있는 active project
  - 없으면 `portalUser.projectId`(주사업)

## Access Rule
- PM 포털 role 에서는 `배정 사업(projectIds)` 과 `담당자(managerId)` 로 연결되는 사업만 선택/검색 후보에 포함한다.
- admin/finance 가 포털 workspace 로 들어오는 경우에는 전체 사업을 검색 후보에 포함해도 된다.
- 검색은 “권한 없는 임의 사업 진입” 수단이 아니어야 한다.

## Login Flow

### PM direct login
- [LoginPage.tsx](/Users/boram/InnerPlatform/.worktrees/portal-project-settings-redesign/src/app/components/auth/LoginPage.tsx:66) 에서 포털로 보내기 전에 `사업 선택` route 로 보낸다.
- 이미 인증된 PM 이 재진입해도 매 로그인마다 한 번은 이 화면을 본다.

### admin/finance login
- [WorkspaceSelectPage.tsx](/Users/boram/InnerPlatform/.worktrees/portal-project-settings-redesign/src/app/components/auth/WorkspaceSelectPage.tsx:89) 에서 `PM 포털 공간`을 고르면 `/portal` 이 아니라 새 `사업 선택` route 로 보낸다.
- `관리자 공간`을 고르면 기존처럼 `/` 로 보낸다.

### requested route handling
- 로그인 전에 사용자가 `/portal/budget`, `/portal/weekly-expenses` 같은 route 를 요청했다면, 사업 선택이 끝난 뒤 그 route 로 보낸다.
- 별도 requested route 가 없으면 `/portal` 로 보낸다.

## New Route
- 새 route: `/portal/project-select`
- 책임:
  - 현재 로그인 세션의 작업 사업을 선택
  - 선택 가능한 사업 목록 카드 노출
  - 후보 사업 검색
  - 선택 완료 후 원래 요청한 포털 route 또는 `/portal` 로 이동

## Project Selection Page UX
- 제목은 `오늘 작업할 사업 선택` 계열의 명시적 카피로 간다.
- 상단에는 “담당 사업” 또는 “배정된 사업” 카드 목록을 먼저 노출한다.
- 후보가 없으면 empty state 와 검색창만 보여준다.
- 검색 결과는 같은 후보 풀 내에서만 찾는다.
- 선택 CTA 는 `이 사업으로 시작` 하나로 단순화한다.
- 로그인 step 에서는 `주사업` 변경 UI 를 노출하지 않는다.

## Portal Header Search UX
- [PortalLayout.tsx](/Users/boram/InnerPlatform/.worktrees/portal-project-settings-redesign/src/app/components/portal/PortalLayout.tsx:922) 의 `CommandDialog` 는 메뉴 이동용 카피를 버리고 `사업 전환` 중심으로 바꾼다.
- placeholder 는 `담당 사업 검색 또는 전환...` 계열로 바꾼다.
- `CommandEmpty` 는 `일치하는 사업이 없습니다.` 로 바꾼다.
- item 목록은 기본적으로 사업 전환 항목만 보인다.
- `관리자 공간` 전환은 별도 섹션이나 하단 보조 item 으로만 남긴다.
- 메뉴 이동 item 과 알림 item 은 이 command dialog 에서 제거한다.

## Navigation Behavior After Search Switch
- 사용자가 상단 검색으로 사업을 바꾸면, 가능하면 현재 보고 있는 포털 route 를 유지한다.
- 예:
  - `/portal/budget` 에서 사업 전환 -> 같은 `/portal/budget` 유지
  - `/portal/cashflow` 에서 사업 전환 -> 같은 `/portal/cashflow` 유지
- 단, 현재 route 가 사업 문맥과 충돌하거나 미등록 예외 flow 라면 `/portal` 로 fallback 한다.

## Project Settings Scope
- [PortalProjectSettings.tsx](/Users/boram/InnerPlatform/.worktrees/portal-project-settings-redesign/src/app/components/portal/PortalProjectSettings.tsx:373) 의 `현재 선택 상태` summary 는 유지 가능하다.
- 유지:
  - 사업 검색
  - 상태 필터
  - 선택/선택 취소
  - 주사업 지정
  - 저장
- 제거:
  - 최근 사용한 사업 block
  - `증빙 드라이브 연결` 전체 block
  - onboarding 성 설명 과다 카피
- 저장 후 메시지는 `주사업 저장 완료` 중심으로 명확하게 줄인다.

## Data / Store Changes

### Portal store
- [portal-store.tsx](/Users/boram/InnerPlatform/.worktrees/portal-project-settings-redesign/src/app/data/portal-store.tsx:363) 에 세션용 `activeProjectId` 상태를 추가한다.
- `myProject` 는 `portalUser.projectId` 가 아니라 `activeProjectId` 우선으로 해석한다.
- 기존 `setActiveProject()` 는 저장성 메서드와 세션 메서드로 분리한다.
  - `setSessionActiveProject(projectId)`:
    - Firestore 저장 없음
    - 세션 state 만 변경
  - `setPrimaryProject(projectId)` 또는 기존 register/save path:
    - Firestore 저장 있음
    - `portalUser.projectId` 갱신

### Candidate project resolver
- 새 helper 에서 후보 사업 풀을 계산한다.
- 입력:
  - `authUser.role`
  - `authUser.uid`
  - `portalUser.projectIds`
  - 전체 `projects`
- 출력:
  - 카드 우선 노출용 assigned/managed projects
  - 검색용 candidate projects

## File Boundaries
- Create: `src/app/components/portal/PortalProjectSelectPage.tsx`
- Create: `src/app/platform/portal-project-selection.ts`
- Modify: `src/app/routes.tsx`
- Modify: `src/app/components/auth/LoginPage.tsx`
- Modify: `src/app/components/auth/WorkspaceSelectPage.tsx`
- Modify: `src/app/platform/navigation.ts`
- Modify: `src/app/data/portal-store.tsx`
- Modify: `src/app/components/portal/PortalLayout.tsx`
- Modify: `src/app/platform/portal-shell-actions.ts`
- Modify: `src/app/components/portal/PortalProjectSettings.tsx`

## Non-Goals
- 이번 단계에서 `증빙 드라이브 연결` 새 위치를 확정하지 않는다.
- 포털 전체 IA 재설계는 하지 않는다.
- 관리자용 전역 command palette 는 건드리지 않는다.

## Testing
- `navigation.test.ts`
  - 포털 로그인 후 `project-select` 경유 규칙 추가
  - requested portal route 보존 확인
- 새 `portal-project-selection.test.ts`
  - PM 후보 사업 = assigned + manager-owned
  - admin/finance 후보 사업 = all projects
- `portal-shell-actions.test.ts`
  - 사업 전환 item 위주로 생성되는지 검증
- `PortalLayout.shell.test.ts`
  - command dialog title/placeholder 가 사업 전환 기준인지 검증
- `PortalProjectSelectPage` component test
  - 카드 목록, 검색, 선택 CTA, empty state 검증
- Playwright
  - 로그인 후 `workspace-select -> project-select -> requested portal route`
  - 상단 검색으로 사업 전환 시 현재 route 유지

## Rollout Note
- 이 변경은 로그인 직후 PM 포털 사용 흐름을 바꾸므로, 첫 배포에서는 운영팀에게 `로그인 후 사업 한 번 선택` 규칙이 생겼다는 점을 반드시 공지해야 한다.
