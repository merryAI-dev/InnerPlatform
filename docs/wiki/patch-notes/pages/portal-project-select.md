# Portal Project Select

- route: `/portal/project-select`
- primary users: PM, admin, finance
- status: active
- last updated: 2026-04-14

## Purpose

포털에 진입할 때 이번 세션에서 작업할 사업을 먼저 고르고, 현재 화면을 유지한 채 사업 전환으로 이어지게 만드는 진입 step이다.

## Current UX Summary

- 로그인 후 포털 진입은 먼저 이 화면을 거친다.
- 담당 사업이 우선 노출되고, 필요하면 검색으로 다른 사업을 찾을 수 있다.
- 여기서 고른 사업은 저장된 주사업을 바꾸지 않고 세션 기준 `active project`만 바꾼다.
- 선택이 끝나면 원래 가려던 포털 화면으로 바로 복귀한다.

## Current Feature Checklist

- [x] `/portal` 진입 시 `project-select` step으로 우회 가능
- [x] 담당 사업 우선 노출 가능
- [x] 사업명, 클라이언트, 유형, 담당자 검색 가능
- [x] 세션 active project만 바꾸고 주사업은 유지
- [x] 선택 후 원래 보던 포털 경로로 복귀 가능

## Recent Changes

- [2026-04-14] 이미 `project-select?redirect=...` 형태인 진입 URL은 redirect query를 보존하도록 라우팅 안정성을 보강했다.
- [2026-04-14] 포털 진입을 `/portal/project-select` step으로 분리하고 세션 active project 선택 흐름을 신설했다.

## Related Files

- `src/app/components/portal/PortalProjectSelectPage.tsx`
- `src/app/components/portal/PortalLayout.tsx`
- `src/app/platform/navigation.ts`
- `src/app/platform/portal-project-selection.ts`

## Related Tests

- `src/app/components/portal/PortalProjectSelectPage.shell.test.ts`
- `src/app/platform/navigation.test.ts`
- `src/app/platform/portal-project-selection.test.ts`

## Next Watch Points

- 로그인 직후 redirect query가 누락되지 않는지
- 담당 사업이 없는 계정에서 검색 fallback이 자연스러운지
- 세션 active project와 저장된 주사업이 다시 섞이지 않는지
