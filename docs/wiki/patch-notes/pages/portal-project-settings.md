# Portal Project Settings

- route: `/portal/project-settings`
- primary users: PM
- status: active
- last updated: 2026-04-14

## Purpose

포털 사용자가 자기 사업 관련 기본 설정과 연결 정보를 확인/조정하는 화면이다.

## Current UX Summary

- 사업 설정 상태를 본다.
- 다른 포털 화면에서 이 설정 화면으로 이동하는 경우가 많다.

## Current Feature Checklist

- [x] 다중 사업 선택 가능
- [x] 주사업 지정 가능
- [x] 최근 사용한 사업 shortcut 사용 가능
- [x] 검색/상태 필터/선택한 사업만 보기 가능
- [x] 저장 후 포털 반영 가능
- [x] 사업별 증빙 Drive 링크 저장 가능
- [x] 기본 폴더 생성 가능
- [x] 다른 포털 화면에서 설정 화면으로 이동 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-04] 최근 사업 shortcut과 배정 검색이 강화됐다.

## Known Notes

- 포털 여러 화면의 fallback 링크 목적지다.

## Related Files

- `src/app/components/portal/PortalProjectSettings.tsx`

## Related Tests

- 현재 프로젝트 설정 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 사업 배정/수정 요청과 함께 읽는 경우가 많다.

## Next Watch Points

- 각 포털 화면에서 이 설정 화면으로 연결되는 경로가 유지되는지
