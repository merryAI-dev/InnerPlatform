# Cashflow Export Split View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/cashflow/export`의 최근 두 주를 가로로 비교하고, 사업 상세를 현재 화면 오른쪽 50%에서 열어 목록 문맥을 보존한다.

**Architecture:** `CashflowExportPage`가 `project` query와 분할 layout만 소유한다. 새 `CashflowExportProjectPane`은 선택된 경우에만 기존 `CashflowWeekProvider`와 `CashflowProjectSheet`를 마운트하며, 데이터 API·저장·계산 계약은 추가하지 않는다.

**Tech Stack:** React 18, TypeScript, React Router search params, Tailwind CSS, Vitest, Playwright.

---

### Task 1: 사용자 동작 계약을 RED로 고정

**Files:**
- Modify: `src/app/components/cashflow/CashflowExportPage.shell.test.ts`
- Create: `src/app/components/cashflow/CashflowExportProjectPane.shell.test.ts`
- Modify: `tests/e2e/admin-cashflow-export-api.spec.ts`

- [ ] **Step 1: 최근 두 주 가로 배치와 query 기반 패널 shell 테스트 작성**

```ts
expect(exportSource).toContain('grid grid-cols-2 gap-2');
expect(exportSource).toContain("searchParams.get('project')");
expect(exportSource).toContain('CashflowExportProjectPane');
expect(exportSource).not.toContain('navigate(`/cashflow/projects/');
expect(paneSource).toContain('<CashflowWeekProvider>');
expect(paneSource).toContain('<CashflowProjectSheet');
expect(paneSource).toContain("event.key === 'Escape'");
```

- [ ] **Step 2: Playwright에 실제 가로 좌표·URL·50:50·뒤로가기·모바일 닫기 계약 추가**

```ts
const strips = row.locator('[data-testid^="cashflow-export-week-"]');
const [first, second] = await Promise.all([strips.nth(0).boundingBox(), strips.nth(1).boundingBox()]);
expect(Math.abs((first?.y ?? 0) - (second?.y ?? 0))).toBeLessThan(2);

await row.getByRole('button', { name: '가 사업 보기' }).click();
await expect(page).toHaveURL(/\/cashflow\/export\?.*project=cashflow-e2e-a/);
await expect(page.getByTestId('cashflow-export-project-pane')).toBeVisible();
await page.goBack();
await expect(page.getByTestId('cashflow-export-project-pane')).toHaveCount(0);
```

- [ ] **Step 3: 테스트를 실행해 기능 부재로 실패하는지 확인**

Run:

```bash
npx vitest run src/app/components/cashflow/CashflowExportPage.shell.test.ts src/app/components/cashflow/CashflowExportProjectPane.shell.test.ts
npm run test:e2e:cashflow-export -- --grep "split view"
```

Expected: 새 패널 파일·query wiring·가로 layout이 없어 FAIL.

### Task 2: 선택 시에만 마운트되는 사업 상세 패널 구현

**Files:**
- Create: `src/app/components/cashflow/CashflowExportProjectPane.tsx`
- Test: `src/app/components/cashflow/CashflowExportProjectPane.shell.test.ts`

- [ ] **Step 1: 기존 provider와 상세 화면만 조합하는 최소 wrapper 작성**

```tsx
export function CashflowExportProjectPane({ project, yearMonth, onClose }: Props) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <aside data-testid="cashflow-export-project-pane" aria-label={`${project.name} 사업 상세`}>
      <header>
        <h2>{project.name}</h2>
        <Button aria-label={`${project.name} 사업 상세 닫기`} onClick={onClose}>...</Button>
      </header>
      <CashflowWeekProvider>
        <CashflowExportProjectPaneBody project={project} yearMonth={yearMonth} />
      </CashflowWeekProvider>
    </aside>
  );
}
```

- [ ] **Step 2: 내부 body에서 기존 month context와 project snapshot callback 연결**

```tsx
function CashflowExportProjectPaneBody({ project, yearMonth }: BodyProps) {
  const { members, patchProjectSnapshot } = useAppStore();
  const { setYearMonth } = useCashflowWeeks();
  useEffect(() => setYearMonth(yearMonth), [setYearMonth, yearMonth]);
  return (
    <CashflowProjectSheet
      projectId={project.id}
      projectName={project.name}
      project={project}
      members={members}
      onExecutiveApproverSaved={(result) => patchProjectSnapshot({ ...project, ...result })}
    />
  );
}
```

패널의 독립 스크롤 영역이 마운트되면 기존 `#projection-actual-comparison` 섹션으로 이동한다. 전역 문서가 아니라 패널 ref 아래에서만 찾는다.

- [ ] **Step 3: shell 테스트를 GREEN으로 전환**

Run:

```bash
npx vitest run src/app/components/cashflow/CashflowExportProjectPane.shell.test.ts
```

Expected: PASS.

### Task 3: Export 페이지 query와 50:50 layout 연결

**Files:**
- Modify: `src/app/components/cashflow/CashflowExportPage.tsx`
- Modify: `src/app/components/cashflow/CashflowExportPage.shell.test.ts`

- [ ] **Step 1: `useSearchParams`로 panel open/close를 구현**

```tsx
const [searchParams, setSearchParams] = useSearchParams();
const panelProjectId = searchParams.get('project') || '';
const panelProject = sortedProjects.find((project) => project.id === panelProjectId) || null;

const openProjectPanel = (projectId: string) => setSearchParams((current) => {
  const next = new URLSearchParams(current);
  next.set('project', projectId);
  return next;
});
const closeProjectPanel = () => setSearchParams((current) => {
  const next = new URLSearchParams(current);
  next.delete('project');
  return next;
}, { replace: true });
```

- [ ] **Step 2: 현재 페이지와 패널을 responsive 2열로 배치**

```tsx
<div data-testid="cashflow-export-split-layout" className={panelProject ? 'lg:grid lg:grid-cols-2 lg:gap-4' : ''}>
  <div data-testid="cashflow-export-primary-pane" className="min-w-0 space-y-4">...</div>
  {panelProject ? (
    <CashflowExportProjectPane project={panelProject} yearMonth={currentYearMonth} onClose={closeProjectPanel} />
  ) : null}
</div>
```

- [ ] **Step 3: 최근 두 주를 한 행에 두고 통장 유형 출처 문구를 명확화**

```tsx
<td className="min-w-[420px] px-3 py-3">
  <div className="grid grid-cols-2 gap-2">{recentWeeks.map(renderWeek)}</div>
</td>
```

도움말은 `정산 정보에 저장된 통장 유형을 여러 개 함께 고릅니다.`로 변경한다. 필터 field와 BFF payload는 변경하지 않는다.

- [ ] **Step 4: invalid project query를 fail-close하고 shell 테스트를 GREEN으로 전환**

Run:

```bash
npx vitest run src/app/components/cashflow/CashflowExportPage.shell.test.ts src/app/components/cashflow/CashflowExportProjectPane.shell.test.ts
```

Expected: PASS.

### Task 4: 브라우저 회귀와 배포 전 게이트

**Files:**
- Modify: `tests/e2e/admin-cashflow-export-api.spec.ts`
- Verify only: `server/bff/**`, `server/jvm-weekly-api/**`, `firebase/**`, `src/app/platform/cashflow-export.ts`

- [ ] **Step 1: panel이 닫혀 있을 때 상세 요청이 0인지, 열 때만 발생하는지 검증**

특정 상세 요청 counter를 route fixture에 추가하고, 초기 0과 open 이후 증가를 각각 assertion한다.

- [ ] **Step 2: 다운로드 회귀를 동일 브라우저 세션에서 검증**

패널을 닫은 뒤 기존 cross-filter 다운로드를 실행하고 기존 POST body와 filename assertion을 유지한다.

- [ ] **Step 3: 전체 관련 검증 실행**

```bash
npx vitest run src/app/components/cashflow/CashflowExportPage.shell.test.ts src/app/components/cashflow/CashflowExportProjectPane.shell.test.ts src/app/platform/cashflow-export-filters.test.ts src/app/platform/cashflow-export-dashboard.test.ts src/app/lib/platform-bff-client.test.ts
npm run test:e2e:cashflow-export
npm run typecheck
npm run build
git diff --check
```

Expected: 관련 Vitest·Playwright 전부 PASS, typecheck 신규 오류 0, production build PASS.

- [ ] **Step 4: frozen surface와 independent QA 확인**

```bash
git diff --exit-code origin/main -- server/bff server/jvm-weekly-api firebase src/app/platform/cashflow-export.ts
```

Expected: exit 0. 독립 QA의 G1~G4와 UI 디자인·독창성·완성도·기능성 점수가 모두 기준을 통과한다.

- [ ] **Step 5: 의도한 UI 파일만 커밋**

```bash
git add src/app/components/cashflow/CashflowExportPage.tsx \
  src/app/components/cashflow/CashflowExportPage.shell.test.ts \
  src/app/components/cashflow/CashflowExportProjectPane.tsx \
  src/app/components/cashflow/CashflowExportProjectPane.shell.test.ts \
  tests/e2e/admin-cashflow-export-api.spec.ts
git commit -m "feat(cashflow): add export project split view"
```
