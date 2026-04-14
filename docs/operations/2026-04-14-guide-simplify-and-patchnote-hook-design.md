# Guide Simplification And Patch Note Hook Design

## Goal

- 화면 전반의 튜토리얼성 안내 UI를 제거해 운영 화면을 더 단순하게 만든다.
- 기능 변경 시 대응 화면의 패치노트 체크리스트가 빠지지 않도록 git hook으로 강제한다.

## UI Simplification Scope

### Remove

- `Guided Start`
- `활용 가이드`
- `Next Action`
- `이번 주 미션`
- 단계형 사용 순서 카드
- 프로토콜 가이드 / 예산 가이드 / 제출 가이드처럼 작업 흐름을 설명하는 별도 패널

### Keep

- 저장 상태
- 오류 / 경고 / 권한 차단 메시지
- 데이터 없음 상태
- 필수 입력 라벨
- 실제 작업 전환에 직접 필요한 최소 CTA

## UX Rule

- 화면은 `설명`보다 `현재 상태`와 `바로 할 수 있는 작업`을 우선 보여준다.
- 동일한 의미를 반복하는 배지, 카드, 가이드 패널은 한 번만 남긴다.
- 이미 버튼과 표, 저장 상태가 있는 화면에는 추가 가이드를 쌓지 않는다.

## Target Surfaces

- `portal/dashboard`
- `portal/bank-statements`
- `portal/weekly-expenses`
- `portal/budget`
- `portal/submissions`
- `admin/dashboard`
- `admin/participation`
- `auth/login`
- `auth/workspace-select`

## Patch Note Hook

### Intent

- 코드 변경이 들어가면 대응 `docs/wiki/patch-notes/pages/*.md` 체크리스트도 같은 커밋에서 갱신되게 만든다.

### Behavior

1. pre-commit에서 staged file 목록을 읽는다.
2. 화면 파일이 바뀌면 대응 patch-note page 목록을 계산한다.
3. 대응 page 문서와 `docs/wiki/patch-notes/log.md`가 staged에 없으면 commit을 막는다.
4. docs-only commit, non-UI infra commit은 통과시킨다.
5. 필요한 경우 `SKIP_PATCH_NOTES_GUARD=1`로 일시 우회할 수 있다.

### Initial Mapping Contract

- `PortalWeeklyExpensePage.tsx` -> `portal-weekly-expense.md`
- `PortalBankStatementPage.tsx` -> `portal-bank-statement.md`
- `PortalBudget.tsx` -> `portal-budget.md`
- `PortalSubmissionsPage.tsx` -> `portal-submissions.md`
- `PortalDashboard.tsx` -> `portal-dashboard.md`
- `ParticipationPage.tsx` -> `admin-participation.md`
- `DashboardPage.tsx` -> `admin-dashboard.md`
- `LoginPage.tsx` -> `portal-onboarding.md`
- `WorkspaceSelectPage.tsx` -> `portal-onboarding.md`

## Non-Goals

- diff를 읽어서 문서를 자동 생성하지 않는다.
- 모든 코드 파일을 100% 자동 매핑하지 않는다.
- 사용자에게 다시 장문의 가이드를 새 표현으로 되돌려놓지 않는다.
