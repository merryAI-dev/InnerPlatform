# Portal Career Profile

- route: `/portal/career-profile`
- primary users: 포털 사용자
- status: active
- last updated: 2026-04-14

## Purpose

사용자 자신의 경력 프로필을 보고 수정하는 화면이다.

## Current UX Summary

- 프로필 기본 정보, 경력, 이력 항목을 편집한다.
- 편집 모드와 저장 버튼이 분리되어 있다.

## Current Feature Checklist

- [x] 기본정보 편집/저장 가능
- [x] 학력 추가 가능
- [x] 직장경력 추가 가능
- [x] 자격증 추가 가능
- [x] 프로젝트 참여 이력 조회 가능
- [x] 사내 교육 이력 탭 확인 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-02-24] career profile 페이지가 추가되고 2026-02-25 정합성이 정리됐다.

## Known Notes

- 다른 운영 화면보다 개인 프로필 성격이 강하다.

## Related Files

- `src/app/components/portal/CareerProfilePage.tsx`

## Related Tests

- 현재 경력 프로필 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 포털 자기정보 관리 영역으로 따로 봐야 하는 문서다.

## Next Watch Points

- 편집 모드 전환과 저장 흐름이 계속 안정적인지
