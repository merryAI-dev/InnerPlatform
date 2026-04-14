# Patch Notes Wiki

화면 단위 변경 이력을 누적 관리하는 운영 위키입니다. 코드와 PR 사이에서 "이 페이지에서 최근 무엇이 바뀌었는가"를 빠르게 복기하고, "지금 실제로 되는 기능이 무엇인가"를 체크리스트로 확인하기 위한 문서 계층입니다.

## Admin Pages

| Page | Route | Last Updated | 현재 구현 체크포인트 |
| --- | --- | --- | --- |
| [admin-dashboard](./pages/admin-dashboard.md) | `/` | 2026-04-14 | 운영 현황 요약, 주요 작업면 이동 |
| [admin-project-list](./pages/admin-project-list.md) | `/projects` | 2026-04-14 | 사업 목록, 탭 필터, 상세/수정 이동 |
| [admin-project-migration-audit](./pages/admin-project-migration-audit.md) | `/projects/migration-audit` | 2026-04-14 | 이관 큐, 상태 점검, 예외 대상 확인 |
| [admin-project-detail](./pages/admin-project-detail.md) | `/projects/:projectId` | 2026-04-14 | 사업 상세, 수정 이동, 연결 작업면 진입 |
| [admin-project-wizard](./pages/admin-project-wizard.md) | `/projects/new`, `/projects/:projectId/edit` | 2026-04-14 | 사업 생성/수정 wizard |
| [admin-ledger-detail](./pages/admin-ledger-detail.md) | `/projects/:projectId/ledgers/:ledgerId` | 2026-04-14 | 원장 상세, 탭 전환 |
| [admin-cashflow-export](./pages/admin-cashflow-export.md) | `/cashflow`, `/cashflow/projects` | 2026-04-14 | 사업별/전체 추출, 정산 기준 필터, projection-only export |
| [admin-cashflow-project-sheet](./pages/admin-cashflow-project-sheet.md) | `/cashflow/projects/:projectId` | 2026-04-14 | compare mode, close 흐름, 주간 snapshot 해석 |
| [admin-evidence-queue](./pages/admin-evidence-queue.md) | `/evidence` | 2026-04-14 | 증빙 큐, 상태 전환, 후속 처리 |
| [admin-bank-reconciliation](./pages/admin-bank-reconciliation.md) | `/bank-reconciliation` | 2026-04-14 | 자동매칭/미매칭 검토, 개별 행 정리 |
| [admin-participation](./pages/admin-participation.md) | `/participation` | 2026-04-14 | 참여인력 현황, 투입률, 편집 dialog |
| [admin-koica-personnel](./pages/admin-koica-personnel.md) | `/koica-personnel` | 2026-04-14 | KOICA 전용 인력 관리 |
| [admin-personnel-changes](./pages/admin-personnel-changes.md) | `/personnel-changes` | 2026-04-14 | 인력변경 요청, 문서 미리보기 |
| [admin-budget-summary](./pages/admin-budget-summary.md) | `/budget-summary` | 2026-04-14 | 예산 요약, 관련 액션 |
| [admin-expense-management](./pages/admin-expense-management.md) | `/expense-management` | 2026-04-14 | 사업비 관리 세트, 기간/메타데이터 관리 |
| [admin-payroll](./pages/admin-payroll.md) | `/payroll` | 2026-04-14 | 급여 상태, 확인/마감 액션 |
| [admin-approvals](./pages/admin-approvals.md) | `/approvals` | 2026-04-14 | 승인 대기 단일 surface |
| [admin-users-auth-governance](./pages/admin-users-auth-governance.md) | `/users` | 2026-04-14 | drift 확인, deep sync, auth/member 정렬 운영 |
| [admin-hr-announcements](./pages/admin-hr-announcements.md) | `/hr-announcements` | 2026-04-14 | 사내 공지 등록/수정 |
| [admin-training-manage](./pages/admin-training-manage.md) | `/training` | 2026-04-14 | 교육 과정 등록/관리 |
| [admin-audit-log](./pages/admin-audit-log.md) | `/audit` | 2026-04-14 | 감사 로그 조회, CSV export |
| [admin-settings](./pages/admin-settings.md) | `/settings` | 2026-04-14 | 조직/구성원/템플릿/이관/권한 탭 |

## Shared Pages

| Page | Route | Last Updated | 현재 구현 체크포인트 |
| --- | --- | --- | --- |
| [shared-board-feed](./pages/shared-board-feed.md) | `/board`, `/portal/board` | 2026-04-14 | 정렬, 검색, 필터, 새 글 작성 |
| [shared-board-post](./pages/shared-board-post.md) | `/board/:postId`, `/portal/board/:postId` | 2026-04-14 | 게시글 상세, 댓글, 반응, 수정/삭제 |

## Portal Pages

| Page | Route | Last Updated | 현재 구현 체크포인트 |
| --- | --- | --- | --- |
| [portal-dashboard](./pages/portal-dashboard.md) | `/portal` | 2026-04-14 | 내 사업 상태, 공지, 빠른 이동 |
| [portal-onboarding](./pages/portal-onboarding.md) | `/portal/onboarding` | 2026-04-14 | 내 사업 선택, 초기 연결 |
| [portal-project-settings](./pages/portal-project-settings.md) | `/portal/project-settings` | 2026-04-14 | 사업 설정/연결 정보 확인 |
| [portal-submissions](./pages/portal-submissions.md) | `/portal/submissions` | 2026-04-14 | 수요일 기준 작성 여부, projection 수정 기준 표시 |
| [portal-payroll](./pages/portal-payroll.md) | `/portal/payroll` | 2026-04-14 | 급여 상태, 확인/마감 인정 |
| [portal-cashflow](./pages/portal-cashflow.md) | `/portal/cashflow` | 2026-04-14 | 포털 캐시플로 확인, 시트 import 보조 |
| [portal-budget](./pages/portal-budget.md) | `/portal/budget` | 2026-04-14 | 가져오기 미리보기, 긴 모달 스크롤, 구조 저장 보호 |
| [portal-weekly-expense](./pages/portal-weekly-expense.md) | `/portal/weekly-expenses` | 2026-04-14 | 기준본에서 이어쓰기, 저장 상태 구분, overwrite/backspace 복구 |
| [portal-bank-statement](./pages/portal-bank-statement.md) | `/portal/bank-statements` | 2026-04-14 | 원본 업로드, intake queue 정리, 사업비 입력으로 이어가기 |
| [portal-personnel](./pages/portal-personnel.md) | `/portal/personnel` | 2026-04-14 | 인력 현황, 변경 요청 이동 |
| [portal-change-requests](./pages/portal-change-requests.md) | `/portal/change-requests` | 2026-04-14 | 변경 요청 목록, 새 요청 생성 |
| [portal-register-project](./pages/portal-register-project.md) | `/portal/register-project` | 2026-04-14 | 직접입력형 자금 흐름, 초안 저장, 계약 예외 처리 |
| [portal-project-edit](./pages/portal-project-edit.md) | `/portal/edit-project` | 2026-04-14 | 포털 자기 사업 수정 |
| [portal-training](./pages/portal-training.md) | `/portal/training` | 2026-04-14 | 교육 목록, 탭 전환 |
| [portal-career-profile](./pages/portal-career-profile.md) | `/portal/career-profile` | 2026-04-14 | 경력 프로필 조회/편집 |
| [portal-guide-chat](./pages/portal-guide-chat.md) | `/portal/guide-chat` | 2026-04-14 | 가이드형 도움말 대화 |

## How To Use

- 각 페이지 문서의 `Current Feature Checklist`에서 지금 실제로 되는 기능을 먼저 확인합니다.
- 구현이 빠졌거나 제거한 항목은 `[ ]`로 남깁니다.
- 새 기능이 생기면 항목을 추가하고, 불필요해진 항목은 지우거나 체크 해제하면 됩니다.

## High Attention

- [admin-project-list](./pages/admin-project-list.md)
- [admin-approvals](./pages/admin-approvals.md)
- [admin-settings](./pages/admin-settings.md)
- [portal-weekly-expense](./pages/portal-weekly-expense.md)
- [portal-budget](./pages/portal-budget.md)
- [portal-bank-statement](./pages/portal-bank-statement.md)
- [admin-cashflow-export](./pages/admin-cashflow-export.md)
- [admin-cashflow-project-sheet](./pages/admin-cashflow-project-sheet.md)
- [admin-users-auth-governance](./pages/admin-users-auth-governance.md)

## Related Repo Context

- QA memory: [qa-feedback-memory.md](../../operations/qa-feedback-memory.md)
- QA memory JSON: [qa-feedback-memory.json](../../operations/qa-feedback-memory.json)
- 설계 문서: [2026-04-14-page-patch-notes-wiki-design.md](../../operations/2026-04-14-page-patch-notes-wiki-design.md)
- 구현 계획: [2026-04-14-page-patch-notes-wiki-plan.md](../../operations/2026-04-14-page-patch-notes-wiki-plan.md)
