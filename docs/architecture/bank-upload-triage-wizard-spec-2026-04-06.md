# Bank Upload Triage Wizard Spec

## Goal

통장내역 업로드가 `사업비 입력(주간)` 전체 시트를 직접 덮어쓰지 않도록 바꾸고, 신규 거래와 검토 필요 거래만 wizard modal에서 처리한 뒤에만 주간 정산 projection에 반영한다. 목표는 업로드를 반복해도 사람이 입력한 값이 날아가지 않는, 신뢰받는 외부형 SaaS 수준의 정산 입력 UX다.

## Problem

현재는 [portal-store.tsx](/Users/boram/InnerPlatform/src/app/data/portal-store.tsx)의 `saveBankStatementRows()`가 업로드 직후 [bank-statement.ts](/Users/boram/InnerPlatform/src/app/platform/bank-statement.ts)의 `mergeBankRowsIntoExpenseSheet()`를 통해 `expense_sheets`를 직접 갱신한다. 기존 병합은 `sourceTxId -> date|counterparty -> index fallback` 순서를 써서, 통장 내역 순서 변경 시 사람이 입력한 기존 row와 잘못 결합될 수 있다. 결과적으로 신규 건과 기존 처리 건이 뒤섞이고, 사람이 쓴 값이 날아갈 수 있다.

## Product Principles

- Human input is sacred: `사업비 사용액`, `비목`, `세목`, `cashflow항목`, `메모`, `증빙 완료 상태`는 재업로드가 절대 덮지 않는다.
- Upload is additive or upsert, never destructive: 업로드는 신규 거래 추가와 기존 은행 거래 원본 업데이트만 한다.
- Order must not matter: row number, row index, 업로드 순서는 식별 기준이 아니다.
- Wizard is for decisions, not spreadsheets: wizard는 사람이 실제로 입력해야 하는 필드만 묻고, 전체 그리드는 예외 수정 화면으로 남긴다.
- Evidence is encouraged, not a reflection blocker: 필드 입력 완료면 즉시 주간 반영하고, 증빙은 같은 루프에서 이어서 처리하되 blocker로 쓰지 않는다.

## Scope

### In scope

- 통장내역 업로드 후 신규/검토 필요 거래만 다루는 `triage wizard modal`
- 은행 업로드용 stable identity/fingerprint 설계
- `expense_intake` persisted state 도입
- wizard에서 입력 완료된 거래만 `expense_sheets` projection에 upsert
- 증빙 업로드를 wizard 내 secondary section으로 통합
- 기존 weekly grid를 예외 수정 화면으로 재포지셔닝

### Out of scope

- Spring/Postgres 전환
- 전체 transaction system의 즉시 전면 교체
- `ImportEditor` 제거
- 증빙 completeness를 제출 전 강제하는 정책 변경

## Current Code Constraints

- `expense_sheets`는 이미 [portal-store.tsx](/Users/boram/InnerPlatform/src/app/data/portal-store.tsx)에서 persisted UI projection으로 쓰인다.
- `ImportRow`는 [settlement-csv.ts](/Users/boram/InnerPlatform/src/app/platform/settlement-csv.ts)에 정의되어 있고 `sourceTxId`, `entryKind`, `reviewStatus`, `userEditedCells`를 이미 보유한다.
- 증빙 업로드 흐름은 [PortalWeeklyExpensePage.tsx](/Users/boram/InnerPlatform/src/app/components/portal/PortalWeeklyExpensePage.tsx), [ImportEditor.tsx](/Users/boram/InnerPlatform/src/app/components/cashflow/ImportEditor.tsx), [evidence-upload-flow.ts](/Users/boram/InnerPlatform/src/app/platform/evidence-upload-flow.ts)에 이미 존재한다.
- 1차 목표는 업로드 시 `bank_statements/default`와 `expense_sheets/{activeSheetId}`를 같이 쓰는 현재 결합을 끊는 것이다.

## Proposed Architecture

### 1. Bank upload authority

각 bank row를 canonical identity로 정규화한다.

- `bankFingerprint = stableHash(account + dateTime + signedAmount + balanceAfter + normalizedCounterparty + normalizedMemo)`
- `sourceTxId = bank:${bankFingerprint}`

동일 거래는 fingerprint와 persisted identity로만 판단한다. row order는 쓰지 않는다.

### 2. Intake layer between upload and weekly projection

새 persisted entity:

- `BankImportIntakeItem`

권장 경로:

- `projects/{projectId}/expense_intake/{bankFingerprint}`

핵심 필드:

- `id`
- `projectId`
- `sourceTxId`
- `bankFingerprint`
- `bankSnapshot`
- `matchState`
- `projectionStatus`
- `evidenceStatus`
- `manualFields`
- `existingExpenseSheetId`
- `existingExpenseRowTempId`
- `reviewReasons`
- `lastUploadBatchId`
- `createdAt`
- `updatedAt`
- `updatedBy`

`expense_intake`는 업로드 후 triage state, `expense_sheets`는 사용자용 projection이다.

### 3. Match state

- `AUTO_CONFIRMED`
- `PENDING_INPUT`
- `REVIEW_REQUIRED`
- `IGNORED`

### 4. Projection status

- `NOT_PROJECTED`
- `PROJECTED`
- `PROJECTED_WITH_PENDING_EVIDENCE`

## Manual vs bank-origin fields

### Bank-origin fields

재업로드 시 갱신 가능:

- 거래일시
- 지급처
- 적요/원본 메모
- 통장 입출금액
- 통장잔액

### Manual fields

재업로드 시 절대 덮지 않음:

- 사업비 사용액
- 비목
- 세목
- cashflow항목
- 사용자 메모
- 수동 증빙 분류/확정

manual fields는 먼저 `expense_intake.manualFields`에 저장하고, wizard 완료 시 projection한다.

## Upload Flow

1. 사용자가 [PortalBankStatementPage.tsx](/Users/boram/InnerPlatform/src/app/components/portal/PortalBankStatementPage.tsx) 에서 통장 엑셀 업로드
2. 시스템이 row 정규화와 fingerprint 계산
3. `bank_statements/default` 저장
4. 각 row별로 `expense_intake/{fingerprint}` upsert
5. `expense_sheets`는 직접 replace하지 않음
6. 업로드 결과 요약:
   - 자동 반영됨
   - 신규 입력 필요
   - 검토 필요
7. `신규 입력 필요 + 검토 필요`가 있으면 wizard modal 제안 또는 자동 오픈

## Wizard Flow

wizard는 `PENDING_INPUT`, `REVIEW_REQUIRED`만 보여준다. `AUTO_CONFIRMED`는 올리지 않는다.

### Layout

- full page 이동이 아니라 `large sheet/modal`
- 좌측 rail: queue, 진행 상태, 상태 배지
- 우측 panel:
  - 은행 원본 정보
  - 필수 입력 필드
  - 증빙 업로드
- 상단 progress: `3 / 12`
- 하단 sticky actions:
  - `임시 저장`
  - `다음 거래`
  - `주간 반영`

### Required manual fields

- 사업비 사용액
- 비목
- 세목
- cashflow항목
- 필요 시 메모

### Evidence section

- `필수증빙자료 리스트`를 즉시 보여줌
- 기존 evidence upload 로직 재사용
- 업로드 직후 `실제 구비 완료된 증빙자료 리스트`와 `준비필요자료`를 갱신
- 증빙 미완료여도 `주간 반영`은 허용

## Reflection Rules

`주간 반영`은 필수 manual fields 입력 완료 시 허용한다. 증빙 완전성은 blocker가 아니다.

반영 시:

1. `sourceTxId`가 같은 projection row 탐색
2. 있으면 update
3. 없으면 insert
4. update 시
   - bank-origin fields는 latest bank snapshot
   - manual fields는 intake manual fields
   - evidence desc/status는 latest upload 상태

반영 시 하지 않는 것:

- 기존 unrelated row 삭제
- row order 기준 replace
- 전체 `expense_sheets` 재생성

## Review-Required Criteria

다음은 `REVIEW_REQUIRED`:

- 같은 upload batch 안에서 fingerprint collision
- 기존 `sourceTxId`와 bank snapshot의 핵심 식별자 drift
  - 날짜
  - signed amount
  - account
- 동일 후보 2개 이상으로 자동 매칭 confidence가 낮음
- 과거 ignored 거래가 핵심 값 변경 후 재등장

## Screen Impact

### PortalBankStatementPage

- 업로드 후 summary card 표시
- CTA:
  - `신규 거래 처리 시작`
  - `나중에 하기`

### PortalWeeklyExpensePage

- 메인 역할은 예외 수정 및 전체 검토
- 상단 `미처리 거래 N건` summary와 wizard reopen CTA

### ImportEditor / SettlementLedgerPage

- 남겨두되 primary entry flow에서 밀려남
- wizard 완료 후 예외 수정용으로 사용

## Acceptance Criteria

- 통장내역 재업로드가 기존 manual weekly row fields를 덮지 않는다.
- 통장내역 순서가 바뀌어도 row number에 의존하지 않는다.
- 업로드 후 신규/검토 필요 거래만 wizard에 나타난다.
- wizard에서 필수 입력 완료 시 해당 거래만 weekly projection에 반영된다.
- 증빙 미완료 거래도 weekly projection 반영은 가능하지만 상태가 남는다.
- 전체 weekly grid는 더 이상 bank upload 직후 primary entry path가 아니다.
