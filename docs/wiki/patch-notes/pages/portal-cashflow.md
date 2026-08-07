# Portal Cashflow

- route: `/portal/cashflow`
- primary users: PM, projection 입력 담당자
- status: active
- last updated: 2026-08-06

## Purpose

공식 Google Sheet의 현금흐름 값을 명시적으로 불러와 프로젝트 원장과 결산 상태를 조회하는 작업 화면이다.

## Current UX Summary

- `시트 값 불러오기`를 눌렀을 때만 공식 시트의 최신 표시값을 가져온다.
- 현금흐름 표는 조회 전용이며, 시트의 `미입력`, `0`, 금액을 서로 다른 값으로 유지한다.
- 반영 중에는 화면을 잠그고 완료 또는 복구 결과가 확정될 때까지 진행 상태를 표시한다.

## Current Feature Checklist

- [x] 명시적 버튼으로 Google Sheet 최신값 불러오기
- [x] 시트 표시값을 재계산하지 않고 원장에 반영
- [x] `미입력`, `0`, 금액을 구분해 표시
- [x] 전년도 행별 누적값, 기준연도 주차값, 이후 연도 합계와 Total 표시
- [x] 주간 정산과 월 결산 상태를 표에서 구분
- [x] 결산 이후 변경은 경고·사유·경고 누적 절차로 반영
- [x] 반영 중 화면 잠금과 불확실한 요청 복구 지원
- [x] PM 포털 부팅 시 cashflow 실시간 구독이 연도 범위 composite index에 직접 의존하지 않음

## Recent Changes

- [2026-07-24] 이전 형식의 월 결산 기록에 주차 합계 블록이 없어도 현금흐름 화면 전체가 중단되지 않고, 저장된 행 값으로 합계를 표시하도록 복구했다.
- [2026-08-06] 상단 프로젝트 선택을 바꾼 뒤에도 이전 프로젝트의 시트 반영 상태가 남아 보이던 문제를 수정했다. 시트 연동 화면은 URL·선택 프로젝트·BFF 요청을 같은 프로젝트 ID로 맞추고, 전환 시 이전 프로젝트의 반영 복구 모달과 임시 시트 상태를 비운다.
- [2026-08-06] 조직장 선택 목록은 현재 요청자만 제외한다. 다른 사용자가 지정하는 경우에는 프로젝트 등록자 또는 담당자도 활성 구성원이면 조직장으로 선택할 수 있다.
- [2026-07-24] 공식 시트의 계산 결과를 그대로 고정하는 one-way 연동으로 정리했다. `미입력`, `0`, 금액과 전년도 행별 이월값을 보존하고, 결산된 월의 값이 달라지면 서버가 사유와 경고 누적을 요구한다. 시트 반영과 월 결산이 겹칠 때는 한쪽이 미완료 데이터를 읽지 않도록 차단하며, 중단된 반영은 서버 상태를 기준으로 복구한다.
- [2026-04-14] migration 설명 카드와 긴 형식 안내를 제거하고 compact import action만 남겼다.
- [2026-04-15] PM용 cashflow 주차 구독은 Firestore에서 project 기준으로만 listen하고, 연도 범위는 클라이언트에서 필터링하도록 바꿔 PM 포털 전체가 cashflow index drift에 덜 민감하게 만들었다.

## Known Notes

- 시트가 입력 원본이고 MYSCube는 반영된 고정본과 결산 증거를 관리한다.
- 연간 합계와 잔액도 시트 표시값을 사용하며 플랫폼에서 다시 계산하지 않는다.

## Related Files

- `src/app/components/portal/PortalCashflowPage.tsx`
- `src/app/components/cashflow/CashflowProjectSheet.tsx`
- `src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.tsx`
- `server/bff/routes/cashflow-sheet-lab.mjs`
- `src/app/routes.tsx`
- `src/app/platform/portal-project-selection.ts`

## Related Tests

- `src/app/components/portal/PortalMinimalSweep.layout.test.ts`
- `src/app/components/cashflow/CashflowProjectSheet.shell.test.ts`
- `src/app/features/cashflow-sheet-compare/CashflowSheetLabPage.shell.test.ts`
- `src/app/platform/portal-project-selection.test.ts`
- `server/bff/routes/cashflow-sheet-lab.test.mjs`

## Next Watch Points

- 실제 Stage 시트에서 `미입력`, `0`, 금액과 의도적으로 잘못된 수식 결과가 그대로 고정되는지
- 월 결산과 시트 반영을 동시에 실행해도 미완료 revision이 대시보드에 노출되지 않는지
