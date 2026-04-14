# Portal Edit Project

- route: `/portal/edit-project`
- primary users: PM, 프로젝트 정보 수정 담당자
- status: active
- last updated: 2026-04-14

## Purpose

현재 선택된 프로젝트의 기본 정보를 수정하는 화면이다.

## Current UX Summary

- 헤더는 화면 제목과 프로젝트명만 보여준다.
- 현재 프로젝트를 설명문으로 반복하지 않고, 제목 아래 메타 한 줄만 유지한다.

## Current Feature Checklist

- [x] 현재 프로젝트 정보 수정 가능
- [x] 화면 제목과 프로젝트명 확인 가능
- [x] 중복 subtitle 없이 폼 중심으로 진입 가능

## Recent Changes

- [2026-04-14] `현재 프로젝트:` subtitle을 제거하고 프로젝트명만 남겨 헤더를 더 짧게 정리했다.

## Related Files

- `src/app/components/portal/PortalProjectEdit.tsx`
- `src/app/routes.tsx`

## Related Tests

- `src/app/components/portal/PortalMinimalSweep.layout.test.ts`

## Next Watch Points

- 헤더 아래에 상태성 보조 문구가 다시 늘어나지 않는지
