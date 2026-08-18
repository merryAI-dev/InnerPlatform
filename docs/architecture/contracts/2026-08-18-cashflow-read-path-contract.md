# 현금흐름 읽기 경로 계약 — JVM 은 쓰기, BFF 는 읽기

**날짜:** 2026-08-18
**상태:** 설계 확정 · 구현 전
**선행:** [기간 권한 계약](./2026-08-14-cashflow-period-authority.md) · [잠금 권한 후속](./2026-08-18-cashflow-close-authority-followup.md) · [라이브 QA](./2026-08-18-cashflow-close-authority-live-qa.md)

## 첫 번째 원칙 — 짓지 말고 걷어낸다

이 계약은 새 계층을 세우지 않는다. 지금 화면 하나를 그리려고 **같은 Firestore 문서를 두 런타임이 각자 읽고 두 번 조립하는 것**을 한 번으로 줄인다. 성공의 척도는 늘어난 줄이 아니라 **사라진 줄**이다.

## 오늘 확인된 것

### 화면 하나에 JVM 왕복 둘, 조립 둘

`GET /api/v1/cashflow/:projectId/month-close` 한 요청이 하는 일:

```
BFF ──▶ JVM  GET /month-close/dashboard-source     (jvm_dashboard)
BFF ──▶ JVM  주간 정산 준수                          (jvm_compliance)
JVM:  Firestore 7종 읽기 → CashflowMonthDashboardSourceResponse (10 필드) 조립
BFF:  그 응답 + 미러 + 스냅샷 → composeCashflowMonthDashboard 433줄로 다시 조립
```

라이브 실측 (AXR, 2026-08-18): **8,654ms**. `stage` 9,032~9,401ms. 44개 사업이 매일 볼 화면이다.

JVM `dashboard-source` 가 읽는 것은 `monthClose`, `ledgerSource`, `openingBalance`, `cumulativeCloseHead`, `declaredWeeklyYear`, `globalLedgerSource`, 그리고 section 조회다. **전부 Firestore 문서 읽기다.** 트랜잭션도 잠금도 없다. 판정이 아니라 조립이며, 그 조립을 BFF 가 한 번 더 한다.

### 읽는 쪽이 원천을 고르다 틀린 사건 셋

오늘 라이브에서 고친 셋이 전부 같은 종류였다.

| | 무엇을 골랐나 | 왜 틀렸나 |
|---|---|---|
| 8월 오잠금 | `monthly_closes` 를 권한 판정에 | 회차 이름표를 데이터 월로 오독 |
| 연간 열 확인 불가 | 계산기가 상태를 세고 버림 | 셀 상태를 그대로 전달하면 될 것 |
| 미러 갱신 안 됨 | 시트 modifiedTime 만 보고 fast-path | 코드가 바뀌면 전제가 깨짐 |

그리고 넷째가 남아 있다.

| | 무엇을 골랐나 | 왜 틀렸나 |
|---|---|---|
| **결산된 회차의 연간 열** | CLOSED 면 결산 스냅샷의 `sheetFacts` | 연간 열은 결산 대상이 아닌데 딸려 얼어붙음. 코드가 고쳐져도 스냅샷은 옛 형태 |

넷째는 데이터를 건드려서 풀 일이 아니다. 리셋 도구는 head 가 정상이라 거부하고(`NORMAL_REOPEN_REQUIRED`), 스냅샷 직접 수정은 해시에 걸리며, 재오픈은 승인 20회에 경고 20건이다. **읽는 쪽이 "CLOSED 면 스냅샷" 으로 분기하는 구조**가 문제이고, 그 분기가 사라지면 증상도 사라진다.

## 원칙

### 1. JVM 은 쓰기 판정, BFF 는 읽기 조립

| 책임 | 어디 | 이유 |
|---|---|---|
| 잠금 판정, 사유 요구, 결산·재오픈 전이, 감사 기록 | **JVM** | 트랜잭션 안에서 봐야 한다. 계약 그대로 |
| 화면에 무엇을 어떻게 그리나 | **BFF** | 판정이 아니다. Firestore 를 읽어 조립한다 |

**BFF 는 화면을 그리려고 JVM 을 기다리지 않는다.** JVM 이 쓴 문서를 읽는다.

기간 권한 계약의 "판정 주체는 JVM" 은 유지된다. 그 계약이 말한 판정은 쓰기 판정이다. 읽기 조립을 JVM 에 두라고 한 적은 없고, 실제로 `dashboard-source` 는 판정을 하지 않는다.

### 2. 동결 증거의 경계는 저장 구조가 말한다

결산 근거는 나중에 바뀌면 안 된다. 이건 유지한다. 다만 지금은 **읽는 쪽이 "CLOSED 면 스냅샷" 으로 분기**해서 지키는데, 그 분기 때문에 근거가 아닌 것까지 얼어붙는다.

앞으로는 **쓰는 쪽이 경계를 긋는다.**

| 결산 근거 (얼린다) | 표시값 (얼리지 않는다) |
|---|---|
| 회차 범위의 주차 값 | 연간 열 항목별 상태·금액 |
| 입금·출금 합계, 잔액 | 시트 수식 검산 |
| 확인 서명, 승인 | Projection–Actual 편차 표시 |
| `rootHash`, revision | 커버리지 안내 |

결산 시 JVM 은 **왼쪽만** 스냅샷에 넣는다. BFF 는 왼쪽을 스냅샷에서, 오른쪽을 미러에서 읽는다. 어느 쪽인지 **문서 위치가 말하므로** 읽는 쪽이 판단하지 않는다.

`sabotageMirror` 테스트("미러를 망가뜨려도 CLOSED 화면은 그대로")는 왼쪽 열에 대해 유지한다. 오른쪽 열은 미러가 원천이므로 미러가 망가지면 망가진 대로 보이는 것이 맞다 — 낡은 값을 최신이라 말하지 않는다.

### 3. 폴백을 두지 않는다

"미러 없으면 스냅샷, 스냅샷 없으면 JVM" 같은 사슬을 만들지 않는다. 오늘 확인했듯 폴백은 지우려는 옛 경로를 영구히 보존한다. 원천이 없으면 그 section 만 `UNAVAILABLE` 로 표시하고 나머지는 그린다 — 기간 권한 계약의 "조회 부가 기능의 실패는 해당 section 만" 그대로다.

### 4. 계산하지 않는다

BFF 읽기 경로에 합산·차감·역산을 두지 않는다. 시트가 SSOT 이고, 합계는 시트 선언값이며, 항목은 셀 그대로다. 오늘 `summarizeAnnualMode` 에서 -87 줄을 걷어낸 것과 같은 기준을 조립부 전체에 적용한다. 계산이 필요하면 JVM 이 쓸 때 하고 결과를 저장한다.

## 변경 범위

### 걷어내는 것

| 대상 | 지금 | 이후 |
|---|---|---|
| `GET /month-close/dashboard-source` (JVM) | BFF 가 매 화면마다 호출 | **호출 제거.** JVM 엔드포인트는 남겨두되 BFF 읽기 경로에서 뗀다 |
| `proxyJavaWeeklyRequest` × 2 in month-close GET | `jvm_dashboard`, `jvm_compliance` | 둘 다 Firestore 직접 읽기로 |
| `composeCashflowMonthDashboard` 433줄 | JVM 응답 + 미러 + 스냅샷 삼중 조립 | Firestore 문서 → 화면 모델 단일 조립. **목표: 절반 이하** |
| `closedSnapshot ? snapshot.sheetFacts : mirror.sheetFacts` 분기 | 읽는 쪽 판단 | 없음. 결산 근거는 스냅샷, 표시값은 미러 — 위치가 정함 |
| `amendedSheetFormulaSnapshot` revision 3개 일치 검사 | 어긋나면 연간 열 통째로 감춤 | 연간 열이 미러 원천이 되면 이 검사가 연간 열에 걸리지 않음. 검사 자체는 결산 근거에 대해서만 |
| `/cashflow-sheet-lab/years` 라우트 + `getCashflowSheetLabYearViewViaBff` | 셸 테스트가 화면에서 쓰지 말라고 못 박은 죽은 경로 | 제거 |

### 남기는 것

- JVM 쓰기 경로 전부. `CashflowMonthLock`, 결산·재오픈·amendment 트랜잭션, 감사 기록.
- 좌표 계약, 짝 테이블, 사보타주 테스트.
- 미러 fast-path (schemaVersion 조건 포함).
- 결산 스냅샷의 결산 근거 부분과 그 해시.

### 순서

```
1. 결산 근거 / 표시값 경계를 스냅샷 쓰기(JVM) 에 반영
   — 새 결산부터 스냅샷에 표시값을 넣지 않는다. 옛 스냅샷은 그대로 둔다 (읽지 않게 되므로 무해)
2. BFF month-close GET 에서 jvm_dashboard 제거, Firestore 직접 읽기
   — 여기서 8초가 사라져야 한다. 측정한다
3. composeCashflowMonthDashboard 를 단일 원천 조립으로 재작성
   — 삼중 분기 제거. 줄 수를 기록한다
4. jvm_compliance 도 같은 방식
5. 죽은 라우트 제거
```

각 단계가 독립 PR 이고 되돌릴 수 있다. 1 이 끝나면 2 부터 라이브에서 AXR·JLIN 을 그대로 둔 채 검증한다 — **옛 형태 스냅샷이 남아 있어도 화면이 정상**인지가 이 재설계의 검증 케이스다. 그래서 그 두 프로젝트를 지금 리셋하지 않는다.

## 측정

| 지표 | 지금 | 목표 |
|---|---|---|
| `month-close` GET 응답 | 8,654ms | 측정 후 확정. JVM 왕복 제거만으로 대부분 |
| BFF 가 화면당 부르는 JVM 엔드포인트 | 2 | **0** |
| `composeCashflowMonthDashboard` 줄 수 | 433 | 기록 |
| AXR·JLIN 결산 회차 화면 연간 열 | 확인 불가 | 값 — 데이터 손 안 대고 |
| 읽기 경로의 산술 (`add`, `sum`, `-`) | 세지 않음 | 0 |

## 범위 밖

- JVM 재계층화. 쓰기 경로는 손대지 않는다.
- 결산 스냅샷의 옛 데이터 마이그레이션. 읽지 않게 되면 무해하다.
- 시트 손상 진단 (범위 밖 결정 유지).
- 재오픈·복구 흐름 변경.

## 위험

- **결산 근거 경계를 잘못 그으면** 근거여야 할 값이 미러에서 읽혀 나중에 바뀔 수 있다. 1 단계에서 경계 표를 JVM 테스트로 고정한다 — 스냅샷에 들어가는 키 목록을 짝 테이블처럼.
- **BFF 가 Firestore 를 직접 읽으면 JVM 이 쓴 문서 형태에 결합**된다. 이미 그렇다 (`monthly_closes`, head, 미러를 BFF 가 읽는다). 새 결합이 아니라 있는 결합을 한 곳으로 모으는 것이다.
