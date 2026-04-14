# Admin Payroll

- route: `/payroll`
- primary users: admin, finance, 급여 운영 담당자
- status: active
- last updated: 2026-04-14

## Purpose

급여 관련 운영 상태를 보고 확인/마감 조치를 수행하는 관리자 화면이다.

## Current UX Summary

- PageHeader와 카드, 탭으로 급여 상태를 본다.
- 확인/인정/마감 액션을 버튼으로 수행한다.

## Current Feature Checklist

- [x] payroll/monthly 탭 전환 가능
- [x] 유동성 위험 queue 확인 가능
- [x] 프로젝트별 인건비 상태 확인 가능
- [x] 인건비 사용내역 dialog 열기 가능
- [x] 지급 확정 처리 가능
- [x] 월간 정산 완료 처리 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-06] liquidity risk queue가 추가됐다.

## Known Notes

- portal payroll과 비슷한 도메인이지만 관리자 승인/운영 조치가 중심이다.

## Related Files

- `src/app/components/payroll/AdminPayrollPage.tsx`

## Related Tests

- 현재 관리자 급여 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 월 마감/급여 확인 요청이 들어오면 portal 쪽과 같이 본다.

## Next Watch Points

- 급여 확인과 월 마감 액션이 실제 운영 정책과 계속 맞는지
