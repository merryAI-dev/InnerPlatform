# Portal Bank Statement

- route: `/portal/bank-statements`
- primary users: PM, 운영 입력 담당자
- status: active
- last updated: 2026-04-14

## Purpose

은행/카드 원본 파일을 업로드하고 거래를 정리한 뒤 사업비 입력(주간)으로 안전하게 이어주는 원본 intake 화면이다.

## Current UX Summary

- 업로드된 원본 거래 건수와 현재 프로젝트 연결 상태를 보여준다.
- intake queue에서 분류, 검토, 증빙 continuation이 필요한 거래를 분리해 다룬다.
- 사용자는 이 화면에서 바로 `사업비 입력(주간)` 흐름으로 이어질 수 있어야 한다.

## Recent Changes

- [2026-04-10] 사업비 입력(주간)으로 이어가는 CTA와 설명 문구를 더 직접적으로 정리했다.
- [2026-04-10] intake queue와 연결 상태 표기를 안정화했다.
- [2026-04-10] 주간 입력 화면과의 align이 약했던 상단 흐름 설명을 보완했다.

## Known Notes

- 이 화면은 자체 완결 화면이 아니라 `사업비 입력(주간)`의 기준본 역할을 한다.
- 거래 분류와 cashflow 항목 매핑이 이후 주간 입력과 submission 상태에 모두 영향을 준다.

## Related Files

- `src/app/components/portal/PortalBankStatementPage.tsx`
- `src/app/components/portal/PortalWeeklyExpensePage.tsx`
- `src/app/routes.tsx`

## Related Tests

- `src/app/platform/bank-statement.test.ts`
- `src/app/platform/bank-html-parser.test.ts`
- `src/app/platform/bank-import-triage.test.ts`
- `src/app/platform/bank-intake-surface.test.ts`

## Related QA / Ops Context

- `docs/operations/qa-feedback-memory.md`의 `통장내역`, `사업비 입력(주간)`, `증빙/드라이브` 관련 QA와 직접 연결된다.
- 최근 QA에서 마지막 행 드롭다운 잘림, cashflow 항목 선택 난이도, 직접작성 사업의 진입 문제 제기가 있었다.

## Next Watch Points

- 마지막 행의 드롭다운/팝오버가 잘리지 않는지
- 신규 거래 queue의 cashflow 항목이 기존 입력 화면과 용어 충돌이 없는지
- 직접작성 사업에서 버튼 비활성/진입 차단 회귀가 없는지
