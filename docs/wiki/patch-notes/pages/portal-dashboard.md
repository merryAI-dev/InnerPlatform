# Portal Dashboard

- route: `/portal`
- primary users: PM, 포털 사용자
- status: active
- last updated: 2026-04-14

## Purpose

포털 첫 진입 화면으로, 내 사업 상태와 공지, 다음 작업으로의 이동을 안내하는 허브다.

## Current UX Summary

- 연결된 사업 상태를 요약한다.
- 공지와 빠른 이동 버튼으로 다음 작업을 안내한다.

## Current Feature Checklist

- [x] 사업 미배정 empty state 확인 가능
- [x] `/portal/project-settings` 이동 가능
- [x] 중요 공지에서 인건비/월간정산 확인 처리 가능
- [x] HR 알림에서 `/portal/change-requests` 이동 가능
- [x] 인건비 지급 queue 카드에서 상세/통장내역 이동 가능
- [x] 미션 가이드 모달과 KPI/빠른 액션 사용 가능

## Recent Changes
- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-06] 미션 가이드가 modal flow로 이동했고 payroll liquidity surface가 추가됐다.

## Known Notes

- 사업이 아직 연결되지 않은 사용자에게는 다른 진입 메시지를 보여준다.

## Related Files

- `src/app/components/portal/PortalDashboard.tsx`

## Related Tests

- 현재 포털 대시보드 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 포털 첫 진입 UX가 바뀌면 onboarding과 project-settings도 같이 봐야 한다.

## Next Watch Points

- 연결 전/후 상태별 안내가 계속 적절한지
