# Admin Bank Reconciliation

- route: `/bank-reconciliation`
- primary users: admin, finance
- status: active
- last updated: 2026-04-14

## Purpose

은행 내역과 시스템 정산 데이터를 대사하고, 미매칭 항목을 정리하는 관리자 화면이다.

## Current UX Summary

- 업로드한 내역을 기준으로 자동 매칭/미매칭 상태를 본다.
- 개별 행을 검토하고 정리한다.

## Current Feature Checklist

- [x] 통장내역 업로드 가능
- [x] 프로젝트/상태 필터 가능
- [x] 매칭 KPI 확인 가능
- [x] 미매칭 항목 검토 가능
- [x] 개별 행 정리 가능
- [x] 대조 상태별 목록 확인 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-03-26] 업로드 후 행 삭제 버튼이 추가됐다.

## Known Notes

- 변경 이력은 상대적으로 적지만 독립 운영면으로 가치가 높다.

## Related Files

- `src/app/components/cashflow/BankReconciliationPage.tsx`

## Related Tests

- `src/app/platform/bank-reconciliation.test.ts`
- `src/app/platform/bank-import-cashflow.test.ts`

## Related QA / Ops Context

- 은행 원본과 캐시플로/정산 결과가 맞지 않을 때 보는 관리자용 확인면이다.

## Next Watch Points

- 업로드 후 개별 행 정리 동작이 계속 유지되는지
