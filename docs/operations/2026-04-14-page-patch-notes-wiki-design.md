# Page Patch Notes Wiki Design

## Goal

GitHub 저장소 안에 `페이지 1개 = 문서 1개` 원칙의 누적 패치노트 위키를 만든다. 이 위키는 LLM이 유지보수하는 중간 지식층으로 동작하며, 코드/PR/QA 이슈와 화면별 변화 기록을 연결해 준다.

## Why Now

- 최근 작업이 `portal`, `cashflow`, `admin/users`에 걸쳐 빠르게 누적되면서 "이 페이지에서 최근 무엇이 바뀌었는가"를 대화 없이 바로 찾기 어려워졌다.
- 기존 `README.md`, 개별 PR, `qa-feedback-memory.md`는 각각 유용하지만, 화면 관점으로 압축된 누적 변경 이력을 제공하지 않는다.
- LLM이 이후 세션에서 shallow recap이 아니라 deep adoption을 하려면, raw code와 PR 사이에 안정적인 문서 계층이 필요하다.

## Design Principles

1. 패치노트는 `도메인 요약`이 아니라 `화면 단위 운영 기록`이어야 한다.
2. raw truth는 코드/테스트/PR/커밋이고, 패치노트 위키는 사람이 읽기 쉬운 누적 요약층이다.
3. 한 변경이 여러 화면에 걸치면 각 화면 문서에는 해당 화면 영향만 짧게 남기고, 공통 서사는 `log.md`에 남긴다.
4. 문서는 LLM이 갱신하지만, GitHub에 커밋되어 사람도 diff로 검토할 수 있어야 한다.
5. 위키 구조는 검색보다 파일명과 링크만으로도 중간 규모까지 탐색 가능해야 한다.
6. 비개발자가 보기에 가장 중요한 것은 "지금 실제로 되는 기능"이므로, 각 페이지 문서는 사용자 체감 기능 체크리스트를 중심에 둔다.

## Scope

### In Scope

- `docs/wiki/patch-notes/` 트리 신설
- `index.md`, `log.md`, `AGENTS.md` 정의
- 초기 seed 페이지 문서 생성
- 최근 주요 변경을 각 seed 페이지 문서에 반영
- 이후 세션에서 LLM이 갱신할 수 있는 규칙 정의

### Out of Scope

- 앱 안에 패치노트 뷰어 UI 추가
- 문서 자동 생성 스크립트 도입
- 전체 repo의 과거 변경 이력 전수 backfill
- PR 템플릿/CI 연동 강제화

## Information Architecture

### Root Structure

```text
docs/wiki/patch-notes/
  AGENTS.md
  index.md
  log.md
  pages/
    admin-cashflow-export.md
    admin-users-auth-governance.md
    portal-bank-statement.md
    portal-submissions.md
    portal-weekly-expense.md
```

### `index.md`

역할:
- 위키의 진입점
- 페이지별 문서 링크와 1줄 설명
- 마지막 업데이트 날짜
- 현재 seed 여부와 운영 중요도

구조:
- 목적 설명
- 카테고리별 페이지 목록
- 최근 7일 변경 페이지 섹션
- 운영 우선 페이지 섹션

### `log.md`

역할:
- append-only 변경 타임라인
- LLM이 최근 작업 맥락을 빠르게 복기하는 entry point

entry 형식:

```md
## [2026-04-14] patch-note | portal-weekly-expense | 통장내역→사업비 입력 흐름 정리
- pages: [portal-weekly-expense](./pages/portal-weekly-expense.md), [portal-bank-statement](./pages/portal-bank-statement.md)
- commits: eb2dc13, c69cd6e, f7735c3
- summary: 저장 차단 경고 제거, 자동 가이드 팝업 제거, 통장내역 기준 입력 흐름을 강화했다.
```

### `pages/*.md`

파일명 규칙:
- 라우트/화면 의미가 드러나는 kebab-case
- `portal-*`, `admin-*` prefix 유지

각 페이지 문서 템플릿:

```md
# <Page Title>

- route:
- primary users:
- status:
- last updated:

## Purpose

## Current UX Summary

## Current Feature Checklist
- [x] ...
- [ ] ...

## Recent Changes
- [YYYY-MM-DD] ...

## Known Notes
- ...

## Related Files
- ...

## Related Tests
- ...

## Related QA / Ops Context
- ...

## Next Watch Points
- ...
```

### `AGENTS.md`

역할:
- LLM이 이 위키를 유지하는 규칙서
- 새 작업 후 어떤 문서를 같이 갱신해야 하는지 정의

핵심 규칙:
- 기능/버그 수정이 특정 화면 UX를 바꾸면 대응 page 문서를 반드시 갱신
- 여러 화면에 걸치면 관련 page 문서 각각 + `log.md`를 갱신
- 새 seed 페이지가 필요하면 `index.md`와 `pages/`를 동시에 갱신
- 패치노트는 마케팅 문구가 아니라 운영/변경 사실 중심으로 작성
- 커밋/PR/테스트/QA 근거를 가능한 한 같이 남김
- 체크리스트는 개발자 구현 단위가 아니라 사용자가 체감하는 기능 항목으로 작성
- 사용자가 직접 항목을 추가/삭제하며 현재 구현 상태를 유지할 수 있게 간결하게 유지

## Seed Strategy

초기 seed는 최근 운영 영향과 변경 빈도가 높은 화면부터 시작한다.

### Phase 1 Seed

- `portal-weekly-expense`
- `portal-bank-statement`
- `portal-budget`
- `portal-register-project`
- `portal-submissions`
- `admin-cashflow-export`
- `admin-cashflow-project-sheet`
- `admin-users-auth-governance`

선정 이유:
- 최근 QA/운영 피드백과 직접 연결된다.
- 최근 커밋 축이 분명하다.
- 테스트 파일과 구현 파일을 함께 연결하기 쉽다.
- 향후 "이 페이지에서 뭐가 바뀌었지?"를 가장 자주 물을 가능성이 높다.

## Update Workflow

### New Feature / Bug Fix

1. 변경 영향 화면 식별
2. 대응 page 문서 갱신
3. `log.md`에 append-only entry 추가
4. 페이지가 새로 생기거나 역할이 바뀌면 `index.md` 갱신

### QA Intake

1. QA 이슈가 특정 화면에 귀속되면 해당 page 문서의 `Related QA / Ops Context` 또는 `Next Watch Points`에 기록
2. 코드 반영 후 `Recent Changes`와 `log.md`에 함께 남긴다.

### Lint / Health Check

정기적으로 아래를 확인한다.
- 최근 수정된 화면인데 page 문서가 없는지
- `last updated`가 오래된 핵심 운영 화면이 있는지
- `Related Files`와 실제 구현 파일이 어긋났는지
- 같은 변경이 여러 문서에 중복/충돌 서술되었는지

## Non-Goals

- 패치노트를 사용 설명서로 만들지 않는다.
- 모든 커밋을 기계적으로 나열하지 않는다.
- 코드 상세 구현을 페이지 문서 안에 과도하게 복제하지 않는다.

## Success Criteria

- 운영자가 GitHub에서 특정 페이지 문서 하나만 열어도 최근 변화와 맥락을 이해할 수 있다.
- 새 세션의 LLM이 `index.md`와 관련 페이지 문서 몇 개만 읽고도 최근 변화의 맥락을 안정적으로 이어받을 수 있다.
- 최근 중요 변경 5개 내외가 seed 페이지 문서와 `log.md`에 빠짐없이 연결된다.
