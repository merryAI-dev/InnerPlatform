# Portal Payroll

- route: `/portal/payroll`
- primary users: PM, 급여 확인 담당자
- status: active
- last updated: 2026-04-14

## Purpose

포털 사용자가 급여 관련 상태를 확인하고 인정/마감 전 확인 작업을 수행하는 화면이다.

## Current UX Summary

- PageHeader와 카드로 급여 상태를 본다.
- 급여 확인과 월 마감 인정 액션이 제공된다.

## Current Feature Checklist

- [x] 지급일 등록/저장 가능
- [x] 지급 창 D-3~D+3 liquidity 상태 확인 가능
- [x] 잔액 부족/지급 미확인 등 위험 배지 확인 가능
- [x] 인건비 지급 확인 처리 가능
- [x] 월간정산 확인 처리 가능
- [x] 통장내역/주간사업비로 이동 가능
- [x] 포털 관점 급여 운영 화면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-06] liquidity risk queue가 포털에도 연결됐다.

## Known Notes

- admin payroll과 같은 도메인이지만 사용자 관점 확인 flow가 중심이다.

## Related Files

- `src/app/components/portal/PortalPayrollPage.tsx`

## Related Tests

- 현재 포털 급여 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 급여 확인과 월 마감 운영 요청에 직접 연결된다.

## Next Watch Points

- 포털과 관리자 급여 화면의 역할 경계가 계속 분명한지
