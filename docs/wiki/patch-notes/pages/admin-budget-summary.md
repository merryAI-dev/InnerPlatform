# Admin Budget Summary

- route: `/budget-summary`
- primary users: admin, finance
- status: active
- last updated: 2026-04-14

## Purpose

예산 전체 현황을 요약해 보고, 관련 가져오기/비교/정리 작업으로 이어지는 관리자 화면이다.

## Current UX Summary

- 예산 요약 카드와 표를 본다.
- 관련 가져오기/비교 작업으로 이동한다.

## Current Feature Checklist

- [x] KPI 카드 확인 가능
- [x] 메타 영역 확인 가능
- [x] 예산 테이블 탐색 가능
- [x] 예산 구성 분석 확인 가능
- [x] 업데이트 기록 확인 가능
- [x] 행 상세 dialog 열기 가능
- [x] 예산 정리 작업의 관리자 진입면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-03-26] 메타 영역과 basis 표시 표현이 정리됐다.

## Known Notes

- portal budget과 달리 관리자 관점의 요약 면이다.

## Related Files

- `src/app/components/budget/BudgetSummaryPage.tsx`

## Related Tests

- 현재 예산 요약 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 예산총괄, 구조관리, 가져오기 관련 운영 흐름과 연결된다.

## Next Watch Points

- portal budget과 관리자 예산 요약의 역할 경계가 계속 분명한지
