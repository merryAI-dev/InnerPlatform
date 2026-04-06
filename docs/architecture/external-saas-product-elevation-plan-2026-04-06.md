# 외부형 SaaS Product Elevation Plan

날짜: 2026-04-06  
기준 척도: Salesforce의 기능 수가 아니라 `운영 통제감`, `레코드 중심성`, `신뢰 표면`  
플랜 관점: `superpowers:autoplan` + `ui-ux-pro-max` 기준을 수동 적용

## 1. 한 줄 결론

지금 제품은 내부 운영툴 단계는 넘어섰지만, 아직 외부 스타트업이 "이 제품에 우리 프로젝트 운영과 자금 흐름을 맡겨도 되겠다"라고 느낄 정도의 제품 완성도는 아닙니다.

Salesforce를 기준으로 봤을 때 부족한 건 기능 개수가 아닙니다. 부족한 건 아래 네 가지입니다.

1. 제품이 아직 `페이지 모음`처럼 느껴진다.
2. 프로젝트가 `레코드`처럼 느껴지지 않는다.
3. 위험과 대기 상태가 `큐`로 압축되어 보이지 않는다.
4. 저장, 동기화, 승인, 차단 상태에 대한 `신뢰`가 아직 제품 표면에 충분히 올라와 있지 않다.

이 플랜의 목표는 Salesforce처럼 보이게 만드는 것이 아니라, Salesforce처럼 `운영이 통제되는 제품`으로 느끼게 만드는 것입니다.

## 2. 현재 진단

### 이미 좋아진 점

- 정산 계산 경로가 local-primary로 정리되어 계산 신뢰도가 올라갔다.
- PM 포털 쪽 onboarding, empty-state, guided mission이 많이 정리됐다.
- release gate와 smoke/e2e 흐름이 예전보다 훨씬 제품 기준에 가까워졌다.
- 인건비 지급 Queue를 통해 `예외 중심 운영 UX`의 좋은 예시가 하나 생겼다.

### 아직 외부형 SaaS로 부족한 점

#### A. 홈이 여전히 운영 컨트롤 타워보다는 카드 묶음에 가깝다

첫 화면이 “지금 뭘 해야 하는가”보다 “여기 기능이 있다”를 더 많이 말하고 있습니다.

#### B. 프로젝트가 진짜 레코드처럼 느껴지지 않는다

프로젝트 상세는 있지만, 아직 한 화면에서 아래를 동시에 설명하지 못합니다.

- 현재 상태
- 위험
- 소유자
- 마지막 중요한 변경
- 다음 액션
- 연결된 운영 흐름

#### C. 위험 표면이 제품 전반에 일관되게 적용되지 않았다

인건비 지급 Queue는 맞는 방향입니다. 하지만 나머지 영역은 여전히 리스트, 페이지 이동, 수동 확인에 의존하는 부분이 많습니다.

#### D. 신뢰 표면이 아직 암묵적이다

외부 고객은 도메인을 몰라도 아래를 즉시 알아야 합니다.

- 이 값이 저장된 것인지
- 아직 동기화 전인지
- 누가 마지막으로 바꿨는지
- 왜 지금 막혀 있는지
- 다음에 무엇을 해야 하는지

#### E. 어드민 영역의 제품 톤이 PM 영역보다 약하다

PM 포털은 많이 정리됐지만, admin은 아직 내부 운영툴의 밀도와 말투가 더 강합니다.

## 3. 제품 원칙

이 플랜 전체를 관통하는 원칙은 아래입니다.

### 원칙 1. 페이지보다 운영

제품은 “어디로 가야 하나”보다 “지금 무엇을 처리해야 하나”를 먼저 답해야 합니다.

### 원칙 2. 레코드 우선

프로젝트, 제출, 인건비 런, 정산 상태는 모두 일회성 화면이 아니라 `지속되는 운영 레코드`처럼 보여야 합니다.

### 원칙 3. 예외 중심

정상 상태는 접고, 위험 상태와 사람 판단이 필요한 상태만 펼쳐야 합니다.

### 원칙 4. 신뢰는 보이게 만든다

저장, 동기화, 승인, review-required, 실패 복구는 항상 UI에 명시적으로 보여야 합니다.

### 원칙 5. 밀도는 높이되 소음은 줄인다

Salesforce 느낌은 복잡함이 아니라 `높은 정보 밀도 + 높은 통제감`입니다. 카드만 늘리는 방식은 금지합니다.

## 4. 목표 제품 모델

### 레이어 1. Operating Shell

모든 역할의 첫 화면은 아래를 가져야 합니다.

- 현재 워크스페이스
- 지금 처리할 큐
- 최근 중요한 변경
- 위험 수치
- 마지막 저장/동기화 신뢰 표면

### 레이어 2. Record Shell

중요한 객체는 모두 레코드처럼 보여야 합니다.

- 프로젝트
- 제출 상태
- 인건비 런
- 정산/동기화 상태

### 레이어 3. Operating Queues

큐는 전부 만들지 않습니다. 진짜 운영 압축을 만들어내는 큐만 만듭니다.

- 인건비 지급 Queue
- 정산 review/sync 예외 Queue
- 제출 마감/차단 Queue
- 설정 미완료 Queue

### 레이어 4. Trust & Audit Surface

모든 핵심 상태에 아래가 필요합니다.

- 상태 이름
- 상태 이유
- 마지막 변경자
- 마지막 변경 시각
- 다음 액션

### 레이어 5. Setup & Readiness

외부 고객은 onboarding보다 readiness를 원합니다.  
즉, “시작해보세요”보다 “무엇이 준비되지 않았는가”를 더 명확히 보여야 합니다.

## 5. Gantt 기능 판단

결론부터 말하면, `넣을 가치가 있습니다.` 다만 아래 조건이 붙습니다.

### 넣어야 하는 이유

이 제품은 CRM이 아니라 프로젝트 운영 제품입니다.  
외부 스타트업 입장에서는 숫자만 보는 것보다 `시간축` 위에서 아래를 함께 보는 경험이 중요합니다.

- 계약 시작/종료
- 제출 마감
- 주차별 사업비 입력 구간
- 인건비 지급일
- 리스크 발생 구간

즉 Gantt는 “예쁜 PM 차트”가 아니라 `운영 시간축 컨트롤 표면`으로 가치가 있습니다.

### 지금 당장 어디에 두는 게 맞는가

홈 대시보드에는 두지 않습니다. 홈은 큐와 경고 중심이 맞습니다.

가장 맞는 위치는 아래입니다.

1. `프로젝트 레코드 쉘` 안의 Timeline / Gantt 탭
2. 어드민용 포트폴리오 화면의 압축된 multi-project timeline view

### 어떤 Gantt가 맞는가

전통적인 PM용 세부 일정 편집형 Gantt는 지금 단계에서 과합니다.

이번 제품에 맞는 형태는:

- 읽기 중심
- 주요 날짜/구간 표시 중심
- 리스크 overlay 가능
- 큐 row와 상호 이동 가능

즉 `operational Gantt`가 맞습니다.

### 현재 로컬에 이미 있는 데이터 축

새로운 대규모 스키마 없이도 첫 버전 Gantt를 만들 수 있는 이유는, 날짜 축 데이터가 이미 있습니다.

- 프로젝트 계약 기간
  - [ProjectDetailPage.tsx](/Users/boram/InnerPlatform/src/app/components/projects/ProjectDetailPage.tsx)
  - [types.ts](/Users/boram/InnerPlatform/src/app/data/types.ts)
  - 필드: `contractStart`, `contractEnd`
- 인건비 지급 일정
  - [payroll-store.tsx](/Users/boram/InnerPlatform/src/app/data/payroll-store.tsx)
  - [PortalPayrollPage.tsx](/Users/boram/InnerPlatform/src/app/components/portal/PortalPayrollPage.tsx)
  - 필드: `plannedPayDate`, `noticeDate`, `dayOfMonth`
- 주간 정산/캐시플로 주차
  - [cashflow-weeks.ts](/Users/boram/InnerPlatform/src/app/platform/cashflow-weeks.ts)
  - 필드: `weekStart`, `weekEnd`
- 제출 마감 흐름
  - [PortalSubmissionsPage.tsx](/Users/boram/InnerPlatform/src/app/components/portal/PortalSubmissionsPage.tsx)
- 활동 이력/타임라인의 선행 패턴
  - [AuditLogPage.tsx](/Users/boram/InnerPlatform/src/app/components/audit/AuditLogPage.tsx)
  - [BudgetSummaryPage.tsx](/Users/boram/InnerPlatform/src/app/components/budget/BudgetSummaryPage.tsx)
  - [PersonnelChangePage.tsx](/Users/boram/InnerPlatform/src/app/components/koica/PersonnelChangePage.tsx)

즉, “Gantt를 위해 모든 걸 새로 만들어야 하는 상태”는 아닙니다.

### Gantt를 지금 넣을 때 주의할 점

- 입력 가능한 full PM tool로 만들지 않는다
- 마일스톤가 너무 많아져서 가독성을 깨지 않는다
- 큐를 대체하지 않는다
- 읽기/판단/이동을 돕는 보조 표면으로 시작한다

## 6. 권장 Tranche

### Tranche 1. Control Tower Shell

목표: 제품을 첫 화면부터 운영 제품처럼 보이게 만든다.

#### 할 일

- Admin 홈을 운영 컨트롤 타워로 재구성
- PM 홈을 작업 중심 홈으로 재구성
- 상단 trust surface 추가
  - 워크스페이스
  - 마지막 저장/동기화
  - unresolved count
  - 빠른 검색 또는 최근 레코드 진입
- normal state는 축약, risk state는 확대

#### 성공 기준

- 어드민이 30초 안에 상위 위험 3개를 말할 수 있다
- PM이 20초 안에 다음 해야 할 일을 찾을 수 있다

### Tranche 2. Record-Centric Project Shell

목표: 프로젝트를 이 제품의 중심 레코드로 승격한다.

#### 할 일

- [ProjectDetailPage.tsx](/Users/boram/InnerPlatform/src/app/components/projects/ProjectDetailPage.tsx)를 record shell로 재설계
- 상단 summary bar 추가
  - 상태
  - owner
  - settlement/account type
  - readiness
  - 주요 위험
- 우측 operational rail 추가
  - 다음 액션
  - 활성 이슈
  - 최근 변경
  - 관련 큐 링크
- 하위 흐름을 탭 또는 섹션 구조로 재편

#### 성공 기준

- 프로젝트 한 화면에서 “이 사업이 안전한가?”를 판단할 수 있다

### Tranche 3. Operational Gantt

목표: 시간축 위에서 운영 상태를 읽을 수 있게 만든다.

#### 할 일

- 프로젝트 레코드 안에 `운영 타임라인/Gantt` 탭 추가
- 첫 버전에서 보여줄 축:
  - 계약 기간
  - 주차 구간
  - 제출 마감
  - 인건비 지급일/공지일
  - 리스크 window overlay
- 큐 row에서 해당 Gantt 구간으로 이동 가능하게 연결

#### 성공 기준

- 사용자가 “언제 무엇이 몰리는가”를 한 화면에서 볼 수 있다
- 지급/제출/정산 리스크가 날짜 축에서 겹쳐 보인다

### Tranche 4. Operating Queues

목표: 페이지 이동형 제품을 예외 처리형 제품으로 바꾼다.

#### 우선 큐

- 인건비 지급 Queue
- 정산 sync/review Queue
- 제출 차단/마감 Queue
- 설정 미완료 Queue

#### 규칙

- 큐는 반드시 `무엇이 문제인지 + 왜 중요한지 + 지금 뭘 해야 하는지`를 한 row에 담아야 한다
- setup gap과 live risk는 같은 큐에 섞지 않는다

### Tranche 5. Trust / Audit / Explainability

목표: 외부 고객이 시스템을 믿을 수 있게 만든다.

#### 할 일

- 프로젝트 및 주요 흐름에 activity timeline 추가
- blocked / review-required / failed 상태에 이유 문구 추가
- last actor / last meaningful change 노출
- 실패 시 recovery CTA 명시

### Tranche 6. Setup Center / Readiness

목표: onboarding을 “튜토리얼”이 아니라 “운영 준비도 진단”으로 바꾼다.

#### 할 일

- 조직 readiness center 추가
- 프로젝트 readiness diagnostics 추가
  - 계좌
  - 인건비 지급일
  - settlement policy
  - budget 구조
  - 주간 입력 readiness
  - 제출 readiness

### Tranche 7. Dense Data / Power UX / Reliability

목표: serious B2B 소프트웨어처럼 느껴지게 만든다.

#### 할 일

- saved views
- split view
- side panel detail
- sticky table / row action 고도화
- heavy chunk UX 추가 개선
- product release gate 확대

## 7. 추천 실행 순서

권장 순서는 아래입니다.

1. Tranche 1: Control Tower Shell
2. Tranche 2: Record-Centric Project Shell
3. Tranche 3: Operational Gantt
4. Tranche 4: Operating Queues
5. Tranche 5: Trust / Audit / Explainability
6. Tranche 6: Setup Center / Readiness
7. Tranche 7: Dense Data / Reliability

이 순서가 맞는 이유:

- Shell이 먼저 안 잡히면 나머지는 예쁜 조각에 그친다
- Project record가 먼저 안 잡히면 Gantt도 queue도 맥락 없이 뜬다
- Gantt는 early value가 크지만 shell/record 위에 얹혀야 힘이 난다
- Trust/Audit는 외부 고객 도입 직전에 반드시 닫혀야 한다

## 8. 이번 플랜에서 의도적으로 자른 것

- 범용 업무 자동화 빌더
- CRM 스타일 breadth expansion
- 과도한 generic queue system
- PM full scheduling tool
- 브랜딩만 바꾸는 cosmetic re-skin

## 9. 제품 점수 관점

이 플랜이 제대로 실행되면 목표 점수는 아래입니다.

- 기능 완성도: 9점대 후반
- 제품 경험 완성도: 9.7 이상
- 외부형 SaaS 신뢰도: 9.5 이상
- 운영/검증 성숙도: 8점대 중후반

## 10. 바로 다음 한 슬라이스

가장 ROI가 큰 다음 슬라이스는 이것입니다.

### `Tranche 1A: Admin + PM Control Tower refresh`

포함 범위:

- 홈 상단 trust surface
- primary queue module
- normal state collapse
- shared vocabulary 정리
- 다음 액션 중심 hierarchy

그 다음 바로 이어서:

### `Tranche 2A: Project record shell foundation`

그리고 그 위에:

### `Tranche 3A: Read-only operational Gantt`

즉, Gantt는 넣되 지금 기준으로는 `세 번째 슬라이스`가 가장 맞습니다.
