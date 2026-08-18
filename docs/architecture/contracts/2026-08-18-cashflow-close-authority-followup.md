# 월결산 잠금 권한 — 2026-08-14 계약의 미완 지점

**날짜:** 2026-08-18
**선행 문서:** [2026-08-14 현금흐름 기간 권한 계약](./2026-08-14-cashflow-period-authority.md)
**상태:** 조사 완료 · 수정 미적용

## 왜 이 문서가 있나

선행 계약은 잠금 권한을 한 곳으로 모았다.

> 월결산 쓰기 잠금 기준을 canonical cumulative close head의 `closedThrough`로 단일화한다.
> `monthly_closes`는 실행 이력으로 보존하고 권한 판정에 다시 사용하지 않는다.

그 계약은 JVM, `cashflow-month-state.mjs`, `cashflow-period-policy-service.mjs`에 반영되어 머지·배포까지 끝났다. 다만 계약이 **범위 밖**으로 선언한 frozen sheet-lab 파이프라인은 손대지 않았고, 그 파일이 아직 옛 규칙을 쓴다. 이 문서는 그 미완 지점과, 그로 인해 라이브에서 관찰된 증상을 기록한다.

계약을 어긴 것이 아니라 계약이 의도적으로 미룬 부분이다. 다만 미룬 대가가 이미 사용자 화면에 나타났으므로 다음 작업자가 같은 조사를 반복하지 않도록 남긴다.

## 계약을 따르지 않는 지점

`server/bff/routes/cashflow-sheet-lab.mjs`의 `readCanonicalClosedCashflowMonths`가 두 출처를 합집합으로 더한다.

```js
// ① 연도 제한이 없다 — 계약은 2024·2025 연간형을 월별 CLOSED 로 해석하지 말라고 한다
if (closedThrough && yearMonth <= closedThrough) closedMonths.add(yearMonth);
// ② 월별 문서를 권한 판정에 쓴다 — 계약은 실행 이력으로만 쓰라고 한다
if (close.status === 'CLOSED') closedMonths.add(yearMonth);
```

정식 규칙은 두 곳에 이미 있고 서로 일치한다.

| 구현 | 규칙 | 계약 준수 |
|---|---|---|
| JVM `isCumulativeClosed` | `target.year == settlementMonth.year && !target.isAfter(closedThrough)` | ✅ |
| `cashflow-month-state.mjs:91-94` | 같은 규칙 | ✅ |
| `cashflow-period-policy-service.mjs` | 도메인 모듈의 authority 를 그대로 사용 | ✅ |
| `cashflow-sheet-lab.mjs:1775-1797` | 자체 구현 | ❌ |

## 라이브에서 관찰된 것 (2026-08-18 기준)

`monthly_closes` 문서는 **회차 월**을 키로 쓴다. JVM 이 같은 트랜잭션에서 두 월을 명시적으로 구분한다.

```java
// 시트 데이터 잠금 → throughMonth (2026-07)
replaceCashflowSheetMonthForMonthClose(..., cumulative.throughMonth(), ...);
// 문서 키와 yearMonth 필드 → 회차 월 (2026-08)
closeRef = db.document(monthlyClosePath(..., request.yearMonth()));
patch.put("status", "CLOSED");
```

그래서 `p1773817948751-2026-08 / status: CLOSED` 는 "8월이 잠겼다"가 아니라 "8월 회차가 완료되었다"는 뜻이다. sheet-lab 의 ②가 이를 데이터 월로 오독한다.

| 프로젝트 | head `closedThrough` | 회차 | 월문서 | 결과 |
|---|---|---|---|---|
| AXR프로젝트경비 (`p1773817948751`) | 2026-07 | 2026-08 | 2026-08 CLOSED | ⚠️ 8월 오잠금 |
| JLIN IBS (`p1776054335896`) | 2026-07 | 2026-08 | 2026-08 CLOSED | ⚠️ 8월 오잠금 |
| 2026전남글로벌 (`p1782702681869`) | 2026-06 | 2026-07 | 2026-08 OPEN | 정상 |

JVM 은 현재 월 잠금을 애초에 거부한다. 8월이 잠긴 것으로 보이는 것은 sheet-lab 만의 판정이다.

```java
if (!closeThrough.isBefore(YearMonth.from(today))) {
    throw new WeeklyExpenseConflictException("Cashflow month close is available after the target month ends.");
}
```

**사용자에게 보이는 증상:** 아직 열린 8월 셀을 고칠 때 "마감 후 시트값 변경" 팝업이 뜨고, 사유를 요구하며, 그 기록이 경고로 누적된다.

## 연간 열 "확인 불가"와의 연결

한 번 "마감 후 시트값 변경"을 거치면 그 프로젝트의 연간 표시가 취약해진다. `jvm-weekly-api.mjs:1003` 의 `amendedSheetFormulaSnapshot` 이 revision 세 개의 완전 일치를 요구하고, 하나라도 어긋나면 `sheetFacts: null` 을 돌려준다. 그러면 프론트의 `annualTotalFor` 가 모든 연도에 `null` 을 반환해 **2024·2025 를 포함한 모든 연간 열이 "확인 불가"** 로 표시된다.

즉 8월 오잠금 → 마감 후 변경 경로 강제 → 연간 표시 취약이라는 사슬이다. 8월 오잠금을 고치면 이 경로 진입 자체가 줄어든다.

**단, 2026-08-18 시점에는 세 프로젝트 모두 revision 이 일치해 발현되지 않은 상태다.** JLIN 은 수정 이력 1건으로 이미 취약 구간에 들어와 있다. 시트를 다시 불러오고 반영하지 않으면 그때 나타난다.

연간 데이터 자체는 손상되지 않았다. 시트의 AXR 2024·2025 열은 실제로 전부 0이며, Firestore 의 `cashflow_sheet_year_totals` 도 16개 항목 전부 `ZERO`/0 으로 일치한다. 좌표 계약이 요구하는 8개 연도(2024·2025·2027~2032)가 세 프로젝트 모두 존재한다.

## 규모

| | 수 |
|---|---|
| 전체 프로젝트 | 70 |
| 시트 연동된 프로젝트 | 47 |
| 이미 결산한 프로젝트 | 3 (2개 발현) |
| 아직 결산하지 않은 프로젝트 | 44 |

지금 보이는 것은 2건이지만 원인이 결산 경로에 있어 44개 사업이 결산할 때마다 재발한다.

## 측정

```bash
node scripts/audit-cashflow-close-horizons.mjs --project inner-platform-live-20260316
```

읽기 전용이다. `지평선너머CLOSED` 항목이 **2개 → 0개** 가 되면 수정이 끝난 것이다. head 없이 CLOSED 월만 있는 레거시 프로젝트도 함께 센다 (2026-08-18 기준 0개).

## 정리할 것

혼란도 순이다.

1. **sheet-lab 의 계약 위반에 표시가 없다.** 그 파일을 여는 사람은 계약의 존재를 모르고, 계약을 읽는 사람은 위반을 모른다. 고치는 것이 맞지만 최소한 위반 지점에 이 문서 링크를 남긴다.
2. **동결 구현이 두 개다.** main 에는 하드 블록(우회 불가, main push 에도 실행), `chore/freeze-cashflow-sheet-lab-one-way` 에는 오너 승인 게이트가 미머지로 남아 있다. 하드 블록은 `f1868182` 안에 묻혀 들어와 커밋 제목에 동결 언급이 없다. sheet-lab 수정은 이것을 먼저 정리해야 가능하다.
3. **`monthly_closes` 문서가 오독을 부른다.** 문서에 `throughMonth` 를 함께 저장하면 오독이 불가능해진다. JVM 은 이미 그 값을 알고 있다.
4. **커밋 본문이 비어 있다.** `a0072cdf` 는 2만 줄 변경인데 본문이 없다. 같은 커밋에 계약 문서가 있으나 연결되어 있지 않다.
5. **병렬 테스트에서 가짜 실패가 난다.** 실측: 병렬에서 실패한 10건이 단일 워커에서 159/159 통과했다 (CSV 테스트 6,398ms → 415ms). 모르면 자기 패치를 의심하게 된다. `npx vitest run --no-file-parallelism --maxWorkers=1` 로 확인한다.
6. **`cashflow-month-state.mjs` 에 테스트가 없다.** 113줄에 잠금 판정의 정답이 들어 있는데 테스트 파일이 없어 조용히 깨질 수 있다. 기한 규칙이 쓰는 짝 테이블 패턴(`DEADLINE_PARITY` ↔ `CashflowCloseDeadlineTest.java`)을 잠금 규칙에도 적용한다.
7. **직접 접근이 35곳이다.** `cashflow_month_close_requests` 15곳, `monthly_closes` 12곳, `cashflow_cumulative_close_heads` 8곳이 도메인 모듈을 우회해 컬렉션을 직접 읽는다. 판정에 쓰이는 접근만이라도 도메인 경유로 바꾼다.

## 범위 결정 — 시트 손상 진단 (2026-08-18)

현금흐름 시트는 조직의 확정된 양식이고 변경이 불가능하다. 시트 값을 신뢰하며, **양식 손상까지 시스템이 잡아내는 것은 개발 범위 밖으로 결정했다.** 좌표 계약도 같은 입장이다 - "양식이 다르면 적응하지 않고 거부한다. 폴백 체인·보정·추론으로 메우지 않는다."

유지하는 것:

- `controlTotals` 합계 대조. 시트가 자기 수식으로 만든 19개 합계행(항목 16 + 입금합계·출금합계·잔액)에 `matches` 불리언이 붙는다. 어긋나면 `SHEET_CONTROL_TOTAL_MISMATCH` 경고, 구조가 깨졌으면 blocker다. 진단이 아니라 거부이므로 계약과 일치한다.
- 수식 깨짐 감지 (`#REF!`, `#N/A`, `#VALUE!` 등, `src/app/platform/google-sheet-workbook-audit.ts`).
- 값은 재계산하지 않는다. 결산은 반입 때 저장된 검증 결과를 확인할 뿐 다시 검증하지 않는다.

하지 않는 것:

- 밀린 행 감지, 원인 칸 지목, 재정렬 시도. `spec-09-a-fleet-forensics.md` 와 `spec-09-b-failure-taxonomy.md` 가 그 설계이며 **문서만 있고 구현하지 않는다.** 두 문서 상단에 같은 표시를 달아 두었다.

한편 지금 코드가 `settlementMonth` 에서 주차 연도를 역산하는 것은 오히려 시트를 신뢰하지 않는 쪽이다. 시트 미러에 `sourceYear` 가 이미 있는데 쓰지 않는다. 선언된 사실을 저장해 읽는 방향이 이 결정과 같은 방향이다.

## 이 조사에서 하지 않은 것

- 라이브 데이터에 쓰기 작업을 하지 않았다. 조회만 했다.
- 코드를 수정하지 않았다. 수정안은 검증했으나 적용하지 않았다.
- AXR·JLIN 의 월문서 2건은 정확하므로 고치지 않는다. 재오픈 절차도 경고 누적도 필요 없다.
- 월결산 한 갈래만 조사했다. `cashflow-sheet-lab.mjs`(4,860줄)와 `jvm-weekly-api.mjs`(6,144줄)는 6개월간 각각 88·98건 변경되었으므로 조사하지 않은 영역에 같은 종류가 남아 있을 수 있다.
