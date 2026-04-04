# Usage Ledger Rule Catalog

작성일: 2026-04-04  
범위: `사용내역(통장내역기준취소내역,불인정포함)`

## 목적

phase 1의 목표는 Google Sheet `사용내역` 탭을 그대로 복제하는 것이 아니라,  
이 탭이 표현하려는 계산 의미를 authoritative TypeScript engine으로 명시하는 것입니다.

이 문서는 phase 1 구현의 첫 번째 공식 rule catalog입니다.

## Inputs

- canonical freeze line: [workbook-freeze-line-2026-04-04.json](/Users/boram/InnerPlatform/docs/architecture/workbook-freeze-line-2026-04-04.json)
- tracked fixture seed: [usage-ledger-phase-1-fixture-2026-04-04.json](/Users/boram/InnerPlatform/docs/architecture/usage-ledger-phase-1-fixture-2026-04-04.json)
- phase 0 review: [workbook-phase-0-review-2026-04-04.md](/Users/boram/InnerPlatform/docs/architecture/workbook-phase-0-review-2026-04-04.md)

## Workbook → App Mapping

| Workbook Column | Workbook Meaning | App Header | App Role |
| --- | --- | --- | --- |
| `D` | 거래 seed / 주차 seed | `거래일시`, `해당 주차` | date/week derivation input |
| `E` | 지출구분 | `지출구분` | payment method |
| `G` | 세목 | `세목` | budget sub category |
| `H` | 세세목 | `세세목` | budget sub-sub category |
| `I` | cashflow line | `cashflow항목` | cashflow mapping |
| `J` | running balance | `통장잔액` | derived balance |
| `K` | bank delta | `통장에 찍힌 입/출금액` | bank amount input |
| `L` | deposit amount | `입금액(사업비,공급가액,은행이자)` | deposit input |
| `M` | VAT refund | `매입부가세 반환` | refund input |
| `N` | expense amount | `사업비 사용액` | expense output/input |
| `O` | input VAT | `매입부가세` | VAT output/input |
| `P` | counterparty | `지급처` | business context |
| `Q` | memo | `상세 적요` | business context |

## Candidate Rules

### Rule 1. Running balance chain

`통장잔액(J)`은 row-by-row running balance입니다.

candidate expression:

```text
current_balance = previous_balance - expense_amount - input_vat + deposit_amount + vat_refund
```

evidence:

- `J4 = 0 - N4 - O4 + L4 + M4`
- `J5 = J4 - N5 - O5 + L5 + M5`

authoritative interpretation:

- `입금계열(L,M)`은 잔액을 증가시킨다.
- `출금계열(N,O)`는 잔액을 감소시킨다.
- phase 1 engine은 이 chain을 deterministic하게 계산한다.

### Rule 2. VAT split from bank amount

sample rows `4:9`에서는 `O = K - N` 패턴이 보입니다.

candidate expression:

```text
input_vat = bank_amount - expense_amount
```

authoritative interpretation:

- bank upload row에서 `사업비 사용액`이 주어지면 `매입부가세`를 역산할 수 있다.
- direct-entry row에서는 사용자가 `사업비 사용액`과 `매입부가세`를 둘 다 명시할 수 있으므로, policy에 따라 자동계산은 보조 역할만 한다.

HITL note:

- 이 규칙은 **authoritative truth가 아니라 candidate derivation**이다.
- 실제 운영에서는 영수증/세금계산서 기준 금액과 통장 금액이 깔끔하게 1:1 분해되지 않는 경우가 많다.
- 따라서 `매입부가세 = 통장금액 - 공급가액`은 자동 제안은 가능하지만, 최종 저장/검증 단계에서는 `사람 확인 필요(HITL)` 상태를 거쳐야 한다.
- phase 1 이후 validation은 `수식으로 계산 가능함`과 `업무상 맞는 금액임`을 같은 것으로 취급하지 않는다.

### Rule 3. Expense amount derivation

source workbook sample은 `N4:N9 = $K$4/11*10`입니다.

이 패턴은 phase 1에서 **공식 규칙으로 채택하지 않습니다.**

reason:

- row-local input인 `K5`, `K6`가 있는데도 `N5`, `N6`가 모두 `$K$4`를 참조합니다.
- spreadsheet error가 아니어도 semantic anomaly일 가능성이 높습니다.

authoritative interpretation:

- 정책상 VAT split이 필요한 경우의 intended rule은 `expense_amount = bank_amount * 10 / 11` 또는 `expense_amount = bank_amount - input_vat` 계열일 가능성이 높다.
- 정확한 선택은 golden fixture와 현행 앱 정책을 비교하면서 고정한다.
- 다만 공급가액 자동 역산이 가능하더라도, 그 결과로 계산된 `매입부가세`는 반드시 HITL 검증 후보로 남긴다.

### Rule 4. Error propagation is not parity target

`J13`에서 `#REF!`가 발생하고 이후 balance chain이 모두 깨집니다.

phase 1 interpretation:

- `J4:J12`는 정상 계산 fixture
- `J13 이후`는 source error propagation fixture

즉 phase 1 test는 “오류가 있다”를 재현할지, “오류를 triage 대상으로 분리한다”를 검증할지 명확히 나눠야 합니다.

## Known Anomalies

1. `N4:N9` absolute reference pattern
2. `J13` literal `#REF!`
3. `J14+` propagated balance failure

이 3개는 source fidelity가 아니라 triage 대상입니다.

## QA Regression Hooks

사업관리플랫폼 QA memory에서 phase 1과 직접 닿는 회귀 포인트는 아래입니다.

- `사업비 입력 메뉴에 입력한 매입부가세가 캐시플로에 반영이 안됩니다!`
- `[사업비 입력]-[사업비 사용액] 수정 불가`
- `사업비 입력(주간) : 매입 부가세 입력 노티`

따라서 phase 1 derivation 구현은 최소한 아래 regression을 같이 봐야 합니다.

- VAT split 후 cashflow 반영
- manual override 보존
- direct-entry / bank-upload 정책 분기
- formula-derived VAT에 대한 HITL 검증 경로 분리

## Acceptance For Phase 1 PR-1

첫 번째 phase 1 PR은 아래를 만족하면 충분합니다.

- `사용내역` 핵심 규칙 3개가 코드/문서로 명시된다.
- tracked fixture seed 기반 test가 추가된다.
- `N4:N9` 절대참조 패턴은 anomaly로 격리된다.
- `J13 이후` 오류 전파는 정상 규칙과 분리된다.
- formula-derived `매입부가세`는 authoritative final truth로 자동 승격되지 않고, HITL review candidate로 남는다.
