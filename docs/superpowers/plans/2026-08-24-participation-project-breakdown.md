# Participation Project Breakdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the all-people View compact, add per-person expandable project contributions to saved-rule Views, and expose every project-registration settlement platform with selectable zero-project counts.

**Architecture:** Extend the existing participation dashboard read model while it already has projects, entries, people, and rules in memory. Build parent and per-project month aggregates in the same server pass, return project details only for a selected user rule, and render disclosure rows without another request. Generate settlement filter options from the registration catalog plus observed legacy classifications, attach project counts, and validate zero-count catalog values on rule save.

**Tech Stack:** Node.js ESM BFF, Express, Firestore Emulator, React 18, TypeScript, Vitest, Supertest, Tailwind/shadcn UI.

---

## File map

- `server/bff/participation-settlement-system.mjs`: server-side settlement catalog order and labels used by rule candidates and validation.
- `server/bff/participation-dashboard.mjs`: person/project/month aggregation and selected-year response shaping.
- `server/bff/routes/participation-dashboard.mjs`: allow catalog platforms even when their current project count is zero.
- `server/bff/participation-dashboard.test.mjs`: fail-first unit and route contracts for counts, zero-count selection, and project/month reconciliation.
- `server/bff/app.integration.test.ts`: persisted Firestore → HTTP portfolio breakdown proof.
- `src/app/lib/platform-bff-client.ts`: typed project breakdown and settlement-option count response.
- `src/app/components/participation/ParticipationPage.tsx`: default-collapsed disclosure rows and count labels.
- `src/app/components/participation/ParticipationPage.shell.test.ts`: static guard that all View stays compact and project expansion performs no fetch or client aggregation.
- `docs/architecture/contracts/2026-08-24-participation-project-breakdown-contract.md`: concise business contract for the cross-screen platform catalog and aggregation invariants.

### Task 0: Freeze the sprint contract and baseline

**Files:**
- Create: `.gstack/sprint-contract-2026-08-24-participation-project-breakdown.md`
- Reference: `docs/superpowers/specs/2026-08-24-participation-project-breakdown-design.md`

- [ ] **Step 1: Run `/sprint` and record the approved contract**

The contract must name these fail conditions:

```text
- 전체 View에 프로젝트 상세가 나타남
- 저장 규칙 View의 사람 월 합계와 project child 월 합계가 다름
- 0% / 미입력 / 기간 밖이 합쳐짐
- 선택 연도 밖 프로젝트가 projectCount에 포함됨
- 등록·수정 표준 정산 플랫폼이 규칙 후보에서 누락됨
- projectCount=0 플랫폼이 저장 시 422로 거부됨
- 펼침 동작이 추가 HTTP 또는 Firestore read/write를 발생시킴
```

- [ ] **Step 2: Run the baseline tests**

Run:

```bash
npx vitest run server/bff/participation-dashboard.test.mjs src/app/components/participation/ParticipationPage.shell.test.ts
```

Expected: PASS before fail-first tests are added.

### Task 1: Align settlement platform candidates with project registration

**Files:**
- Modify: `server/bff/participation-settlement-system.mjs`
- Modify: `server/bff/participation-dashboard.mjs`
- Modify: `server/bff/routes/participation-dashboard.mjs`
- Test: `server/bff/participation-dashboard.test.mjs`

- [ ] **Step 1: Write failing catalog/count tests**

Add a snapshot test with one `E_NARA_DOUM` project and no RCMS project:

```js
it('등록·수정의 표준 정산 플랫폼을 0개까지 규칙 후보로 제공한다', () => {
  const snapshot = buildParticipationDashboardSnapshot({
    projects: [{
      id: 'enara-1', name: 'e나라도움 사업', clientOrg: 'KOICA',
      registrationRequirementsVersion: 2, basis: '공급가액', settlementSystem: 'E_NARA_DOUM',
    }],
  });

  expect(snapshot.filterOptions.settlementSystems.map(({ value }) => value)).toEqual([
    'NONE', 'E_NARA_DOUM', 'BOTAEM_E', 'RCMS', 'EZBARO',
    'SMTECH', 'KOCCA_PMS', 'NIPA', 'IRIS', 'OTHER',
  ]);
  expect(snapshot.filterOptions.settlementSystems).toEqual(expect.arrayContaining([
    expect.objectContaining({ value: 'E_NARA_DOUM', projectCount: 1 }),
    expect.objectContaining({ value: 'RCMS', projectCount: 0 }),
  ]));
});
```

Extend the route test to save a zero-count RCMS rule:

```js
const zeroCount = await request(app)
  .post('/api/v1/participation-dashboard/rules')
  .set('Idempotency-Key', 'zero-count-key')
  .send({ alias: '향후 RCMS 사업', clientOrgs: [], settlementSystems: ['RCMS'] })
  .expect(200);
expect(saved.get(`orgs/mysc/participation_rules/${zeroCount.body.id}`))
  .toMatchObject({ settlementSystems: ['RCMS'] });
```

- [ ] **Step 2: Run the tests and confirm RED**

Run:

```bash
npx vitest run server/bff/participation-dashboard.test.mjs -t "표준 정산 플랫폼|zero-count|향후 RCMS"
```

Expected: FAIL because candidates only contain observed project classifications, have no `projectCount`, and rule validation rejects RCMS.

- [ ] **Step 3: Export the registration-aligned server catalog**

Add to `server/bff/participation-settlement-system.mjs`:

```js
export const PARTICIPATION_RULE_SETTLEMENT_SYSTEM_CODES = [
  'NONE',
  'E_NARA_DOUM',
  'BOTAEM_E',
  'RCMS',
  'EZBARO',
  'SMTECH',
  'KOCCA_PMS',
  'NIPA',
  'IRIS',
  'OTHER',
];

export const PARTICIPATION_SETTLEMENT_SYSTEM_LABELS = {
  E_NARA_DOUM: 'e나라도움 (국고보조금통합관리시스템)',
  IRIS: 'IRIS(범부처통합연구지원시스템)',
  RCMS: 'RCMS (실시간연구비관리시스템)',
  EZBARO: '통합이지바로 (통합 Ez-plus)',
  E_HIJO: 'e호조 (지방재정)',
  EDUFINE: '에듀파인 (교육재정)',
  HAPPYEUM: '행복이음 (사회보장)',
  AGRIX: '아그릭스 (농림사업)',
  BOTAEM_E: '보탬e(지방보조금관리시스템)',
  SMTECH: 'SMTECH (중소기업기술개발사업종합관리시스템)',
  KOCCA_PMS: 'KOCCA PMS',
  NIPA: 'NIPA 사업관리시스템',
  ACCOUNTANT: '회계사정산',
  PRIVATE: '민간사업',
  OTHER: '기타',
  NONE: '시스템 미사용',
};
```

Keep `SETTLEMENT_SYSTEM_CODES` unchanged for legacy classification and validation compatibility.

- [ ] **Step 4: Build complete options with counts**

Replace the local label map in `server/bff/participation-dashboard.mjs` with imports and add:

```js
import {
  PARTICIPATION_RULE_SETTLEMENT_SYSTEM_CODES,
  PARTICIPATION_SETTLEMENT_SYSTEM_LABELS,
  resolveParticipationSettlementSystem,
} from './participation-settlement-system.mjs';

function buildSettlementSystemOptions(projects) {
  const counts = new Map();
  for (const project of projects) {
    const value = resolveParticipationSettlementSystem(project);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const observedLegacy = [...counts.keys()]
    .filter((value) => !PARTICIPATION_RULE_SETTLEMENT_SYSTEM_CODES.includes(value))
    .sort();
  return [...PARTICIPATION_RULE_SETTLEMENT_SYSTEM_CODES, ...observedLegacy].map((value) => ({
    value,
    label: PARTICIPATION_SETTLEMENT_SYSTEM_LABELS[value] || value,
    projectCount: counts.get(value) || 0,
  }));
}
```

Use it in the snapshot:

```js
filterOptions: {
  clientOrgs: [...new Set(projects
    .map((project) => readOptionalText(project?.clientOrg))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ko')),
  settlementSystems: buildSettlementSystemOptions(projects),
},
```

- [ ] **Step 5: Permit zero-count catalog values on save**

Import the catalog in `server/bff/routes/participation-dashboard.mjs` and replace the observed-only set:

```js
const validSettlementSystems = new Set([
  ...PARTICIPATION_RULE_SETTLEMENT_SYSTEM_CODES,
  ...projects.map(resolveParticipationSettlementSystem),
]);
```

Keep client organization validation observed-only; the user only approved prefilled settlement platforms.

- [ ] **Step 6: Run Task 1 tests and commit**

Run:

```bash
npx vitest run server/bff/participation-dashboard.test.mjs
```

Expected: PASS.

Commit:

```bash
git add server/bff/participation-settlement-system.mjs server/bff/participation-dashboard.mjs server/bff/routes/participation-dashboard.mjs server/bff/participation-dashboard.test.mjs
git commit -m "feat(participation): align settlement rule candidates"
```

### Task 2: Add server-calculated per-project month breakdowns

**Files:**
- Modify: `server/bff/participation-dashboard.mjs`
- Test: `server/bff/participation-dashboard.test.mjs`

- [ ] **Step 1: Write the fail-first reconciliation fixture**

Add a saved-rule test with:

```js
const projects = [
  { id: 'p-sheet', name: 'KOICA e나라도움', clientOrg: 'KOICA', settlementSystem: 'E_NARA_DOUM' },
  { id: 'p-manual', name: 'KOICA RCMS', clientOrg: 'KOICA', settlementSystem: 'RCMS' },
  { id: 'p-out', name: '다른 고객 RCMS', clientOrg: '다른 고객', settlementSystem: 'RCMS' },
  { id: 'p-old', name: '과거 KOICA', clientOrg: 'KOICA', settlementSystem: 'RCMS' },
];
const entries = [
  {
    id: 'sheet', source: 'PROJECT_TEAM_SYNC', projectId: 'p-sheet', personId: 'person-1',
    periodStart: '2026-01', periodEnd: '2026-03', rate: 30,
    monthlyRates: { '2026-01': 20, '2026-02': null, '2026-03': 0 },
  },
  {
    id: 'suppressed-manual', source: 'MANUAL', projectId: 'p-sheet', personId: 'person-1',
    periodStart: '2026-01', periodEnd: '2026-03', rate: 5,
  },
  {
    id: 'manual', source: 'MANUAL', projectId: 'p-manual', personId: 'person-1',
    periodStart: '2026-01', periodEnd: '2026-03', rate: 40,
  },
  {
    id: 'outside-rule', source: 'MANUAL', projectId: 'p-out', personId: 'person-1',
    periodStart: '2026-01', periodEnd: '2026-03', rate: 90,
  },
  {
    id: 'old', source: 'MANUAL', projectId: 'p-old', personId: 'person-1',
    periodStart: '2025-01', periodEnd: '2025-12', rate: 10,
  },
];
```

Assert:

```js
const result = selectParticipationDashboardYear(buildParticipationDashboardSnapshot({
  projects,
  entries,
  people: [{ personId: 'person-1', name: '김정태' }],
  rules: [{
    id: 'koica-platforms', kind: 'USER_DEFINED', alias: 'KOICA 플랫폼',
    clientOrgs: ['KOICA'], settlementSystems: ['E_NARA_DOUM', 'RCMS'],
  }],
}), '2026', 'koica-platforms');
const member = result.members[0];

expect(member.projectCount).toBe(2);
expect(new Set(member.projects.map(({ projectId }) => projectId)))
  .toEqual(new Set(['p-sheet', 'p-manual']));
expect(member.months.slice(0, 3)).toEqual([
  expect.objectContaining({ rate: 60, isConfirmed: true, hasMissing: false }),
  expect.objectContaining({ rate: 40, isConfirmed: true, hasMissing: true }),
  expect.objectContaining({ rate: 40, isConfirmed: true, hasMissing: false }),
]);
expect(member.projects.find(({ projectId }) => projectId === 'p-sheet').months.slice(0, 3)).toEqual([
  expect.objectContaining({ rate: 20, isConfirmed: true, hasMissing: false }),
  expect.objectContaining({ rate: 0, isConfirmed: false, hasMissing: true }),
  expect.objectContaining({ rate: 0, isConfirmed: true, hasMissing: false }),
]);
expect(selectParticipationDashboardYear(
  buildParticipationDashboardSnapshot({ projects, entries, people: [{ personId: 'person-1', name: '김정태' }] }),
  '2026',
).members[0].projects).toEqual([]);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npx vitest run server/bff/participation-dashboard.test.mjs -t "프로젝트별 월 기여율"
```

Expected: FAIL because `member.projects` does not exist and `projectCount` includes `p-old`.

- [ ] **Step 3: Accumulate project rows in the existing pass**

Add `projects: new Map()` to the person row initializer. Before the month loops, initialize the project row:

```js
const projectName = readOptionalText(entry?.projectShortName)
  || readOptionalText(entry?.projectName)
  || readOptionalText(project?.name)
  || projectId;
const projectRow = row.projects.get(projectId) || {
  projectId,
  projectName,
  values: new Map(),
  confirmedMonths: new Set(),
  missingMonths: new Set(),
};
```

After the existing ownership and manual-suppression checks, apply the same value and status to the parent and project:

```js
const value = valueForMonth(entry, yearMonth);
row.values.set(yearMonth, (row.values.get(yearMonth) || 0) + value);
projectRow.values.set(yearMonth, (projectRow.values.get(yearMonth) || 0) + value);
const isMissing = Object.hasOwn(entry || {}, 'monthlyRates')
  && (!Object.hasOwn(entry?.monthlyRates || {}, yearMonth) || entry?.monthlyRates?.[yearMonth] === null);
if (isMissing) {
  row.missingMonths.add(yearMonth);
  projectRow.missingMonths.add(yearMonth);
} else {
  row.confirmedMonths.add(yearMonth);
  projectRow.confirmedMonths.add(yearMonth);
}
```

After the month loops, store it only when it owns at least one month:

```js
if (projectRow.confirmedMonths.size || projectRow.missingMonths.size) {
  row.projects.set(projectId, projectRow);
}
```

Serialize `row.projects` beside the existing person aggregate:

```js
projects: [...row.projects.values()].map((projectRow) => ({
  projectId: projectRow.projectId,
  projectName: projectRow.projectName,
  monthlyRates: Object.fromEntries(projectRow.values),
  confirmedMonths: [...projectRow.confirmedMonths].sort(),
  missingMonths: [...projectRow.missingMonths].sort(),
})).sort((left, right) => (
  left.projectName.localeCompare(right.projectName, 'ko')
  || left.projectId.localeCompare(right.projectId)
)),
```

- [ ] **Step 4: Shape selected-year details from one helper**

Inside `selectParticipationDashboardYear`, add:

```js
const monthStatus = (source, yearMonth) => {
  const rate = Number(source?.monthlyRates?.[yearMonth] || 0);
  return {
    yearMonth,
    label: `${Number(yearMonth.slice(5, 7))}월`,
    rate,
    isConfirmed: (source?.confirmedMonths || []).includes(yearMonth),
    hasMissing: (source?.missingMonths || []).includes(yearMonth),
    isWarning: rate > 100,
  };
};
```

Replace duplicated parent month shaping with `monthKeys.map((yearMonth) => monthStatus(member, yearMonth))`, then derive selected-year projects:

```js
const selectedYearProjects = (member.projects || []).map((project) => ({
  projectId: project.projectId,
  projectName: project.projectName,
  months: monthKeys.map((yearMonth) => monthStatus(project, yearMonth)),
})).filter((project) => project.months.some((month) => month.isConfirmed || month.hasMissing));
```

Return:

```js
projectLabel: selectedYearProjects.map(({ projectName }) => projectName).join(' · '),
projectCount: selectedYearProjects.length,
projects: selectedRule.id === 'all' ? [] : selectedYearProjects,
```

- [ ] **Step 5: Run all participation dashboard unit tests and commit**

Run:

```bash
npx vitest run server/bff/participation-dashboard.test.mjs
```

Expected: PASS.

Commit:

```bash
git add server/bff/participation-dashboard.mjs server/bff/participation-dashboard.test.mjs
git commit -m "feat(participation): return project month breakdowns"
```

### Task 3: Prove the persisted portfolio response end to end

**Files:**
- Modify: `server/bff/app.integration.test.ts`

- [ ] **Step 1: Add failing HTTP breakdown assertions to the existing KOICA portfolio fixture**

After the existing `dashboard.body.members` assertion, add:

```ts
const koicaMember = dashboard.body.members[0];
expect(koicaMember.projects.map((project: { projectId: string }) => project.projectId)).toEqual([
  targetProjectId,
  'p-koica-ezbaro',
  'p-koica-rcms',
]);
expect(koicaMember.projects).toEqual(expect.arrayContaining([
  expect.objectContaining({
    projectId: targetProjectId,
    months: expect.arrayContaining([
      expect.objectContaining({ yearMonth: '2026-01', rate: 20, isConfirmed: true, hasMissing: false }),
      expect.objectContaining({ yearMonth: '2026-02', rate: 0, isConfirmed: false, hasMissing: true }),
      expect.objectContaining({ yearMonth: '2026-03', rate: 0, isConfirmed: true, hasMissing: false }),
    ]),
  }),
  expect.objectContaining({
    projectId: 'p-koica-rcms',
    months: expect.arrayContaining([expect.objectContaining({ yearMonth: '2026-01', rate: 7 })]),
  }),
  expect.objectContaining({
    projectId: 'p-koica-ezbaro',
    months: expect.arrayContaining([expect.objectContaining({ yearMonth: '2026-01', rate: 3 })]),
  }),
]));
expect(koicaMember.projects.reduce((sum: number, project: { months: Array<{ yearMonth: string; rate: number }> }) => (
  sum + (project.months.find(({ yearMonth }) => yearMonth === '2026-01')?.rate || 0)
), 0)).toBe(koicaMember.months.find(({ yearMonth }: { yearMonth: string }) => yearMonth === '2026-01').rate);
```

Also assert the all View remains summary-only:

```ts
const allDashboard = await api
  .get('/api/v1/participation-dashboard?year=2026&ruleId=all')
  .set(defaultHeaders);
expect(allDashboard.status).toBe(200);
expect(allDashboard.body.members.every((member: { projects: unknown[] }) => member.projects.length === 0)).toBe(true);
```

- [ ] **Step 2: Run the focused emulator test and confirm RED**

Run:

```bash
npm run bff:test:integration
```

Expected before Task 2 implementation: the participation portfolio case FAILS on missing `projects`; unrelated emulator cases retain their baseline result.

- [ ] **Step 3: Re-run after Task 2 and commit the integration contract**

Run:

```bash
npm run bff:test:integration
```

Expected: Firestore and Storage integration suites PASS.

Commit:

```bash
git add server/bff/app.integration.test.ts
git commit -m "test(participation): verify portfolio project breakdown"
```

### Task 4: Type and render default-collapsed project rows

**Files:**
- Modify: `src/app/lib/platform-bff-client.ts`
- Modify: `src/app/components/participation/ParticipationPage.tsx`
- Modify: `src/app/components/participation/ParticipationPage.shell.test.ts`

- [ ] **Step 1: Add fail-first UI contract assertions**

Extend `ParticipationPage.shell.test.ts`:

```ts
it('keeps all view compact and discloses projects only for saved rules', () => {
  expect(source).toContain("snapshot.selectedRule.id !== 'all'");
  expect(source).toContain('const projects = member.projects || []');
  expect(source).toContain('projects.length');
  expect(source).toContain('aria-expanded={isExpanded}');
  expect(source).toContain('aria-controls={`participation-projects-${member.memberId}`}');
  expect(source).toContain('projects.map');
  expect(source).toContain('project.months.map');
  expect(source).toContain('setExpandedMemberIds(new Set())');
  expect(source).not.toContain('fetchParticipationDashboardViaBff({ projectId');
  expect(source).not.toContain('member.projects.reduce');
});

it('shows registered settlement systems with zero-project counts', () => {
  expect(source).toContain('system.projectCount');
  expect(source).toContain('`${Number(system.projectCount) || 0}개`');
});
```

- [ ] **Step 2: Run UI contract tests and confirm RED**

Run:

```bash
npx vitest run src/app/components/participation/ParticipationPage.shell.test.ts
```

Expected: FAIL because project details, disclosure state, and option counts are absent.

- [ ] **Step 3: Extend client response types**

Add:

```ts
export interface ParticipationDashboardMonth {
  yearMonth: string;
  label: string;
  rate: number;
  isConfirmed: boolean;
  hasMissing: boolean;
  isWarning: boolean;
}

export interface ParticipationDashboardProject {
  projectId: string;
  projectName: string;
  months: ParticipationDashboardMonth[];
}
```

Use `ParticipationDashboardMonth[]` for the member `months`, add the backward-compatible `projects?: ParticipationDashboardProject[]`, and change filter options to:

```ts
filterOptions: {
  clientOrgs: string[];
  settlementSystems: Array<{ value: string; label: string; projectCount?: number }>;
};
```

- [ ] **Step 4: Add reusable month-cell rendering**

In `ParticipationPage.tsx`, import `ChevronRight` and the `ParticipationDashboardMember` type, then add above `ParticipationPage`:

```tsx
function ParticipationMonthValue({ month, detail = false }: {
  month: ParticipationDashboardMember['months'][number];
  detail?: boolean;
}) {
  const className = month.isWarning
    ? 'bg-rose-50 font-semibold text-rose-700'
    : month.hasMissing
      ? 'bg-amber-50 text-amber-800'
      : month.isConfirmed
        ? detail ? 'font-medium text-slate-700' : 'font-semibold text-slate-800'
        : 'text-slate-300';
  return <TableCell className={`px-2 py-2 text-center text-xs tabular-nums ${className}`}>
    {month.isConfirmed
      ? <span className="inline-flex flex-col"><span>{`${month.rate}%`}</span>{month.hasMissing ? <span className="text-[10px] font-medium">미입력 있음</span> : null}</span>
      : month.hasMissing ? '미입력' : '—'}
  </TableCell>;
}
```

- [ ] **Step 5: Add default-collapsed disclosure state**

Inside `ParticipationPage`:

```tsx
const [expandedMemberIds, setExpandedMemberIds] = useState<Set<string>>(() => new Set());
useEffect(() => {
  setExpandedMemberIds(new Set());
}, [selectedRuleId, selectedYear]);
const toggleMember = (memberId: string) => {
  setExpandedMemberIds((current) => {
    const next = new Set(current);
    if (next.has(memberId)) next.delete(memberId);
    else next.add(memberId);
    return next;
  });
};
```

Replace the single shared `<TableBody>` with one `<TableBody>` per member so `aria-controls` can reference the complete row group:

```tsx
{snapshot.members.map((member) => {
  const projects = member.projects || [];
  const canExpand = snapshot.selectedRule.id !== 'all' && projects.length > 0;
  const isExpanded = canExpand && expandedMemberIds.has(member.memberId);
  const firstProjectName = projects[0]?.projectName || `프로젝트 ${member.projectCount}개`;
  const projectSummary = member.projectCount > 1
    ? `${firstProjectName} 외 ${member.projectCount - 1}개 · 총 ${member.projectCount}개`
    : firstProjectName;
  return <TableBody key={member.memberId} id={`participation-projects-${member.memberId}`}>
    <TableRow className="group border-slate-100 hover:bg-slate-50/70">
      <TableCell className="sticky left-0 z-10 bg-white text-xs font-medium text-slate-800 group-hover:bg-slate-50">
        {member.memberName}
      </TableCell>
      <TableCell className="sticky left-[150px] z-10 border-r border-slate-100 bg-white text-xs text-slate-600 group-hover:bg-slate-50">
        {canExpand ? (
          <button
            type="button"
            aria-label={`${member.memberName}의 프로젝트 ${member.projectCount}개 ${isExpanded ? '접기' : '펼치기'}`}
            aria-expanded={isExpanded}
            aria-controls={`participation-projects-${member.memberId}`}
            onClick={() => toggleMember(member.memberId)}
            className="flex w-full items-center gap-1 rounded text-left text-xs text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            <span className="line-clamp-2">{projectSummary}</span>
          </button>
        ) : `프로젝트 ${member.projectCount}개`}
      </TableCell>
      {member.months.map((month) => <ParticipationMonthValue key={month.yearMonth} month={month} />)}
    </TableRow>
    {isExpanded && projects.map((project) => (
      <TableRow
        key={`${member.memberId}:${project.projectId}`}
        className="border-slate-100 bg-slate-50/80 hover:bg-slate-100/80"
      >
        <TableCell className="sticky left-0 z-10 bg-slate-50/95 text-xs text-slate-400" />
        <TableCell className="sticky left-[150px] z-10 border-r border-slate-200 bg-slate-50/95 py-2 pl-6 text-xs font-medium text-slate-700">
          <span aria-hidden="true">↳ </span>{project.projectName}
        </TableCell>
        {project.months.map((month) => <ParticipationMonthValue key={month.yearMonth} month={month} detail />)}
      </TableRow>
    ))}
  </TableBody>;
})}
```

Use `<ParticipationMonthValue>` for parent month cells as well. Do not calculate totals in React.

- [ ] **Step 6: Show counts in the rule manager**

Replace the settlement option label with:

```tsx
<span className="flex min-w-0 flex-1 items-center justify-between gap-2">
  <span>{system.label}</span>
  <span className="shrink-0 text-xs text-muted-foreground">{`${Number(system.projectCount) || 0}개`}</span>
</span>
```

Keep the checkbox enabled when `projectCount === 0`.

- [ ] **Step 7: Run frontend tests, typecheck, and build**

Run:

```bash
npx vitest run src/app/components/participation/ParticipationPage.shell.test.ts src/app/lib/platform-bff-client.test.ts
npm run typecheck
npm run build
```

Expected: targeted tests PASS, no new TypeScript errors, production build PASS.

- [ ] **Step 8: Commit the UI**

```bash
git add src/app/lib/platform-bff-client.ts src/app/components/participation/ParticipationPage.tsx src/app/components/participation/ParticipationPage.shell.test.ts
git commit -m "feat(participation): disclose project contributions"
```

### Task 5: Document and independently verify the completed behavior

**Files:**
- Create: `docs/architecture/contracts/2026-08-24-participation-project-breakdown-contract.md`
- Verify: all files from Tasks 1–4

- [ ] **Step 1: Write the concise business contract**

The document must state:

```markdown
# 참여율 프로젝트 조합 계약

- 전체 View는 사람별 합계만 표시한다.
- 사용자 규칙 View는 기본 접힘이며 사람별로 프로젝트 기여행을 펼친다.
- 사람 월 합계는 선택 규칙·선택 연도의 프로젝트 월 합계와 같다.
- 0%는 확인된 미참여, 미입력은 확인 대기, —는 투입기간 밖이다.
- 정산 플랫폼 후보는 프로젝트 등록·수정 표준 목록을 모두 표시한다.
- 사업 수 0개인 플랫폼도 선택 가능하며 기존 규칙을 자동 변경하지 않는다.
- 펼침은 추가 조회나 쓰기를 발생시키지 않는다.
```

- [ ] **Step 2: Run the full local gates**

Run:

```bash
npm test
npm run bff:test:integration
npm run typecheck
npm run build
git diff --check origin/main...HEAD
```

Expected: all required gates PASS; known baseline TypeScript errors are not increased if the repository reports a baseline count.

- [ ] **Step 3: Run browser QA using the repository `/qa` procedure**

Use `/Users/boram/gstack/.agents/skills/gstack-qa/SKILL.md` with the evaluator persona and calibration files required by `AGENTS.md`. Verify in a local authenticated or mocked-user flow:

```text
1. 전체 View: disclosure button count 0, 사람 합계 visible.
2. Saved KOICA rule: all rows default collapsed.
3. One person expanded by mouse, another by Enter/Space.
4. Child project values reconcile with 12 parent month cells.
5. 0%, 미입력, — remain distinct.
6. Toggle each row repeatedly; dashboard GET request count does not increase.
7. Rule manager shows every registration platform, including RCMS 0개, and it remains enabled.
8. 375x812 viewport: only table container scrolls horizontally; sticky columns and detail rows stay aligned.
9. Empty response and 5xx response preserve existing UI states; console has no errors.
```

Score the UI against `~/.gstack/eval-criteria.md`; require total 70+, every dimension 10+, and design plus originality 40+.

- [ ] **Step 4: Perform sabotage checks**

Temporarily break one behavior at a time and confirm the named test fails, then restore immediately:

```text
- derive projectCount from the old all-years Set → selected-year unit test fails
- treat null as the base rate → missing-month unit test fails
- remove PROJECT_TEAM_SYNC suppression → reconciliation test fails
- remove the full settlement catalog from valid values → zero-count route test fails
- show disclosures for selectedRule.id === 'all' → UI contract/browser QA fails
- add a fetch in the toggle handler → browser request-count check fails
```

- [ ] **Step 5: Commit docs and final verification evidence**

```bash
git add docs/architecture/contracts/2026-08-24-participation-project-breakdown-contract.md
git commit -m "docs(participation): document project breakdown contract"
git status --short
```

Expected: only intentionally ignored local analysis/mockup directories remain untracked; no product or test file is left uncommitted.
