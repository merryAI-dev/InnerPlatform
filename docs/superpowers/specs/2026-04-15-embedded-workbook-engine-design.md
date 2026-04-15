# Embedded Workbook Engine Design

작성일: 2026-04-15

## Summary

InnerPlatform는 `통장내역 → intake → 사업비 입력(주간) → cashflow / 제출 / admin 모니터링` 흐름을 이미 가지고 있다. 이번 설계의 목표는 이 흐름을 버리지 않고, `사업비 입력(주간)`을 **프로젝트별 authoritative workbook**으로 승격하는 것이다.

핵심 방향은 다음과 같다.

- 프론트엔드는 `Vite React`를 유지한다.
- 계산/검증/공식 출력 매핑 권위층은 `Rust`로 강화한다.
- 기존 통장내역/triage/evidence/cashflow 연동 플로우는 유지한다.
- PM/사업담당자는 workbook 안의 정책 셀, 수식, 라벨, 출력 매핑을 수정할 수 있다.
- 단, 시스템이 지정한 코어 정책 셀은 추가/삭제할 수 없다.
- 저장은 즉시 공식 반영이지만, 공식 출력이 깨지면 저장을 차단한다.
- 이 설계는 단순 spreadsheet-like UI가 아니라, **앱 안의 Embedded General Spreadsheet Engine**을 지향한다.

## Why This Direction

이번 프로젝트의 비전은 “입력 화면을 시트처럼 보이게 한다”가 아니다. 목표는 PM이 개발자 없이 정책적 계산 기준과 운영 구조를 바꾸고, 그 결과가 실제 cashflow, 제출 상태, admin 모니터링까지 반영되는 것이다.

하지만 현 시점에서 전면적인 greenfield spreadsheet app 재작성은 맞지 않는다.

- 현재 코드베이스에는 이미 `expenseSheets`, `expenseIntakeItems`, `sheetSources`, `cashflow sync payload`, `Rust calculation core`의 씨앗이 있다.
- 운영상 중요한 ingress는 여전히 통장내역/triage/evidence 흐름이다.
- 전면 sheet-first rewrite는 기존 운영 흐름과 QA/ops 맥락을 모두 버리는 선택이 된다.

따라서 추천 전략은:

> **Engine-over-existing**
>
> 기존 운영 플로우를 유지하면서, 그 위에 workbook 권위층을 끼워 넣는다.

## Decisions Locked In

이 문서는 아래 결정을 고정한다.

- 첫 번째 대상 surface는 `사업비 입력(주간)`이다.
- 첫 사용자 페르소나는 `PM/사업담당자`다.
- workbook 수정 결과는 해당 `프로젝트`에만 영향을 준다.
- 정책 셀/수식/매핑 변경은 저장 즉시 공식 반영된다.
- 공식 출력 대상은 최소한 아래를 포함한다.
  - weekly expense official rows
  - cashflow actual/projection sync
  - submission readiness / status
  - admin monitoring surfaces
- 수식 언어는 `Excel/Google Sheets 최대 호환`을 기본으로 한다.
- 참조 범위는 같은 프로젝트 안의 다른 시트/탭까지 허용한다.
- 공식 출력에 필요한 매핑/수식이 깨지면 저장을 차단한다.
- 동시 편집은 `낙관적 저장 + 충돌 해결` 모델을 따른다.
- 정책 변경은 저장 시 `앞으로만 적용` 또는 `과거 전체 재계산` 중 하나를 고르게 한다.
- 코어 정책 셀은 값/수식 수정은 가능하지만, 셀의 존재 자체를 추가/삭제할 수 없다.

## Non-Goals

이번 설계의 비목표는 아래와 같다.

- 범용 Excel/Google Sheets 완전 대체 제품 만들기
- 임의의 workbook 레이아웃/병합셀/서식 엔진까지 1차에 모두 구현하기
- 조직 전체 공통 spreadsheet platform으로 즉시 일반화하기
- 현재 통장내역/triage/evidence/cashflow 플로우를 제거하기
- 기존 운영화면을 모두 workbook 하나로 통합하기

## Product Shape

### One Project = One Authoritative Workbook

각 프로젝트는 하나의 `ProjectWorkbook` 문서를 가진다. 이 문서는 화면이 아니라 **프로젝트 운영의 공식 계산 문서**다.

최소 구성 시트:

- `weekly_expense`
- `bank_intake_view`
- `policy`
- `output_mapping`
- `summary`

이 중 `weekly_expense`가 1차 primary editing surface다.

### Flexibility Model

PM이 수정 가능한 것:

- 정책 셀 값
- 정책 셀 수식
- 일반 수식 셀
- 표시 라벨
- 공식 출력 매핑 값

PM이 수정 불가능한 것:

- 코어 정책 셀의 존재
- 시스템이 정의한 공식 테이블 스키마 골격
- workbook 최상위 skeleton
- 시스템 audit/version metadata
- 권한 모델

즉, “완전 자유”는 literal한 자유가 아니라:

> **정책/계산 기준은 바꾸되, 플랫폼이 공식 출력을 이해하는 최소 구조는 지킨다**

## Recommended Architecture

### Frontend

`Vite React`를 유지한다.

React는 아래를 담당한다.

- workbook shell
- grid editing UX
- formula bar
- selection / clipboard / paste / fill / filter / sort
- tab navigation
- optimistic local edits
- conflict diff modal
- policy & mapping panel

프론트엔드 프레임워크를 Next.js나 다른 언어로 바꾸는 것은 우선순위가 아니다. 핵심 난제는 rendering stack이 아니라 workbook 권위층과 공식 출력 매핑이다.

### Calculation Core

`Rust`는 workbook의 계산/검증 권위층이다.

Rust 엔진 책임:

- workbook document parse
- formula parse
- dependency graph 구성
- same-project multi-sheet reference resolution
- recalc
- blocking validation
- official output mapping validation
- replay mode 실행
- audit snapshot generation

실행 형태:

- 브라우저: Rust/WASM
- 서버: Rust native

저장 시 브라우저 계산 결과를 신뢰하지 않고 서버에서도 다시 검증한다.

### Existing Flow Adapters

기존 흐름은 ingress/adapters로 유지한다.

- `PortalBankStatementPage`는 여전히 업로드 entrypoint다.
- triage wizard는 여전히 신규/검토 필요 거래를 다룬다.
- evidence upload flow도 유지한다.

단, 최종 반영 대상은 기존의 임시 projection rows가 아니라 `ProjectWorkbook`의 공식 테이블/출력으로 바뀐다.

## Core Document Model

### ProjectWorkbook

```ts
type ProjectWorkbook = {
  id: string
  projectId: string
  version: number
  sheets: WorkbookSheet[]
  policyCells: PolicyCellBinding[]
  outputMappings: OutputMapping[]
  officialOutputs: OfficialOutputsSnapshot
  lastAppliedMode: "forward_only" | "recalc_all"
  updatedAt: string
  updatedBy: string
}
```

### WorkbookSheet

```ts
type WorkbookSheet = {
  id: string
  kind: "weekly_expense" | "bank_intake_view" | "policy" | "output_mapping" | "summary"
  name: string
  grid: WorkbookGrid
}
```

### PolicyCellBinding

```ts
type PolicyCellBinding = {
  id: string
  sheetId: string
  cellRef: string
  semanticKey: string
  mutableFormula: boolean
  mutableValue: boolean
  deletable: false
}
```

정책 셀은 `deletable: false`가 기본이다. 사용자는 값을 바꾸거나 수식을 바꿀 수 있지만, 코어 정책 셀 자체를 없앨 수 없다.

### OutputMapping

공식 출력은 1차에서 `table schema 기반`이 중심이다.

예:

- `official_weekly_rows.transaction_date`
- `official_weekly_rows.budget_code`
- `official_weekly_rows.sub_code`
- `official_weekly_rows.expense_amount`
- `official_weekly_rows.cashflow_category`
- `submission_readiness.required_evidence_count`
- `cashflow_actuals.line_items`

필요한 KPI/요약값은 부가적인 named output으로 둘 수 있지만, 1차의 권위 매핑 중심은 table schema다.

## Workbook Save Lifecycle

저장 시퀀스:

1. PM이 workbook cell / policy / formula / mapping 수정
2. 브라우저의 Rust/WASM이 즉시 재계산
3. 저장 요청 전 optimistic diff 생성
4. 서버가 현재 workbook version과 비교
5. 버전이 다르면 충돌 셀 diff 계산
6. 충돌이 없거나 해결되면 Rust native가 전체 workbook 재검증
7. 공식 출력 매핑이 유효하면 commit
8. commit 성공 시 official outputs fan-out

fan-out 대상:

- weekly expense authoritative rows
- cashflow actual/projection sync payload
- budget actual rollups
- submission readiness/status
- admin monitoring snapshot
- export/audit snapshot

## Blocking Validation Rules

저장을 막는 조건:

- `#REF!`
- 순환 참조
- 필수 output mapping 누락
- 공식 테이블 스키마 필수 컬럼 미매핑
- 코어 정책 셀 미존재
- 코어 정책 셀 참조 깨짐
- 공식 출력 타입 불일치
- replay mode 선택과 모순되는 불완전 상태

저장을 막지 않는 조건:

- 증빙 미완료
- 운영상 권장 경고
- 참고용 보조 셀 오류

즉:

> 공식 출력이 깨지는 오류만 hard block이다.

## Concurrency Model

동시 편집 모델은 `optimistic save + conflict resolution`이다.

기본 원칙:

- 조회는 자유
- 편집은 로컬 optimistic
- 저장 시 version check
- 충돌은 셀 단위 diff로 해결
- 코어 정책 셀 충돌은 더 높은 우선순위 경고

충돌 UI에서 최소한 보여줘야 하는 것:

- 현재 저장하려는 값
- 서버 최신 값
- 마지막 수정자
- 마지막 수정 시각
- 선택 액션
  - 내 값으로 덮기
  - 서버 값 유지
  - 수동 병합 후 다시 저장

## Replay Mode

정책/수식 변경 시 저장할 때 둘 중 하나를 고른다.

- `forward_only`
- `recalc_all`

`forward_only`

- 변경 이후 데이터부터 새 정책 적용
- 과거 공식 결과는 유지

`recalc_all`

- 과거 주차/월/출력까지 전체 재계산
- audit snapshot을 남긴 후 적용

admin/audit에서 “언제 어떤 정책으로 계산되었는가”를 추적할 수 있어야 한다.

## Integration With Current Flows

### Bank Statement / Triage

기존 통장내역 플로우는 유지한다.

- 통장내역 업로드 화면은 계속 존재
- triage wizard도 계속 존재
- intake 분류 흐름도 유지

달라지는 점:

- triage 완료 후 반영 대상이 workbook 공식 테이블이 된다
- `weekly_expense` 시트는 intake 결과와 사람 입력을 함께 가진다
- workbook의 공식 출력이 cashflow/submission/admin까지 이어진다

### Weekly Expense

`PortalWeeklyExpensePage`는 1차의 workbook primary surface다.

현재의 `expenseSheetRows` 중심 편집을 workbook grid shell로 치환하되, 아래는 유지한다.

- 미저장 가드
- evidence workflow
- project drive provisioning
- intake queue summary
- submission 연동
- cashflow upsert path

### Cashflow

cashflow는 별도 독립 편집면이 아니라, workbook 공식 출력의 주요 downstream이다.

즉, PM이 workbook 안에서 정책 셀/수식을 바꾸면:

- weekly rows가 바뀌고
- cashflow actual/projection payload가 바뀌고
- admin export/monitoring도 바뀐다

이 연결은 이번 플랫폼 비전의 핵심이다.

## Rust / TypeScript Boundary

TypeScript 유지 영역:

- UI composition
- editor state
- grid interactions
- browser affordances
- feature flags
- navigation/route composition

Rust 권위 영역:

- workbook schema validation
- formula runtime
- dependency graph
- row derivation and sync payloads
- output mapping validation
- replay engine
- parity fixtures

현재 TypeScript calculation kernel은 authoritative reference로 남기고, Rust는 parity와 save-time authority를 먼저 잡는다. 이후 hot path가 안정되면 authoritative role을 Rust로 이동시킨다.

## Rollout Plan

### Epic 1. Workbook Document Model

- `ProjectWorkbook` 도입
- 현재 `expenseSheets`, `sheetSources`, `expenseIntakeItems`와의 매핑 정의
- Firestore/BFF 저장 경계 설계

### Epic 2. Rust Workbook Engine

- workbook schema
- formula parser
- dependency graph
- multi-sheet references
- validation engine
- server/native + browser/WASM dual-run

### Epic 3. Weekly Expense Migration

- `PortalWeeklyExpensePage`에 workbook grid shell 도입
- 기존 ledger UX와 미저장 가드 유지
- intake -> workbook official table 반영

### Epic 4. Policy Cells and Output Mapping

- policy panel
- output mapping panel
- core policy cell immutability
- hard-block validation

### Epic 5. Official Output Fan-Out

- cashflow payload
- submission readiness
- admin monitoring snapshot
- export snapshot

### Epic 6. Conflict / Audit / Replay

- versioning
- cell diff merge
- replay mode
- audit snapshots
- parity fixtures

## Policy Record Strategy

이 프로젝트는 장기 구현이므로, 정책을 코드 밖에 명시적으로 고정해야 한다.

권장 방식:

- 이 spec을 최상위 기준 문서로 둔다.
- 세부 정책은 `WB-*` ID를 가진 policy record로 쪼갠다.
- 구현 이슈, PR, 커밋, 문서는 반드시 관련 `WB-*`를 참조한다.

초기 정책 ID:

- `WB-001` Core policy cells are immutable in existence
- `WB-002` Official output breakages block save
- `WB-003` Bank statement and triage flow remain ingress
- `WB-004` Weekly expense workbook is project-scoped authoritative surface
- `WB-005` Cashflow / submission / admin outputs derive from workbook official mappings
- `WB-006` Policy changes support forward-only and recalc-all modes
- `WB-007` Same-project multi-sheet references are allowed; cross-project references are out of scope

## Light Hook Strategy

hook은 heavy gate보다 `light policy reminder`가 맞다.

목표:

- 구현 중 policy drift를 줄인다
- 작업자가 지금 어떤 정책을 건드리는지 항상 보게 한다
- patch-note guard처럼 과도한 hard fail은 피한다

### Local Hook

pre-commit 또는 pre-push 경고:

- 아래 경로가 staged되면
  - `src/app/platform/**`
  - `src/app/components/portal/PortalWeeklyExpensePage.tsx`
  - `src/app/data/portal-store.tsx`
  - `rust/spreadsheet-calculation-core/**`
- 커밋 메시지 또는 staged note/reference에 `WB-*`가 없으면 경고를 띄운다.

처음엔 경고만 한다. hard fail은 하지 않는다.

### CI Check

CI에서도 같은 정책 참조 누락을 soft report한다.

출력 예:

- `warning: workbook-engine-related changes detected without WB policy reference`

이 경고는 구현자가 issue/spec를 다시 보게 만드는 수준이면 충분하다.

## Risks

### 1. Engine ambition explodes into product rewrite

대응:

- 첫 surface는 `weekly expense`로 고정
- ingress flows는 유지
- workbook skeleton은 고정

### 2. PM freedom breaks authoritative outputs too often

대응:

- core policy cells immutable
- hard-block validation
- mapping panel 분리

### 3. TS / Rust dual logic drift

대응:

- parity fixtures
- replay snapshots
- golden workbook tests

### 4. Spreadsheet UX complexity overwhelms current app

대응:

- 1차는 general layout engine이 아니라 operational workbook
- 병합셀/고급서식/범용 문서 편집은 후순위

## Recommendation

이 프로젝트의 규모와 비전을 고려하면, 추천 방향은 하나다.

> **Vite React + Rust 기반을 유지하고, Embedded General Spreadsheet Engine을 기존 운영 플로우 위에 authoritative workbook layer로 얹는다.**

이 선택은 다음을 동시에 만족시킨다.

- 현재 코드 자산 재사용
- 장기 비전 유지
- cashflow / submission / admin까지의 공식 연동
- 정책 셀 중심의 PM 자율성 확보

## Next Step

다음 단계는 구현이 아니라 **실행 계획(plan) 분해**다.

이 spec을 기준으로, epics를 실제 작업 단위로 쪼갠 implementation plan을 작성한다.
