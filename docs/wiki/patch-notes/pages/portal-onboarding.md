# Portal Onboarding

- route: `/portal/onboarding`
- primary users: PM, 신규 포털 사용자
- status: active
- last updated: 2026-04-14

## Purpose

내 사업을 선택하고 포털 사용을 시작하는 초기 연결 화면이다.

## Current UX Summary

- 내 사업 선택을 중심으로 구성된다.
- 선택 후 포털 사용 흐름으로 이어진다.

## Current Feature Checklist

- [x] 로그인/권한 gate 반영
- [x] 사업 1개 이상 선택 가능
- [x] 주사업 지정 가능
- [x] 온보딩 시작 화면으로 사용 가능
- [x] 저장 후 `/portal` 리다이렉트 가능
- [x] 사업이 없을 때 `/portal/register-project` 유도 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- 포털 대시보드와 달리 초기 연결 전용 화면이다.

## Related Files

- `src/app/components/portal/PortalOnboarding.tsx`

## Related Tests

- 현재 온보딩 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 사업 연결이 안 된 사용자 경험과 직접 연결된다.

## Next Watch Points

- 사업 선택 이후 이동 흐름이 끊기지 않는지
