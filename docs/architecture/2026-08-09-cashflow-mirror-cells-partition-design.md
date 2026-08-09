# SPEC-25 — mirror.cells 월별 분리 설계

**작성:** 2026-08-09
**상태:** 설계 — 착수 전 승인 필요
**선행:** SPEC-22 좌표 계약(`server/bff/cashflow-coordinates.mjs`), PR #485~#493

---

## 0. 이 문서가 필요한 이유

월 결산 대시보드 지연의 지배 항을 오해하고 있었다. `dashboard-source`(JVM 홉)를 병목으로
보고 계층 이관(PR C)을 준비했으나, 실측 결과 **BFF 가 매 요청 통째로 읽는 mirror 문서**가
나머지 전부를 합친 것의 세 배였다. 계층 이관으로는 이 비용이 줄지 않는다 — 오히려 BFF
읽기가 늘어난다.

이 문서는 실제 지배 항을 겨냥한 저장 구조 변경을 다룬다. 저장 구조와 revision 계약에
닿으므로 착수 전 승인을 받는다.

## 1. 측정 (2026-08-09, 라이브 읽기 전용)

`p1773651024850` 기준, 워밍업 후 5회 중앙값. 절대값은 측정 지점(로컬)→서울 링크라
프로덕션과 다르지만 **모든 읽기가 같은 링크를 통과하므로 상대 비교는 유효하다.**

| 읽기 | 중앙값 |
|---|---:|
| **`cashflow_sheet_mirrors/{projectId}` 1건** | **10,519ms** |
| `cashflow_weeks` 12개월(60건) | 878ms |
| `monthly_closes/{p}-{ym}` 1건 | 780ms |
| `cashflow_sheet_year_totals` 8건 | 712ms |
| `cashflow_cumulative_close_heads` 1건 | 573ms |
| `projects` 1건 | 569ms |
| `cashflow_sheet_publications` 1건 | 418ms |
| `monthly_closes` 프로젝트 전체 | 257ms |

mirror 를 뺀 나머지 합계는 4,187ms 다. mirror 하나가 그 **2.5배**다.

## 1-2. 두 축을 구별한다 — 주차 셀과 연간 셀은 다른 것이다

좌표 계약(SPEC-22)상 주별 블록과 연간 열은 형태가 다르고, 저장에서도 **이미 분리되어**
있다. 라이브 문서로 확인한 실제 구조다.

| 필드 | 개수 | 키 | 담는 연도 | 크기 |
|---|---:|---|---|---:|
| `cells` | 1,920 | `(yearMonth, weekNo, lineId, mode)` | **주별 연도 하나 = 2026** | **349KB** |
| `annualCells` | 288 | `(year, lineId, mode)` — **주차 없음** | 2024·2025·2027~2032 (**256칸**) + 2026 GRAND_TOTAL (32칸) | 58KB |
| `annualDerivedCells` | 54 | `(year, derivedKind, mode)` | 위와 같음 (48 + 6) | 8KB |
| `totalCells` | 38 | `(kind, lineId, mode)` — Total 열 BS | — | 5KB |

확인된 사실 두 가지:

- **349KB 는 전부 2026 주차 그리드다.** `cells` 의 연도 집합은 `['2026']` 하나뿐이다.
  2024·2025·2027~2032 는 `cells` 에 **존재하지 않는다** — 연 단위 관리 연도이므로 당연하다.
- `annualCells` 에 섞인 2026 은 전부 `periodKind: 'GRAND_TOTAL'`(Total 열 BS)이다.
  `GRAND_TOTAL` 을 빼면 **256칸 = 8개 연도 × 32칸**으로 `annualYearsFor(2026)` 과 정확히 일치한다.
  주별 연도에 연간 열이 없다는 계약이 저장에서도 지켜지고 있다.

**따라서 분리 대상은 `cells`(주차) 하나다.** 연간 축은 건드리지 않는다:

- `annualCells` 256칸/58KB 는 화면이 **연간 열 8개를 항상 전부** 그리므로 버리는 것이 없다.
  쪼개도 읽는 양이 같다.
- `annualDerivedCells`(8KB)·`totalCells`(5KB)도 같은 이유로 대상이 아니다.
- 즉 이 설계는 **"월별 분리" 가 아니라 "주차 그리드의 월별 분리"** 다. 연간 셀은 mirror
  문서에 그대로 남는다.

## 2. 원인 — 주차 그리드 한 필드에 1,920개 셀

`p1773651024850` mirror 총 **507KB** (다른 프로젝트도 동일 수준 — 고정 양식이므로):

| 필드 | 크기 | 개수 |
|---|---:|---:|
| **`cells`** (주차 그리드, 2026) | **349KB** | **1,920** (16라인 × 2모드 × 60주) |
| `sheetFacts` | 72KB | |
| `annualCells` (연간 열 8개 + Total) | 58KB | 288 |
| `annualDerivedCells` | 8KB | 54 |
| `totalCells` | 5KB | 38 |
| 그 외 | 15KB | |

**월 결산 화면이 주차 해상도로 그리는 것은 선택한 달의 160칸**(16라인 × 2모드 × 5주)이다.
주차 그리드 1,920칸 중 **91%를 읽어서 버린다.** 좌표 계약상 주차 셀은
`(월, 주차, 라인, 모드)` 로 결정되므로 필요한 달만 읽는 것이 가능하다.

연간 열은 사정이 다르다. 화면이 8개 연도를 **항상 전부** 그리므로 256칸을 다 쓴다.
버리는 것이 없으니 분리 대상이 아니다.

Firestore 는 문서 단위로 읽는다. 배열 필드의 일부만 가져오는 방법은 없으므로
(`select()` 는 필드 단위이고 `cells` 는 단일 배열), **문서를 쪼개는 것 외에 방법이 없다.**

## 3. 제약 — 건드리면 깨지는 것

착수 전에 확정한 사실이다.

**3-1. `sourceRevision` 이 `cells` 전체를 해싱한다**

- `cashflow-sheet-lab.mjs:734` — `stableHash({ sources, cells, annualCells, annualDerivedCells, totalCells })`
- `cashflow-sheet-snapshot.mjs:632` — 스냅샷 레벨 `revisionOf({ …, cells, … })`

이 값은 화면의 `targetRevisionAtFetch` 로 흘러 **결산 입력의 근거**가 되고
(`CashflowProjectSheet.tsx:998` → `cashflow-month-close.ts:360` → BFF `:2114` 검증),
반영 경로의 `appliedSourceRevision` 비교에도 쓰인다.

→ **해시 입력 집합이 바뀌면 안 된다.** 문서를 쪼개더라도 해시는 이전과 같은 셀 전체를
같은 순서로 먹어야 한다. 안 그러면 전 프로젝트가 "시트값을 다시 불러와 주세요" 에 걸린다.

**3-2. 소비처 15곳 — 경로별로 필요 범위가 다르다 (재확인)**

| 경로 | 소비 | 필요 범위 |
|---|---|---|
| **대시보드** `jvm-weekly-api.mjs:1987` | `normalizeMonthCloseCells(cells, yearMonth)` — 다른 달은 필터로 버린다 | **1개월** |
| 대시보드 `:2054, :2323` | `pinnedSheetCells` → `canonicalPinnedSheetWeeks` (전 기간 그룹핑) | **도달 불가** ↓ |
| 반영/수집 `cashflow-sheet-lab.mjs:1807,1814,1871` | INVALID 월 산출, 확정월 차이 검출, 반영 후보 | 60주 전체 |
| 스냅샷 저장 `cashflow-sheet-lab.mjs:1396` | `groupPinnedCellsByMonth` → 월별 문서로 저장 | 60주 전체 |

**대시보드의 전 기간 소비는 실제로 도달하지 않는다.** `pinnedSheetCells` 를 쓰는 분기는
`monthState === 'FROZEN_COMPLETE'` 뿐인데(`:734`, `:805`), 그 값을 **설정하는 생산자가
코드베이스에 없다.** 호출부 셋이 넘기는 값은 `LIVE_AMENDED`(`:2042`)와
`LIVE_CURRENT`(`:2057`, `:2326`) 뿐이고, `MONTH_CELLS` 도 마찬가지다.

→ **대시보드 경로는 1개월만 필요하다.** 전 기간이 필요한 것은 반영·수집·스냅샷 경로이며,
그쪽은 요청 빈도가 낮고 이미 전 기간을 다루는 것이 자연스러운 작업이다.

`FROZEN_COMPLETE`/`MONTH_CELLS` 분기 자체의 처리(죽은 코드 정리 또는 생산자 복원)는
이 문서의 범위 밖이며 별도 확인이 필요하다. 이 설계는 두 분기가 살아나더라도
`months: 'ALL'` 로 동작하도록 둔다.

**3-3. 프론트 DTO 에 `cells` 배열이 있다**

`sheets-cashflow-readonly-client.ts:428` 이 `Array.isArray(candidate.cells)` 로 검증한다.
→ 응답 shape 은 유지한다. 저장 구조만 바꾸고 조립은 BFF 가 한다.

## 4. 설계

### 4-1. 저장 구조

```
orgs/{tenant}/cashflow_sheet_mirrors/{projectId}          ← 유지
  sourceRevision, sources, sheetFacts, weeklyYear, applied* …
  annualCells, annualDerivedCells, totalCells      ← 연간 축은 그대로 둔다 (분리 안 함)
  cells 제거
  weeklyCellsPartition: { scheme: 'MONTH_V1', weeklyYear: 2026,
                          months: ['2026-01' … '2026-12'], cellCount: 1920 }

orgs/{tenant}/cashflow_sheet_mirrors/{projectId}/weeklyCells/{yearMonth}   ← 신규 서브컬렉션
  { yearMonth, cells: [...160] }
```

주별 연도는 하나뿐이므로 서브컬렉션 문서는 **12건**이고 문서 id 는 그 해의 연월이다.
월 하나당 160칸 ≈ **29KB**. 대시보드는 1건만 읽는다 (**349KB → 29KB**).
전 기간이 필요한 경로는 서브컬렉션을 통째로 조회한다 (12건).

이름을 `weeklyCells` 로 두는 이유: 좌표 계약이 주차 축과 연간 축을 구별하므로 저장
이름도 그 구별을 드러내야 한다. `cells` 라는 이름이 두 축을 다 담는 것처럼 읽히던 것이
이 설계를 처음 잘못 쓰게 만든 원인이다.

`weeklyCellsPartition` 은 마이그레이션 상태를 문서 스스로 말하게 하는 필드다 — 유추 금지 원칙.

**이 구조는 새 발명이 아니다.** 같은 저장소가 이미 두 축을 나눠 쓰고 있다 —
`cashflowSheetSnapshotMonthDocPath`(월별, `cashflow-sheet-lab.mjs:398`)와
`cashflowSheetSnapshotYearDocPath`(연도별, `:402`). 스냅샷 저장은 `groupPinnedCellsByMonth`
로 주차 셀을 월별 문서에 쓰고 연간은 따로 둔다. mirror 만 두 축을 한 문서에 담고 있어
이 설계는 그 예외를 선례에 맞추는 것이다.

### 4-2. 읽기 범위를 호출부가 선언한다

```js
// server/bff/cashflow-mirror-weekly-cells.mjs (신규, 조회는 여기 / 판정은 좌표 계약)
readMirrorWeeklyCells({ db, tenantId, projectId, mirror, months })  // months: ['2026-08'] | 'ALL'
```

- `months` 미지정을 허용하지 않는다. 기본값으로 전 기간을 읽으면 지금과 같아진다.
- 요청한 월이 주별 연도 밖이면 좌표 계약대로 빈 결과다 — `weekOrdinal(...) === -1`.
  없는 월 문서를 만들지도, 유추하지도 않는다.
- `weeklyCellsPartition` 이 없는 문서(마이그레이션 전)는 `mirror.cells` 를 그대로 쓴다 —
  Tolerant Reader. 새 상태·새 분류를 만들지 않는다.
- **연간 셀 접근 경로는 바뀌지 않는다.** `mirror.annualCells` 그대로다.

### 4-3. revision 불변 (가장 중요)

`sourceRevision` 계산은 **지금과 같은 입력**을 받는다. 수집 시점에는 셀 전체가 메모리에
있으므로 해시는 그대로 계산하고, 저장만 나눈다.

```js
const sourceRevision = stableHash({ sources, cells, annualCells, annualDerivedCells, totalCells });
// ↑ 무변경. cells 는 여전히 주차 그리드 전체 배열이고 연간 축도 그대로 들어간다.
await writeMirror({ ...mirror, weeklyCellsPartition });   // cells 필드만 제거
await writeWeeklyCellPartitions(cellsByMonth);            // 주별 연도의 12개월 문서
```

**검증 게이트:** 마이그레이션 전후로 각 프로젝트의 `sourceRevision` 이 **바이트 동일**이어야
한다. 하나라도 다르면 중단한다.

### 4-4. 쓰기 경로

반영·수집은 트랜잭션 안에서 mirror 문서와 주차 월별 문서를 함께 쓴다. Firestore 트랜잭션
쓰기 한도(500)에 대해 주별 연도 12건 + mirror 1건이므로 여유가 있다. 연간 셀은 mirror
문서 안에 있으므로 추가 쓰기가 없다.
`assertAtomicWriteBudget` 에 새 쓰기 수를 반영한다.

## 5. 마이그레이션 (Expand → Migrate → Contract)

| 단계 | 내용 | 롤백 |
|---|---|---|
| **E1** | 읽기가 `weeklyCellsPartition` 있으면 서브컬렉션, 없으면 `mirror.cells`. 쓰기는 **양쪽 모두** 기록 | 배포 되돌리기 |
| **E2** | 백필 스크립트로 기존 43건에 주차 서브컬렉션 생성 (`mirror.cells` 는 그대로 둠). **사본 필수** | 서브컬렉션 삭제 |
| **E3** | 읽기가 서브컬렉션만 사용. `mirror.cells` 는 여전히 존재 (읽지 않음) | E1 로 되돌리기 |
| **E4** | `mirror.cells` 제거. **되돌릴 수 없으므로 별도 승인** | 사본에서 복원 |

각 단계는 독립 배포·독립 롤백이 가능해야 한다. E4 는 이 문서의 범위 밖으로 둔다.

## 6. 성공 조건

1. **revision 바이트 동일** — 43개 프로젝트 전부, 마이그레이션 전후 `sourceRevision` 불변
2. **화면 값 동일** — 대시보드 응답을 마이그레이션 전후로 비교해 차이 0
3. 대시보드 경로의 mirror 읽기 바이트: 507KB → **≤190KB** (주차 349KB 중 29KB 만,
   연간 축 71KB 는 그대로)
4. 전 기간이 필요한 경로(반영 대상 산출·확정월 차이 검출)가 여전히 주차 60주 전체를 본다
5. **연간 열 8개 값이 변하지 않는다** — 분리 대상이 아니므로 회귀가 없어야 한다
6. 사보타주: 주차 월별 문서 하나를 빠뜨리면 전 기간 경로 테스트가 실패한다

## 7. 하지 않는 것

- `sourceRevision` 입력 집합 변경 (3-1)
- 응답 DTO 의 `cells` 배열 제거 (3-3)
- **연간 축(`annualCells`·`annualDerivedCells`·`totalCells`) 분리** — 화면이 8개 연도를 항상
  전부 그리므로 버리는 것이 없다. 쪼개도 읽는 양이 같고 계약 면적만 넓어진다
- `sheetFacts` 분리 — 72KB 로 주차 그리드(349KB)에 비해 지배 항이 아니다. 필요해지면 별도 단위
- 캐시 도입 — 저장 구조가 정리되기 전의 캐시는 문제를 가린다

## 8. 판단이 필요한 지점

**이 작업은 저장 구조와 결산 근거(revision)에 닿는다.** 지금까지의 변경(#485~#493)은
읽기·표시·인가였고 저장 형태는 건드리지 않았다. 착수 여부와 시점은 승인 사안이다.

대안으로 **아무것도 하지 않는 선택**도 유효하다. #486(리전)·#488(병렬화·상주 인스턴스)
이후 실제 사용자 체감이 충분하다면, 이 변경의 위험 대비 이득이 크지 않을 수 있다.
그 판단을 위해서는 **프로덕션 실측이 선행되어야 한다** — 라우트에 이미 구간 계측
(`cashflow.performance`)이 있으므로, 화면 접속 한 번으로 Vercel 로그에서 확인할 수 있다.

권장 순서:

1. 프로덕션 구간 실측 (화면 1회 접속, 코드 변경 0)
2. mirror 읽기가 실제 지배 항으로 확인되면 E1 착수
3. 아니면 이 문서를 보류 상태로 남기고 다른 항목으로
