# Admin Cashflow Export

- route: `/cashflow`
- primary users: admin, finance, 경영기획실
- status: active
- last updated: 2026-04-14

## Purpose

경영기획실 전용으로 프로젝트별 또는 전체 사업 기준의 projection 캐시플로 workbook을 내려받는 운영툴형 추출 화면이다.

## Current UX Summary

- 범위, 사업, 정산 기준, 기간, 형식을 한 화면에서 고른다.
- 사업별 단건 추출과 전체 사업 일괄 추출을 같은 contract 위에서 다룬다.
- 화면은 분석 대시보드가 아니라 다운로드 중심 운영 surface로 유지한다.
- 권한은 `admin`과 `finance`가 동일하게 `cashflow:export`를 가진다.

## Current Feature Checklist

- [x] 사업별 단건 추출 가능
- [x] 전체 사업 일괄 추출 가능
- [x] 연간 범위 일괄 추출 가능
- [x] 시작월~종료월 기간 지정 가능
- [x] 정산 기준별 필터 가능
- [x] projection만 export
- [x] `admin`과 `finance` 모두 접근 가능
- [ ] actual export 지원

## Recent Changes

- [2026-04-09] browser workbook 생성 대신 server-side export 기준으로 구조를 정리했다.
- [2026-04-09] 화면 명칭을 `경영기획실 전용 캐시플로 추출 화면`으로 바꾸고 운영툴형 단일 화면으로 재편했다.
- [2026-04-09] 정산 기준 필터를 추가해 `공급가액`, `공급대가`, `해당없음` 기준으로 추출 대상을 좁힐 수 있게 했다.
- [2026-04-09] 설명 과잉 영역을 걷어내고 노션형 모노톤 패널 레이아웃으로 정리했다.
- [2026-04-09] 전체 사업 통합 시트 기준으로 projection만 길게 펼쳐지는 workbook 형식으로 맞췄다.

## Known Notes

- 이 화면은 대시보드가 아니라 추출 도구다.
- actual은 추출 대상이 아니며 현재 모든 형식에서 projection만 내려간다.
- 캐시플로 추출 권한은 시스템 전체로 보면 `admin > finance`지만, 이 기능만 놓고 보면 `admin = finance`다.

## Related Files

- `src/app/components/cashflow/CashflowExportPage.tsx`
- `src/app/components/cashflow/CashflowPage.tsx`
- `src/app/platform/admin-nav.ts`
- `server/bff/app.mjs`
- `server/bff/routes/*.mjs`

## Related Tests

- `tests/e2e/admin-cashflow-export.spec.ts`
- `tests/e2e/admin-ops-surface.spec.ts`
- `src/app/platform/cashflow-export.test.ts`
- `src/app/platform/cashflow-export-surface.test.ts`
- `server/bff/cashflow-export.test.mjs`

## Related QA / Ops Context

- 최근 운영 요청에서 색 대비, 드롭다운 화살표 가시성, 정산 기준 필터, wording, 연간/사업별/전체사업 추출 형식 조정이 반복되었다.
- QA보다 운영 요구가 빠르게 들어오는 화면이므로 UI 변경과 export contract 변경을 분리해 기록하는 편이 안전하다.

## Next Watch Points

- `admin`과 `finance` role이 프론트/BFF에서 계속 동일하게 해석되는지
- settlement basis 필터가 workbook 결과와 실제로 일치하는지
- 노션형 모노톤 표면이 다시 다채로운 스타일로 회귀하지 않는지
