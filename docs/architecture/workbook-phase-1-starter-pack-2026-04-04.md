# Workbook Phase 1 Starter Pack

작성일: 2026-04-04  
대상: 플랫폼 엔지니어링 / PM 운영 전환 태스크포스

## 목적

다음 구현 페이즈는 `사용내역` family를 TypeScript authoritative engine으로 고정하는 것이다.  
이 문서는 그 시작점에서 흔들리면 안 되는 frozen input, known risk, acceptance gate를 한 번에 묶는다.

## Frozen Inputs

- source workbook: `tmp/spreadsheets/expense-sheet.xlsx`
- workbook SHA-256: `9ee7d582c898532ddb6f25fb8867ec4501dcb5074b96320fad2338f017f00868`
- tracked freeze artifact: [workbook-freeze-line-2026-04-04.json](/Users/boram/InnerPlatform/docs/architecture/workbook-freeze-line-2026-04-04.json)
- extraction command:

```bash
npm run workbook:extract:formulas -- /Users/boram/InnerPlatform/tmp/spreadsheets/expense-sheet.xlsx /Users/boram/InnerPlatform/output/spreadsheet
```

- current workbook size
  - sheet count: `17`
  - formula count: `1879`
  - source issue count: `73`

## Execution Order

다음 순서가 phase 1 기준선이다.

1. `통장내역(MYSC법인계좌e나라도움제외)`
2. `사용내역(통장내역기준취소내역,불인정포함)`
3. `예산총괄시트`
4. `cashflow(사용내역 연동)`
5. `cashflow(e나라도움 시 가이드)`
6. `비목별 증빙자료`

그룹/보조 시트는 phase 1 범위에 넣지 않는다.

## Phase 0 Review Link

- [workbook-phase-0-review-2026-04-04.md](/Users/boram/InnerPlatform/docs/architecture/workbook-phase-0-review-2026-04-04.md)
- [usage-ledger-rule-catalog-2026-04-04.md](/Users/boram/InnerPlatform/docs/architecture/usage-ledger-rule-catalog-2026-04-04.md)
- [usage-ledger-phase-1-fixture-2026-04-04.json](/Users/boram/InnerPlatform/docs/architecture/usage-ledger-phase-1-fixture-2026-04-04.json)

## Known Source Issues

- literal spreadsheet formula error: `11`
- propagated spreadsheet formula error: `62`
- 현재 원본 workbook에는 `#REF!`뿐 아니라 `#N/A`도 존재한다.
- 따라서 phase 1 구현은 “원본 시트가 완전하다”를 가정하지 않고, source bug ledger를 함께 참조해야 한다.

## Phase 1 Scope

이번 페이즈에서 구현할 것은 아래로 제한한다.

- `사용내역` 행 단위 파생 규칙 카탈로그 작성
- running balance 기준 로직 명시화
- 공급가액 / 사업비 사용액 / 매입부가세 파생 우선순위 고정
- 취소/환입 포함 순액 계산 규칙 고정
- golden fixture 기반 테스트 작성

이번 페이즈에서 하지 않는 것:

- 그룹 시트 이관
- cashflow projection 전체 재구현
- UI polish
- Rust 이관

## Acceptance Gates

phase 1은 아래가 모두 충족될 때만 종료한다.

- `사용내역` family의 핵심 컬럼 파생 규칙이 문서화되어 있다.
- golden fixture가 시트 결과와 일치한다.
- source bug가 있는 행은 “원본 오류”로 분리되어 parity mismatch와 섞이지 않는다.
- direct-entry 정책과 bank-upload 정책이 같은 authoritative engine 입력 모델로 수렴한다.
- 다음 phase가 `예산총괄시트`로 넘어갈 수 있을 정도로 API/DTO 경계가 고정된다.

## Blockers To Watch

- 시트 수식이 깨져 있어도 업무상 정답이 암묵적으로 알려진 행이 있을 수 있다.
- `cashflow(e나라도움 시 가이드)` 같은 guide 탭은 계산 규칙과 설명 규칙이 섞여 있다.
- direct-entry 사업과 bank-upload 사업이 같은 `사용내역` 규칙을 모두 공유하지 않을 수 있다.

## Handoff Rule

phase 1 작업 PR은 한 번에 크게 올리지 않는다.

- rule catalog
- fixture
- authoritative derivation
- replay compare

이 네 묶음을 작은 PR로 나눈다.  
UI 변경과 parity 엔진 변경은 같은 PR에 섞지 않는다.
