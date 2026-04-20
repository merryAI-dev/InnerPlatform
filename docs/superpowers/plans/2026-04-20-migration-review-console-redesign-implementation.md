# Migration Review Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 마이그레이션 운영 콘솔을 search-first master-detail 심사 화면으로 바꾸고, PM 포털 원문/예산/등록 인력을 우측 심사 패널에서 충분히 읽은 뒤 임원이 승인·반려·폐기를 결정할 수 있게 만든다.

**Architecture:** 기존 migration matching/data source는 유지하고, `ProjectMigrationAuditPage`의 UI surface만 재구성한다. 상단은 검색/필터 bar, 좌측은 searchable queue, 우측은 PM 프로젝트 수정 원문 기반 review dossier, 하단은 sticky decision footer로 분리한다.

**Tech Stack:** React 18, TypeScript, existing shadcn/ui primitives, current migration console helpers, portal project display helpers

---

### Task 1: Review Dossier View Model 정의

**Files:**
- Create: `src/app/platform/project-migration-review-dossier.ts`
- Test: `src/app/platform/project-migration-review-dossier.test.ts`
- Modify: `src/app/components/projects/migration-audit/MigrationAuditDetailPanel.tsx`

- [ ] `Project`, `MigrationAuditConsoleRecord`를 입력으로 받아 임원용 dossier model을 반환하는 helper를 정의한다.
- [ ] dossier model에는 기본 정보, 계약/운영 정보, 예산, 인력, 메모 섹션에 필요한 라벨/값을 모두 포함한다.
- [ ] `teamMembersDetailed`, `teamName`, `contractAmount`, `salesVatAmount`, `fundInputMode`, `accountType`, `basis`, `settlementType` 라벨을 일관되게 포맷한다.
- [ ] `src/app/platform/project-migration-review-dossier.test.ts`에서
  - 포털 등록 제안 프로젝트를 dossier model로 변환하는 케이스
  - 예산/인력 값이 비어 있을 때 fallback 라벨을 만드는 케이스
  - CIC/PM/발주기관/정산 정보가 모두 포함되는 케이스
  를 고정한다.

### Task 2: Search-First Control Bar 재작성

**Files:**
- Modify: `src/app/components/projects/migration-audit/MigrationAuditControlBar.tsx`
- Modify: `src/app/components/projects/ProjectMigrationAuditPage.tsx`
- Test: `src/app/components/projects/migration-audit/MigrationAuditControlBar.test.tsx`

- [ ] 기존 `운영 포커스`, `빠른 등록 시작`, `기준 다시 적재` 중심 구성을 제거한다.
- [ ] 상단을 `사업명 검색 + CIC 필터 + 상태 필터` 중심의 한 줄 sticky bar로 재구성한다.
- [ ] 검색 placeholder는 `사업명으로 검색`으로 바꾸고, PM 입력 사업명 기준 검색이 먼저 읽히게 한다.
- [ ] `ProjectMigrationAuditPage.tsx`에서 control bar props를 정리하고, summary 카피도 queue/attention 문구 대신 심사 문맥으로 바꾼다.
- [ ] 테스트에서는 control bar에서 legacy action copy가 사라졌는지와 검색/필터 컨트롤이 남는지를 고정한다.

### Task 3: Queue Rail을 검색형 리스트로 재구성

**Files:**
- Modify: `src/app/components/projects/migration-audit/MigrationAuditQueueRail.tsx`
- Modify: `src/app/platform/project-migration-console.ts`
- Test: `src/app/components/projects/migration-audit/MigrationAuditQueueRail.test.tsx`

- [ ] 상태별 카드 묶음 표현을 약화하고, 하나의 searchable list 느낌으로 재구성한다.
- [ ] 각 행에 `사업명`, `CIC`, `담당 PM`, `발주기관`, `상태 배지`가 보이게 한다.
- [ ] 선택 행 시각 강조를 강화하고, 좌측 rail 전체를 독립 스크롤로 유지한다.
- [ ] `project-migration-console.ts`에서 queue item 표시용 PM/발주기관 메타를 내려주는 helper를 추가한다.
- [ ] 테스트에서는 legacy section headline 비중이 줄고, 각 item에 사업명/CIC/PM/상태가 노출되는지 고정한다.

### Task 4: Detail Panel을 PM 원문 기반 심사 패널로 전면 교체

**Files:**
- Modify: `src/app/components/projects/migration-audit/MigrationAuditDetailPanel.tsx`
- Modify: `src/app/components/projects/ProjectMigrationAuditPage.tsx`
- Test: `src/app/components/projects/migration-audit/MigrationAuditDetailPanel.test.tsx`

- [ ] 기존 `등록 제안 프로젝트 검토`, `빠른 등록`, `중복 정리` 카드 중심 레이아웃을 해체한다.
- [ ] 우측 패널을 아래 섹션 순서로 재작성한다.
  - 기본 식별
  - 계약/운영 정보
  - 예산
  - 등록 인력
  - 목적/조건/메모
  - 임원 판단 메모
- [ ] `PortalProjectEdit`와 `PortalProjectRegister`의 라벨/구조를 최대한 재사용해 PM 원문과 시각적 차이가 크지 않게 만든다.
- [ ] 우측 패널은 독립 스크롤을 가지게 하고, 상단보다 본문 읽기 면적이 우세하게 한다.
- [ ] 테스트에서는 예산/인력/목적/정산/통장 유형이 모두 우측 패널에 노출되는지를 고정한다.

### Task 5: Sticky Decision Footer와 판단 입력 정리

**Files:**
- Modify: `src/app/components/projects/migration-audit/MigrationAuditDetailPanel.tsx`
- Modify: `src/app/components/projects/ProjectMigrationAuditPage.tsx`
- Test: `src/app/components/projects/migration-audit/MigrationAuditDecisionFooter.test.tsx`

- [ ] `우리 사업으로 승인`, `수정 요청 후 반려`, `중복·폐기`를 우측 하단 sticky footer에만 둔다.
- [ ] `수정 요청 후 반려`와 `중복·폐기`는 사유 입력이 비어 있으면 제출 불가 상태로 둔다.
- [ ] 좌측 rail과 상단 control bar에는 임원 결정 액션이 나타나지 않게 한다.
- [ ] 현재의 link/quick create/trash handler는 유지하되, 액션 배치만 footer 중심으로 옮긴다.
- [ ] 테스트에서는 상단에 결정 버튼이 없고, 우측 footer에만 존재하는지를 고정한다.

### Task 6: 레이아웃/스크롤 안정화

**Files:**
- Modify: `src/app/components/projects/ProjectMigrationAuditPage.tsx`
- Modify: `src/app/components/projects/migration-audit/MigrationAuditQueueRail.tsx`
- Modify: `src/app/components/projects/migration-audit/MigrationAuditDetailPanel.tsx`
- Test: `src/app/components/projects/ProjectMigrationAuditPage.layout.test.tsx`

- [ ] 상단 bar sticky, 좌측 rail 독립 스크롤, 우측 detail 독립 스크롤, footer sticky를 레이아웃 수준에서 고정한다.
- [ ] `xl:grid-cols-[...]` 계열 width를 재조정해 우측 detail이 넓은 master-detail 구도가 되게 한다.
- [ ] dense table은 fold 아래 secondary surface로 내리거나 시각 비중을 낮춘다.
- [ ] layout test에서 sticky/search-first/master-detail 구조를 문자열/DOM 기준으로 고정한다.

### Task 7: 문서/회귀 정리

**Files:**
- Modify: `docs/wiki/patch-notes/pages/admin-dashboard.md` or migration-related page if present
- Modify: `docs/wiki/patch-notes/log.md`
- Test: targeted vitest commands for changed files

- [ ] 이번 심사 콘솔 redesign의 사용자 관점 설명을 patch note에 추가한다.
- [ ] 타깃 테스트를 실행한다.
  - migration audit component tests
  - dossier helper tests
  - layout tests
- [ ] 기능 수동 확인 체크리스트를 남긴다.
  - 검색창 동작
  - CIC 필터
  - 좌측 선택 ↔ 우측 원문 변경
  - sticky decision footer
  - 반려/폐기 사유 validation
