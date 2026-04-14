# Portal Cashflow

- route: `/portal/cashflow`
- primary users: PM, projection 입력 담당자
- status: active
- last updated: 2026-04-14

## Purpose

주차별 projection 캐시플로를 입력하고 기존 시트를 가져와 현재 프로젝트 시트에 반영하는 작업 화면이다.

## Current UX Summary

- 기본 화면은 시트 작업면과 가져오기 액션만 먼저 보여준다.
- 형식 설명은 import wizard 안으로 밀고, 상단에는 import action만 남긴다.
- projection 입력/수정은 프로젝트 시트 화면에서 직접 처리한다.

## Current Feature Checklist

- [x] 주차별 projection 시트 입력 가능
- [x] 기존 Google Sheets / `.xlsx` / `.csv` 가져오기 가능
- [x] 상단 explainer 카드 없이 compact import action 유지
- [x] 가져오기 이후 주간 제출 상태와 연결 가능
- [ ] import wizard 내부 안내 문구 추가 감산 여지 있음

## Recent Changes

- [2026-04-14] migration 설명 카드와 긴 형식 안내를 제거하고 compact import action만 남겼다.

## Known Notes

- 이 화면은 actual 분석면이 아니라 projection 운영 입력면이다.
- 가져오기 이후 제출 상태와 admin 캐시플로 추출 화면까지 간접적으로 연결된다.

## Related Files

- `src/app/components/portal/PortalCashflowPage.tsx`
- `src/app/components/cashflow/CashflowProjectSheet.tsx`
- `src/app/routes.tsx`

## Related Tests

- `src/app/components/portal/PortalMinimalSweep.layout.test.ts`
- `src/app/components/cashflow/CashflowProjectSheet.test.tsx`

## Next Watch Points

- import wizard 바깥에 다시 설명 카드가 늘어나지 않는지
- projection 편집과 제출 상태 반영이 계속 같이 움직이는지
