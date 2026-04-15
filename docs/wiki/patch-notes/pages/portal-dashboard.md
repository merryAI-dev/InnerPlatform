# Portal Dashboard

- route: `/portal`
- primary users: PM
- status: active
- last updated: 2026-04-15

## Purpose

배정된 내 사업의 현재 운영 상태를 한 화면에서 확인하고 예산, 통장내역, 제출 흐름으로 이동하는 PM 포털 첫 화면이다.

## Current UX Summary

- 상단 workspace bar, 업무 탭, 사업 전환 rail을 통해 현재 사업과 현재 업무를 먼저 보여준다.
- 본문은 단일 헤더 slab 안에서 `자금 요약 → 프로젝트 상세 → 이번 주 작업 상태`를 한 번에 읽히게 배치하고, 아래에는 예외 상태 카드만 남긴다.
- 첫 화면 최상단은 좌우 분할 대신 사업 핵심 정보와 주간 상태를 한 장의 세로형 slab로 묶는다.
- 별도 미션/가이드 카드 없이 현재 사업 상태와 필수 운영 정보만 보여준다.
- 이번 주 Projection 작성 여부, 최근 Projection 수정일, 사업비 입력 상태를 첫 화면에서 바로 확인할 수 있다.
- 별도 `내 제출 현황` 탭 대신 이번 주 제출 상태 표를 홈 안에 흡수해 같은 화면에서 확인한다.
- `0건 / 처리 필요 없음` 성격의 운영 요약 카드는 숨기고 실제 대응이 필요한 항목만 노출한다.
- 상단 검색은 담당 사업 전환과 관리자 공간 이탈을 담당하고, 알림/사용자 아이콘은 실제 shell action으로 연결된다.
- 상단 브랜드는 폴더 아이콘 대신 MYSC 로고를 사용하고, 부가 workspace 카피는 노출하지 않는다.
- 사업이 아직 연결되지 않은 경우에도 단계형 설명 대신 최소 안내와 CTA만 남긴다.

## Current Feature Checklist

- [x] 배정된 내 사업 상태 확인 가능
- [x] 통장내역, 제출, 예산 흐름으로 바로 이동 가능
- [x] 이번 주 Projection 작성 여부와 최근 Projection 수정일 확인 가능
- [x] 이번 주 사업비 입력 상태 확인 가능
- [x] 이번 주 제출 상태를 `내 사업 현황` 안에서 사업별로 함께 확인 가능
- [x] 별도 `내 제출 현황` 탭 없이 홈 한 화면에서 주간 제출 상태 확인 가능
- [x] 제출 통합 화면에서 `인력변경 신청`과 중복 `사업비 입력(주간) 작성/제출` 블록은 제외됨
- [x] 상단 앱 탭에서 핵심 업무 전환 가능
- [x] 상단에서 현재 사업 전환 가능
- [x] 별도 미션/가이드 카드 없이 현재 상태 중심으로 확인 가능
- [x] `0건 / 처리 필요 없음` 운영 요약 카드를 기본 화면에서 숨김
- [x] 포털 진입 시 `project-select` step을 거쳐 세션 기준 사업 선택 가능
- [x] 상단 검색에서 담당 사업명으로 검색하고 해당 사업으로 전환 가능
- [x] 상단 검색에서 관리자 공간으로 빠르게 빠져나갈 수 있음
- [x] 현재 담당 사업을 검색해도 이동이 막히지 않음
- [x] 상단 사용자 메뉴에서 내 프로필, 관리자 공간, 로그아웃 이동 가능
- [x] 상단 알림 메뉴에서 실제 처리할 항목만 확인 가능
- [x] 상단 shell에서 `My Work` 같은 보조 section label 없이 현재 화면명만 노출
- [x] 프로젝트 정보와 주간 상태를 첫 화면 한 장의 헤더 슬랩에서 확인 가능
- [x] 상단에 MYSC 로고만 남기고 부가 workspace 문구는 제거됨
- [x] 첫 화면에서 중복 바로가기 CTA 없이 상태와 요약 정보 중심으로 확인 가능
- [x] PM 홈 부팅이 cashflow 주차 listener의 연도 범위 index 상태에 직접 막히지 않음
- [x] PM 포털 전역 payroll listener가 compound query 없이 project 기준 listen으로 동작함
- [x] PM 포털 주요 운영 데이터는 safe fetch 모드에서 realtime listen 없이도 부팅 가능
- [x] 포털 홈의 거래 집계는 direct `onSnapshot` 없이 fetch 기반으로 로드됨
- [x] 포털 홈은 route shell이 주입한 `portal-safe` access mode를 기준으로 부팅됨
- [x] 포털 store는 pathname이나 `window.location`을 읽어 realtime 여부를 스스로 판단하지 않음
- [x] 자금 요약 4칸이 사업명 바로 아래에서 한 번에 확인 가능
- [x] 프로젝트 상세와 이번 주 작업 상태를 한 slab 안의 좌우 축으로 확인 가능
- [x] 좌우 패널 비중이 상태 정보 기준으로 재조정됨
- [x] hero 내부 surface에 회색 계층이 분명하게 적용됨
- [x] 사업 미연결 상태에서 최소 안내와 CTA 제공
- [x] cold enterprise SaaS 톤으로 색상 정리
- [ ] 다른 포털 하위 화면까지 같은 shell 언어를 확장할 여지 있음

## Recent Changes

- [2026-04-14] 포털 진입을 `/portal/project-select` step으로 분리하고, 상단 search를 메뉴 이동이 아닌 담당 사업 전환 중심으로 바꿨다.
- [2026-04-14] `운영 알림`, `운영 바로가기`, 별도 소진율 바처럼 반복되거나 0건인 정보 박스를 걷어냈다.
- [2026-04-14] 첫 화면 우측 패널을 `이번 주 정산 상태`로 바꾸고 Projection 작성 여부, 최근 Projection 수정일, 사업비 입력 상태를 전면 배치했다.
- [2026-04-14] 급하지 않은 운영 정보는 숨기고 실제 대응이 필요한 이슈만 `처리 필요` pill로 축약했다.
- [2026-04-14] 직접입력형/통장연동형 사업에 따라 `이번 주 바로 작업` 액션 구성을 다르게 정리했다.
- [2026-04-14] 상단 검색을 실제 command palette로 연결하고, 사용자/알림 아이콘도 dropdown action으로 마저 구현했다.
- [2026-04-14] 폴더 아이콘과 `MYSC Workspace / Project Operations` 카피를 제거하고 MYSC 로고 중심의 간결한 상단 브랜드로 교체했다.
- [2026-04-14] 사업 헤더와 주간 상태를 한 장의 세로형 slab로 합쳐 발주기관, 금액, Projection, 최근 수정, 사업비 입력 상태를 한 번에 읽히게 재배치했다.
- [2026-04-14] `프로젝트 설정`, `사업비 입력 열기`, `이번 주 바로 작업` 블록처럼 중복된 CTA를 제거하고 홈을 상태 중심 화면으로 다시 압축했다.
- [2026-04-14] 자금 요약 4칸을 별도 카드로 두지 않고 사업명 바로 아래로 끌어올렸고, 하단은 `프로젝트 상세 / 이번 주 작업 상태` 2축 구조로 재배치했다.
- [2026-04-14] 자금 요약 4칸의 아이콘 박스를 제거하고 라벨·숫자 타이포를 키워 더 평평하고 읽기 쉬운 SaaS 밀도로 정리했다.
- [2026-04-14] 우측 `이번 주 작업 상태` 축을 조금 더 넓히고, 박스는 흰색으로 유지한 채 hero 바탕 회색만 더 강하게 잡아 좌우 균형과 엔터프라이즈 톤을 보강했다.
- [2026-04-14] 헤더 우측의 중복 `사업비 입력` CTA를 제거하고, command search가 담당 사업 전체를 검색해 해당 사업으로 바로 전환되도록 확장했다.
- [2026-04-14] command search에서 현재 담당 사업을 선택해도 이동이 막히지 않도록 `setActiveProject` no-op 케이스를 정리했다.
- [2026-04-14] 상단 shell의 `My Work` 보조 라벨을 제거하고 현재 화면명만 남겼다.
- [2026-04-15] PM 홈은 전역 cashflow 주차 구독이 project 기준 query만 사용하도록 바꿔, cashflow composite index drift가 있어도 포털 첫 화면 전체가 Listen 400 재시도로 흔들리지 않게 보강했다.
- [2026-04-15] PM 포털 전역 payroll 구독도 `projectId + orderBy` 복합 listen을 제거하고 project 기준 listen 뒤 클라이언트 정렬로 단순화해, 남아 있던 Listen 400 후보를 더 줄였다.
- [2026-04-15] PM/viewer 경로의 portal/board/hr/training 운영 surface는 역할 기반 safe fetch 모드에서 일회성 조회를 사용하도록 바꿔, 반복 Firestore Listen 400이 포털 전체를 흔드는 구조를 더 줄였다.
- [2026-04-15] 포털 홈이 직접 붙이던 `transactions` realtime listener를 제거하고, `/portal` 경로에서는 거래 집계도 fetch 기반으로만 읽게 바꿨다.
- [2026-04-15] 포털 전역 provider들이 `window.location.pathname`를 한 번 읽고 끝내는 대신 route change를 구독하도록 바꿔, admin/live 판단이 이전 화면 기준으로 고정된 채 `/portal`에서 realtime listen이 다시 살아나는 문제를 막았다.
- [2026-04-15] App 루트 broad provider를 route shell로 분리하고, 포털은 `portal-safe` access mode를 주입받아 store가 URL self-inference 없이 동일한 fetch 정책을 따르게 정리했다.
- [2026-04-14] `내 제출 현황`을 홈 하단의 compact 제출 상태 표로 흡수했고, 별도 탭과 직접 진입 라우트는 홈으로 정리했다.
- [2026-04-14] 제출 통합 블록에서는 `인력변경 신청`, `사업비 입력(주간) 작성/제출`, `주간 제출 체크` 같은 중복 섹션을 제외하고 현재 주차 기준 핵심 상태만 남겼다.
- [2026-04-14] 상단을 Salesforce 계열 SaaS처럼 `workspace bar + app tabs + project switcher` 구조로 재편했다.
- [2026-04-14] 본문을 record header, alerts rail, KPI strip, 작업 카드 구조로 다시 정리했다.
- [2026-04-14] 초록/보라/주황 혼용을 줄이고 navy/slate 중심의 차가운 엔터프라이즈 톤으로 정리했다.
- [2026-04-14] 자동 미션/가이드 카드와 단계형 설명 블록을 제거했다.
- [2026-04-14] 헤더 문구를 `현재 운영 현황` 중심으로 단순화했다.

## Known Notes

- 이 화면은 온보딩보다는 운영 진입면 성격이 강하다.
- 설명이 늘어나기 쉬운 화면이라 상태 카드와 CTA 외 보조 문구 증식을 경계해야 한다.

## Related Files

- `src/app/components/portal/PortalDashboard.tsx`
- `src/app/components/portal/PortalProjectSelectPage.tsx`
- `src/app/components/portal/PortalLayout.tsx`
- `src/app/routes.tsx`

## Related Tests

- `src/app/platform/project-dashboard-scope.test.ts`
- `src/app/platform/portal-happy-path.test.ts`

## Related QA / Ops Context

- 최근 운영 피드백에서 자동 가이드와 단계 설명이 과하다는 지적이 있었고, PM 홈도 같은 기준으로 단순화했다.
- 상단 vacuum space가 크고 화면 활용이 비효율적이라는 피드백을 반영해 SaaS workspace형 상단 구조로 바꿨다.

## Next Watch Points

- 미연결 상태에서 필요한 CTA가 충분히 남아 있는지
- KPI 카드가 다시 설명성 블록으로 불어나지 않는지
- 홈에서 보여주는 주간 상태와 `내 제출 현황` 해석이 어긋나지 않는지
