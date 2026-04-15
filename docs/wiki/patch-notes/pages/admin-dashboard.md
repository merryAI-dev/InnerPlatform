# Admin Dashboard

- route: `/`
- primary users: 관리자, 운영 PM
- status: active
- last updated: 2026-04-15

## Purpose

전사 프로젝트 현황, 위험 신호, 핵심 재무/운영 수치를 한 번에 보는 관리자 대시보드다.

## Current UX Summary

- KPI, 위험 카드, 프로젝트 현황 표 중심으로 구성한다.
- 별도 작성 가이드 패널 없이 현재 상태와 작업 진입점만 남긴다.
- 캐시플로 추출과 프로젝트 목록 이동을 상단 액션으로 유지한다.

## Current Feature Checklist

- [x] 전사 KPI와 상태 확인 가능
- [x] 프로젝트 목록과 캐시플로 추출로 바로 이동 가능
- [x] 작성 가이드, 웰컴, validation/reminder 보조 표면 없이 운영 수치 중심 화면 유지
- [ ] 요약 카드 우선순위와 시각적 밀도는 추가 조정 여지 있음

## Recent Changes

- [2026-04-15] 웰컴 배너, validation summary, validation badge, update reminder를 제거해 첫 화면을 KPI와 관제 블록만 남는 운영판으로 더 압축했다.
- [2026-04-14] `대시보드 작성 가이드` 패널을 제거해 메인 화면을 단순화했다.

## Known Notes

- 관리자 첫 화면은 교육면이 아니라 관제면에 가깝다.
- 설명 패널보다 이상 징후와 이동 액션이 우선이어야 한다.

## Related Files

- `src/app/components/dashboard/DashboardPage.tsx`
- `src/app/components/dashboard/DashboardGuide.tsx`
- `src/app/routes.tsx`

## Related Tests

- `src/app/components/dashboard/dashboard-rollups.test.ts`
- `src/app/components/dashboard/DashboardPage.shell.test.ts`

## Related QA / Ops Context

- 운영 측에서 메인 대시보드의 가이드성 정보보다 실제 작업 진입과 현황 확인이 더 중요하다는 방향으로 정리했다.

## Next Watch Points

- 웰컴/검증 표면 제거 뒤에도 `캐시플로 추출`, `전체 프로젝트` 진입성이 충분한지
- 대시보드 보조 컴포넌트가 다시 설명성 패널로 되돌아가지 않는지
