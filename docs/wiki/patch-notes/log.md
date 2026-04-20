# Patch Notes Log

## [2026-04-20] patch-note | shared-migration-retrospective | 실행 원칙과 overlay roadmap 추가
- pages: [shared-migration-retrospective](./pages/shared-migration-retrospective.md)
- summary: 회고를 실제 실행 기준으로 바꾸기 위해 `원문 정본 우선`, `대체보다 번역`, `admin-first / PM-thin`, `metadata-first storage`, `parity gate cutover`의 5개 실행 원칙과 issue/roadmap 스냅샷을 문서에 추가하고, 상세 실행 문서 `docs/superpowers/plans/2026-04-20-spreadsheet-overlay-transition-roadmap.md`를 연결했다.

## [2026-04-20] patch-note | shared-migration-retrospective | LLM Wiki 배경과 후속 방향 추가
- pages: [shared-migration-retrospective](./pages/shared-migration-retrospective.md)
- summary: `LLM Wiki` 패턴이 왜 이번 회고 판단의 직접적 배경이 되었는지 정리하고, 현재까지의 마이그레이션 매몰비용을 버리지 않으면서 `spreadsheet as canonical source + app as overlay/governance layer`로 플랫폼을 재정의하는 후속 방향을 추가했다.

## [2026-04-20] patch-note | shared-migration-retrospective | centralize-first 가정 재검토
- pages: [shared-migration-retrospective](./pages/shared-migration-retrospective.md)
- summary: `데이터를 꼭 플랫폼 안으로 모아야 한다`는 전제가 전통적인 SaaS 사고에 더 가깝고, 이 프로젝트에서는 `spreadsheet as canonical source + app as overlay/governance layer`가 더 AI-native했을 수 있다는 판단과 `PM thick app` 축소 원칙을 추가했다.

## [2026-04-20] patch-note | shared-migration-retrospective | 강제 spreadsheet migration 회고
- pages: [shared-migration-retrospective](./pages/shared-migration-retrospective.md)
- summary: 이번 일을 신규 제품보다 기존 스프레드시트 운영체계의 강제 migration으로 재해석하고, 초기에는 replace-first portal보다 `file-first intake + admin review + export parity`가 더 AI-native한 wedge였다는 회고를 문답 형태로 기록했다.

## [2026-04-20] patch-note | shared-migration-retrospective | office-hours / ceo-review verdict 추가
- pages: [shared-migration-retrospective](./pages/shared-migration-retrospective.md)
- summary: 시트 형식이 표준화돼 있다는 전제에서는 `standardized spreadsheet-first + crawler + md/json converter + admin/PM viewing harness`가 Firestore-first 앱보다 더 AI-native하고 장기적인 방향일 수 있다는 판단을 `Office Hours`, `CEO Review`, `fatal assumption` 섹션으로 추가했다.

## [2026-04-20] patch-note | shared-migration-retrospective | gstack verdict 추가
- pages: [shared-migration-retrospective](./pages/shared-migration-retrospective.md)
- summary: `gstack` 관점에서도 중심 bet은 `PM thick app`보다 `표준 시트 + admin agent console + PM thin viewer`에 두는 편이 더 적합하다는 판단을 `Gstack Verdict` 섹션으로 추가했다.

## [2026-04-15] patch-note | shared-portal-architecture | portal bootstrap loop postmortem
- pages: [shared-portal-architecture](./pages/shared-portal-architecture.md)
- summary: `portal-store` bootstrap이 `projects -> scopedProjectIds -> weekly submission fetch`를 다시 흔드는 self-trigger 구조였음을 포스트모템으로 남기고, 이후에는 state write boundary와 fetch scope를 분리하는 운영 규칙을 명시했다.

## [2026-04-15] patch-note | shared-portal-architecture | 포털 안정화 장기안 정리
- pages: [shared-portal-architecture](./pages/shared-portal-architecture.md)
- summary: 포털 안정화의 기본안을 `Firestore 유지 + BFF/API-first hybrid`로 고정하고, 6~8주 동안 provider split, read model API, critical write command, admin summary cutover 순서를 따르는 RFC와 실행 계획을 문서화했다.

## [2026-04-15] patch-note | portal-onboarding | 선택 카드 실제 이동 복구
- pages: [portal-onboarding](./pages/portal-onboarding.md)
- summary: 포털 미등록 사용자가 온보딩 선택 카드에서 `기존 사업 선택`, `증빙 업로드`, `새 사업 등록`을 눌렀을 때 강제 온보딩 리다이렉트에 다시 덮이지 않고 실제 다음 화면으로 이동하도록 복구했다.

## [2026-04-15] patch-note | portal-dashboard | PM safe fetch stabilization
- pages: [portal-dashboard](./pages/portal-dashboard.md), [portal-bank-statement](./pages/portal-bank-statement.md), [portal-weekly-expense](./pages/portal-weekly-expense.md)
- summary: PM/viewer 포털 경로의 portal store, board, training, HR surface는 역할 기반 safe fetch 모드로 전환해 반복 Firestore Listen 400이 포털 전체를 재시도 루프로 흔드는 구조를 줄였다.

## [2026-04-15] patch-note | portal-dashboard | payroll listen hardening
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: PM 포털 전역 payroll provider가 `projectId + orderBy` 복합 listen 없이 동작하도록 단순화해 남아 있던 Firestore Listen 400 후보를 추가로 제거했다.

## [2026-04-15] patch-note | admin-dashboard | 웰컴/검증 표면 제거
- pages: [admin-dashboard](./pages/admin-dashboard.md)
- summary: 어드민 첫 화면에서 웰컴 배너와 validation/reminder 보조 UI를 제거하고 KPI, 리스크, 집계, 작업 진입만 남는 운영판으로 더 압축했다.

## [2026-04-14] patch-note | portal-bank-statement | queue-first flow rollback
- pages: [portal-bank-statement](./pages/portal-bank-statement.md), [portal-weekly-expense](./pages/portal-weekly-expense.md)
- summary: QA 반응이 좋지 않았던 신규 거래 queue와 triage wizard 강제 흐름을 제거하고, 통장내역 저장본에서 바로 주간 사업비 입력으로 이어가는 단일 handoff로 복귀했다.

## [2026-04-15] patch-note | shared-label-policy | cashflow label enum policy 통합
- pages: [shared-label-policy](./pages/shared-label-policy.md), [admin-cashflow-export](./pages/admin-cashflow-export.md), [portal-bank-statement](./pages/portal-bank-statement.md)
- summary: `cashflow`의 화면 라벨, 내부 enum, sheet line id, export 라벨 기준을 JSON source of truth와 policy API로 통합했다.

## [2026-04-14] patch-note | portal-minimal-sweep | 빈 상태/가이드/placeholder 감산
- pages: [portal-submissions](./pages/portal-submissions.md), [portal-bank-statement](./pages/portal-bank-statement.md), [portal-weekly-expense](./pages/portal-weekly-expense.md), [portal-register-project](./pages/portal-register-project.md), [portal-cashflow](./pages/portal-cashflow.md), [portal-project-settings](./pages/portal-project-settings.md), [portal-edit-project](./pages/portal-edit-project.md)
- summary: 남은 포털 화면들에서 helper copy, role notice, 중복 상태 bar, `-` placeholder를 걷어내고 작업면 중심의 더 얇은 운영 화면으로 정리했다.

## [2026-04-14] patch-note | portal-submissions | enterprise tone alignment
- pages: [portal-submissions](./pages/portal-submissions.md)
- summary: 내 제출 현황의 header slab, ledger table, 상태칩, 탭, 보조 카드 톤을 portal dashboard와 같은 Salesforce형 enterprise palette로 맞췄다.

## [2026-04-14] bootstrap | patch-notes-wiki | 초기 위키 scaffold
- pages: [portal-weekly-expense](./pages/portal-weekly-expense.md), [portal-bank-statement](./pages/portal-bank-statement.md), [portal-budget](./pages/portal-budget.md), [portal-register-project](./pages/portal-register-project.md), [portal-submissions](./pages/portal-submissions.md), [admin-cashflow-export](./pages/admin-cashflow-export.md), [admin-cashflow-project-sheet](./pages/admin-cashflow-project-sheet.md), [admin-users-auth-governance](./pages/admin-users-auth-governance.md)
- summary: GitHub 내부에 화면 단위 누적 패치노트 위키 구조를 신설했다.

## [2026-04-14] patch-note | admin-users-auth-governance | auth deep sync 운영면 신설
- pages: [admin-users-auth-governance](./pages/admin-users-auth-governance.md)
- commits: `4787138`
- summary: shallow 사용자 목록을 auth governance 대시보드로 교체하고 member role, legacy member, custom claim drift를 한 화면에서 정렬할 수 있게 했다.

## [2026-04-14] patch-note | admin-cashflow-export | 운영툴형 캐시플로 추출 화면 정리
- pages: [admin-cashflow-export](./pages/admin-cashflow-export.md)
- commits: `9428009`, `416fab5`, `5c1ac13`, `e1e957f`, `29e4a60`, `71f5769`, `e77dbe7`, `b51f12c`, `d351407`
- summary: server-side export 전환과 함께 경영기획실 전용 모노톤 운영툴 화면으로 재편했다.

## [2026-04-14] patch-note | admin-cashflow-project-sheet | compare/close/weekly snapshot 작업면 기록
- pages: [admin-cashflow-project-sheet](./pages/admin-cashflow-project-sheet.md)
- commits: `0c7cb49`, `33bb7d9`, `e3c7757`, `d5ef374`, `bde5143`, `f517792`, `228ee3d`
- summary: 개별 사업 캐시플로 상세 작업면의 compare, close, snapshot, audit trail 관련 변화 포인트를 묶었다.

## [2026-04-14] patch-note | portal-weekly-expense | 저장 차단/자동 가이드/흐름 카피 정리
- pages: [portal-weekly-expense](./pages/portal-weekly-expense.md), [portal-bank-statement](./pages/portal-bank-statement.md)
- commits: `afc2098`, `0fb32ff`, `c6508c0`, `a6ff87b`, `eb2dc13`
- summary: 입력 화면 진입을 단순화하고, 통장내역에서 현재 탭 입력으로 이어지는 작업 흐름을 더 직접적으로 보이게 했다.

## [2026-04-14] patch-note | portal-budget | 모달 레이아웃과 구조 저장 보호 정리
- pages: [portal-budget](./pages/portal-budget.md)
- commits: `d9739d1`, `2189d8d`, `cafb5b4`, `7a31980`
- summary: 예산총괄 가져오기 안내 가독성, 긴 모달 스크롤, budget code book 보호를 정리했다.

## [2026-04-14] patch-note | portal-register-project | 직접입력형 자금 흐름과 등록 흐름 확장
- pages: [portal-register-project](./pages/portal-register-project.md)
- commits: `d6eb497`, `87d9953`, `6e623d4`, `2f5bb62`, `32eefdc`, `6f527fc`, `db5698d`
- summary: 직접 입력형 자금 흐름 등록, draft autosave, 단계 게이팅 완화, 계약 예외 흐름을 묶었다.

## [2026-04-14] patch-note | portal-submissions | 주간 작성 여부와 projection 기준 해석 정리
- pages: [portal-submissions](./pages/portal-submissions.md)
- commits: `afc2098`
- summary: 이번주 작성 여부와 최근 업데이트(Projection) 기준을 화면에서 더 명확하게 읽히도록 정리했다.

## [2026-04-14] patch-note | guide-simplify-and-hook | 설명성 UI 축소와 patch-note guard 추가
- pages: [portal-dashboard](./pages/portal-dashboard.md), [portal-weekly-expense](./pages/portal-weekly-expense.md), [portal-bank-statement](./pages/portal-bank-statement.md), [portal-budget](./pages/portal-budget.md), [portal-submissions](./pages/portal-submissions.md), [portal-onboarding](./pages/portal-onboarding.md), [admin-dashboard](./pages/admin-dashboard.md), [admin-participation](./pages/admin-participation.md)
- summary: 주요 운영 화면에서 미션/가이드/프로토콜 패널을 제거하고, 대응 patch-note page와 log가 같이 staged되지 않으면 커밋을 막는 hook을 추가했다.

## [2026-04-14] patch-note | portal-dashboard-saas-shell | 상단 workspace형 SaaS 재편
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: 내사업 현황을 좌측 포털형 툴에서 상단 workspace bar, 앱 탭, 사업 전환 rail을 가진 cold enterprise SaaS 구조로 재편했다.

## [2026-04-14] patch-note | portal-dashboard | 0건 운영 정보 축소와 주간 상태 전면 배치
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: 0건 운영 알림과 설정성 바로가기를 걷어내고, 이번 주 Projection 작성 여부·최근 Projection 수정일·사업비 입력 상태를 홈 첫 화면에서 바로 보이도록 압축했다.

## [2026-04-14] patch-note | portal-dashboard-shell | 검색/알림/사용자 액션 연결
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: 상단 search, bell, user affordance를 실제 command palette와 dropdown action으로 연결해 관리자 이동, 내 프로필, 로그아웃, 처리할 알림 확인이 가능하도록 마감했다.

## [2026-04-14] patch-note | portal-dashboard-shell | section label 감산
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: 상단 shell에서 정보량이 없는 `My Work` 보조 라벨을 제거하고 현재 화면명만 남겨 더 미니멀한 heading 구조로 정리했다.

## [2026-04-14] patch-note | portal-dashboard-shell | 현재 사업 검색 이동 보정
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: command search에서 현재 담당 사업을 선택했을 때 `setActiveProject` no-op 때문에 이동이 막히던 문제를 제거했다.

## [2026-04-14] patch-note | portal-dashboard-brand-slab | 로고 교체와 단일 헤더 슬랩
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: 상단 폴더 아이콘을 MYSC 로고로 교체하고 workspace 문구를 제거했으며, 첫 화면의 사업 정보와 주간 상태를 한 장의 세로형 헤더 슬랩으로 다시 묶었다.

## [2026-04-14] patch-note | portal-dashboard-minimal-pass | 중복 CTA 제거와 단일 세로 흐름
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: 홈 첫 화면에서 중복 이동 버튼과 작업 카드 묶음을 제거하고, 상태 slab와 자금 요약만 남는 더 미니멀한 세로 흐름으로 압축했다.

## [2026-04-14] patch-note | portal-dashboard-two-axis-hero | 상세/주간상태 한 판 통합
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: 자금 요약을 사업명 아래 4칸으로 올리고, 같은 hero 안에서 좌측 프로젝트 상세와 우측 이번 주 작업 상태가 한 번에 보이도록 재구성했다.

## [2026-04-14] patch-note | portal-dashboard-finance-typography | 자금 요약 가독성 정리
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: 자금 요약 4칸의 장식 아이콘을 제거하고 라벨과 숫자 크기를 키워 더 미니멀하고 읽기 쉬운 밀도로 다듬었다.

## [2026-04-14] patch-note | portal-dashboard-balance-tone | 좌우 비중과 gray hierarchy 조정
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: 프로젝트 상세와 이번 주 작업 상태의 좌우 비중을 다시 맞추고, hero 내부에 slate 회색 계층을 추가해 덜 허옇고 더 전문적인 운영툴 톤으로 정리했다.

## [2026-04-14] patch-note | portal-dashboard-white-boxes | 흰 박스 유지와 배경 대비 강화
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: 정보 박스는 다시 흰색으로 통일하고, hero 바탕 회색만 더 진하게 조정해 박스 대비와 가독성을 높였다.

## [2026-04-14] patch-note | portal-shell-project-search | 담당 사업 검색 전환 지원
- pages: [portal-dashboard](./pages/portal-dashboard.md)
- summary: 헤더의 중복 `사업비 입력` 버튼을 제거하고, 상단 command search가 담당 사업 전체를 검색해 선택 시 해당 사업으로 전환 후 이동하도록 확장했다.

## [2026-04-14] patch-note | portal-session-active-project | 세션 사업 전환과 진입 step 분리
- pages: [portal-weekly-expense](./pages/portal-weekly-expense.md), [portal-bank-statement](./pages/portal-bank-statement.md), [portal-submissions](./pages/portal-submissions.md)
- summary: 저장된 주사업과 별도로 session active project를 도입하고, 포털 진입을 `project-select` step으로 분리해 같은 화면을 유지한 채 사업 전환이 가능하도록 정리했다.

## [2026-04-14] patch-note | portal-project-select-shell | 포털 진입 사업 선택 step 신설
- pages: [portal-project-select](./pages/portal-project-select.md), [portal-dashboard](./pages/portal-dashboard.md)
- summary: 로그인 후 포털 진입을 `project-select` step으로 라우팅하고, 상단 search는 메뉴 이동이 아니라 담당 사업 전환과 관리자 공간 이탈만 담당하도록 정리했다.

## [2026-04-14] patch-note | portal-project-select-redirect | wrapped redirect 보존
- pages: [portal-project-select](./pages/portal-project-select.md)
- summary: 이미 `project-select?redirect=...` 형태인 포털 진입 URL을 다시 해석할 때도 redirect query를 지우지 않도록 안정성을 보강했다.

## [2026-04-15] patch-note | portal-onboarding-workspace-choice | 명시적 workspace 선택 우선
- pages: [portal-onboarding](./pages/portal-onboarding.md), [portal-project-select](./pages/portal-project-select.md)
- summary: workspace 선택 화면에서는 이전 admin redirect를 무조건 재사용하지 않고, 사용자가 고른 공간과 같은 성격의 경로만 유지하도록 정리했다.

## [2026-04-14] patch-note | portal-dashboard-submission-merge | 제출 상태 홈 흡수
- pages: [portal-dashboard](./pages/portal-dashboard.md), [portal-submissions](./pages/portal-submissions.md)
- summary: `내 제출 현황`의 핵심 제출 상태를 `/portal` 홈 안으로 흡수하고, 중복이던 `인력변경 신청`, `주간 제출 체크`, `사업비 입력(주간) 작성/제출` 블록은 홈 통합 섹션 밖으로 뺐다.

## [2026-04-14] patch-note | portal-weekly-expense | navigation guard와 bank wizard 회귀 복구
- pages: [portal-weekly-expense](./pages/portal-weekly-expense.md)
- summary: 미저장 사업비 입력 편집은 화면 이동 전에 확인 다이얼로그로 막도록 복구했고, bank import triage wizard의 cashflow category 선택과 fullscreen/주간입력 연계 E2E도 다시 통과하도록 정리했다.

## [2026-04-15] patch-note | portal-bank-statement, portal-weekly-expense | direct handoff row projection
- pages: [portal-bank-statement](./pages/portal-bank-statement.md), [portal-weekly-expense](./pages/portal-weekly-expense.md)
- summary: 통장내역 저장 시 신규 은행 행을 현재 주간 사업비 탭으로 바로 merge하도록 바꿔, Queue 없이 `통장내역 -> 사업비 입력(주간)` 운영 경로가 실제로 이어지게 복구했다.

## [2026-04-15] patch-note | portal-cashflow, portal-dashboard | PM cashflow listen hardening
- pages: [portal-cashflow](./pages/portal-cashflow.md), [portal-dashboard](./pages/portal-dashboard.md)
- summary: PM용 cashflow 주차 구독은 Firestore에서 project 기준으로만 listen하고, 연도 범위는 클라이언트에서 필터링하도록 바꿔 PM 포털 부팅이 cashflow composite index drift에 직접 막히지 않게 보강했다.
