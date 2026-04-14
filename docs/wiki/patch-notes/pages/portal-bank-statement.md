# Portal Bank Statement

- route: `/portal/bank-statements`
- primary users: PM, 운영 입력 담당자
- status: active
- last updated: 2026-04-14

## Purpose

은행/카드 원본 파일을 업로드하고 거래를 정리한 뒤 사업비 입력(주간)으로 안전하게 이어주는 원본 intake 화면이다.

## Current UX Summary

- 업로드된 원본 거래 건수와 현재 프로젝트 연결 상태를 보여준다.
- 저장된 통장내역을 주간 사업비 기준본으로 두고 바로 다음 화면으로 이어진다.
- 사용자는 이 화면에서 바로 `사업비 입력(주간)` 흐름으로 이어질 수 있어야 한다.

## Current Feature Checklist

- [x] 은행/카드 원본 업로드 가능
- [x] 연결된 거래 건수와 상태 확인 가능
- [x] `사업비 입력(주간)`으로 이어가기 가능
- [x] 별도 queue/wizard 없이 저장 후 바로 주간 사업비 입력으로 이어가기 가능
- [x] 빈 초기 화면은 업로드 CTA와 지원 형식만 보이는 단일 박스로 유지
- [x] 직접작성 사업도 같은 흐름에서 다룰 수 있음
- [x] 환수행, 선사용금, 특이건 보조 액션 없이 기본 표 편집 흐름만 유지
- [ ] 마지막 행 드롭다운 잘림 이슈 완전 해소 확인 필요

## Recent Changes

- [2026-04-14] `신규 거래 처리 Queue` 카드와 queue-first wizard 액션을 제거하고, 통장내역 저장본에서 바로 사업비 입력으로 이어지는 단일 흐름으로 롤백했다.
- [2026-04-14] 환수행, 선사용금, 특이건 보조 행 추가 액션을 현재 operator-facing 화면에서 제외했다.
- [2026-04-14] 빈 초기 화면에서 walkthrough 3단계와 role notice를 제거하고 업로드 박스 하나로 압축했다.
- [2026-04-14] 미션/가이드 카드를 제거하고 원본, queue, 표 중심으로 화면을 정리했다.
- [2026-04-10] 사업비 입력(주간)으로 이어가는 CTA와 설명 문구를 더 직접적으로 정리했다.
- [2026-04-10] intake queue와 연결 상태 표기를 안정화했다.
- [2026-04-10] 주간 입력 화면과의 align이 약했던 상단 흐름 설명을 보완했다.

## Known Notes

- 이 화면은 자체 완결 화면이 아니라 `사업비 입력(주간)`의 기준본 역할을 한다.
- queue-first triage는 QA 반응으로 롤백됐고, 현재는 기준본 저장 후 바로 다음 입력 화면으로 이어지는 것이 기본 원칙이다.

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
- 직접작성 사업에서 버튼 비활성/진입 차단 회귀가 없는지
