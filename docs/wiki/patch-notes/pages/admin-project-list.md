# Admin Project List

- route: `/projects`
- primary users: admin, finance, 운영 담당자
- status: active
- last updated: 2026-04-14

## Purpose

사업 목록을 상태별로 보고, 검색/필터링하고, 상세나 수정 화면으로 들어가는 관리자용 목록 화면이다.

## Current UX Summary

- 탭별로 사업 상태를 나눠 본다.
- 검색 조건과 필터를 조합해 원하는 사업을 찾는다.
- 상세 보기나 수정으로 이동한다.

## Current Feature Checklist

- [x] 사업 목록 조회 가능
- [x] 확정/예정/휴지통 탭 전환 가능
- [x] 검색 및 필터 초기화 가능
- [x] 사업명/발주기관/담당자 검색 가능
- [x] 사업 상세 이동 가능
- [x] 사업 수정 진입 가능
- [x] 휴지통 복구 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-09] admin project surface trim 이후 목록 중심 운영 흐름이 정리됐다.

## Known Notes

- 신규 사업 생성 진입은 별도 redirect route를 통해 wizard로 연결된다.

## Related Files

- `src/app/components/projects/ProjectListPage.tsx`

## Related Tests

- 현재 목록 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 프로젝트 등록/개설, 계약서 업로드, 배정 관련 QA와 자주 이어진다.

## Next Watch Points

- 필터와 탭 상태가 상세/수정 이동 후에도 사용자 기대와 맞는지
