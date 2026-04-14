# Portal Dashboard

- route: `/portal`
- primary users: PM
- status: active
- last updated: 2026-04-14

## Purpose

배정된 내 사업의 현재 운영 상태를 한 화면에서 확인하고 예산, 통장내역, 제출 흐름으로 이동하는 PM 포털 첫 화면이다.

## Current UX Summary

- 핵심 상태 카드와 현재 사업 기본 정보 중심으로 화면을 유지한다.
- 별도 미션/가이드 카드 없이 현재 사업 상태와 바로가기 액션만 보여준다.
- 사업이 아직 연결되지 않은 경우에도 단계형 설명 대신 최소 안내와 CTA만 남긴다.

## Current Feature Checklist

- [x] 배정된 내 사업 상태 확인 가능
- [x] 통장내역, 제출, 예산 흐름으로 바로 이동 가능
- [x] 별도 미션/가이드 카드 없이 현재 상태 중심으로 확인 가능
- [x] 사업 미연결 상태에서 최소 안내와 CTA 제공
- [ ] KPI 밀도와 우선순위는 추가 정리 여지 있음

## Recent Changes

- [2026-04-14] 자동 미션/가이드 카드와 단계형 설명 블록을 제거했다.
- [2026-04-14] 헤더 문구를 `현재 운영 현황` 중심으로 단순화했다.

## Known Notes

- 이 화면은 온보딩보다는 운영 진입면 성격이 강하다.
- 설명이 늘어나기 쉬운 화면이라 상태 카드와 CTA 외 보조 문구 증식을 경계해야 한다.

## Related Files

- `src/app/components/portal/PortalDashboard.tsx`
- `src/app/components/portal/PortalLayout.tsx`
- `src/app/routes.tsx`

## Related Tests

- `src/app/platform/project-dashboard-scope.test.ts`
- `src/app/platform/portal-happy-path.test.ts`

## Related QA / Ops Context

- 최근 운영 피드백에서 자동 가이드와 단계 설명이 과하다는 지적이 있었고, PM 홈도 같은 기준으로 단순화했다.

## Next Watch Points

- 미연결 상태에서 필요한 CTA가 충분히 남아 있는지
- KPI 카드가 다시 설명성 블록으로 불어나지 않는지
