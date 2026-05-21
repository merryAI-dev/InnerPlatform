# Admin Dashboard

- route: `/`
- primary users: 관리자, 운영 PM
- status: active
- last updated: 2026-05-21

## Purpose

전사 프로젝트 현황, 위험 신호, 핵심 재무/운영 수치를 한 번에 보는 관리자 대시보드다.

## Current UX Summary

- `/` 첫 화면은 사이드바 없이 전체 화면을 쓰는 glassmorphism 기능 검색 페이지로 두고, 기존 운영 대시보드는 `/dashboard`에서 유지한다.
- KPI, 위험 카드, 프로젝트 현황 표 중심으로 구성한다.
- 별도 작성 가이드 패널 없이 현재 상태와 작업 진입점만 남긴다.
- 캐시플로 추출과 프로젝트 목록 이동을 상단 액션으로 유지한다.
- LAB OFF 기본 상태에서는 아직 운영 안정화 전인 관리 화면을 대시보드 카드, 알림, 상태바에서도 노출하지 않는다.

## Current Feature Checklist

- [x] 전사 KPI와 상태 확인 가능
- [x] 첫 진입 화면에서 관리자/PM 업무를 색상으로 구분해 검색 가능
- [x] 프로젝트 목록과 캐시플로 추출로 바로 이동 가능
- [x] 작성 가이드, 웰컴, validation/reminder 보조 표면 없이 운영 수치 중심 화면 유지
- [x] LAB OFF 기본 상태에서 숨김 메뉴가 대시보드, 알림, 상태바, 커맨드 팔레트로 우회 노출되지 않음
- [ ] 요약 카드 우선순위와 시각적 밀도는 추가 조정 여지 있음

## Recent Changes

- [2026-05-21] `/` 첫 화면을 기능 검색 전용 페이지로 바꾸고 기존 대시보드는 `/dashboard`로 보존했다. 검색 결과는 `관리자`와 `PM` 그룹으로 나눠 색상 pill과 카드 배경으로 구분하고, 계약서/CIC/사업비/권한 같은 현업 키워드를 노출된 업무 화면에 매핑했다.
- [2026-05-21] 기능 검색 화면의 검색 slab, 관리자/PM shortcut panel, 검색 결과 리스트를 translucent surface와 blur 기반 glassmorphism 톤으로 조정했다.
- [2026-05-21] `/` 기능 검색 화면에서는 AppLayout의 sidebar/header/status chrome을 생략해 최초 진입 시 전체 화면으로 보이게 했다. 실제 업무 화면으로 이동하면 기존 Admin/Portal shell이 다시 적용된다.
- [2026-05-21] 기능 검색 headline을 로그인 사용자 이름 기반 인사 문구로 바꾸고, 검색창은 hover 전에도 경계가 보이며 hover/focus 시 outline과 shadow가 더 분명하게 드러나도록 조정했다.
- [2026-05-21] Admin/Portal shell에 공통 LAB visibility policy를 추가하고, 대시보드 이상 징후, 시스템 상태, 최근 활동, 상태바, 알림 패널, 404 quick links, 캐시플로 허브 카드까지 같은 정책으로 필터링해 평시에는 프로젝트/캐시플로/권한 중심 화면만 보이도록 정리했다.
- [2026-05-20] 대시보드와 승인 진입면의 `사업/승인 큐` 계열 문구를 `프로젝트/CIC 검토` 기준으로 정리하고, 등록·수정·승인 흐름에서 같은 project status와 dropdown 값을 보도록 맞췄다.
- [2026-04-16] 인건비 관제 숫자에 `PM 입력 금액 없음`, `Projection 금액 없음`, `금액 불일치`, `Projection 기준 잔액 부족`, `PM 기준 잔액 부족`을 추가해 사업별 payroll anomaly를 더 직접적으로 모니터링할 수 있게 했다.
- [2026-04-16] 인건비 모니터링 숫자를 `PM 검토 대기 / 후보 없음 / 최종 확정 가능`으로 나눠 보여주고, Admin 월간정산 화면에서 PM 판단 요약과 최종 확정 액션이 같은 언어 체계로 읽히도록 정리했다.
- [2026-04-15] 웰컴 배너, validation summary, validation badge, update reminder를 제거해 첫 화면을 KPI와 관제 블록만 남는 운영판으로 더 압축했다.
- [2026-04-14] `대시보드 작성 가이드` 패널을 제거해 메인 화면을 단순화했다.

## Known Notes

- 관리자 첫 화면은 교육면이 아니라 관제면에 가깝다.
- 설명 패널보다 이상 징후와 이동 액션이 우선이어야 한다.

## Related Files

- `src/app/components/dashboard/DashboardPage.tsx`
- `src/app/components/dashboard/FeatureSearchPage.tsx`
- `src/app/components/dashboard/AdminCommandSearch.tsx`
- `src/app/components/dashboard/SystemHealthPanel.tsx`
- `src/app/components/dashboard/DashboardGuide.tsx`
- `src/app/platform/admin-command-index.ts`
- `src/app/platform/shell-lab-visibility.ts`
- `src/app/routes.tsx`

## Related Tests

- `src/app/components/dashboard/dashboard-rollups.test.ts`
- `src/app/components/dashboard/DashboardPage.shell.test.ts`
- `src/app/components/dashboard/FeatureSearchPage.shell.test.ts`
- `src/app/components/dashboard/SystemHealthPanel.shell.test.ts`
- `src/app/platform/admin-command-index.test.ts`
- `src/app/platform/shell-lab-visibility.test.ts`

## Related QA / Ops Context

- 운영 측에서 메인 대시보드의 가이드성 정보보다 실제 작업 진입과 현황 확인이 더 중요하다는 방향으로 정리했다.

## Next Watch Points

- 웰컴/검증 표면 제거 뒤에도 `캐시플로 추출`, `전체 프로젝트` 진입성이 충분한지
- 대시보드 보조 컴포넌트가 다시 설명성 패널로 되돌아가지 않는지
