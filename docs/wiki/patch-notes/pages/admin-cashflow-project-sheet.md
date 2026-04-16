# Admin Cashflow Project Sheet

- route: `/cashflow/projects/:projectId`
- primary users: admin, finance, 사업 운영 검토자
- status: active
- last updated: 2026-04-14

## Purpose

개별 사업의 projection, actual, compare, 제출/마감, 엑셀 export를 다루는 상세 캐시플로 작업 화면이다.

## Current UX Summary

- 월별 projection과 actual 비교, compare mode, 제출/마감 흐름이 한 화면에 모인다.
- 주간 accounting snapshot과 audit trail이 화면 해석의 근거가 된다.
- dirty state와 close 정책이 강하게 엮여 있어 변경 영향 범위가 넓다.

## Current Feature Checklist

- [x] 사업별 projection 확인 가능
- [x] actual과 compare mode 확인 가능
- [x] 제출 및 마감 흐름 처리 가능
- [x] dirty state 경고와 저장 차단 정책 존재
- [x] 주간 accounting snapshot과 audit trail 확인 가능
- [x] project 단위 export 흐름과 연결됨
- [x] admin 주간 마감은 `/api/v1/cashflow/weeks/close` command boundary를 통해 server-owned close path를 사용함

## Recent Changes

- [2026-04-16] admin 주간 마감이 `closeWeekAsAdmin` direct write path 대신 `/api/v1/cashflow/weeks/close` BFF command를 통하도록 옮겼다. `CashflowProjectSheet`는 command 결과를 store에 apply하고, dev harness와 client contract도 같은 응답 shape로 잠갔다.
- [2026-04-09] admin export 흐름과 project sheet의 workbook contract를 더 밀접하게 맞췄다.
- [2026-04-05] lazy heavy module 로딩 안정화를 넣었다.
- [2026-04-04] compare mode, guide preview, weekly accounting snapshot, audit trail, soft gate를 강화했다.
- [2026-03-18] close 흐름을 projection 기준으로 옮기고 settlement close 이후 projection 수정 허용으로 바꿨다.

## Known Notes

- 이 화면은 admin cashflow export와 별개가 아니라 같은 데이터 해석 체계 위에 있다.
- compare/close/dirty blocking 정책은 운영 규칙 변경 시 가장 먼저 영향을 받는다.

## Related Files

- `src/app/components/cashflow/CashflowProjectSheet.tsx`
- `src/app/components/cashflow/ProjectCashflowSheetPage.tsx`
- `src/app/components/cashflow/SettlementLedgerPage.tsx`
- `src/app/routes.tsx`

## Related Tests

- `src/app/components/cashflow/cashflow-unsaved.test.ts`
- `src/app/platform/cashflow-sheet.test.ts`
- `src/app/platform/weekly-accounting-state.test.ts`
- `src/app/platform/__tests__/settlement-e2e-scenarios.test.ts`

## Related QA / Ops Context

- projection 저장, close 정책, dirty blocking, guide preview는 운영팀 질문이 다시 생기기 쉬운 포인트다.

## Next Watch Points

- compare mode와 close 정책이 export contract와 다시 어긋나지 않는지
- dirty blocking이 정상 저장 이후에도 남지 않는지
- weekly snapshot과 audit trail이 projection/actual 해석과 계속 일치하는지
