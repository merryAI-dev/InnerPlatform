# Bank Intake Evidence Continuation Spec

## Goal

`통장내역 업로드 -> triage wizard -> 사업비 입력(주간)` 흐름을 한 번 더 제품 수준으로 다듬는다. 핵심 목표는 신규 거래를 분류하는 순간 같은 맥락에서 증빙 업로드까지 이어지게 하면서도, `주간 반영` 자체는 막지 않는 것이다. 결과적으로 사용자는 전체 정산대장을 뒤지지 않고도 신규 거래를 빠르게 분류하고, 증빙은 같은 루프에서 이어서 처리할 수 있어야 한다.

## Why Another Tranche

현재 구현은 중요한 경계를 이미 바꿨다.

- bank upload는 `expense_sheets`를 직접 덮어쓰지 않는다.
- 신규 거래와 검토 필요 거래는 `expense_intake`에 저장된다.
- wizard에서 필수 입력을 마치면 해당 거래만 `weekly projection`에 반영된다.

하지만 아직 외부형 SaaS 수준으로는 한 단계가 더 필요하다.

- 증빙 체크리스트는 보이지만, 실제 업로드 continuation이 wizard의 중심 흐름으로 통합되지 않았다.
- 사용자는 여전히 `주간 표 -> 예외 수정 -> 증빙 업로드`로 머릿속 컨텍스트를 여러 번 바꿔야 한다.
- `무엇을 지금 처리해야 하는지`, `무엇은 이미 반영됐고 무엇이 남았는지`, `나중에 어디서 다시 이어야 하는지`가 제품 표면에서 충분히 명확하지 않다.

## Product Principles

- Reflection first, evidence next: 필수 분류 필드가 끝나면 주간 반영은 즉시 가능해야 한다.
- Same-loop continuation: 증빙 업로드는 별도 화면이 아니라 같은 wizard 맥락에서 이어지는 것이 기본이다.
- No destructive reconciliation: 증빙 업로드가 기존 manual classification이나 projected weekly row를 되돌리면 안 된다.
- Resume safely: 사용자는 언제든 wizard를 닫고 나중에 다시 들어와도 같은 거래 상태에서 이어야 한다.
- Salesforce-style trust surface: 상태는 친절한 설명보다 `무엇이 끝났고`, `무엇이 남았고`, `지금 어디로 가야 하는지`를 짧게 보여줘야 한다.

## User Story

PM은 통장 엑셀을 업로드한 뒤 신규 거래만 추린 queue를 본다. 첫 거래에서 `사업비 사용액`, `비목`, `세목`, `cashflow 항목`을 채우고 `주간 반영 후 다음 거래`를 누른다. 거래는 즉시 `사업비 입력(주간)`에 나타난다. 같은 화면 아래에서 필수 증빙 체크리스트와 업로드 영역이 보이므로, 증빙이 손에 있으면 바로 올리고, 아니면 `증빙은 나중에`로 넘어간다. 나중에 다시 wizard를 열면 `반영됨 · 증빙 미완료` 거래만 모아 이어서 처리할 수 있다.

## Scope

### In scope

- `BankImportTriageWizard`를 `분류 + 증빙 continuation` 중심으로 재구성
- `expense_intake`에 wizard continuation 상태를 명시적으로 저장
- 증빙 업로드 성공 시 `expense_intake`와 projected weekly row의 evidence fields를 즉시 동기화
- `PortalBankStatementPage`와 `PortalWeeklyExpensePage`에 intake summary를 `분류 필요`, `증빙 미완료`, `검토 필요` 기준으로 분리
- wizard reopen/resume UX
- deterministic Playwright gate 추가

### Out of scope

- 드라이브 설정 화면 재배치
- submission 단계의 증빙 강제 정책 변경
- Spring/postgres migration
- `ImportEditor` 제거

## Approaches Considered

### Option A. Keep evidence outside the wizard

분류만 wizard에서 하고, 증빙은 기존 정산대장 편집이나 별도 dialog에서 이어간다.

- 장점: 구현 범위가 작다.
- 단점: 사용자가 신규 거래를 처리하는 흐름이 끊기고, 동일 거래를 다시 찾아야 한다.

### Option B. Inline evidence continuation inside the wizard

분류 패널 아래에서 같은 거래의 증빙 체크리스트와 업로드 action을 이어서 제공한다. 주간 반영은 필드 입력 완료 즉시 허용하고, 증빙은 non-blocking continuation으로 둔다.

- 장점: 현재 구조와 잘 맞고, 사용자가 한 거래 맥락을 유지한 채 처리할 수 있다.
- 단점: wizard가 비대해질 위험이 있어 정보 계층을 엄격히 제어해야 한다.

### Option C. Separate evidence inbox page

분류는 wizard에서, 증빙은 별도 queue/inbox 페이지에서 모아 처리한다.

- 장점: 운영 큐 관점에서는 강력하다.
- 단점: 현재 제품 단계에서는 화면과 개념을 늘려 onboarding 비용이 커진다.

### Recommendation

Option B를 채택한다. 이 제품의 지금 단계에서는 `신규 거래 처리`라는 한 개의 mental model을 지키는 것이 가장 중요하다. 다만 Salesforce식으로 정보를 무겁게 늘리지 않고, `필수 입력`, `증빙 상태`, `다음 액션`만 드러나는 밀도 높은 wizard로 설계한다.

## Proposed Product Design

## 1. Intake status model

`expense_intake`는 단순 queue가 아니라 resumable workflow state를 가져야 한다.

추가/명확화할 상태 축:

- `matchState`
  - `PENDING_INPUT`
  - `REVIEW_REQUIRED`
  - `AUTO_CONFIRMED`
  - `IGNORED`
- `projectionStatus`
  - `NOT_PROJECTED`
  - `PROJECTED`
  - `PROJECTED_WITH_PENDING_EVIDENCE`
- `evidenceStatus`
  - `MISSING`
  - `PARTIAL`
  - `COMPLETE`
- `wizardStatus`
  - `NEEDS_CLASSIFICATION`
  - `READY_TO_PROJECT`
  - `PROJECTED_PENDING_EVIDENCE`
  - `PROJECTED_COMPLETE`
  - `REVIEW_REQUIRED`

`wizardStatus`는 UI 전용 파생값으로 시작해도 되지만, 같은 계산을 여러 화면에서 반복할 것이므로 helper로 고정한다.

## 2. Wizard information hierarchy

각 거래에 대해 동시에 보여주는 정보는 세 레이어로 제한한다.

### Layer 1. 은행 원본

- 거래일시
- 거래처
- 입출금액
- 잔액
- 원본 적요

### Layer 2. 지금 꼭 입력할 것

- 사업비 사용액
- 비목
- 세목
- cashflow 항목
- 메모

### Layer 3. 증빙 continuation

- 필수 증빙 체크리스트
- 완료된 증빙
- 아직 필요한 증빙
- 업로드 dropzone / picker
- `증빙은 나중에` action

중요한 제약:

- 필수 입력과 증빙 업로드를 한 step 안에 두되, 증빙은 항상 secondary section이다.
- primary CTA는 입력 상태에 따라 `주간 반영 후 다음 거래` 또는 `임시 저장` 하나뿐이다.
- 증빙 업로드는 같은 거래를 벗어나지 않도록 side-panel이 아니라 inline card로 제공한다.

## 3. Reflection behavior

주간 반영 규칙은 현재 정책을 유지하되, evidence continuation과 더 단단히 연결한다.

- 필수 manual fields 완료 시 `projectExpenseIntakeItem` 가능
- projection 성공 즉시
  - weekly row upsert
  - `existingExpenseSheetId`, `existingExpenseRowTempId` 갱신
  - `projectionStatus` 갱신
- 증빙 업로드 성공 즉시
  - intake item의 `manualFields.evidenceCompletedDesc` 갱신
  - `evidenceStatus` 재계산
  - projected weekly row의
    - `필수증빙자료 리스트`
    - `실제 구비 완료된 증빙자료 리스트`
    - `준비필요자료`
    - `evidenceStatus`
    를 narrow patch로 갱신

중요한 점은 `증빙 업로드가 projection을 다시 생성하지 않고`, 동일 `sourceTxId` row에 evidence-related fields만 upsert해야 한다는 것이다.

## 4. Resume and reopen UX

`PortalBankStatementPage`

- 업로드 직후 summary는 세 구획으로 나눈다.
  - `분류 필요`
  - `검토 필요`
  - `증빙 미완료`
- CTA는 2개만 둔다.
  - `신규 거래 처리 시작`
  - `증빙 이어서 하기`

`PortalWeeklyExpensePage`

- 상단 strip도 같은 세 구획을 공유한다.
- `미처리 거래 N건` 같은 뭉뚱그린 표현 대신,
  - `분류 필요 2`
  - `증빙 미완료 5`
  - `검토 필요 1`
  식으로 분리한다.
- weekly grid는 여전히 예외 수정용이다. wizard reopen은 prominent하지만 primary page action을 먹어치우면 안 된다.

## 5. Error handling and trust

- 업로드 실패:
  - current item에만 에러를 붙이고 wizard는 닫히지 않는다.
- projection 성공 + evidence upload 실패:
  - row는 이미 주간 반영됨
  - 상태는 `PROJECTED_WITH_PENDING_EVIDENCE`
  - 사용자에게 `주간 반영은 끝났고 증빙만 남음`을 명확히 보여준다.
- wizard close/reopen:
  - draft가 저장되지 않은 경우엔 현재처럼 explicit save 또는 close semantics를 유지
  - saved intake state는 항상 재진입 기준이 된다.

## Architecture Changes

## 1. Evidence patch helper

현재 `upsertExpenseSheetProjectionRowBySourceTxId()`는 full projection upsert에 초점이 있다. 다음 tranche에서는 evidence-only narrow patch helper를 추가한다.

예상 helper:

- `patchExpenseSheetProjectionEvidenceBySourceTxId(...)`

이 helper는 동일 `sourceTxId` row를 찾아 evidence 관련 컬럼만 갱신하고, 다른 manual/bank fields는 건드리지 않는다.

## 2. Portal store action split

현재 store는 `updateExpenseIntakeItem()`와 `projectExpenseIntakeItem()`가 핵심이다. 다음 tranche에서는 evidence continuation을 위해 action을 분리한다.

- `saveExpenseIntakeDraft(id, updates)`
- `projectExpenseIntakeItem(id, updates?)`
- `syncExpenseIntakeEvidence(id, updates)`

`syncExpenseIntakeEvidence`는 intake doc 갱신과 projected row evidence patch를 같은 transaction-like sequence로 처리해야 한다.

## 3. Shared status resolver

새 helper module을 추가해 wizard, bank statement page, weekly page가 같은 status vocabulary를 보게 한다.

예상 helper:

- `resolveBankImportWizardStatus(item)`
- `groupExpenseIntakeItemsForSurface(items)`

## Acceptance Criteria

- 사용자는 신규 거래를 분류한 직후 같은 wizard 안에서 증빙 업로드를 이어갈 수 있다.
- 필수 입력을 완료한 거래는 증빙이 없어도 즉시 `사업비 입력(주간)`에 반영된다.
- 증빙 업로드 성공 시 `실제 구비 완료된 증빙자료 리스트`와 `준비필요자료`가 즉시 갱신된다.
- 증빙 업로드가 기존 manual classification 또는 projected weekly row의 non-evidence 필드를 덮지 않는다.
- bank statement page와 weekly page는 `분류 필요 / 검토 필요 / 증빙 미완료`를 분리해서 보여준다.
- reupload in different order scenario 이후에도 projected row와 evidence 상태가 유지된다.

## Verification Strategy

### Unit

- wizard status resolver
- evidence-only projection patch helper
- intake item evidence status recomputation

### Integration

- intake doc update + projected row evidence patch coherence
- dev harness/local persistence resume

### Playwright

- bank upload -> wizard classify -> project -> evidence later continue
- project first, upload evidence second
- wizard close and reopen resumes pending evidence items
- reupload same rows in different order preserves projected values and evidence state
