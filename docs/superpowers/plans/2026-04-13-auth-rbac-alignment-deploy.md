# Auth + RBAC Alignment And Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로컬 코드, `main`, 배포 환경, Firebase 인증 정보, BFF RBAC가 같은 기준으로 `admin/finance` 권한을 해석하도록 맞추고, `jslee@mysc.co.kr` 같은 대상 계정이 캐시플로 추출 접근 권한을 일관되게 갖게 만든다.

**Architecture:** 프론트에서는 bootstrap admin 이메일과 member role fallback으로 초기 권한을 계산하고, BFF는 Firebase ID token claim role로 최종 권한을 다시 검사한다. 따라서 이번 작업은 단순 프론트 수정이 아니라 `frontend bootstrap list + member document role + Firebase custom claim + BFF enforcement + production deploy`를 하나의 권한 계약으로 묶어 정렬하는 작업이다.

**Tech Stack:** React, TypeScript, Vite, Firebase Auth, Firestore member docs, Node BFF, policy JSON (`policies/rbac-policy.json`, `policies/nav-policy.json`), Vercel deploy, GitHub PR workflow

---

## File Map

### Existing files to modify

- `src/app/data/auth-bootstrap.ts`
  - bootstrap admin 이메일 기준 목록
- `src/app/data/auth-bootstrap.test.ts`
  - bootstrap admin 목록 회귀 테스트
- `src/app/platform/firestore-rules-policy.test.ts`
  - bootstrap 목록과 정책 정합성 회귀 테스트
- `docs/superpowers/plans/2026-04-13-auth-rbac-alignment-deploy.md`
  - 이번 정렬 작업의 실행 기준 문서

### Existing files to inspect during execution

- `src/app/data/auth-store.tsx`
  - 프론트 role fallback 우선순위
- `src/app/platform/admin-nav.ts`
  - `/cashflow` admin-space 노출 조건
- `src/app/platform/rbac.ts`
  - `cashflow:export` permission 판정
- `src/app/components/cashflow/CashflowExportPage.tsx`
  - 화면 내부 권한 게이트
- `server/bff/auth.mjs`
  - Firebase token role/tenant/email 검증
- `server/bff/routes/cashflow-exports.mjs`
  - BFF export endpoint permission 재검사
- `policies/nav-policy.json`
  - `/cashflow` 메뉴 접근 계약
- `policies/rbac-policy.json`
  - `cashflow:export` 권한 계약

### External systems to verify manually

- Firebase Auth custom claims
- Firestore `orgs/{tenantId}/members/{uid}` documents
- Production Vercel deployment

---

## Architecture Notes

### Current mismatch

- 로컬 작업본의 bootstrap admin 목록에는 `jslee@mysc.co.kr`가 포함되어 있다.
- `origin/main`의 bootstrap admin 목록에는 `jslee@mysc.co.kr`가 없다.
- 프론트는 bootstrap admin이면 `admin`으로 승격하지만, BFF는 Firebase token claim의 role을 기준으로 다시 검사한다.
- 따라서 프론트만 수정해도 UI는 열릴 수 있지만, BFF export는 여전히 403이 날 수 있다.

### Source of truth order

1. Firebase ID token custom claim role
2. Firestore member document role
3. frontend bootstrap admin fallback

이번 작업의 목표는 세 경로가 서로 모순되지 않게 만드는 것이다.

### Success criteria

- `jslee@mysc.co.kr`로 로그인하면 `/cashflow` 메뉴가 노출된다.
- `/cashflow` 페이지에 진입 가능하다.
- `POST /api/v1/cashflow-exports`가 403 없이 성공한다.
- 같은 계정이 로컬, preview, production에서 같은 role로 보인다.

---

### Task 1: Freeze The Actual RBAC Diagnosis

**Files:**
- Inspect: `src/app/data/auth-bootstrap.ts`
- Inspect: `src/app/data/auth-store.tsx`
- Inspect: `src/app/platform/admin-nav.ts`
- Inspect: `src/app/platform/rbac.ts`
- Inspect: `src/app/components/cashflow/CashflowExportPage.tsx`
- Inspect: `server/bff/auth.mjs`
- Inspect: `server/bff/routes/cashflow-exports.mjs`

- [ ] **Step 1: Capture the current local vs `origin/main` bootstrap diff**

Run:

```bash
git show origin/main:src/app/data/auth-bootstrap.ts | sed -n '1,40p'
sed -n '1,40p' src/app/data/auth-bootstrap.ts
```

Expected:
- local에는 `jslee@mysc.co.kr` 포함
- `origin/main`에는 미포함

- [ ] **Step 2: Confirm the frontend gate for cashflow export**

Run:

```bash
nl -ba src/app/platform/admin-nav.ts | sed -n '1,120p'
nl -ba src/app/components/cashflow/CashflowExportPage.tsx | sed -n '100,120p'
```

Expected:
- `/cashflow`는 `admin` 또는 `finance`만 노출
- `cashflow:export` permission이 화면 내부에서도 다시 검사됨

- [ ] **Step 3: Confirm the BFF gate for cashflow export**

Run:

```bash
nl -ba server/bff/auth.mjs | sed -n '70,180p'
nl -ba server/bff/routes/cashflow-exports.mjs | sed -n '1,80p'
```

Expected:
- BFF는 Firebase ID token claim role을 신뢰
- export route는 `cashflow:export` permission을 재검사

- [ ] **Step 4: Write the diagnosis summary into the PR/issue notes**

Summary text to keep:

```md
- Frontend bootstrap admin list and production main are out of sync.
- UI access depends on frontend role fallback, but BFF export depends on Firebase token claim role.
- Therefore the fix requires both code deploy and auth data/claim alignment.
```

---

### Task 2: Align The Frontend Bootstrap Contract

**Files:**
- Modify: `src/app/data/auth-bootstrap.ts`
- Modify: `src/app/data/auth-bootstrap.test.ts`
- Modify: `src/app/platform/firestore-rules-policy.test.ts`

- [ ] **Step 1: Write/adjust failing tests for the required bootstrap admin set**

Ensure these emails are asserted:

```ts
expect(emails).toContain('ylee@mysc.co.kr');
expect(emails).toContain('jyoo@mysc.co.kr');
expect(emails).toContain('jslee@mysc.co.kr');
expect(emails).toContain('jhsong@mysc.co.kr');
expect(emails).toContain('jybaek@mysc.co.kr');
expect(emails).toContain('fin@mysc.co.kr');
expect(emails).toContain('hwkim@mysc.co.kr');
```

Run:

```bash
npm test -- --run src/app/data/auth-bootstrap.test.ts src/app/platform/firestore-rules-policy.test.ts
```

Expected: FAIL on `main`-equivalent state if the list is missing

- [ ] **Step 2: Update bootstrap admin defaults**

Keep `DEFAULT_BOOTSTRAP_ADMIN_EMAILS` aligned with the required production candidate set:

```ts
export const DEFAULT_BOOTSTRAP_ADMIN_EMAILS: readonly string[] = [
  'admin@mysc.co.kr',
  'ai@mysc.co.kr',
  'ylee@mysc.co.kr',
  'jyoo@mysc.co.kr',
  'jslee@mysc.co.kr',
  'jhsong@mysc.co.kr',
  'jybaek@mysc.co.kr',
  'fin@mysc.co.kr',
  'hwkim@mysc.co.kr',
  'mwbyun1220@mysc.co.kr',
];
```

- [ ] **Step 3: Re-run frontend bootstrap tests**

Run:

```bash
npm test -- --run src/app/data/auth-bootstrap.test.ts src/app/platform/firestore-rules-policy.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/data/auth-bootstrap.ts src/app/data/auth-bootstrap.test.ts src/app/platform/firestore-rules-policy.test.ts
git commit -m "fix(auth): align bootstrap admin emails for cashflow export"
```

---

### Task 3: Align Firebase Member Roles And Custom Claims

**Files:**
- No repo file change required by default
- Inspect/operate against Firebase Auth and Firestore member docs

- [ ] **Step 1: Inspect the target users in production auth/member data**

Run the existing inspection tooling or equivalent admin commands for:

```text
jslee@mysc.co.kr
ylee@mysc.co.kr
jyoo@mysc.co.kr
jhsong@mysc.co.kr
jybaek@mysc.co.kr
fin@mysc.co.kr
hwkim@mysc.co.kr
```

Verify for each user:
- Firebase custom claim `role`
- Firestore member doc `role`
- tenant id

Expected:
- All cashflow-export target users should be `admin` or `finance`

- [ ] **Step 2: Normalize claim/member mismatches**

Apply this rule:

```text
If user should see admin cashflow export:
- Firebase custom claim role := admin or finance
- Firestore member role := same role
```

Do not leave:
- claim = `pm`, member = `admin`
- claim = empty, member = `finance`
- claim = `viewer`, bootstrap fallback = `admin`

- [ ] **Step 3: Force re-login/token refresh after claim changes**

Required operator note:

```text
Firebase custom claims do not apply to the current browser session immediately.
The user must sign out and sign back in, or refresh token explicitly.
```

---

### Task 4: Deploy The Auth Bootstrap Fix To Production

**Files:**
- Deploy current branch or merged PR to `main`

- [ ] **Step 1: Verify the branch contains only the intended auth/bootstrap diff**

Run:

```bash
git diff -- src/app/data/auth-bootstrap.ts src/app/data/auth-bootstrap.test.ts src/app/platform/firestore-rules-policy.test.ts
```

Expected:
- Only bootstrap admin alignment changes

- [ ] **Step 2: Land the change**

Run the standard ship/merge flow:

```bash
git push
gh pr create --fill
gh pr merge --squash --delete-branch
```

Expected:
- bootstrap admin alignment is merged into `main`

- [ ] **Step 3: Verify production deployment picked up the new main build**

Run:

```bash
vercel inspect inner-platform.vercel.app
vercel alias ls
```

Expected:
- production alias points to the new deployment built from the merged commit

---

### Task 5: Verify End-To-End Access On Production

**Files:**
- Verify live application and BFF behavior

- [ ] **Step 1: Verify UI-level access with the target account**

Check on production:
- left nav shows `캐시플로 추출`
- `/cashflow` route opens

Expected:
- no redirect to `/portal`
- no missing menu

- [ ] **Step 2: Verify server-side export succeeds**

From the same session, trigger a real export.

Expected:
- no 403
- workbook download succeeds

- [ ] **Step 3: Verify a control account still stays blocked**

Use a PM-only account.

Expected:
- `/cashflow` hidden
- direct route access blocked
- export endpoint not usable

- [ ] **Step 4: Record the final truth table**

Keep this final matrix in the PR comment or deploy note:

```md
| Email | Bootstrap | Member Role | Token Claim Role | /cashflow UI | Export API |
|------|-----------|-------------|------------------|--------------|------------|
| jslee@mysc.co.kr | yes | admin/finance | admin/finance | allow | allow |
| pm user example | no | pm | pm | block | block |
```

---

## Self-Review

- Spec coverage:
  - local/main 정합성 확인 포함
  - deploy 포함
  - Firebase auth + Firestore member + BFF RBAC 정렬 포함
  - production E2E verification 포함
- Placeholder scan:
  - execution order와 commands를 모두 명시함
- Type consistency:
  - role naming은 `admin | finance | pm | viewer` 기준으로 통일함

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-13-auth-rbac-alignment-deploy.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
