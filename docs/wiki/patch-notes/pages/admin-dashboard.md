# Admin Dashboard

- route: `/`
- primary users: admin, finance, 운영 리더
- status: active
- last updated: 2026-04-14

## Purpose

관리자 공간의 첫 진입 화면으로, 전반적인 운영 상태를 요약하고 주요 작업면으로 이동시키는 허브다.

## Current UX Summary

- 핵심 상태 카드와 검증/안내 패널을 한 화면에서 본다.
- 프로젝트, 승인, 정산, 설정 같은 주요 작업면으로 빠르게 이동한다.

## Current Feature Checklist

- [x] 전반적인 운영 현황 요약 확인 가능
- [x] 주요 작업면으로 빠른 이동 가능
- [x] 승인/증빙/반려/캐시플로/참여율 alert strip 확인 가능
- [x] HR 알림 패널 확인 가능
- [x] 인건비 notice 및 liquidity risk surface 확인 가능
- [x] validation summary 확인 가능
- [x] 관리자 첫 진입 허브로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-06] payroll liquidity risk surface와 guided onboarding 계열 연결이 강화됐다.

## Known Notes

- 이 문서는 개별 기능보다는 운영 허브 성격이 강하다.

## Related Files

- `src/app/components/dashboard/DashboardPage.tsx`

## Related Tests

- 현재 대시보드 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 여러 운영 화면으로 퍼지는 허브라 링크 구조가 바뀌면 다른 화면 문서도 같이 봐야 한다.

## Next Watch Points

- 대시보드 링크와 실제 라우트 연결이 계속 맞는지
