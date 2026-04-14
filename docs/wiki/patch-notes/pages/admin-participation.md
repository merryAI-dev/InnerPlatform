# Admin Participation

- route: `/participation`
- primary users: admin, 인력 투입률 관리 담당자
- status: active
- last updated: 2026-04-14

## Purpose

참여인력과 투입률을 보고 편집하고, 관련 운영 정책을 반영하는 관리자 화면이다.

## Current UX Summary

- 탭과 카드 기반으로 참여인력 현황을 본다.
- 참여인력 추가/수정 관련 dialog를 사용한다.

## Current Feature Checklist

- [x] KPI와 danger/warning 카드 확인 가능
- [x] 인원별/사업별/교차검증 탭 전환 가능
- [x] 이름/사업 검색 가능
- [x] 멤버 상세 dialog 확인 가능
- [x] 위험 리포트 다운로드 가능
- [x] 과투입 경고 확인 가능
- [x] 프로젝트 운영 기준으로 인력 배치 관리 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- 사업 등록과 personnel-change 흐름과 함께 보는 경우가 많다.

## Related Files

- `src/app/components/participation/ParticipationPage.tsx`

## Related Tests

- 현재 참여인력 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 참여인력/인력투입률 관련 운영 요청이 들어올 때 기준 화면이다.

## Next Watch Points

- 참여인력 편집 dialog와 목록 상태가 계속 일치하는지
