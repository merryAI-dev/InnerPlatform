# Admin Training Manage

- route: `/training`
- primary users: admin, 교육 운영 담당자
- status: active
- last updated: 2026-04-14

## Purpose

사내 교육 과정을 등록하고 운영 상태를 관리하는 관리자 화면이다.

## Current UX Summary

- 강의 등록 dialog와 목록 관리가 함께 있다.
- 교육 운영 상태를 보면서 등록/수정한다.

## Current Feature Checklist

- [x] 강의 검색 가능
- [x] 강의 등록 가능
- [x] 기간/강사 validation 확인 가능
- [x] 교육 현황 KPI 확인 가능
- [x] 리스트 탐색 가능
- [x] portal training/career profile과 데이터 일관성 확인 가능
- [x] 관리자 교육 관리 화면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- portal training과는 달리 운영자 측 관리 기능이 중심이다.

## Related Files

- `src/app/components/training/TrainingManagePage.tsx`

## Related Tests

- 현재 교육 관리 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 사내 교육 운영 정책이 바뀌면 portal training과 같이 봐야 한다.

## Next Watch Points

- 강의 등록 dialog와 목록 상태가 계속 일치하는지
