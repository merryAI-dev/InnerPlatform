# Bank Intake Queue Rollback

- issue: #182
- branch: `feat/rollback-bank-intake-queue`
- status: draft

## Goal

QA 반응이 좋지 않은 `신규 거래 처리 Queue` 중심 흐름을 롤백하고, 통장내역에서 `사업비 입력(주간)`으로 바로 이어지는 단순한 작업 흐름으로 복귀한다.

## Scope

- `PortalBankStatementPage`
  - queue 카드 제거
  - `분류/검토 열기`, `증빙 이어서 하기`, `주간 사업비에서 보기` 제거
  - 기본 흐름을 `사업비 입력으로 이어가기` 단일 CTA 중심으로 복귀
- `PortalWeeklyExpensePage`
  - queue strip 제거
  - queue-first wizard 유도 제거
- intake / triage 연결부
  - operator-facing 기본 흐름에서 queue-first 진입 제거
- current operator surface simplification
  - `환수행`
  - `선사용금`
  - `특이건`
  - 위 세 가지를 현재 작업면에서 제외

## Non-Goals

- intake draft data model 전면 삭제
- 장기적인 triage workflow 설계 제거
- 다른 admin/portal 화면 구조 변경

## Verification

- 통장내역에서 queue 카드가 보이지 않는다.
- 통장내역에서 바로 `사업비 입력`으로 이동할 수 있다.
- 주간 사업비 입력 화면에서 queue strip이 보이지 않는다.
- queue-first wizard 없이 기존 입력/저장 흐름이 유지된다.
- 관련 회귀 테스트가 추가/갱신된다.
