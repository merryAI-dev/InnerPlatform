# Guide Simplification And Patch Note Hook Plan

## Step 1

- 관련 가이드 UI 위치를 정리한다.
- 제거 대상과 유지 대상을 화면별로 확정한다.

## Step 2

- patch-note guard 테스트를 먼저 추가한다.
- staged 변경 파일에서 required patch-note page를 계산하는 함수를 만든다.

## Step 3

- `.husky/pre-commit`에 patch-note guard를 연결한다.
- 실패 메시지에 누락된 page 문서와 `log.md`를 구체적으로 출력한다.

## Step 4

- portal/admin/auth 화면에서 가이드성 패널과 문구를 제거한다.
- 상태 요약과 실제 CTA만 남기도록 레이아웃을 정리한다.

## Step 5

- 영향받는 patch-note page와 `log.md`를 갱신한다.
- 관련 테스트와 build를 돌려서 회귀를 확인한다.
