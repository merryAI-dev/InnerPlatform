---
name: verify-git-policy
description: InnerPlatform Git 정책 검증. PR 생성 전, 브랜치 정리 전, 머지 작업 전 실행.
argument-hint: "[선택사항: branch|commit|pr|cleanup 중 하나]"
disable-model-invocation: true
---

# Git 정책 검증

## 목적

InnerPlatform의 Git 운영 정책을 자동으로 점검합니다:

1. **브랜치 네이밍** — 허용된 prefix 외 브랜치 탐지
2. **커밋 컨벤션** — Conventional Commits 형식 준수 여부
3. **로컬 잔류 브랜치** — plan/* 등 원격에만 있어야 할 브랜치 로컬 잔류 탐지
4. **PR 없는 미머지 브랜치** — 원격에 올라가 있지만 PR 없는 브랜치 탐지
5. **main 직접 푸시** — 현재 브랜치가 main인 상태로 커밋 시도 탐지

## 허용 브랜치 Prefix

```
feat/   fix/   docs/   qa/   ft/   chore/   refactor/   test/
```

## 허용 커밋 타입

```
feat  fix  docs  chore  refactor  test  perf  ci  revert  WIP  wip
```

## When to Run

- PR 생성 전
- 브랜치 머지/정리 작업 전
- 분산된 브랜치를 한 번에 처리하기 전
- main 브랜치 상태가 혼재되어 있을 때

## Related Files

| File | Purpose |
|------|---------|
| `.claude/skills/merge-worktree/SKILL.md` | 브랜치 → main 스쿼시 머지 자동화 |
| `CLAUDE.md` | 프로젝트 개발 가이드 |

---

## Workflow

### Step 1: 현재 상태 수집

```bash
# 현재 브랜치
git branch --show-current

# 로컬 브랜치 전체
git branch

# 원격 브랜치 전체
git branch -r

# main 대비 미머지 로컬 브랜치
git branch --no-merged main

# 최근 커밋 20개
git log --oneline -20
```

결과를 아래 형식으로 표시:

```markdown
## Git 정책 검증 시작

**현재 브랜치:** `<branch>`
**로컬 브랜치 수:** N개
**미머지 브랜치 수:** N개
```

---

### Step 2: 브랜치 네이밍 검증

로컬 브랜치 목록에서 허용 prefix(`feat/`, `fix/`, `docs/`, `qa/`, `ft/`, `chore/`, `refactor/`, `test/`)로 시작하지 않는 브랜치를 탐지합니다. `main`, `master`, `HEAD`는 제외.

PASS 조건: 모든 브랜치가 허용 prefix로 시작
FAIL 조건: 허용 prefix 없는 브랜치 존재

```markdown
### [브랜치 네이밍]

| 상태 | 브랜치 | 비고 |
|------|--------|------|
| ✅ PASS | feat/cashflow-fix | 허용 prefix |
| ❌ FAIL | my-experiment | prefix 없음 |
```

---

### Step 3: 로컬 plan/* 브랜치 탐지

`plan/`으로 시작하는 로컬 브랜치를 탐지합니다. plan/* 브랜치는 문서 전용으로 원격에만 존재해야 합니다.

```bash
git branch | grep "plan/"
```

PASS 조건: 로컬에 plan/* 브랜치 없음 (또는 현재 브랜치가 plan/* 아님)
FAIL 조건: 로컬에 plan/* 브랜치 존재

```markdown
### [plan/* 로컬 잔류]

❌ 아래 브랜치는 원격에만 있어야 합니다:
- plan/kr1-1-etl-migration
- plan/launch-완전전환

→ `git branch -D <브랜치명>` 으로 로컬 삭제 권장
```

---

### Step 4: 커밋 컨벤션 검증

현재 브랜치의 main 대비 커밋들을 점검합니다:

```bash
git log main..HEAD --format="%s" 2>/dev/null
```

각 커밋 메시지가 `<type>(<scope>): <summary>` 또는 `<type>: <summary>` 형식인지 확인합니다.
허용 타입: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`, `revert`, `WIP`, `wip`

PASS 조건: 모든 커밋이 형식 준수
FAIL 조건: 형식 벗어난 커밋 존재

```markdown
### [커밋 컨벤션]

| 상태 | 커밋 메시지 |
|------|------------|
| ✅ PASS | `fix(cashflow): allow projection edits after close` |
| ❌ FAIL | `수정함` |
```

---

### Step 5: PR 없는 미머지 원격 브랜치 탐지

원격 브랜치 중 main에 머지되지 않은 브랜치를 조회하고, `gh` CLI로 열린 PR이 있는지 확인합니다:

```bash
# 미머지 원격 브랜치 목록
git branch -r --no-merged origin/main | grep -v "HEAD" | sed 's|origin/||'

# 열린 PR 목록
gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null
```

두 목록을 비교해 PR 없는 미머지 브랜치를 표시합니다.

```markdown
### [PR 없는 미머지 브랜치]

| 브랜치 | PR 상태 | 권장 액션 |
|--------|---------|----------|
| feat/settlement-grid-clear-actions | ❌ PR 없음 | PR 생성 또는 브랜치 삭제 |
| fix/google-sheet-preview-navigation-lock | ❌ PR 없음 | PR 생성 또는 브랜치 삭제 |
| feat/firebase-live-cutover | ✅ PR 있음 | 유지 |
```

---

### Step 6: 종합 보고서 출력

```markdown
## Git 정책 검증 결과

| 항목 | 상태 | 이슈 수 |
|------|------|---------|
| 브랜치 네이밍 | ✅ PASS / ❌ N개 이슈 | N |
| plan/* 로컬 잔류 | ✅ PASS / ❌ N개 이슈 | N |
| 커밋 컨벤션 | ✅ PASS / ❌ N개 이슈 | N |
| PR 없는 미머지 브랜치 | ✅ PASS / ❌ N개 이슈 | N |

**총 이슈: N개**
```

이슈가 있으면 각 항목별 권장 액션을 제시합니다.
이슈가 없으면:
```markdown
모든 정책을 통과했습니다. PR/머지 진행해도 안전합니다 ✅
```

---

## 예외사항

1. **`main`, `master`, `HEAD`** — 네이밍 검증 대상 제외
2. **`plan/launch-완전전환`** — worktree에서 사용 중이면 로컬 삭제 불가, 면제
3. **WIP 커밋** — `WIP(scope):` 형식은 임시 커밋으로 허용 (머지 전 squash 권장)
4. **자동 생성 머지 커밋** — `Merge pull request #N` 형식은 검사 제외
5. **feat/예산총괄** 등 한글 브랜치명 — 레거시로 허용하되 신규 생성 비권장
