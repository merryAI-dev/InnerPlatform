# Portal Training

- route: `/portal/training`
- primary users: PM, 구성원
- status: active
- last updated: 2026-04-14

## Purpose

포털 사용자가 사내 교육 목록을 보고 신청/참여 상태를 확인하는 화면이다.

## Current UX Summary

- 탭 기반으로 전체 강의와 내 강의를 나눠 본다.
- 강의 카드와 버튼 중심으로 상호작용한다.

## Current Feature Checklist

- [x] 이수 완료/수강 중/개설 강의 KPI 확인 가능
- [x] 강의 검색 가능
- [x] 카테고리/필수교육 필터 가능
- [x] 전체 강의/내 수강 탭 전환 가능
- [x] 수강 신청 confirm dialog 사용 가능
- [x] 신청/이수 상태 배지 확인 가능
- [x] 포털 교육 화면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- 관리자 교육 관리와 사용자 교육 참여는 별도 문서로 관리한다.

## Related Files

- `src/app/components/portal/PortalTrainingPage.tsx`

## Related Tests

- 현재 포털 교육 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 교육 운영 정책 변화 시 admin training과 같이 본다.

## Next Watch Points

- 탭 구조와 강의 상태 라벨이 계속 분명한지
