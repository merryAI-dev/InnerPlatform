# Cashflow Export Status Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the outdated `/cashflow/export` status table with a canonical seven-column operations view that shows the previous and current finance week, exact settlement timestamps, stored Projection-Actual, and the mirror capture time.

**Architecture:** Keep workbook export, JVM mutations, sheet synchronization, and cashflow coordinates frozen. Enrich the existing BFF weekly-overview read model after the JVM response with one bounded mirror batch read, then have the frontend join exact `projectId + yearMonth + WEEK_n` status records for the two KST finance weeks. The export page performs no cashflow calculation and never reads Firestore directly.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind/shadcn, Node.js ESM BFF, Firestore Admin SDK, Vitest, Supertest, Playwright.

---

## File map

- `server/bff/routes/jvm-weekly-api.mjs`: trusted stored-mirror projection summary, bounded mirror reads, and additive weekly-overview v4 fields.
- `server/bff/routes/jvm-weekly-api.test.mjs`: mirror identity/shape/freshness sabotage, strict-endpoint regression, batch-read count, and partial failure tests.
- `src/app/lib/platform-bff-client.ts`: v4 overview DTO with `sheetCapturedAt` and nested response identity validation.
- `src/app/lib/platform-bff-client.test.ts`: accepts valid v4 and rejects foreign month/project/timestamp payloads.
- `src/app/platform/cashflow-export-dashboard.ts`: pure recent-two-week selection, 100-project chunking, and exact status/read-model joins.
- `src/app/platform/cashflow-export-dashboard.test.ts`: month/year/raw-week-6 boundaries, statuses, and partial errors.
- `src/app/components/cashflow/CashflowExportPage.tsx`: canonical overview orchestration and seven-column operations table.
- `src/app/components/cashflow/CashflowExportPage.shell.test.ts`: removes old Thursday/week/P-A batch path and locks new labels/data sources.
- `tests/e2e/admin-cashflow-export-api.spec.ts`: API-enabled two-week/mirror/owner rendering, 375px table, console, and unchanged workbook download.
- `docs/superpowers/specs/2026-08-26-cashflow-export-dashboard-design.md`: approved product/data contract.

### Task 1: Enrich weekly-overview from one authorized mirror snapshot

**Files:**
- Modify: `server/bff/routes/jvm-weekly-api.mjs`
- Test: `server/bff/routes/jvm-weekly-api.test.mjs`

- [ ] **Step 1: Write fail-first mirror overview tests**

Add a route test whose JVM response contains one authorized `project-a`, whose mirror is `STALE` with mismatched revisions, and whose stored facts contain an exact amount and capture time:

```js
it('maps the stored mirror snapshot into weekly overview without the strict freshness gate', async () => {
  const source = fullMonthCloseSource({ mirrorStatus: 'STALE' });
  const mirrorPath = 'orgs/tenant-a/cashflow_sheet_mirrors/project-a';
  source.documents.get(mirrorPath).appliedSourceRevision = `sha256:${'f'.repeat(64)}`;
  source.documents.get(mirrorPath).capturedAt = '2026-08-25T07:48:00.000Z';
  source.documents.get(mirrorPath).sheetFacts.projectionActualDifferences = [
    { yearMonth: '2026-08', weekNo: 4, amount: -12_345, sourceCell: 'A14' },
  ];
  const getAll = vi.fn(async (...refs) => Promise.all(refs.map((ref) => ref.get())));
  const canonical = {
    version: '1', yearMonth: '2026-08',
    items: [{ projectId: 'project-a', settlementStatuses: {
      projectId: 'project-a', yearMonth: '2026-08', items: [],
    }, projectionActualSummary: null }], errors: [],
  };
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(canonical), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  const { app } = createApp(fetchImpl, createIdempotencyService(), { actorRole: 'finance' }, {
    env: runtimeEnv, db: { ...source.db, getAll }, now: () => new Date('2026-08-26T03:00:00.000Z'),
  });

  const overview = await request(app).post('/api/v1/cashflow/weekly-overview')
    .send({ projectIds: ['project-a'], yearMonth: '2026-08' }).expect(200);

  expect(overview.body.version).toBe('4');
  expect(overview.body.items[0]).toMatchObject({
    projectId: 'project-a', sheetCapturedAt: '2026-08-25T07:48:00.000Z',
    projectionActualSummary: { projectId: 'project-a', differenceAmount: -12_345 },
  });
  expect(getAll).toHaveBeenCalledTimes(1);

  const strict = await request(app).post('/api/v1/cashflow/projection-actual-summary/batch')
    .send({ projectIds: ['project-a'], yearMonth: '2026-08' }).expect(200);
  expect(strict.body).toMatchObject({ items: [], errors: [{ projectId: 'project-a', code: 'SUMMARY_UNAVAILABLE' }] });
});
```

Add table tests for foreign `mirror.projectId`, duplicate keys, malformed rows, future-only rows, missing mirror, and a `getAll` rejection. Every invalid data case returns `projectionActualSummary: null`; only read failure adds `SUMMARY_UNAVAILABLE`; none returns numeric zero.

- [ ] **Step 2: Run the focused route tests and confirm RED**

Run:

```bash
npx vitest run server/bff/routes/jvm-weekly-api.test.mjs -t "stored mirror snapshot|foreign mirror|duplicate projection|future-only|mirror batch"
```

Expected: FAIL because overview is version 3, forces the summary to null, exposes no capture time, and performs no mirror batch read.

- [ ] **Step 3: Split strict and stored mirror mapping**

Keep the existing strict wrapper unchanged and add an exact stored mapper:

```js
function storedSheetFormulaProjectionActualSummary({ projectId, mirror, comparisonBoundary, yearMonth = '' }) {
  if (readOptionalText(mirror?.projectId) !== projectId) return null;
  const rawRows = Array.isArray(mirror?.sheetFacts?.projectionActualDifferences)
    ? mirror.sheetFacts.projectionActualDifferences : [];
  const rows = rawRows.map(normalizeProjectionActualDifferenceRow);
  if (rows.some((row) => !row)) return null;
  const keys = rows.map((row) => `${row.yearMonth}:${row.weekNo}`);
  if (new Set(keys).size !== keys.length) return null;
  return buildSheetFormulaProjectionActualSummary({ projectId, mirror, rows, comparisonBoundary, yearMonth });
}

function sheetFormulaProjectionActualSummary(input) {
  if (readOptionalText(input.mirror?.status) !== 'FRESH'
    || !readOptionalText(input.mirror?.sourceRevision)
    || readOptionalText(input.mirror?.sourceRevision) !== readOptionalText(input.mirror?.appliedSourceRevision)) return null;
  return storedSheetFormulaProjectionActualSummary(input);
}
```

`buildSheetFormulaProjectionActualSummary` selects the latest stored row not after `comparisonBoundary.asOfWeek`. It copies that row's safe integer `amount`; it does not sum rows or use labels as identity.

- [ ] **Step 4: Batch mirrors only after the JVM overview succeeds**

After `alignMonthSettlementStatus`, the successful JVM overview has already authorized the requested project scope. Call production `db.getAll(...refs)` once for every requested projectId in the chunk, including projects with `STATUS_UNAVAILABLE`; that error describes only the status side read. Build summary and `sheetCapturedAt` from each same snapshot:

```js
const mirrorSnapshots = await readWeeklyOverviewMirrorSnapshots({
  db,
  tenantId: req.context.tenantId,
  projectIds: authorizedProjectIds,
});
```

Return:

```js
{
  ...item,
  projectionActualSummary: mirrorResult?.summary || null,
  sheetCapturedAt: mirrorResult?.capturedAt || null,
}
```

Use version `4`. A mirror read failure is caught after JVM success, adds `{ projectId, code: 'SUMMARY_UNAVAILABLE' }`, and keeps settlement statuses.

- [ ] **Step 5: Re-run all JVM route tests and commit**

Run:

```bash
npx vitest run server/bff/routes/jvm-weekly-api.test.mjs
```

Expected: all tests pass; the known unrelated test is rerun in isolation if the existing one-off 404 reappears.

Commit:

```bash
git add server/bff/routes/jvm-weekly-api.mjs server/bff/routes/jvm-weekly-api.test.mjs
git commit -m "feat(cashflow): expose mirror status in weekly overview"
```

### Task 2: Lock recent-week selection and client identities

**Files:**
- Create: `src/app/platform/cashflow-export-dashboard.ts`
- Create: `src/app/platform/cashflow-export-dashboard.test.ts`
- Modify: `src/app/lib/platform-bff-client.ts`
- Test: `src/app/lib/platform-bff-client.test.ts`

- [ ] **Step 1: Write fail-first finance-week and join tests**

Create tests with these exact expectations:

```ts
expect(resolveCashflowExportRecentWeeks('2026-08-26').map(({ yearMonth, weekNo }) => [yearMonth, weekNo]))
  .toEqual([['2026-08', 4], ['2026-08', 5]]);
expect(resolveCashflowExportRecentWeeks('2026-08-31').map(({ yearMonth, weekNo }) => [yearMonth, weekNo]))
  .toEqual([['2026-08', 4], ['2026-08', 5]]);
expect(resolveCashflowExportRecentWeeks('2026-09-01').map(({ yearMonth, weekNo }) => [yearMonth, weekNo]))
  .toEqual([['2026-08', 5], ['2026-09', 1]]);
expect(resolveCashflowExportRecentWeeks('2027-01-01').map(({ yearMonth, weekNo }) => [yearMonth, weekNo]))
  .toEqual([['2026-12', 5], ['2027-01', 1]]);
expect(chunkCashflowExportProjectIds(Array.from({ length: 101 }, (_, i) => `p${i}`)).map((chunk) => chunk.length))
  .toEqual([100, 1]);
```

Add joins proving that the same project in two months receives the correct `WEEK_5` and `WEEK_1`, and that a foreign project/month response is ignored rather than cross-wired.

- [ ] **Step 2: Run the new helper test and confirm RED**

Run:

```bash
npx vitest run src/app/platform/cashflow-export-dashboard.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure helper**

Use the shared finance-week resolver and shared date arithmetic:

```ts
export function resolveCashflowExportRecentWeeks(todayIso: string) {
  const current = resolveFinanceWeekForDate(todayIso);
  if (!current) return [];
  const previous = resolveFinanceWeekForDate(addDays(current.weekStart, -1));
  return [previous, current].filter(Boolean).map((week) => ({
    ...week,
    period: `WEEK_${week.weekNo}` as CashflowSettlementPeriod,
    displayLabel: `${week.financeMonth}월 ${week.weekNo}주차`,
  }));
}
```

Implement project chunking and exact lookup helpers without status/date inference.

- [ ] **Step 4: Write client v4 identity RED tests**

Update the valid fixture with `version: '4'`, matching settlement `projectId/yearMonth`, matching summary projectId, and ISO `sheetCapturedAt`. Add cases that change one identity at a time and expect `현금흐름 현황 응답이 올바르지 않습니다.`.

- [ ] **Step 5: Extend DTO and nested validation minimally**

Add to overview items:

```ts
sheetCapturedAt: string | null;
```

Require version 4, requested item IDs, matching nested project/month identity, supported periods/statuses, matching summary project ID, and a parseable ISO capture time or null. Do not derive or rewrite nested data.

- [ ] **Step 6: Run helper/client tests and commit**

Run:

```bash
npx vitest run src/app/platform/cashflow-export-dashboard.test.ts src/app/lib/platform-bff-client.test.ts
```

Expected: pass.

Commit:

```bash
git add src/app/platform/cashflow-export-dashboard.ts src/app/platform/cashflow-export-dashboard.test.ts src/app/lib/platform-bff-client.ts src/app/lib/platform-bff-client.test.ts
git commit -m "feat(cashflow): map recent settlement status"
```

### Task 3: Replace the export page's legacy table path

**Files:**
- Modify: `src/app/components/cashflow/CashflowExportPage.tsx`
- Test: `src/app/components/cashflow/CashflowExportPage.shell.test.ts`
- Modify: `tests/e2e/admin-cashflow-export-api.spec.ts`

- [ ] **Step 1: Turn shell expectations RED**

Require the new columns and sources and forbid the old path:

```ts
expect(source).toContain('조직장');
expect(source).toContain('주정산 최근 2주');
expect(source).toContain('시트 불러온 시각');
expect(source).toContain('fetchCashflowWeeklyOverviewViaBff');
expect(source).toContain('fetchCashflowSettlementStatusesBatchViaBff');
expect(source).not.toContain('buildCashflowExportProjectRows');
expect(source).not.toContain('useCashflowProjectionActualSummaries');
expect(source).not.toContain('BFF 서버의 최신 현금흐름 데이터');
expect(source).not.toContain('지난 목요일 자정');
expect(source).not.toContain('확인 불가');
expect(source).not.toContain('다시 조회');
```

Run the shell test and confirm it fails.

- [ ] **Step 2: Load current overview plus previous-month status only when needed**

In `CashflowExportPage`, compute recent weeks from `getSeoulTodayIso()`, chunk visible project IDs by 100, and load:

```ts
const currentRequests = chunks.map((projectIds) => fetchCashflowWeeklyOverviewViaBff({
  tenantId: orgId, actor: user, projectIds, yearMonth: currentWeek.yearMonth,
}));
const previousRequests = previousWeek.yearMonth === currentWeek.yearMonth ? [] : chunks.map((projectIds) => (
  fetchCashflowSettlementStatusesBatchViaBff({
    tenantId: orgId, actor: user, projectIds, yearMonth: previousWeek.yearMonth,
  })
));
```

Use `Promise.allSettled`. Store fulfilled chunks and failed project IDs separately for current and previous month. Clear the old read model when auth scope or visible project IDs change, and ignore late results after effect cleanup. Download remains independent and enabled if the operations read fails.

- [ ] **Step 3: Render the seven-column operations table**

Use the existing People UID owner functions exported by `CashflowWeeklyPage` without changing that page. Render two compact, vertically stacked week strips with explicit week label, status pill, submitted time, and approval time. Render summary only when present; otherwise use neutral `시트 저장값 없음`. Render capture time only from `sheetCapturedAt`; otherwise `불러온 기록 없음`.

Remove the third technical summary tile and make the remaining summary grid two columns. Keep the existing table container as the only horizontal scroll owner.

- [ ] **Step 4: Update the API-enabled browser fixture**

Freeze the browser clock to `2026-09-01T03:00:00.000Z`, provide People-linked organization head/manager IDs, and stub:

- September weekly-overview with `WEEK_1`, exact P/A, and capture time.
- August settlement-status batch with `WEEK_5`.
- Existing cashflow export download response and filename.

Assert:

```ts
await expect(page.getByRole('columnheader', { name: '조직장' })).toBeVisible();
await expect(page.getByRole('columnheader', { name: '주정산 최근 2주' })).toBeVisible();
await expect(row).toContainText('8월 5주차');
await expect(row).toContainText('9월 1주차');
await expect(row).toContainText('실무자 제출 완료');
await expect(row).toContainText('조직장 승인 완료');
await expect(row).toContainText('2026. 08. 26.');
await expect(page.getByText('BFF 서버의 최신 현금흐름 데이터')).toHaveCount(0);
```

At 375px assert the table container has `scrollWidth > clientWidth`, can receive focus, and moves after ArrowRight. Check browser console errors. Continue the same test through the existing download assertion so the UI read model cannot break the workbook action.

- [ ] **Step 5: Run UI tests and commit**

Run:

```bash
npx vitest run src/app/components/cashflow/CashflowExportPage.shell.test.ts src/app/platform/cashflow-export-dashboard.test.ts src/app/lib/platform-bff-client.test.ts
npm run test:e2e:cashflow-export
```

Expected: unit/shell and API-enabled Playwright pass.

Commit:

```bash
git add src/app/components/cashflow/CashflowExportPage.tsx src/app/components/cashflow/CashflowExportPage.shell.test.ts tests/e2e/admin-cashflow-export-api.spec.ts
git commit -m "feat(cashflow): refresh export operations table"
```

### Task 4: Independent QA and release gates

**Files:**
- Inspect only: `server/bff/cashflow-coordinates.mjs`, cashflow workbook/export files, JVM tree, Firebase rules/indexes, sheet refresh/apply files.
- Update only if required by repository patch-note gate: the exact cashflow export patch-note files named by the commit hook.

- [ ] **Step 1: Run scoped gates**

```bash
npx vitest run server/bff/routes/jvm-weekly-api.test.mjs src/app/platform/cashflow-export-dashboard.test.ts src/app/lib/platform-bff-client.test.ts src/app/components/cashflow/CashflowExportPage.shell.test.ts
npm run test:e2e:cashflow-export
npm run typecheck
npm run build
git diff --check origin/main...HEAD
```

- [ ] **Step 2: Prove frozen surfaces are untouched**

```bash
git diff --exit-code origin/main...HEAD -- \
  server/bff/cashflow-coordinates.mjs \
  server/bff/cashflow-export.mjs \
  server/bff/routes/cashflow-exports.mjs \
  server/jvm-weekly-api \
  firebase/firestore.rules firebase/storage.rules firebase/firestore.indexes.json
```

Also search the export page to prove there is no `cashflow_weeks`, Thursday cutoff, strict P/A batch hook, direct Firestore, or per-project HTTP loop.

- [ ] **Step 3: Run independent `/qa` and UI evaluation**

Use the dedicated cashflow-export Playwright server. Verify desktop and 375px, both week states, owner mapping, P/A, capture time, loading, partial error, empty project set, permission denial, repeated filter changes, and download. Score design, originality, craft, and functionality using the repository evaluator criteria. Any critical/high/medium finding is fixed with a regression test and re-run.

- [ ] **Step 4: Request code review and prepare landing**

Run an independent diff/spec review. Do not push, merge, deploy, or dispatch workflows until review is GO. After a clean review, use the repository land-and-deploy path: PR, required CI, automatic `workflow_run` production deployment, and post-deploy canary. This change has no Firestore/JVM deployment step because those frozen surfaces remain unchanged.
