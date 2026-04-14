# Portal Dashboard

- route: `/portal`
- primary users: PM
- status: active
- last updated: 2026-04-14

## Purpose

배정된 내 사업의 현재 운영 상태를 한 화면에서 확인하고 예산, 통장내역, 제출 흐름으로 이동하는 PM 포털 첫 화면이다.

## Current UX Summary

- 상단 workspace bar, 업무 탭, 사업 전환 rail을 통해 현재 사업과 현재 업무를 먼저 보여준다.
- 본문은 record header, alerts rail, KPI strip, 작업 카드 순서로 운영 정보를 배치한다.
- 별도 미션/가이드 카드 없이 현재 사업 상태와 바로가기 액션만 보여준다.
- 사업이 아직 연결되지 않은 경우에도 단계형 설명 대신 최소 안내와 CTA만 남긴다.

## Current Feature Checklist

- [x] 배정된 내 사업 상태 확인 가능
- [x] 통장내역, 제출, 예산 흐름으로 바로 이동 가능
- [x] 상단 앱 탭에서 핵심 업무 전환 가능
- [x] 상단에서 현재 사업 전환 가능
- [x] 별도 미션/가이드 카드 없이 현재 상태 중심으로 확인 가능
- [x] 사업 미연결 상태에서 최소 안내와 CTA 제공
- [x] cold enterprise SaaS 톤으로 색상 정리
- [ ] 다른 포털 하위 화면까지 같은 shell 언어를 확장할 여지 있음

## Recent Changes

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
