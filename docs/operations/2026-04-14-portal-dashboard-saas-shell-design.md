# Portal Dashboard SaaS Shell Design

## Goal

- `/portal`의 `내사업 현황`을 좌측 포털형 툴에서 상단 중심의 전문 SaaS workspace로 재편한다.
- 상단 vacuum space를 줄이고, 현재 사업/현재 업무/빠른 작업을 첫 시야에 올린다.
- 색과 정보 구조를 Salesforce 계열의 차갑고 선명한 엔터프라이즈 톤으로 정리한다.

## Direction

- 선택안: `A안`
- 기준 레퍼런스: Salesforce Lightning의 상단 workspace + object tab + record home 정보 밀도
- 금지:
  - 초록/보라/주황을 브랜드색처럼 혼용
  - “사업비 관리 포털” 같은 툴 네이밍 과노출
  - 좌측 사이드바에 주요 정보가 숨어 있는 구조

## Information Architecture

### Global Shell

1. `workspace bar`
   - MYSC workspace identity
   - search / notifications / account utility
2. `app nav`
   - `내 사업 현황`
   - `내 제출 현황`
   - `예산`
   - `사업비 입력`
   - `캐시플로`
3. `project control rail`
   - 현재 사업 switcher
   - quick action CTA

### Page Body

1. `record header`
   - 사업명
   - 정산 기준 / 상태 / 발주기관
   - 최근 업데이트
   - primary CTA
2. `alerts rail`
   - 제출/검토/공지/지급 관련 주의사항
3. `KPI strip`
   - 총 입금
   - 총 출금
   - 잔액
   - 소진율
4. `work surfaces`
   - 현재 작업
   - 운영 카드
   - 최근 변화 / 빠른 이동

## Visual System

- primary: deep navy / enterprise blue
- surfaces: white, slate-50, slate-100
- text: slate-950 / slate-700 / slate-500
- state colors:
  - success only when status meaning is real
  - warning only for risk
  - danger only for blocking state
- iconography:
  - Lucide only
  - no emoji

## Responsive Rules

### Desktop

- full 3-tier header
- horizontal app tabs
- project switcher and quick actions visible

### Tablet

- app tabs stay horizontal
- secondary actions collapse
- KPI grid becomes 2x2

### Mobile

- workspace bar stays
- app tabs become horizontal scroll
- project switcher collapses under header
- record header becomes single column
- KPI cards become single column or 2-up depending on width

## Scope

- 포함:
  - `PortalLayout` 상단 shell 재편
  - `PortalDashboard` 본문 구조 재편
  - cold SaaS palette 정리
  - responsive behavior
- 제외:
  - 다른 포털 페이지 전체 동일 재디자인
  - 데이터 모델 변경
  - admin 화면 리브랜딩
