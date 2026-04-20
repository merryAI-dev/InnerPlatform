# Project Migration Review Console Redesign

## Goal

`프로젝트 마이그레이션 운영 콘솔`을 queue 처리 화면에서 `임원 심사 콘솔`로 바꾼다.  
운영자는 상단 검색과 CIC 필터로 대상을 좁히고, 좌측 목록에서 하나를 고른 뒤, 우측에서 PM이 포털에 입력한 프로젝트 수정 원문과 예산/인력 정보를 충분히 읽고 `승인 / 수정 요청 후 반려 / 중복·폐기`를 결정한다.

## Problem

현재 화면은 다음 문제가 있다.

- attention/queue 중심 서술이 너무 강해서 “무엇을 심사하는지”보다 “몇 건 남았는지”가 먼저 보인다.
- 상단 액션인 `빠른 등록 시작`, `기준 다시 적재`가 주요 흐름을 흐린다.
- 좌측 rail이 검색 기반이 아니라 상태 카드 묶음이라, 특정 사업을 찾는 속도가 느리다.
- 우측 패널은 연결/빠른 등록/중복 정리 카드가 섞여 있어, 임원이 실제로 봐야 할 `PM 입력 원문`이 전면에 나오지 않는다.
- PM 포털의 프로젝트 수정 내용, 예산, 등록 인력이 한 화면에서 충분히 읽히지 않는다.

## Product Decision

### 1. 심사 기준을 바꾼다

기존의 “25개 attention queue” 구조는 버린다.  
이제 핵심 질문은 다음 하나다.

> “PM이 등록한 이 프로젝트가 우리 사업이 맞는가?”

임원은 다음 3개 액션만 결정한다.

- `우리 사업으로 승인`
- `수정 요청 후 반려`
- `중복·폐기`

### 2. 상단은 탐색 전용으로 바꾼다

상단 영역은 운영 카피와 액션 버튼이 아니라 탐색 바가 된다.

- 큰 검색창: `PM이 입력한 사업명` 기준 1순위 검색
- `CIC 필터`
- `상태 필터`

상단에는 임원 액션을 두지 않는다.

### 3. 마스터-디테일 구조로 재구성한다

본문은 `좌측 검색 큐 + 우측 풀 상세 심사 패널` 구조로 고정한다.

- 좌측: 필터 결과 목록
- 우측: PM 포털 원문 기반 심사 패널

기존 dense table은 secondary surface로만 남기거나 후순위로 밀어낸다.

### 4. 우측은 요약 카드가 아니라 “심사 도서(dossier)”다

우측은 `PortalProjectEdit`를 거의 그대로 읽는 심사 뷰가 된다.  
다만 임원 판단 순서에 맞게 정보를 다시 묶는다.

우측에서 반드시 보여줄 묶음:

- 프로젝트 기본 정보
- 계약/기간/유형/통장유형/입력방식
- 예산
- 등록 인력
- 목적/참고 메모
- 임원 결정 메모
- sticky decision footer

## UX Structure

### Header / Search Bar

페이지 상단은 sticky 탐색 바 한 줄로 정리한다.

- 검색 input placeholder: `사업명으로 검색`
- CIC filter: `전체 CIC`, `CIC1`, `CIC2`, `CIC3`, `개발협력센터` 등
- 상태 filter: `전체`, `미등록`, `검토중`, `완료`, `중복/폐기`

보조 KPI는 줄일 수 있지만, 화면의 주인공은 search bar여야 한다.  
기존 `빠른 등록 시작`, `기준 다시 적재`, `운영 포커스` 영역은 제거 또는 하단 secondary action으로 낮춘다.

### Left Queue

좌측 큐는 상태별 카드 묶음이 아니라 하나의 검색 가능한 리스트로 바꾼다.

행에 보일 최소 정보:

- 사업명
- CIC
- 담당 PM
- 발주기관
- 상태 배지

행 높이는 76–96px 수준으로 유지하고, dense table 느낌이 아니라 decision list 느낌으로 만든다.

큐 특성:

- 독립 스크롤
- 선택 행 강조
- hover 시 핵심 메타만 더 진하게
- “현재 선택”이 명확해야 함

### Right Review Dossier

우측은 상세 심사 패널이며 독립 스크롤을 가진다.

섹션 순서:

1. `기본 식별`
   - 사업명
   - 정식 계약명
   - 발주기관
   - 등록 조직(CIC)
   - 담당 PM
2. `계약/운영 정보`
   - 사업 유형
   - 계약 기간
   - 정산 기준
   - 통장 유형
   - 자금 입력 방식
3. `예산`
   - 총사업비
   - 매출부가세
   - 예산 입력 여부
   - 필요 시 예산 상세 deep link
4. `등록 인력`
   - 팀명
   - 등록 인력 목록
   - 역할
   - 참여율
5. `목적/조건/메모`
   - 프로젝트 목적
   - 참여 조건
   - 비고
6. `임원 판단 메모`
   - 수정 요청 사유
   - 반려/폐기 사유

### Sticky Decision Footer

우측 패널 하단은 sticky footer로 유지한다.

버튼:

- `우리 사업으로 승인`
- `수정 요청 후 반려`
- `중복·폐기`

행동 원칙:

- 상단과 좌측에는 이 버튼을 두지 않는다.
- 버튼은 선택된 대상이 있을 때만 활성화한다.
- `수정 요청 후 반려`와 `중복·폐기`는 사유 입력이 없으면 submit할 수 없도록 한다.

## Data Mapping

### Current Sources

현 구조를 최대한 재사용한다.

- `ProjectMigrationAuditPage.tsx`
- `project-migration-audit.ts`
- `project-migration-console.ts`
- `PortalProjectEdit.tsx`
- `PortalProjectRegister.tsx`
- 예산/인력 관련 store 데이터

### New Derived Review Model

우측 패널 전용 view model을 추가한다.

예시 필드:

- `displayName`
- `officialContractName`
- `clientOrg`
- `cic`
- `pmName`
- `department`
- `projectTypeLabel`
- `contractPeriodLabel`
- `settlementTypeLabel`
- `basisLabel`
- `accountTypeLabel`
- `fundInputModeLabel`
- `contractAmount`
- `salesVatAmount`
- `teamName`
- `teamMembersDetailed`
- `projectPurpose`
- `participantCondition`
- `note`

핵심은 임원 패널이 `Project` 원문을 그대로 JSX에서 다시 조합하지 않고, `review dossier model`을 받도록 하는 것이다.

## Implementation Direction

### Keep

- Firestore source collections
- 기존 migration matching logic
- 기존 quick-create/link/trash action 자체

### Change

- `MigrationAuditControlBar`를 search-first bar로 전면 수정
- `MigrationAuditQueueRail`을 searchable list orientation으로 전면 수정
- `MigrationAuditDetailPanel`을 PM 포털 원문 기반의 dossier panel로 재작성
- 필요하면 `PortalProjectEdit`의 표시 로직 일부를 읽기 전용 컴포넌트로 추출

## Success Criteria

- 임원이 사업명 검색과 CIC 필터로 빠르게 대상을 찾을 수 있다.
- 좌측 목록에서 하나를 선택하면 우측에서 PM 포털 프로젝트 수정 정보가 충분히 보인다.
- 예산과 등록 인력이 상세 패널 안에서 누락 없이 보인다.
- 임원 액션은 우측 sticky footer에서만 일어난다.
- 기존 attention/quick-create 중심 문구가 화면의 주인공이 아니다.

## Out of Scope

- 신규 승인 워크플로 엔진 구축
- PM 포털의 프로젝트 등록 자체 리디자인
- CIC 분류 체계 재정의
- Firestore source-of-truth 변경
