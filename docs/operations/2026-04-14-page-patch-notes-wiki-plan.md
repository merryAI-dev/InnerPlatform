# Page Patch Notes Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub 저장소 안에 페이지별 누적 패치노트 위키를 만들고, 최근 운영 영향이 큰 화면 8개의 seed 문서를 초기화한다.

**Architecture:** `docs/wiki/patch-notes/`를 위키 루트로 두고 `index.md`, `log.md`, `AGENTS.md`, `pages/*.md`를 함께 관리한다. 변경이 특정 화면 UX에 영향을 주면 해당 page 문서와 `log.md`를 같이 갱신하는 운영 규칙을 문서화한다.

**Tech Stack:** Markdown, git history, existing repo docs under `docs/operations`, source files in `src/app/components/*`

---

### Task 1: 위키 루트와 운영 규칙 문서 만들기

**Files:**
- Create: `docs/wiki/patch-notes/AGENTS.md`
- Create: `docs/wiki/patch-notes/index.md`
- Create: `docs/wiki/patch-notes/log.md`
- Reference: `docs/operations/2026-04-14-page-patch-notes-wiki-design.md`

- [ ] **Step 1: AGENTS 초안 작성**

```md
# Patch Notes Wiki Agent Guide

## Mission

이 디렉터리는 화면 단위 누적 패치노트 위키다. raw truth는 코드/테스트/PR이고, 이 위키는 운영자가 최근 변화를 읽기 쉽게 정리한 중간 계층이다.

## Update Rules

1. 특정 화면 UX 또는 운영 흐름이 바뀌면 대응 `pages/*.md`를 반드시 갱신한다.
2. 여러 화면에 걸치면 각 화면 문서와 `log.md`를 함께 갱신한다.
3. 새 화면 문서를 만들면 `index.md`를 함께 갱신한다.
4. 문장은 사실 중심으로 쓰고, 가능한 한 관련 파일/테스트/커밋을 같이 남긴다.
```

- [ ] **Step 2: index 초안 작성**

```md
# Patch Notes Wiki

화면 단위 변경 이력을 누적 관리하는 운영 위키입니다.

## Pages
- [portal-weekly-expense](./pages/portal-weekly-expense.md) - 사업비 입력(주간) 화면의 저장/입력/흐름 변경 기록
- [portal-bank-statement](./pages/portal-bank-statement.md) - 통장내역 업로드/분류/연결 화면 변경 기록
```

- [ ] **Step 3: log 초안 작성**

```md
# Patch Notes Log

## [2026-04-14] bootstrap | patch-notes-wiki | 초기 위키 scaffold
- pages: index, log, agents, initial seed pages
- summary: GitHub 내부에 페이지 단위 누적 패치노트 위키 구조를 신설했다.
```

- [ ] **Step 4: 파일 생성 상태 확인**

Run: `find docs/wiki/patch-notes -maxdepth 2 -type f | sort`
Expected: `AGENTS.md`, `index.md`, `log.md`가 출력된다.

- [ ] **Step 5: Commit**

```bash
git add docs/wiki/patch-notes/AGENTS.md docs/wiki/patch-notes/index.md docs/wiki/patch-notes/log.md
git commit -m "docs: add patch notes wiki scaffold"
```

### Task 2: portal seed 페이지 문서 작성

**Files:**
- Create: `docs/wiki/patch-notes/pages/portal-weekly-expense.md`
- Create: `docs/wiki/patch-notes/pages/portal-bank-statement.md`
- Create: `docs/wiki/patch-notes/pages/portal-budget.md`
- Create: `docs/wiki/patch-notes/pages/portal-register-project.md`
- Create: `docs/wiki/patch-notes/pages/portal-submissions.md`
- Modify: `docs/wiki/patch-notes/index.md`
- Modify: `docs/wiki/patch-notes/log.md`
- Reference: `src/app/components/portal/PortalWeeklyExpensePage.tsx`
- Reference: `src/app/components/portal/PortalBankStatementPage.tsx`
- Reference: `src/app/components/portal/PortalBudget.tsx`
- Reference: `src/app/components/portal/PortalProjectRegister.tsx`
- Reference: `src/app/components/portal/PortalSubmissionsPage.tsx`

- [ ] **Step 1: 최근 portal 변경 근거 수집**

Run: `git log --oneline -8 -- src/app/components/portal`
Expected: `eb2dc13`, `0974416`, `18e2925`, `c69cd6e`, `f7735c3`, `a179cb6`, `afc2098` 같은 최근 portal 관련 커밋이 보인다.

- [ ] **Step 2: portal weekly expense 문서 작성**

```md
# Portal Weekly Expense

- route: `/portal/weekly-expense`
- primary users: PM, 실무 입력 담당자
- status: active
- last updated: 2026-04-14

## Recent Changes
- [2026-04-10] 저장 후에도 뜨던 이동 차단 경고를 제거했다.
- [2026-04-10] 자동 미션/가이드 팝업을 제거해 입력 시작 진입을 단순화했다.
- [2026-04-10] 통장내역 기준본에서 현재 탭 입력으로 이어지는 흐름 카피와 배치를 강화했다.
```

- [ ] **Step 3: portal bank statement / budget / register-project / submissions 문서 작성**

```md
# Portal Bank Statement
- route: `/portal/bank-statement`

## Recent Changes
- [2026-04-10] 사업비 입력(주간)으로 이어가는 흐름 문구를 강화했다.
- [2026-04-10] intake queue 안정화와 연결 상태 표기가 정리됐다.
```

```md
# Portal Budget
- route: `/portal/budget`

## Recent Changes
- [2026-04-13] 가져오기 안내 텍스트 겹침을 수정했다.
- [2026-04-10] 긴 포털 모달 내부 스크롤을 복구했다.
- [2026-04-10] 잘못된 budget code book 저장을 막았다.
```

```md
# Portal Register Project
- route: `/portal/register-project`

## Recent Changes
- [2026-04-03] 직접 입력형 자금 흐름(`DIRECT_ENTRY`) 등록 플로우를 추가했다.
- [2026-04-03] 등록 완료 후 BFF/Slack 알림 연계를 넣었다.
- [2026-04-01] draft 자동저장과 단계 게이팅을 완화했다.
```

```md
# Portal Submissions
- route: `/portal/submissions`

## Recent Changes
- [2026-04-10] 이번 주 작성 여부와 projection 수정 시각 중심으로 상태 해석을 바꿨다.
- [2026-04-10] 최근 업데이트 기준을 projection 수정일시로 명확히 맞췄다.
```

- [ ] **Step 4: index/log에 portal seed 반영**

Run: `sed -n '1,220p' docs/wiki/patch-notes/index.md && sed -n '1,220p' docs/wiki/patch-notes/log.md`
Expected: portal seed 3개 링크와 해당 bootstrap entry가 보인다.

- [ ] **Step 5: Commit**

```bash
git add docs/wiki/patch-notes/pages/portal-weekly-expense.md docs/wiki/patch-notes/pages/portal-bank-statement.md docs/wiki/patch-notes/pages/portal-budget.md docs/wiki/patch-notes/pages/portal-register-project.md docs/wiki/patch-notes/pages/portal-submissions.md docs/wiki/patch-notes/index.md docs/wiki/patch-notes/log.md
git commit -m "docs: add portal patch note pages"
```

### Task 3: admin seed 페이지 문서 작성

**Files:**
- Create: `docs/wiki/patch-notes/pages/admin-cashflow-export.md`
- Create: `docs/wiki/patch-notes/pages/admin-cashflow-project-sheet.md`
- Create: `docs/wiki/patch-notes/pages/admin-users-auth-governance.md`
- Modify: `docs/wiki/patch-notes/index.md`
- Modify: `docs/wiki/patch-notes/log.md`
- Reference: `src/app/components/cashflow/CashflowExportPage.tsx`
- Reference: `src/app/components/cashflow/CashflowProjectSheet.tsx`
- Reference: `src/app/components/users/UserManagementPage.tsx`
- Reference: `tests/e2e/admin-cashflow-export.spec.ts`
- Reference: `tests/e2e/admin-ops-surface.spec.ts`

- [ ] **Step 1: 최근 admin 관련 근거 수집**

Run: `git log --oneline -8 -- src/app/components/cashflow src/app/components/users server/bff`
Expected: `4787138`, `d351407`, `b51f12c`, `e77dbe7`, `71f5769` 등이 보인다.

- [ ] **Step 2: admin cashflow export 문서 작성**

```md
# Admin Cashflow Export

- route: `/cashflow`
- primary users: admin, finance
- status: active
- last updated: 2026-04-14

## Recent Changes
- [2026-04-09] 추출 화면을 운영툴형 단일 화면으로 재편했다.
- [2026-04-09] server-side export 기준으로 정리하고 workbook 생성 책임을 BFF로 이동했다.
- [2026-04-09] 노션형 모노톤 패널 레이아웃으로 정리했다.
```

- [ ] **Step 3: admin cashflow project sheet / users auth governance 문서 작성**

```md
# Admin Cashflow Project Sheet

- route: `/cashflow/projects/:projectId`

## Recent Changes
- [2026-04-05] compare mode, guide preview, weekly accounting snapshot, audit trail을 더 강화했다.
- [2026-03-18] projection 기준 close 흐름으로 정리하고 settlement close 이후 projection 수정 허용으로 바꿨다.
```

```md
# Admin Users Auth Governance

- route: `/users`
- primary users: admin
- status: active
- last updated: 2026-04-14

## Recent Changes
- [2026-04-13] shallow user table을 auth governance 대시보드로 교체했다.
- [2026-04-13] Firebase Auth, canonical member, legacy member, custom claim drift를 한 화면에 비교할 수 있게 했다.
- [2026-04-13] 개별/일괄 deep sync로 member role과 auth 상태를 정렬할 수 있게 했다.
```

- [ ] **Step 4: index/log에 admin seed 반영**

Run: `sed -n '1,260p' docs/wiki/patch-notes/index.md && sed -n '1,260p' docs/wiki/patch-notes/log.md`
Expected: admin seed 2개 링크와 auth governance/cashflow 관련 log entry가 보인다.

- [ ] **Step 5: Commit**

```bash
git add docs/wiki/patch-notes/pages/admin-cashflow-export.md docs/wiki/patch-notes/pages/admin-cashflow-project-sheet.md docs/wiki/patch-notes/pages/admin-users-auth-governance.md docs/wiki/patch-notes/index.md docs/wiki/patch-notes/log.md
git commit -m "docs: add admin patch note pages"
```

### Task 4: 위키 일관성 점검과 handoff 정리

**Files:**
- Modify: `docs/wiki/patch-notes/index.md`
- Modify: `docs/wiki/patch-notes/log.md`
- Modify: `docs/wiki/patch-notes/pages/*.md`

- [ ] **Step 1: 링크와 메타데이터 점검**

Run: `rg -n "last updated|route:|primary users:|Related Files|Recent Changes" docs/wiki/patch-notes`
Expected: 모든 page 문서에 공통 메타데이터와 핵심 섹션이 들어 있다.

- [ ] **Step 2: 중복/누락 문장 점검**

Run: `sed -n '1,260p' docs/wiki/patch-notes/index.md && sed -n '1,260p' docs/wiki/patch-notes/log.md`
Expected: `index.md`는 디렉터리 역할, `log.md`는 append-only 타임라인 역할이 분리되어 보인다.

- [ ] **Step 3: git diff 최종 검토**

Run: `git diff -- docs/wiki/patch-notes docs/operations/2026-04-14-page-patch-notes-wiki-design.md docs/operations/2026-04-14-page-patch-notes-wiki-plan.md`
Expected: patch notes wiki 문서만 추가/수정된 diff가 보인다.

- [ ] **Step 4: Commit**

```bash
git add docs/wiki/patch-notes docs/operations/2026-04-14-page-patch-notes-wiki-design.md docs/operations/2026-04-14-page-patch-notes-wiki-plan.md
git commit -m "docs: define page patch notes wiki"
```
