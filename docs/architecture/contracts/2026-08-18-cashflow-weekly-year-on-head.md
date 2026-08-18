# 주차 연도를 결산 head 에 기록한다

**날짜:** 2026-08-18
**상태:** 설계 확정 · 구현 전
**관련:** [기간 권한 계약](./2026-08-14-cashflow-period-authority.md) · [잠금 권한 후속](./2026-08-18-cashflow-close-authority-followup.md)

## 문제

시트는 주차 연도를 선언한다. 미러는 그것을 `weeklyYear` 로 저장하고, JVM 은 `findCashflowDeclaredWeeklyYear()` 로 읽는다. 그런데 **누적 결산 head 에는 그 값이 없다.**

그래서 잠금 판정이 회차 월에서 연도를 역산한다.

```js
month.slice(0, 4) === settlementMonth.slice(0, 4)   // "회차 월은 주차 연도 안에 있다"
```

결과는 맞다. 회차 월은 지평선의 다음 달이고, 그 시점의 주차 연도 안에 있기 때문이다. 다만 **왜 맞는지가 코드에 없다.**

그 대가는 실측되었다. 2026-08-18 조사에서 담당자(Claude)가 이 추론을 읽지 못해 "연말에 잠금이 풀리는 버그"로 오판하고, 양쪽 런타임을 고치고, parity 표에 틀린 기대값까지 넣었다. 기존 테스트 `januarySettlementKeepsThePreviousAnnualYearOutsideMonthlyWriteAuthority` 가 잡아내지 않았다면 잘못된 규칙이 "검증된 규칙" 으로 굳었을 것이다.

양식 규칙은 해마다 바뀐다. 2027 년에는 2026 이 연간으로 내려가고 2027 이 주차가 된다. 역산은 그때도 동작하겠지만, 왜 동작하는지 모르는 채로 동작한다.

## 설계

**결산 시점의 선언된 주차 연도를 head 에 기록하고, 판정은 그것만 읽는다.**

```js
locked(month) = isWeeklyMonth(head.weeklyYear, month) && month <= head.closedThrough
```

`isWeeklyMonth` 는 좌표 계약에 이미 있고 (`cashflow-coordinates.mjs`, JVM `CashflowCoordinates`), 새로 만드는 판정은 없다.

### 미러를 직접 읽지 않는 이유

미러는 현재 상태이고 head 는 과거 사건이다. 시트가 2027 주차로 넘어가면 `mirror.weeklyYear` 는 2027 이 된다. 그 값으로 2026 년에 확정된 head 를 판정하면 **과거 결산의 잠금 범위가 나중에 바뀐다.** 권한 문서는 그 시점의 사실을 보존해야 하므로 결산 시점 값을 박는다.

### 폴백을 두지 않는 이유

```js
head.weeklyYear ?? Number(head.settlementMonth.slice(0, 4))   // 넣지 않는다
```

지우려는 역산을 폴백이라는 이름으로 보존하게 된다. 두 경로가 영구히 공존하고 다음 사람은 여전히 역산을 읽어야 하므로, 이 작업을 할 이유가 사라진다.

값이 없는 head 는 판정 불능으로 다루어 `readCashflowCumulativeCloseAuthority` 가 `null` 을 돌려주고, 쓰기 가드가 409 `cashflow_month_close_contract_invalid` 로 막는다. 모르면 추측하지 않고 멈춘다는 이 저장소의 기존 원칙과 같다.

## 변경 범위

**쓰는 쪽 (2곳)**

| 위치 | 내용 |
|---|---|
| JVM 결산 head 기록 | `findCashflowDeclaredWeeklyYear()` 결과를 `weeklyYear` 로 저장 |
| `cashflow-cumulative-close-head-recovery.mjs` 의 `HEAD_FIELDS` | 목록에 `weeklyYear` 추가 |

**판정하는 쪽 (3곳) — 역산 제거**

| 위치 | 지금 | 이후 |
|---|---|---|
| `cashflow-month-state.mjs:91` | `settlementMonth.slice(0, 4)` | `authority.weeklyYear` |
| `cashflow-close-calendar.mjs` `cashflowCumulativeMonthLocked` | 같음 | `isWeeklyMonth(...)` |
| JVM `CashflowMonthLock` | `settlementMonth.getYear()` | `CashflowCoordinates` |

**짝 테이블** — `cashflow-month-lock.test.mjs` 와 `CashflowMonthLockTest` 를 `weeklyYear` 입력으로 바꾼다. 기대값은 새로 지어내지 않고 기존 JVM 테스트에서 가져온다. 특히 `januarySettlementKeepsThePreviousAnnualYearOutsideMonthlyWriteAuthority` 의 시나리오(회차 2026-01, 지평선 2025-12, 2025-12 는 쓰기 가능)를 표에 포함한다.

## 백필하지 않는다

기존 head 3 건은 QA 데이터이며 어차피 리셋 대상이다 (2026-08-18 보람 결정). 따라서 **라이브 쓰기가 없고 2 단계 배포도 필요 없다.**

배포 후 그 3 건은 `weeklyYear` 가 없으므로 판정 불능이 되어 409 로 막힌다. 복구는 기존 경로를 쓴다 — `RESET_TO_RECLOSE` 로 head 를 정리한 뒤 정상 결산을 다시 수행하면 새 head 가 `weeklyYear` 를 포함한다.

## 범위 밖

- `monthly_closes` 에 `throughMonth` 저장. 같은 처방(선언된 사실을 저장한다)이지만 별도로 진행한다. 롤백 단위를 작게 유지한다.
- 시트 손상 진단. [범위 결정](./2026-08-18-cashflow-close-authority-followup.md) 참고.

## 성공 기준

- 잠금 판정에서 `settlementMonth` 로 연도를 유도하는 코드가 남지 않는다 (정적 검색으로 확인).
- 새 결산이 만든 head 는 `weeklyYear` 를 포함한다.
- `weeklyYear` 가 없는 head 는 잠그지도 통과시키지도 않고 409 로 막는다.
- 짝 테이블이 BFF·JVM 양쪽에서 같은 표로 통과하고, 한쪽 규칙을 바꾸면 반대쪽이 깨진다.
- 기존 JVM 결산·잠금 테스트가 그대로 통과한다. 특히 1 월 회차 시나리오.
