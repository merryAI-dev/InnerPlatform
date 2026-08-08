# SPEC-22 — 좌표 계약 이행 (워커 공통 브리프)

**작성:** 2026-08-08 · **상태:** 계약 확정, 이행 중
**단일 진실:** `server/bff/cashflow-coordinates.mjs`
**근거 계약:** `docs/architecture/contracts/2026-07-28-cashflow-formula-validation-contract.md`

이 문서를 **먼저 전부 읽고** 작업을 시작하세요.

---

## 0. 왜 이 작업을 하는가 — 확정된 사고

2026-08-07 라이브 확정, 프로젝트 `p1773651024850`:

| 증상 | 값 |
|---|---|
| 시트의 2025 연간 열 Actual | **317,449,417** |
| 화면에 표시된 2025 Actual | **7,582,243** |
| 차이 | **약 3억 1천만 원** |

원인은 **낙오 주차 문서** 1건입니다. `p1773651024850-2025-12-w4` 에 `SALES_IN 7,582,243` 이 저장되어 있습니다.
2025 년은 시트에서 **연 단위 관리 연도**라 12월도 4주차도 존재하지 않습니다. 좌표에 대응 칸이 없는 문서입니다.

그런데 읽기 경로가 **"문서가 있으니 2025 는 주별 관리 연도"** 로 유추합니다. 그러면:

1. 2025 → 주별 연도로 분류
2. → 연간 fallback 대상에서 제외
3. → 시트의 2025 연간 열 무시
4. → 낙오 문서 값이 그 자리를 차지

**낙오 문서 1건이 연도 하나를 통째로 뒤집습니다.**

---

## 1. 좌표 계약 (변경 불가 · 재론 없음)

사업비 관리 시트는 **전사 단일 고정 양식**입니다. 읽기는 고정 좌표에서 값을 꺼내는 것이고, 그 이상은 하지 않습니다.

```
좌표    C      D    │  E ─────────── BL  │  BM ──────── BR   │  BS
연도   2024  2025   │      2026 주별      │   2027 … 2032    │ Total
칸수    1     1     │   60 (12월 × 5주)   │       6          │
```

| # | 원칙 |
|---|---|
| 1 | **주별 블록은 `E:BL` 60칸 하나뿐.** 그 연도는 프로젝트당 **단일 상수**. "어느 연도들이 주별인가"는 집합 질문이 아니다 |
| 2 | **연간 열은 `C:D`(이전 2개) + `BM:BR`(이후 6개) 고정.** 연간 값은 이 좌표에서 읽는다 |
| 3 | **라인 정체성 = 행 인덱스** (`LINE_ROWS`). 라벨 문자열·alias 로 라인을 찾지 않는다 |
| 4 | **좌표 밖 = 존재하지 않음.** `weekOrdinal(...) === -1` 이면 읽기 경로 진입 금지 |
| 5 | **양식이 다르면 적응하지 않고 거부.** `CashflowTemplateMismatchError` → "양식이 다릅니다." |

`lineRowIndexes[i]` ↔ `policies/cashflow-policy.json` 의 `lineEntries[i]` 가 **1:1 대응함이 테스트로 고정**되어 있습니다
(`server/bff/cashflow-coordinates.test.mjs`). 라벨 매칭은 같은 사실을 두 번 구하는 중복입니다.

### 계약 API

```js
import {
  LINE_ROWS, LINE_IDS, WEEKS_PER_MONTH, WEEKS_PER_YEAR,
  requireWeeklyYear, annualYearsFor, isWeeklyMonth,
  weekOrdinal, weekColumnFor, annualColumnFor,
  lineRowFor, lineIndexOfRow, CashflowTemplateMismatchError,
} from './cashflow-coordinates.mjs';
```

`annualYearsFor(2026)` → `[2024, 2025, 2027, 2028, 2029, 2030, 2031, 2032]`
`weekOrdinal(2026, '2025-12', 4)` → `-1` (낙오 문서 거부)
`weekOrdinal(2026, '2026-03', 2)` → `11`

### 주별 연도(`weeklyYear`)는 어디서 오는가

시트 주차 라벨 행(`E12`/`E35`, 예: `26-1-1`)이 선언합니다. 수집 시점에 **한 번** 읽어
`cashflow_sheet_mirrors/{projectId}.weeklyYear` 에 **단일 숫자**로 저장합니다.
하류는 전부 그 필드 하나를 읽습니다. 재유도·집합화 금지.

---

## 2. 금지 사항 (공통)

- 새 `weeklyYears` 배열/Set/연도 집합 유도를 만들지 않는다
- 주차 문서를 합산해 **연간값을 만들지 않는다** (연간 열 좌표에서 읽는다)
- `EMPTY` 와 `ZERO` 를 뭉개지 않는다. 셀 상태는 저장값이며 금액에서 역산하지 않는다
- 폴백 체인·보정·추론으로 결손을 메우지 않는다 (거부한다)
- 과거 `monthly_closes.snapshot`, `snapshotHash`, CLOSED 판정값 재작성·backfill 금지 (SPEC-04)
- `LIVE_AMENDED` 전역 revision 검증 변경 금지 (SPEC-16 선행 필요)
- **낙오 문서 삭제 금지.** 읽기에서 배제만 한다. 데이터 정리는 별도 승인 사안
- 테스트만 통과시키는 우회 금지 — **사보타주 검증 필수**

## 3. 공통 성공 조건

각 워커는 완료 보고에 아래를 포함합니다.

1. 변경 파일 목록
2. 대상 테스트 결과 (통과 수 / 전체)
3. **사보타주 결과** — 계약을 의도적으로 깼을 때 테스트가 실패하는지 확인하고 원복. 실패 건수를 보고
4. 계약 위반 잔존 0건 근거 (해당 영역 grep 결과)
5. 못 한 것 / 범위 밖으로 남긴 것

커밋은 Conventional Commits (`fix(cashflow): ...`), 본문은 한국어로 **무엇이 왜 틀렸고 무엇으로 바꿨는지** 서술.

---

## 4. 워커 분담 (파일 충돌 없음)

| 워커 | 항목 | 파일 영역 |
|---|---|---|
| **W-FE** | ① 프론트 연간 재계산 제거 | `src/app/components/cashflow/` |
| **W-TPL** | ② 라벨 매칭 제거 | `server/bff/cashflow-sheet-template.mjs`, `cashflow-canonical-store.mjs`, `policies/cashflow-policy.json` |
| **W-JVM** | ⑥⑦ 무범위 스캔 + weeklyYears 집합 | `server/jvm-weekly-api/**` |
| **W-BFF** | ③④⑤ 유추·폴백·산술 인덱스 | `server/bff/routes/jvm-weekly-api.mjs` |

**다른 워커의 파일 영역을 건드리지 마세요.** 필요하면 완료 보고에 "이 영역도 바꿔야 한다"고 적으세요.

---

## 5. 각 워커 상세

### W-FE — 프론트 연간 재계산 제거 (3억 오차의 확정 경로)

**위반:** `src/app/components/cashflow/cashflow-month-close.ts:40` `summarizeCanonicalCashflowYear`

```ts
const selected = months.filter((m) => Number(m.yearMonth.slice(0,4)) === year);
if (!selected.length) return null;
lineAmounts = ... selected.reduce(... week.amounts[lineId] ...)   // 주차를 합산해 연간값 생성
lineStates: hasValue ? (lineAmounts[lineId] === 0 ? 'ZERO' : 'VALUE') : 'EMPTY'  // 상태 역산
```

두 가지를 다 어깁니다 — 주차 합산으로 연간값을 만들고, 셀 상태를 금액에서 역산합니다.
2025 에 낙오 문서 1건이 있으면 `selected.length === 1` 이 되어 그 값이 2025 연간값이 됩니다.
시트의 317,449,417 은 화면에 도달할 경로가 없습니다.

**할 일:** 연간 값과 셀 상태를 **서버가 준 연간 열 DTO 그대로** 표시합니다. 클라이언트 재계산·역산 제거.
서버 DTO 형태가 아직 없으면 **소비 지점을 먼저 DTO 기준으로 바꾸고**, 필요한 필드를 완료 보고에 명시하세요
(W-BFF 가 그 필드를 채웁니다). 프론트에서 서버 필드를 재구현하지 마세요.

**주의:** 이 저장소의 프론트 테스트 다수가 소스 문자열 매칭(`expect(source).toContain(...)`)이라 회귀를 못 잡습니다.
값 동일성을 실제로 검증하는 테스트를 1건 이상 세우고 들어가세요.

### W-TPL — 라벨 매칭 제거

**위반:** `server/bff/cashflow-sheet-template.mjs:39,50,51,66,199`, `cashflow-canonical-store.mjs:61`

`buildCashflowLineLookup` (약 32줄) 이 라벨 정규화 + alias 15개 + `ambiguousKeys`(동명이인 방어)로 라인을 찾습니다.
행 인덱스가 이미 라인 정체성인데 같은 사실을 문자열로 다시 구합니다.
고정 양식에서 동명이인은 발생할 수 없으므로 `ambiguousKeys` 는 **일어날 수 없는 일을 방어하는 코드**입니다.

**할 일:** `lineRowFor` / `lineIndexOfRow` 로 대체. `buildCashflowLineLookup` 과 정책 JSON 의 `aliases` 필드 제거.
라벨은 **표시용으로만** 남깁니다. 헤더 라벨이 예상과 다르면 보정하지 말고 `CashflowTemplateMismatchError` 로 거부.

### W-JVM — 무범위 스캔 + weeklyYears 집합

**위반 1:** `FirestoreInheritedWeeklyExpensePersistence.java` — `whereEqualTo("projectId", projectId)` 만 있고
`yearMonth` 필터도 `limit` 도 없는 쿼리 **10곳**. 복합 인덱스(`projectId+yearMonth+weekNo`)는
`firebase/firestore.indexes.json` 에 **이미 선언**되어 있는데 쿼리가 안 씁니다. Postgres 접근 패턴의 잔재입니다.

**위반 2:** `WeeklyExpensePersistence.java:725-737` `findCashflowLedgerSource` 가 원장 문서에서 연도 집합을 재유도.
`:756-824` `findCashflowOpeningBalance` 의 *"prior year uses weekly ledger lines when that year exists in the weekly ledger;
the annual-total document is only a fallback"* 우선순위 규칙.

이 우선순위 규칙이 **낙오 문서에 시트 연간 열보다 높은 권한을 줍니다.** 좌표 계약에서는 겹칠 수가 없으므로 규칙 자체가 소멸합니다.

**할 일:**
- 대시보드 원장 읽기를 주별 블록 연도 범위로 고정. `CashflowQueryScope.between()` 을 쓰는 bounded 오버로드가 이미 있습니다
- `weeklyYears` 집합 유도 → 단일 `weeklyYear` 상수
- 이전 연도는 **항상** `cashflow_sheet_year_totals` 에서 읽습니다 (fallback 아님, 유일 경로)
- **`LIVE_AMENDED` 경로는 손대지 마세요.** `WeeklyExpenseController.java:506` 이 전역 해시를 검증하며 SPEC-16 선행이 필요합니다.
  OPEN 과 일반 CLOSED 만 다룹니다

**성공 조건 추가:** 가짜 persistence 로 OPEN 읽기 문서 수를 단언하는 테스트. 낙오 문서를 fixture 에 심고
**읽히지 않음**을 단언하세요 (이게 이 워커의 핵심 사보타주입니다).

### W-BFF — 유추 · 폴백 · 산술 인덱스

**단일 파일 `server/bff/routes/jvm-weekly-api.mjs` 안이라 아래 순서대로 순차 진행하세요.**

**③ `canonicalCashflowWeeks` (643-682) — 유추와 3단 폴백**

```js
for (const month of cashflow?.readModel?.months ?? []) { /* 있으면 5주로 펼침 */ }
if (byKey.size > 0)      { ... }   // 폴백 1
if (pinnedWeeks.length)  { ... }   // 폴백 2
if (completeMonthCloseCells(cells)) { ... }  // 폴백 3
```

낙오 문서가 연도를 둔갑시키는 지점입니다. 폴백 3단은 자기 추론이 틀릴 때를 방어하는 코드입니다.
→ `weekOrdinal` 로 좌표 밖을 배제. 폴백 제거하고 월 상태로 분기.

**④ `.find()` 탐색 11건 — 613, 619, 620, 651, 657, 658, 1841 외**

```js
month?.projection?.weeks?.find((w) => Number(w?.weekNo) === weekNo)?.amounts || {}
```

주차 5칸이 고정인데 배열을 매번 순회합니다. `|| {}` 는 "없을 수도 있다"는 전제인데 고정 양식에선 항상 있습니다.
→ 산술 인덱스. `server/bff/cashflow-template-index.mjs` (PR #482) 가 이 용도로 만들어졌으나 **아직 미배선**입니다.
단, 그 모듈의 `weeklyYears` **배열/Set 부분은 좌표 계약의 단일 상수로 교체**하고 배선하세요.

**⑤ `composeCashflowMonthDashboard` (1826-2204) — 구조 폴백 체인 14건+**

```js
const project    = closedSnapshot?.project || projectDocument || {};
const sheetFacts = closedSnapshot?.sheetFacts || mirror?.sheetFacts || null;
```

같은 사실에 소스가 2~3개고 런타임에 고릅니다. 어느 게 진실인지 코드가 모릅니다.
→ 월 상태(OPEN / 일반 CLOSED / LIVE_AMENDED)가 소스를 **결정**하도록 분기. 고르지 않습니다.

**추가:** W-FE 가 요구하는 연간 열 DTO 필드를 서버에서 채웁니다. 연간 값은 연간 열 좌표에서 읽은 저장값을
**원문 그대로** 전달하세요 — BFF 에서 연간 합계를 재구현하면 SSOT 위반입니다.

---

## 6. 보고

막히면 추측하지 말고 코디네이터에게 물어보세요.

```bash
orca orchestration ask --question "<질문>" --timeout-ms 600000 --json
```

완료 시:

```bash
orca orchestration send --type worker_done --subject "<상태>" \
  --body "<변경·테스트·사보타주·잔존·미완>" \
  --task-id <task_id> --dispatch-id <dispatch_id> \
  --outcome succeeded --files-modified "path/a,path/b" --json
```

실패는 산문에만 적지 말고 `--outcome failed` 로 표시하세요.
