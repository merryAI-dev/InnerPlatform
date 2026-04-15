# Portal Onboarding

- route: `/login`, `/workspace-select`
- primary users: 전체 사용자
- status: active
- last updated: 2026-04-15

## Purpose

로그인과 공간 선택을 마친 뒤 관리자 공간 또는 PM 포털로 진입시키는 시작 화면 묶음이다.

## Current UX Summary

- 로그인 화면은 계정 인증과 예외 상태만 보여준다.
- 공간 선택 화면은 관리자 공간과 PM 포털의 차이를 짧게 설명하고 바로 진입시킨다.
- 별도 Guided Start 카드 없이 핵심 선택만 남긴다.

## Current Feature Checklist

- [x] 로그인 가능
- [x] 역할별 기본 진입 경로 판단 가능
- [x] workspace 선택 가능 계정은 공간 선택 후 진입 가능
- [x] 포털 미등록 사용자는 온보딩 선택 카드에서 기존 사업 선택, 증빙 업로드, 새 사업 등록으로 실제 이동 가능
- [x] Guided Start 카드 없이 핵심 인증/선택 UI만 유지
- [ ] 공간 설명 카피는 더 압축할 여지 있음

## Recent Changes

- [2026-04-15] 포털 시작 선택 카드는 standalone entry path 정책을 공통 helper로 보게 정리했고, deep route 진입 후에도 fallback 선택 화면이 다시 덮이지 않도록 복구했다.
- [2026-04-15] `기존 사업 선택`은 `사업 배정 수정`이 아니라 실제 세션 사업 선택 단계인 `/portal/project-select`로 연결되게 바꿨다.
- [2026-04-15] workspace 선택 화면에서 사용자가 `관리자 공간` 또는 `PM 포털 공간`을 명시적으로 고르면, 그 공간에 맞는 redirect만 유지하도록 정리했다.
- [2026-04-14] PM 포털 진입을 바로 `/portal`로 보내지 않고 `/portal/project-select` step을 거친 뒤 세션 기준 사업을 고르게 바꿨다.
- [2026-04-15] 포털 미등록 상태에서 온보딩 선택 카드를 눌렀을 때 `register-project`와 `weekly-expenses`가 강제 리다이렉트에 다시 덮이지 않도록 bypass 경로를 `shouldForcePortalOnboarding` 정책과 맞췄다.
- [2026-04-14] 로그인 화면의 `Guided Start` 블록을 제거했다.
- [2026-04-14] workspace 선택 화면의 PM 안내 문구를 더 직접적으로 정리했다.

## Known Notes

- 이 영역은 설명보다는 인증 성공과 빠른 진입이 우선이다.
- 데모 로그인, preview auth 예외, workspace 선택은 계속 분기 복잡도가 높다.

## Related Files

- `src/app/components/auth/LoginPage.tsx`
- `src/app/components/auth/WorkspaceSelectPage.tsx`
- `src/app/platform/navigation.ts`

## Related Tests

- `src/app/platform/navigation.test.ts`
- `src/app/platform/preview-auth.test.ts`
- `src/app/data/member-workspace.test.ts`

## Related QA / Ops Context

- 최근 운영 방향에서 시작 화면의 튜토리얼성 카드를 줄이고 바로 작업 공간으로 들어가게 하는 쪽을 우선했다.

## Next Watch Points

- preview auth / dev harness 분기에서 진입 CTA가 여전히 명확한지
- workspace 선택 화면 카피가 다시 과도하게 길어지지 않는지
