# Portal Personnel

- route: `/portal/personnel`
- primary users: PM
- status: active
- last updated: 2026-04-14

## Purpose

포털 사용자가 자기 사업의 참여인력 상태를 보고, 변경 요청 흐름으로 이어지는 화면이다.

## Current UX Summary

- 인력 현황을 요약해서 본다.
- 필요 시 변경 요청 화면으로 이동한다.

## Current Feature Checklist

- [x] 사업 미선택 guard 반영
- [x] 현재 사업 인력 목록 표시 가능
- [x] 역할/상태 배지 확인 가능
- [x] 인력 없음 empty state 확인 가능
- [x] 프로젝트 설정 화면으로 이동 가능
- [x] 변경 요청 화면으로 이동 가능
- [x] 포털 인력 현황 화면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- 관리자 인력 화면보다 사용자 안내와 요청 연결이 중심이다.

## Related Files

- `src/app/components/portal/PortalPersonnel.tsx`

## Related Tests

- 현재 포털 인력 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- change-requests와 직접 연결되는 문서다.

## Next Watch Points

- 인력 현황과 변경 요청 진입선이 계속 명확한지
