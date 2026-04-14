# Portal Budget

- route: `/portal/budget`
- primary users: PM, 예산 구조 관리 담당자
- status: active
- last updated: 2026-04-14

## Purpose

예산 총괄, 비목/세목 구조, 가져오기 미리보기와 반영을 관리하는 포털 예산 운영 화면이다.

## Current UX Summary

- 예산총괄 가져오기 모달에서 미리보기 후 반영한다.
- 긴 모달과 구조 편집 다이얼로그는 내부 스크롤이 끊기지 않아야 한다.
- 구조 저장은 잘못된 code book 상태를 막는 보호 로직 위에서 이뤄진다.

## Recent Changes

- [2026-04-13] 예산총괄 가져오기 안내 텍스트 겹침을 수정했다.
- [2026-04-10] 긴 포털 모달의 내부 스크롤을 복구했다.
- [2026-04-10] 잘못된 budget code book 저장을 차단했다.
- [2026-04-04] AI 보조 예산 가져오기 가이드를 추가했다.

## Known Notes

- 긴 안내 텍스트, 미리보기 표, 구조 편집 폼이 한 모달에 모여 있어 레이아웃 회귀가 잦다.
- 스크롤과 줄바꿈은 기능 자체보다 먼저 무너지기 쉬운 운영 품질 포인트다.

## Related Files

- `src/app/components/portal/PortalBudget.tsx`
- `src/app/components/portal/PortalDialogs.tsx`
- `src/app/routes.tsx`

## Related Tests

- `src/app/components/portal/PortalBudget.import-layout.test.ts`
- `src/app/platform/budget-plan-import.test.ts`
- `src/app/platform/budget-import-ai.test.ts`
- `src/app/platform/budget-code-book-validation.test.ts`

## Related QA / Ops Context

- 최근 QA에서 안내 텍스트 겹침, 구조관리 스크롤 부재, 예산총괄 가져오기 레이아웃 가독성 문제가 반복됐다.

## Next Watch Points

- 긴 문장 안내가 다시 겹치지 않는지
- 구조관리 모달과 가져오기 모달에서 내부 스크롤이 계속 동작하는지
- code book validation이 너무 공격적으로 정상 저장까지 막지 않는지
