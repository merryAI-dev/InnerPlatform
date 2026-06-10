# Portal Weekly Expense

- route: `/portal/weekly-expenses`
- primary users: PM, 실무 입력 담당자
- status: active
- last updated: 2026-06-10

## Purpose

통장내역에서 넘어온 거래와 서버가 확정한 주간 사업비 원장을 조회하고, 수정/생성은 별도 위자드로 보내는 핵심 운영 화면이다.

## Current UX Summary

- 현재 탭 단위로 사업비 원장을 조회한다.
- 통장내역 기준본, 현재 탭, 저장 상태를 화면 상단에서 짧게 요약한다.
- 원장 화면에서는 `작성자` 컬럼 위치를 행 선택 체크박스로 대체한다.
- 확정된 행은 직접 수정하지 않고, 선택 행 정정 위자드에서 모든 값을 수정한 뒤 새 행으로 append한다.
- 정정 위자드의 빨간색 표시는 저장 전 임시 상태에서만 보이고, 저장된 원장에는 별도 정정 배지를 남기지 않는다.

## Current Feature Checklist

- [x] 통장내역 기준본에서 현재 탭 원장 조회로 이어가기 가능
- [x] 저장 상태, 업로드 반영, 수동 수정 상태 확인 가능
- [x] 사업비 입력(주간)은 view-only ledger로 고정
- [x] 금액/분류/지급정보 생성·수정은 위자드 경로로만 처리
- [x] 선택 행 정정은 기존 행 mutate가 아니라 새 원장 행 append로 처리
- [x] 작성자 컬럼 UI는 원장 조회 화면에서 행 선택 체크박스로 대체
- [x] `통장잔액`/`통장에 찍힌 입/출금액` 드래그 선택 시 금액 합계 표시
- [x] 미저장 편집이 있으면 화면 이동 전 확인 다이얼로그로 차단 가능
- [x] 저장 후 검토 루프/원본/검토 배지 없이 원장 값만 표시
- [x] 별도 미션/가이드 카드 없이 바로 입력 시작 가능
- [x] 상단 정책/하단 중복 요약 bar 없이 헤더 정보만으로 현재 상태 파악 가능
- [x] overwrite/backspace 입력 가능
- [x] 통장내역 저장본에서 queue-first wizard 없이 바로 주간 입력으로 이어가기 가능
- [x] 통장내역 선택 반영 위자드에서 확정된 행만 주간 사업비 원장에 들어옴
- [x] PM 포털 safe fetch 모드에서도 주간 입력 화면 부팅 가능
- [x] `v2` 프로젝트에서 세세목 dropdown과 tree 기반 2단 예산 목록 사용 가능
- [ ] 입력 보조 드롭다운/팝오버 잘림 이슈 완전 해소 확인 필요

## Recent Changes

- [2026-06-10] 사업비 입력 원장에서 `통장잔액` 또는 `통장에 찍힌 입/출금액` 셀을 드래그 선택하면 좌측 하단에 `금액 합계`를 표시하도록 했다. 선택 영역에 두 금액 컬럼이 섞여 있어도 해당 컬럼의 숫자 셀만 합산한다.
- [2026-06-10] 사업비 입력(주간)의 `작성자` 컬럼 UI를 행 선택 체크박스로 바꾸고, 선택 행은 정정 위자드에서 모든 값을 수정한 뒤 새 행으로 append하도록 했다. 기존 반영완료 행은 직접 mutate하지 않는다.
- [2026-06-10] 정정 위자드의 빨간 강조는 저장 전 임시 상태에서만 보이게 하고, 저장 후 원장에는 정정/검토/원본 배지를 남기지 않는다.
- [2026-06-10] 주간 사업비 원장 저장과 통장내역 반영 뒤 cashflow actual read model을 즉시 sync해, 캐시플로 화면이 기존 static actual을 계속 물고 있지 않게 했다.
- [2026-06-10] 증빙 업로드 경로가 Google Workspace access helper를 Auth store에서 명시적으로 받도록 복구해, stage 주간 사업비 화면의 `ensureGoogleWorkspaceAccess is not defined` 런타임 크래시를 막았다.
- [2026-06-10] 사업비 입력(주간)을 view-only ledger로 고정했다. 원장 셀 직접 편집, 행 추가/삭제, 작성본 업로드, 저장/되돌리기, 대량 셀 비우기 같은 mutation 액션은 주간 화면에서 숨기고, 생성/수정은 위자드 경로에서만 처리하도록 `SettlementLedgerPage`/`ImportEditor`에 read-only 모드를 추가했다.
- [2026-06-10] 주간 사업비 화면을 원래 원장 입력 항목 중심으로 복구하고, 통장내역 선택 반영 위자드에서 확정된 행만 들어오도록 경계를 고정했다. 주간 화면은 입력/저장/이동만 담당하고, 저장 결과 비교는 캐시플로 화면에서 확인하도록 문구와 배너를 정리했다.
- [2026-06-10] 통장내역 기준본 저장만으로 주간 사업비 행이 자동 생성되지 않도록 handoff 정책을 분리했다. 주간 사업비에는 통장내역 화면에서 사용자가 선택해 반영한 거래만 들어온다.
- [2026-06-10] QA 중 셀 편집을 방해하던 주간 사업비 자동 저장을 끄고 수동 저장만 사용하도록 바꿨다. 저장 버튼 경로는 유지하되 idle autosave와 자동 cashflow sync는 실행하지 않는다.
- [2026-04-21] `v2` 프로젝트에서는 사업비 입력이 `budget_tree_v2` 기준 세세목 dropdown을 쓰고, 2단 목록도 tree 파생값을 우선 사용하도록 정리했다.
- [2026-04-14] 포털 session active project 전환과 함께 현재 사업 기준 입력 상태 요약과 진행 step strip을 안정적으로 다시 연결했다.
- [2026-04-15] 통장내역 저장 직후 신규 은행 행이 현재 주간 사업비 탭에 바로 나타나도록 연결했다. 별도 Queue나 triage wizard 없이 이 화면에서 바로 편집을 이어간다.
- [2026-04-15] PM 역할에서는 portal store가 주요 운영 데이터를 realtime listen 대신 safe fetch로 초기 로딩해, 포털 부팅 중 반복 Listen 400이 사업비 입력 화면까지 흔드는 구조를 줄였다.
- [2026-04-14] 미처리 거래 queue strip과 triage wizard 진입을 제거하고, 통장내역 저장본에서 바로 현재 탭 입력으로 이어가는 흐름으로 롤백했다.
- [2026-04-14] 미저장 편집이 남은 상태에서 통장내역이나 사이드바로 이동하면 확인 다이얼로그를 띄우도록 복구했다.
- [2026-04-14] bank import triage wizard의 cashflow category 선택값을 정리하고, fullscreen wizard와 주간 입력 화면 간 회귀 E2E를 다시 통과시켰다.
- [2026-04-14] `현재 정책` 문구와 하단 summary bar를 제거해 헤더 한 곳에서만 상태를 읽도록 정리했다.
- [2026-04-14] 미션/가이드 카드와 `Next Action` 블록을 제거하고 상태 요약만 남겼다.
- [2026-04-10] 저장 후에도 남아 있던 이동 차단 경고를 제거했다.
- [2026-04-10] 자동으로 뜨던 미션/가이드 팝업을 제거해 입력 시작 흐름을 단순화했다.
- [2026-04-10] 상단 흐름 카피를 `통장내역 기준본 → 현재 탭 입력 → 저장/반영` 기준으로 재정리했다.
- [2026-04-10] 사람 입력 필드에서 overwrite/backspace 관련 회귀를 잡고 기본 입력 안정성을 복구했다.

## Known Notes

- 사업비 입력(주간)은 통장내역 선택 반영과 submission 상태에 연결되지만, Projection/Actual 조회·비교 UI는 캐시플로 화면에서만 담당한다.
- 사업비 입력(주간)은 DB 원장 조회 화면이다. 금액, 분류, 지급정보, 직접 입력 행 생성은 위자드에서만 처리한다.
- 확정 행 정정은 원장 행 update가 아니라 새 row append다. 기존 행은 감사/대조 기준으로 보존한다.
- "사람이 입력해야 하는 필드"의 overwrite/backspace 회귀는 향후 위자드 입력면에서 확인한다.

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
