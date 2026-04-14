# Portal Weekly Expense

- route: `/portal/weekly-expenses`
- primary users: PM, 실무 입력 담당자
- status: active
- last updated: 2026-04-14

## Purpose

통장내역에서 넘어온 거래 초안을 검토하고, 사람 확인이 필요한 값과 수동 입력을 정리한 뒤 저장과 반영까지 마무리하는 핵심 운영 화면이다.

## Current UX Summary

- 현재 탭 단위로 사업비 입력을 이어간다.
- 통장내역 기준본, 현재 탭, 저장 상태를 화면 상단에서 짧게 요약한다.
- 저장 상태, 업로드 반영, 수동 수정, 빠른 입력 등 현재 편집 상태를 함께 보여준다.
- 저장 이후 사람 확인이 남는 후보값은 캐시플로 반영과 분리해 다룬다.

## Current Feature Checklist

- [x] 통장내역 기준본에서 현재 탭 입력으로 이어가기 가능
- [x] 저장 상태, 업로드 반영, 수동 수정 상태 확인 가능
- [x] 저장 후 이동 차단 경고 없이 다른 화면 이동 가능
- [x] 사람 확인 대상과 저장 상태를 분리해 표시
- [x] 별도 미션/가이드 카드 없이 바로 입력 시작 가능
- [x] 상단 정책/하단 중복 요약 bar 없이 헤더 정보만으로 현재 상태 파악 가능
- [x] overwrite/backspace 입력 가능
- [ ] 입력 보조 드롭다운/팝오버 잘림 이슈 완전 해소 확인 필요

## Recent Changes

- [2026-04-14] `현재 정책` 문구와 하단 summary bar를 제거해 헤더 한 곳에서만 상태를 읽도록 정리했다.
- [2026-04-14] 미션/가이드 카드와 `Next Action` 블록을 제거하고 상태 요약만 남겼다.
- [2026-04-10] 저장 후에도 남아 있던 이동 차단 경고를 제거했다.
- [2026-04-10] 자동으로 뜨던 미션/가이드 팝업을 제거해 입력 시작 흐름을 단순화했다.
- [2026-04-10] 상단 흐름 카피를 `통장내역 기준본 → 현재 탭 입력 → 저장/반영` 기준으로 재정리했다.
- [2026-04-10] 사람 입력 필드에서 overwrite/backspace 관련 회귀를 잡고 기본 입력 안정성을 복구했다.

## Known Notes

- 사업비 입력(주간)은 통장내역, submission 상태, 캐시플로 actual 반영까지 여러 화면과 직접 연결된다.
- "사람이 입력해야 하는 필드"의 overwrite/backspace는 반복 회귀 포인트라 다음 변경 시 가장 먼저 확인해야 한다.

## Related Files

- `src/app/components/portal/PortalWeeklyExpensePage.tsx`
- `src/app/components/portal/PortalBankStatementPage.tsx`
- `src/app/routes.tsx`

## Related Tests

- `src/app/components/portal/PortalWeeklyExpensePage.flow-layout.test.ts`
- `src/app/platform/portal-happy-path.test.ts`
- `src/app/platform/weekly-expense-save-policy.test.ts`
- `src/app/platform/bank-import-triage.test.ts`
- `src/app/data/portal-store.integration.test.ts`

## Related QA / Ops Context

- `docs/operations/qa-feedback-memory.md`의 `사업비 입력(주간)` / `증빙` / `표/스크롤/대량편집` 관련 항목과 직접 연결된다.
- 최근 QA에서 overwrite, backspace, 저장 차단 경고, 드롭다운 잘림, 직접작성 사업 진입 문제가 반복되었다.

## Next Watch Points

- 날짜 입력 백스페이스가 다시 전체 삭제로 돌아가지 않는지
- 증빙자료 리스트 입력 필드의 overwrite/backspace 회귀가 없는지
- 직접작성 사업과 통장업로드 사업에서 진입 분기가 다시 어긋나지 않는지
