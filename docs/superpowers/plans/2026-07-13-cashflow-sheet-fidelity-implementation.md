# Cashflow Sheet Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원본 시트의 16개 cashflow line을 손실 없이 읽고, 화면을 `Projection - Actual 차이 → Projection → ACTUAL` 고정 순서로 표시한다.

**Architecture:** 기존 `cashflow-policy.json`과 line arrays를 확장하되 `MYSC_PREPAY_IN`은 호환용으로 유지한다. BFF template parser는 입금 합계 전후의 방향 문맥으로 중복 라벨을 구분하고, BFF snapshot 응답에 `Projection - Actual` comparison을 조합한다. 프론트는 comparison을 계산하지 않고 표시하며 기존 lease/draft 쓰기 경로를 재사용한다.

**Tech Stack:** React 18, TypeScript, Vitest, Express BFF, Spring Boot/JVM, Rust calculation core, Firestore

---

### Task 1: Cashflow line catalog 확장

**Files:**
- Modify: `policies/cashflow-policy.json`
- Modify: `src/app/data/types.ts`
- Modify: `src/app/platform/cashflow-sheet.ts`
- Modify: `src/app/platform/policies/cashflow-policy.ts`
- Test: `src/app/platform/cashflow-sheet.test.ts`
- Test: `src/app/platform/policies/cashflow-policy.test.ts`

- [ ] **Step 1: 새 line ID와 순서가 없어서 실패하는 테스트 작성**

```ts
expect(CASHFLOW_IN_LINES).toEqual([
  'MYSC_PREPAY_IN',
  'MYSC_PREPAY_LABOR_IN',
  'MYSC_PREPAY_INPUT_VAT_IN',
  'SALES_IN',
  'SALES_VAT_IN',
  'TEAM_SUPPORT_IN',
  'BANK_INTEREST_IN',
]);
expect(CASHFLOW_OUT_LINES.slice(0, 2)).toEqual([
  'MYSC_PREPAY_DIRECT_OUT',
  'MYSC_PREPAY_LABOR_OUT',
]);
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/app/platform/cashflow-sheet.test.ts src/app/platform/policies/cashflow-policy.test.ts`
Expected: FAIL — 새 line ID 또는 mode label helper가 없음

- [ ] **Step 3: 기존 ID를 유지하고 네 ID만 추가**

```ts
export type CashflowSheetLineId =
  | 'MYSC_PREPAY_IN'
  | 'MYSC_PREPAY_LABOR_IN'
  | 'MYSC_PREPAY_INPUT_VAT_IN'
  | 'MYSC_PREPAY_DIRECT_OUT'
  | 'MYSC_PREPAY_LABOR_OUT'
  // 기존 IDs 유지
```

`cashflow-policy.json` 각 선입금 entry에는 `projectionLabel`, `actualLabel`, 방향별 aliases를 기록한다. `getCashflowModeLineLabel(lineId, mode)`는 mode label이 없을 때 기존 `label`로 폴백한다.

- [ ] **Step 4: 합계와 호환성 테스트 통과 확인**

Run: `npx vitest run src/app/platform/cashflow-sheet.test.ts src/app/platform/policies/cashflow-policy.test.ts`
Expected: PASS; 새 입금 7개·출금 9개가 한 번씩만 합산되고 기존 `MYSC_PREPAY_IN` export label은 유지됨

- [ ] **Step 5: 커밋**

```bash
git add policies/cashflow-policy.json src/app/data/types.ts src/app/platform/cashflow-sheet.ts src/app/platform/policies/cashflow-policy.ts src/app/platform/cashflow-sheet.test.ts src/app/platform/policies/cashflow-policy.test.ts
git commit -m "feat(cashflow): add detailed MYSC prepayment lines"
```

### Task 2: BFF 시트 parser의 방향 문맥 매핑

**Files:**
- Modify: `server/bff/cashflow-sheet-template.mjs`
- Test: `server/bff/cashflow-sheet-template.test.mjs`

- [ ] **Step 1: 실제 16행 순서 fixture로 실패 테스트 작성**

```js
expect(result.sections[0].lineRows.map(({ lineId }) => lineId)).toEqual([
  'MYSC_PREPAY_IN', 'MYSC_PREPAY_LABOR_IN', 'MYSC_PREPAY_INPUT_VAT_IN',
  'SALES_IN', 'SALES_VAT_IN', 'TEAM_SUPPORT_IN', 'BANK_INTEREST_IN',
  'MYSC_PREPAY_DIRECT_OUT', 'MYSC_PREPAY_LABOR_OUT',
  'DIRECT_COST_OUT', 'INPUT_VAT_OUT', 'MYSC_LABOR_OUT', 'MYSC_PROFIT_OUT',
  'SALES_VAT_OUT', 'TEAM_SUPPORT_OUT', 'BANK_INTEREST_OUT',
]);
```

동일한 `MYSC 선입금 - 직접사업비 등`이 입금 합계 전에는 `MYSC_PREPAY_IN`, 뒤에는 `MYSC_PREPAY_DIRECT_OUT`인지 별도로 assert한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run server/bff/cashflow-sheet-template.test.mjs`
Expected: FAIL — 현재 global label map이 동일 문구를 한 ID로 덮어씀

- [ ] **Step 3: derived row를 먼저 읽고 현재 방향을 추적**

```js
let direction = 'IN';
const derivedKind = resolveDerivedKind(label);
if (derivedKind) {
  derivedRows.push(/* existing fields */);
  if (derivedKind === 'deposit_total') direction = 'OUT';
  continue;
}
const lineEntry = resolveLineEntry(label, direction);
```

`LINE_BY_LABEL`은 `${direction}|${normalizedLabel}` key로 만들고, 방향이 불명확하면 임의 폴백하지 않는다.

- [ ] **Step 4: parser 테스트 통과 확인**

Run: `npx vitest run server/bff/cashflow-sheet-template.test.mjs`
Expected: PASS — Projection/ACTUAL 각각 16개 line, 합계·잔액은 derived row, 중복 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add server/bff/cashflow-sheet-template.mjs server/bff/cashflow-sheet-template.test.mjs
git commit -m "fix(cashflow): map repeated sheet labels by direction"
```

### Task 3: 서버 line validation과 합계 확장

**Files:**
- Modify: `server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/domain/CashflowLineCatalog.java`
- Test: `server/jvm-weekly-api/src/test/java/dev/merryai/innerplatform/weekly/domain/CashflowLineCatalogTest.java`
- Modify: `server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/storage/FirestoreCashflowWeekActualMerge.java`
- Test: `server/jvm-weekly-api/src/test/java/dev/merryai/innerplatform/weekly/storage/FirestoreCashflowWeekActualMergeTest.java`
- Modify: `rust/spreadsheet-calculation-core/src/lib.rs`

- [ ] **Step 1: JVM/Rust 누락을 드러내는 테스트 작성**

```java
assertThat(CashflowLineCatalog.canonicalize("MYSC 선입금 - MYSC 인건비(출금)"))
    .isEqualTo("MYSC_PREPAY_LABOR_OUT");
assertThat(CashflowLineCatalog.IN_LINES).contains("MYSC_PREPAY_INPUT_VAT_IN");
assertThat(CashflowLineCatalog.OUT_LINES).contains("MYSC_PREPAY_DIRECT_OUT");
```

Rust self-test에는 16개 catalog key와 새 line의 입출금 방향을 assert한다.

- [ ] **Step 2: 실패 확인**

Run: `mvn -f server/jvm-weekly-api/pom.xml -Dtest=CashflowLineCatalogTest test && cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml`
Expected: FAIL — 새 IDs/aliases가 catalog에 없음

- [ ] **Step 3: allowlist와 aliases 최소 확장**

JVM `IN_LINES`, `OUT_LINES`, `ALIASES`와 Rust `cashflow_in_line_ids`, `cashflow_all_line_ids`, label parser에 같은 네 ID를 추가한다. 문맥 없는 과거 `MYSC선입금` alias는 계속 `MYSC_PREPAY_IN`으로 둔다.

Firestore Actual 합계는 별도 하드코딩 목록을 두지 않고 JVM catalog를 재사용한다.

- [ ] **Step 4: JVM/Rust 테스트 통과 확인**

Run: `mvn -f server/jvm-weekly-api/pom.xml -Dtest=CashflowLineCatalogTest test && cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/domain/CashflowLineCatalog.java server/jvm-weekly-api/src/test/java/dev/merryai/innerplatform/weekly/domain/CashflowLineCatalogTest.java rust/spreadsheet-calculation-core/src/lib.rs
git commit -m "feat(cashflow): validate detailed prepayment lines"
```

### Task 3A: 구형 BFF canonical writer 차단

**Files:**
- Modify: `server/bff/projections.mjs`
- Test: `server/bff/projections.test.ts`
- Modify: `policies/relation-rules.json`
- Test: `server/bff/app.integration.test.ts`

- [ ] transaction rule에서 `cashflow_weeks` affected view를 제거한다.
- [ ] 이미 대기 중인 queue job을 위해 handler는 유지하되 metadata만 갱신하고 canonical week는 쓰지 않는다.
- [ ] JVM이 저장한 `weeklyExpenseActualBySheet`, `actual`, `actualTotals`가 그대로 보존되는 실패-후-성공 테스트를 둔다.
- [ ] writer 전용 date/category helper는 제거하고 focused/integration suite를 통과시킨다.

### Task 3B: 명시적 시트 연동과 pinned snapshot

**Files:**
- Create: `server/bff/cashflow-sheet-snapshot.mjs`
- Test: `server/bff/cashflow-sheet-snapshot.test.mjs`
- Modify: `server/bff/routes/cashflow-sheet-lab.mjs`
- Test: `server/bff/routes/cashflow-sheet-lab.test.mjs`
- Modify: `server/bff/schemas.mjs`

- [ ] Google Sheet는 `시트 연동하기` 또는 `최신값 다시 가져오기` 요청에서만 읽는다.
- [ ] `sourceRevision`은 정규화 snapshot만으로 계산하고 `targetRevision`은 별도 보관한다.
- [ ] `VALUE`, `EMPTY`, `INVALID`를 구분하고 invalid A1이 있는 월은 차단한다.
- [ ] 조회 실패 시 last-good revision을 유지해 `STALE`, last-good도 없으면 `ERROR`를 반환한다.
- [ ] stage는 `expectedMirrorRevision`의 frozen snapshot만 사용하고 canonical/project config는 쓰지 않는다.

### Task 3C: 월별 authoritative JVM apply

**Files:**
- Modify: `server/bff/java-weekly-client.mjs`
- Test: `server/bff/java-weekly-client.test.mjs`
- Modify: `server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/api/CashflowSheetLabApplyRequest.java`
- Modify: `server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/service/WeeklyExpenseCommandService.java`
- Modify: `server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/storage/WeeklyExpensePersistence.java`
- Modify: `server/jvm-weekly-api/src/main/java/dev/merryai/innerplatform/weekly/storage/FirestoreInheritedWeeklyExpensePersistence.java`
- Test: matching JVM command/persistence tests

- [ ] 권위 단위는 `projectId + yearMonth`; 월 안의 모든 주차·16 line·두 mode coverage를 요구한다.
- [ ] Projection은 대상 월 전체 교체, Actual은 `cashflow-sheet-lab` source 기여만 교체한다.
- [ ] 다른 월과 다른 Actual source는 보존하고 주차별 actual/actualTotals를 같은 transaction에서 재계산한다.
- [ ] 월 결산·revision 충돌은 409로 차단한다.
- [ ] 같은 body의 idempotency replay는 성공 뒤 lease가 종료돼도 기존 결과를 반환한다.

### Task 4: BFF `Projection - Actual` comparison read model

**Files:**
- Create: `server/bff/cashflow-comparison.mjs`
- Create: `server/bff/cashflow-comparison.test.mjs`
- Modify: `server/bff/routes/jvm-weekly-api.mjs`
- Test: `server/bff/routes/jvm-weekly-api.test.mjs`

- [ ] **Step 1: 부호와 새 line 합계를 고정하는 실패 테스트 작성**

```js
expect(result.readModel.months[0].comparison.weeks[0]).toMatchObject({
  amounts: { MYSC_PREPAY_LABOR_IN: 60 },
  totalIn: 60,
  totalOut: 30,
  net: 30,
});
```

fixture는 Projection 100/Actual 40을 넣어 반드시 `+60`이 되게 한다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run server/bff/cashflow-comparison.test.mjs server/bff/routes/jvm-weekly-api.test.mjs`
Expected: FAIL — comparison read model이 없음

- [ ] **Step 3: 정책 direction을 재사용해 comparison 조합**

```js
const difference = Number(projectionAmount || 0) - Number(actualAmount || 0);
```

주차·행 union을 만들고 `amounts`, `rowTotals`, `totalIn`, `totalOut`, `net`을 반환한다. GET `/api/v1/cashflow/:projectId`의 JVM 결과에만 comparison을 붙이며 canonical 저장은 하지 않는다.

- [ ] **Step 4: BFF 테스트 통과 확인**

Run: `npx vitest run server/bff/cashflow-comparison.test.mjs server/bff/routes/jvm-weekly-api.test.mjs`
Expected: PASS — 원 JVM payload는 유지되고 comparison만 추가됨

- [ ] **Step 5: 커밋**

```bash
git add server/bff/cashflow-comparison.mjs server/bff/cashflow-comparison.test.mjs server/bff/routes/jvm-weekly-api.mjs server/bff/routes/jvm-weekly-api.test.mjs
git commit -m "feat(cashflow): expose projection actual comparison"
```

### Task 5: 고정된 Frontend 블록 순서

**Files:**
- Modify: `src/app/lib/platform-bff-client.ts`
- Modify: `src/app/components/cashflow/CashflowProjectSheet.tsx`
- Test: `src/app/components/cashflow/CashflowProjectSheet.shell.test.ts`
- Test: `src/app/components/cashflow/cashflow-action-tooltips.shell.test.ts`

- [ ] **Step 1: 고정 순서와 역방향 제거 실패 테스트 작성**

```ts
expect(source.indexOf('Projection - Actual 차이')).toBeLessThan(source.indexOf('data-cashflow-block="projection"'));
expect(source.indexOf('data-cashflow-block="projection"')).toBeLessThan(source.indexOf('data-cashflow-block="actual"'));
expect(source).not.toContain('Actual - Projection');
expect(source).not.toContain('diff: actual - projection');
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/app/components/cashflow/CashflowProjectSheet.shell.test.ts src/app/components/cashflow/cashflow-action-tooltips.shell.test.ts`
Expected: FAIL — 현재 차이 블록이 아래에 있고 행이 mode별로 교차됨

- [ ] **Step 3: interleave renderer를 mode block renderer로 교체**

`renderLineRows()`의 rowSpan/구분 열을 제거하고 `renderModeBlock('projection')`, `renderModeBlock('actual')`을 순서대로 호출한다. Projection만 input을 렌더링하고 Actual은 기존 read-only amount를 사용한다. 선입금 문구는 `getCashflowModeLineLabel()`을 사용하고 합계·잔액은 각 mode derived totals를 사용한다.

상위 반환 순서는 다음으로 고정한다.

```tsx
{renderProjectionActualDiffTable()}
{renderUnifiedMonthlyBoard()}
```

차이 테이블은 BFF comparison 상태를 표시하며 로딩 실패 시 오류를 보여주고 클라이언트 재계산으로 폴백하지 않는다.

- [ ] **Step 4: Frontend 테스트 통과 확인**

Run: `npx vitest run src/app/components/cashflow/CashflowProjectSheet.shell.test.ts src/app/components/cashflow/cashflow-action-tooltips.shell.test.ts src/app/platform/cashflow-sheet.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/app/lib/platform-bff-client.ts src/app/components/cashflow/CashflowProjectSheet.tsx src/app/components/cashflow/CashflowProjectSheet.shell.test.ts src/app/components/cashflow/cashflow-action-tooltips.shell.test.ts
git commit -m "feat(cashflow): match approved projection actual layout"
```

### Task 6: 통합 검증과 Stage QA

**Files:**
- Verify only; fix only failures caused by Tasks 1-5

- [ ] **Step 1: focused suite**

```bash
npx vitest run \
  src/app/platform/cashflow-sheet.test.ts \
  src/app/platform/policies/cashflow-policy.test.ts \
  server/bff/cashflow-sheet-template.test.mjs \
  server/bff/cashflow-comparison.test.mjs \
  server/bff/routes/jvm-weekly-api.test.mjs \
  src/app/components/cashflow/CashflowProjectSheet.shell.test.ts \
  src/app/components/cashflow/cashflow-action-tooltips.shell.test.ts
```

Expected: PASS

- [ ] **Step 2: backend and build**

```bash
mvn -f server/jvm-weekly-api/pom.xml test
cargo test --manifest-path rust/spreadsheet-calculation-core/Cargo.toml
npm run build
```

Expected: PASS

- [ ] **Step 3: 원본 보호 확인**

Run: `shasum -a 256 '/Users/boram/Downloads/2026 사업비 관리 시트 _ 원본 (절대 건드리지 마시고 사본을 만들어서 써주세요 ㅠㅠ).xlsx'`
Expected: `e3ce2a8640cf45ffda7f68fe79f4529c87548c44618ebd1474956ea2a5363ac1`

- [ ] **Step 4: `/qa` 기준 Stage 브라우저 검증**

Stage 프로젝트 캐시플로에서 차이 → Projection → ACTUAL 순서, 정확한 19행, Projection 편집 lease, Actual 조회 전용, 차이 부호를 확인한다. Live URL과 Live 프로젝트는 열거나 배포하지 않는다.
