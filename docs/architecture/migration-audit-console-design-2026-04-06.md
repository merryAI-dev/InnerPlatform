# Migration Audit Console Design

## Goal

`이관 점검`을 단순 대조 테이블이 아니라, 운영자가 `무엇을 매칭해야 하는지`, `무엇을 새로 등록해야 하는지`, `어느 CIC에 속하는지`를 빠르게 판단하고 처리하는 핵심 운영 콘솔로 승격한다.

이번 슬라이스의 핵심 결과는 두 가지다.

1. `통합대조표`를 `CIC 중심 운영 콘솔`로 재구성한다.
2. 운영자가 대조 화면 안에서 `CIC별 프로젝트를 이름만으로 빠르게 등록`하고, 그 자리에서 현재 원본 row에 즉시 매칭할 수 있게 만든다.

이 작업은 외부형 SaaS 기준으로 `긴 테이블을 해석하는 화면`에서 `해야 할 일부터 처리하는 화면`으로 바꾸는 데 목적이 있다.

## Why This Matters

현재 [ProjectMigrationAuditPage.tsx](/Users/boram/InnerPlatform/src/app/components/projects/ProjectMigrationAuditPage.tsx)는 기능은 있지만, 가장 중요한 운영 질문에 바로 답하지 못한다.

- 어떤 row가 제일 급한가
- 자동 후보가 있는가
- 이 row가 어떤 CIC에 속하는가
- 없으면 새 프로젝트를 만들어 지금 바로 연결할 수 있는가

지금 화면은 대조표와 인라인 셀 편집이 섞여 있어 `행을 읽고 -> 옵션을 찾고 -> 상태를 고르고 -> 반영`하는 인지 부담이 크다. Salesforce급 운영 화면에 가까워지려면, 표보다 먼저 `queue`, `selection detail`, `single primary action`이 보여야 한다.

## Product Decisions

### 1. CIC는 상위 사업군/조직 단위다

- 각 원본 사업 row는 가능한 경우 특정 `CIC`로 분류된다.
- `CIC`는 여러 프로젝트를 묶는 상위 단위다.
- 이 화면에서 프로젝트를 새로 만들 때도 `반드시 CIC 컨텍스트 안에서` 만든다.

이번 슬라이스에서는 기존 프로젝트 스키마를 대규모로 재설계하지 않는다. 우선 `이관 점검` 화면과 관련 helper/state에서 `CIC 필터`, `CIC 기반 quick create`, `CIC 매칭`을 다룰 수 있게 한다.

### 2. 화면의 주인공은 표가 아니라 queue다

`통합대조표`는 계속 필요하지만, primary surface는 아래 세 큐다.

- `미등록`
- `후보 있음`
- `완료`

운영자는 먼저 좌측 큐에서 처리 대상을 선택하고, 우측 detail panel에서 매칭/등록을 끝낸다. 표는 전체 현황과 dense inspection 용도로 유지하되, 액션은 detail panel 중심으로 옮긴다.

### 3. 새 프로젝트 등록은 “quick create + 즉시 매칭”으로 묶는다

운영자는 이 화면을 벗어나지 않는다.

flow:

1. row 선택
2. CIC 확인 또는 선택
3. `새 프로젝트 빠른 등록`
4. 이름 입력
5. 생성 직후 현재 row에 즉시 연결

이번 슬라이스에서는 `이름 + CIC`만으로 생성한다. 생성 직후 사용자는 이관 점검 화면을 벗어나지 않고 즉시 매칭까지 끝낼 수 있어야 한다. 세부 프로젝트 정보는 quick create의 범위에 넣지 않는다.

### 4. 미등록 row는 red, 후보 row는 amber, 완료 row는 green으로만 단순화한다

색은 행동을 위한 신호로만 쓴다.

- `미등록`: 지금 생성 또는 연결이 필요한 상태
- `후보 있음`: 사람이 최종 확인만 하면 되는 상태
- `완료`: 이미 연결됨

보조 설명은 detail panel에 두고, 표의 셀 안에 긴 설명을 집어넣지 않는다.

## UX Structure

### Page Layout

페이지는 3개 수평 레이어로 구성한다.

#### A. Control Bar

상단 고정 제어 영역.

- `CIC 선택`
- `검색`
- `상태 필터`
- `정렬`
- `새 프로젝트 빠른 등록`

그리고 KPI 4개를 함께 둔다.

- `미등록`
- `후보 있음`
- `완료`
- `완료율`

기존의 긴 주의 문구와 “기준 다시 적재” 영역은 보조 영역으로 낮춘다. 운영자는 숫자와 queue를 먼저 봐야 한다.

#### B. Queue Rail

좌측 28-32% 너비.

- `미등록`
- `후보 있음`
- `완료`

각 item은 아래 정도만 보인다.

- 상태 pill
- 원본 사업명
- CIC
- 현재 후보 프로젝트명 또는 `등록 필요`

각 row는 클릭 가능하며, 선택 시 우측 detail panel이 바뀐다.

#### C. Detail Panel

우측 68-72% 너비.

선택된 row 기준으로 아래 블록을 보여준다.

1. 원본 정보
   - 사업명
   - 담당조직
   - 고객기관
   - CIC
2. 현재 매칭 상태
   - 연결된 플랫폼 프로젝트
   - 후보들
   - 마지막 반영
3. 다음 액션
   - 기존 프로젝트에 연결
   - 새 프로젝트 빠른 등록
4. 결과 요약
   - 반영 시 어떤 필드가 바뀌는지

### Dense Table

기존 표는 유지하지만 secondary surface로 내린다.

컬럼은 다음처럼 단순화한다.

- 상태
- CIC
- 원본 사업명
- 현재 플랫폼 프로젝트
- 후보 수
- 마지막 액션

현재처럼 긴 인라인 select + 상태 select + 반영 버튼을 각 셀 안에 계속 두지 않는다. 표는 선택을 위한 surface이고, 실제 mutation은 detail panel에서 한다.

## Data and Domain Design

### Existing Source of Truth

현재 화면은 다음을 조합한다.

- Firestore `projectDashboardProjects`
- 플랫폼 `projects`
- helper:
  - `buildProjectMigrationAuditRows`
  - `buildProjectMigrationCurrentRows`

이 구조는 유지한다. 이번 슬라이스는 source of truth를 바꾸지 않는다.

### New Derived Concepts

새로 필요한 파생 개념은 아래다.

- `cic`
- `actionable status`
  - `MISSING`
  - `CANDIDATE`
  - `REGISTERED`
- `queue grouping`
- `selected audit record`
- `quick create draft`

핵심은 `row -> queue item -> detail model` 파생을 helper로 분리하는 것이다. `ProjectMigrationAuditPage.tsx` 내부에서 모든 파생 계산을 직접 하지 않는다.

### CIC Handling

이번 슬라이스에서는 다음 수준으로 처리한다.

- source row에 CIC가 있으면 그대로 사용
- current project에는 `project.cic?: string` 필드를 새로 추가해 표시한다
- 없으면 `미지정`
- quick create 시 현재 선택 row의 CIC를 기본값으로 사용

이번 슬라이스에서 명시적으로 추가할 필드는 다음과 같다.

- `Project.cic?: string`
- `ProjectMigrationCandidate.cic?: string`

기존 문서에 CIC 값이 없으면 `department`에서 추론하지 않는다. 추론은 오탐 위험이 크므로, 값이 없으면 명시적으로 `미지정`으로 취급한다.

### Quick Create

새 프로젝트 quick create는 아래 정책을 따른다.

- 필수 입력
  - `name`
  - `cic`
- 기본 상태
  - `CONTRACT_PENDING`
- 생성 직후 현재 source row에 자동 연결
- 계약명은 현재 source 사업명으로 채움

중복 생성 방지를 위해 quick create panel에는 아래를 먼저 보여준다.

- 같은 CIC의 기존 후보 프로젝트
- 이름 유사 프로젝트

사용자가 그래도 새로 만들기로 결정한 경우에만 생성한다.

## Components and File Boundaries

이번 설계는 `ProjectMigrationAuditPage.tsx`를 그대로 계속 비대하게 키우지 않는다.

예상 분리:

- `ProjectMigrationAuditPage.tsx`
  - 페이지 orchestration
- `project-migration-console.ts`
  - queue/detail 파생 helper
- `MigrationAuditControlBar.tsx`
  - CIC, 검색, 필터, quick create entry
- `MigrationAuditQueueRail.tsx`
  - actionable rows list
- `MigrationAuditDetailPanel.tsx`
  - current selection detail + primary actions
- `MigrationAuditQuickCreatePanel.tsx`
  - 이름 기반 quick create + 즉시 매칭
- `MigrationAuditDenseTable.tsx`
  - dense inspection table

## Error Handling

### Quick Create 실패

- 생성 실패 시 현재 selection은 유지
- 이름 입력값도 유지
- 에러는 detail panel 인라인으로 표시
- 이미 존재하는 후보가 있으면 그 후보 연결 CTA를 같이 제안

### Match Apply 실패

- 기존 selection 유지
- optimistic success copy를 미리 보여주지 않음
- 성공 시에만 success toast

### CIC Missing

- CIC가 비어 있으면 `미지정` 배지로 보임
- quick create를 하려 할 때 CIC 선택을 강제

## Visual System

UI/UX 기준은 `external-saas`, `admin console`, `salesforce-like task orientation`으로 둔다.

- tone: enterprise, dense, deliberate
- cards: subdued
- primary CTA: 한 패널당 하나
- typography: compact but readable
- table text: 11-12px
- detail headers: 13-14px semibold
- sticky panel actions

Anti-patterns:

- 셀 안에 너무 많은 form control
- 설명문이 액션보다 먼저 오는 구조
- 동일 중요도의 CTA 여러 개
- “표 전체를 읽어야만” 다음 액션을 알 수 있는 구조

## Testing Strategy

### Unit

- queue grouping
- CIC filtering
- selected detail model
- quick create default payload
- duplicate suggestion ordering

### Integration

- quick create 후 현재 row에 즉시 연결
- 기존 프로젝트 연결 시 source row와 current row summary가 함께 갱신
- CIC 필터가 queue, detail, dense table에 일관되게 적용

### E2E

- 이관 점검 페이지 진입
- `미등록` queue 선택
- 이름만 입력해서 새 프로젝트 quick create
- 즉시 매칭 성공
- 완료율/KPI 갱신
- dense table에도 반영됨

## Out of Scope

이번 슬라이스에서 하지 않는 것:

- 전체 프로젝트 등록 wizard 재작성
- CIC 관리 전용 설정 페이지
- bulk matching
- AI 자동 매칭
- 프로젝트 상세 스키마 전체 재정의

## Success Criteria

이 슬라이스가 끝나면 운영자는 아래를 할 수 있어야 한다.

1. 이관 점검 페이지에서 `무엇을 먼저 처리해야 하는지` 바로 볼 수 있다.
2. 원본 row를 선택하고, 같은 화면에서 새 프로젝트를 이름만으로 만들 수 있다.
3. 새 프로젝트를 만든 즉시 현재 row에 연결할 수 있다.
4. CIC별로 queue와 표를 좁혀서 볼 수 있다.
5. 기존 표를 계속 읽지 않아도 detail panel에서 핵심 판단과 action을 끝낼 수 있다.
