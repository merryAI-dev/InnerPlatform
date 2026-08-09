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

## 2. 원인 — 문서 하나에 1,920개 셀

`p1773651024850` mirror 총 **507KB** (다른 프로젝트도 동일 수준 — 고정 양식이므로):

| 필드 | 크기 | 개수 |
|---|---:|---:|
| **`cells`** | **349KB** | **1,920** (16라인 × 2모드 × 60주) |
| `sheetFacts` | 72KB | |
| `annualCells` | 58KB | 288 |
| `annualDerivedCells` | 8KB | 54 |
| `totalCells` | 5KB | 38 |
| 그 외 | 15KB | |

**월 결산 화면이 그리는 것은 선택한 달의 160칸**(16라인 × 2모드 × 5주)이다.
1,920칸 중 **91%를 읽어서 버린다.** 좌표 계약상 셀은 `(월, 주차, 라인, 모드)` 로
결정되므로, 필요한 달만 읽는 것이 가능하다.

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

**3-2. 소비처 15곳**

`mirror.cells` 를 읽는 곳이 BFF 에 15곳 있다. 성격이 두 가지다.

| 성격 | 예 | 필요 범위 |
|---|---|---|
| 선택 월만 필요 | `normalizeMonthCloseCells(mirror.cells, yearMonth)` (`jvm-weekly-api.mjs:1987`) | 1개월 |
| 전 기간 필요 | 반영 대상 월 산출, 확정월 차이 검출 (`cashflow-sheet-lab.mjs:1807,1814,1871`) | 60주 전체 |

→ 전 기간이 필요한 경로가 실재하므로 **"항상 1개월만 읽기" 는 불가능하다.** 읽기 범위를
호출부가 선언하게 만들어야 한다.

**3-3. 프론트 DTO 에 `cells` 배열이 있다**

`sheets-cashflow-readonly-client.ts:428` 이 `Array.isArray(candidate.cells)` 로 검증한다.
→ 응답 shape 은 유지한다. 저장 구조만 바꾸고 조립은 BFF 가 한다.

## 4. 설계

### 4-1. 저장 구조

```
orgs/{tenant}/cashflow_sheet_mirrors/{projectId}          ← 유지 (cells 만 제거)
  sourceRevision, sources, annualCells, annualDerivedCells,
  totalCells, sheetFacts, weeklyYear, applied* …
  cellsPartition: { scheme: 'MONTH_V1', months: ['2026-01', …], cellCount: 1920 }

orgs/{tenant}/cashflow_sheet_mirrors/{projectId}/cells/{yearMonth}   ← 신규 서브컬렉션
  { yearMonth, cells: [...160], revision }
```

월 하나당 160칸 ≈ **29KB**. 대시보드는 1건만 읽는다 (**349KB → 29KB**).
전 기간이 필요한 경로는 서브컬렉션을 통째로 조회한다 (12건 병렬).

`cellsPartition` 은 마이그레이션 상태를 문서 스스로 말하게 하는 필드다 — 유추 금지 원칙.

### 4-2. 읽기 범위를 호출부가 선언한다

```js
// server/bff/cashflow-mirror-cells.mjs (신규, 순수 조립 + 조회 분리)
readMirrorCells({ db, tenantId, projectId, mirror, months })   // months: ['2026-08'] | 'ALL'
```

- `months` 미지정을 허용하지 않는다. 기본값으로 전 기간을 읽으면 지금과 같아진다.
- `cellsPartition` 이 없는 문서(마이그레이션 전)는 `mirror.cells` 를 그대로 쓴다 —
  Tolerant Reader. 새 상태·새 분류를 만들지 않는다.

### 4-3. revision 불변 (가장 중요)

`sourceRevision` 계산은 **지금과 같은 입력**을 받는다. 수집 시점에는 셀 전체가 메모리에
있으므로 해시는 그대로 계산하고, 저장만 나눈다.

```js
const sourceRevision = stableHash({ sources, cells, annualCells, annualDerivedCells, totalCells });
// ↑ 무변경. cells 는 여전히 전체 배열이다.
await writeMirror({ ...mirror, cellsPartition });        // cells 필드 제거
await writeCellPartitions(cellsByMonth);                  // 월별 문서
```

**검증 게이트:** 마이그레이션 전후로 각 프로젝트의 `sourceRevision` 이 **바이트 동일**이어야
한다. 하나라도 다르면 중단한다.

### 4-4. 쓰기 경로

반영·수집은 트랜잭션 안에서 mirror 문서와 월별 셀 문서를 함께 쓴다. Firestore 트랜잭션
쓰기 한도(500)에 대해 월 12건 + mirror 1건이므로 여유가 있다.
`assertAtomicWriteBudget` 에 새 쓰기 수를 반영한다.

## 5. 마이그레이션 (Expand → Migrate → Contract)

| 단계 | 내용 | 롤백 |
|---|---|---|
| **E1** | 읽기가 `cellsPartition` 있으면 서브컬렉션, 없으면 `mirror.cells`. 쓰기는 **양쪽 모두** 기록 | 배포 되돌리기 |
| **E2** | 백필 스크립트로 기존 43건에 서브컬렉션 생성 (`mirror.cells` 는 그대로 둠). **사본 필수** | 서브컬렉션 삭제 |
| **E3** | 읽기가 서브컬렉션만 사용. `mirror.cells` 는 여전히 존재 (읽지 않음) | E1 로 되돌리기 |
| **E4** | `mirror.cells` 제거. **되돌릴 수 없으므로 별도 승인** | 사본에서 복원 |

각 단계는 독립 배포·독립 롤백이 가능해야 한다. E4 는 이 문서의 범위 밖으로 둔다.

## 6. 성공 조건

1. **revision 바이트 동일** — 43개 프로젝트 전부, 마이그레이션 전후 `sourceRevision` 불변
2. **화면 값 동일** — 대시보드 응답을 마이그레이션 전후로 비교해 차이 0
3. 대시보드 경로의 mirror 읽기 바이트: 507KB → **≤180KB** (cells 349KB 중 29KB 만)
4. 전 기간이 필요한 경로(반영 대상 산출·확정월 차이 검출)가 여전히 60주 전체를 본다
5. 사보타주: 월별 문서 하나를 빠뜨리면 전 기간 경로 테스트가 실패한다

## 7. 하지 않는 것

- `sourceRevision` 입력 집합 변경 (3-1)
- 응답 DTO 의 `cells` 배열 제거 (3-3)
- `annualCells`/`sheetFacts` 분리 — 58KB/72KB 로 지배 항이 아니다. 필요해지면 별도 단위
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
