# [KR1.2] Tri-modal → BFF 단일 경로 전환

## 결론

이번 주 KR1 첫 실행 항목은 `KR1.2`입니다. 목표는 프론트엔드의 핵심 쓰기 흐름을 BFF 단일 경로로 고정하고, ETL 실제 이관과 coverage 확장을 그 위에서 진행할 수 있게 기준선을 만드는 것입니다.

## 현재 상태

- BFF 서버와 runbook은 이미 존재합니다: `server/bff/`, `guidelines/ETL-BFF-Cutover-Runbook.md`
- feature flag는 아직 `VITE_PLATFORM_API_ENABLED=false` 기준입니다.
- `src/app/data/store.tsx`에는 BFF 실패 시 Firestore로 우회하는 쓰기 로직이 남아 있습니다.
- 2026-03-23 기준 baseline은 green입니다.
  - `npm run bff:test:integration`
  - `npm run test:e2e -- tests/e2e/migration-wizard.harness.spec.js`
  - `npm run test:e2e -- tests/e2e/platform-smoke.spec.ts`

## 이번 주 범위

### 1. 쓰기 경로 단일화

- `src/app/data/store.tsx`의 핵심 mutation 경로를 정리합니다.
- 대상 범위는 `project`, `ledger`, `transaction`, `comment`, `evidence` 쓰기입니다.
- 목표 상태는 "flag on 상태에서 쓰기 요청이 BFF만 사용하고, 실패 시 Firestore로 silent fallback 하지 않는 것"입니다.

### 2. Google Sheet migration 경로 고정

- migration wizard 관련 BFF 경로를 이번 cutover acceptance에 포함합니다.
- 최소 검증 범위는 `preview`, `analyze`, `source upload`입니다.
- 최근 수정된 `preview_only` 분기와 navigation lock 동작은 회귀 없이 유지해야 합니다.

### 3. 단계적 전환

- Local: `VITE_PLATFORM_API_ENABLED=true` + `npm run bff:dev` + `npm run dev`
- Non-prod: feature flag on 후 smoke 재검증
- Production: non-prod green 이후에만 env 전환 및 배포

## 이번 주 제외 범위

- ETL 실제 commit sync 실행
- 단위 테스트 80% 달성을 위한 광범위한 신규 테스트 작성
- 온보딩 문서 전면 개편

## Acceptance

### 필수 테스트

- `npm run bff:test:integration` green
- `npm run test:e2e -- tests/e2e/migration-wizard.harness.spec.js` green
- `npm run test:e2e -- tests/e2e/platform-smoke.spec.ts` green

### 수동 검증

- flag on 상태에서 PM/Admin 핵심 쓰기 시나리오 수동 확인
- migration wizard 샘플 시트 preview/analyze/upload 재검증
- 배포 전 rollback 절차 점검

### 완료 정의

- 프론트엔드 핵심 쓰기 경로가 BFF 단일 경로로 동작합니다.
- env 전환과 rollback 절차가 문서와 실제 동작 기준으로 일치합니다.
- `KR1.1`의 Firestore commit sync를 시작해도 되는 상태라는 운영 판단이 가능합니다.

## 롤백

- prod에서 문제가 발생하면 `VITE_PLATFORM_API_ENABLED=false`로 즉시 복귀합니다.
- cutover PR에는 env 전환 순서, 확인 책임자, 복귀 조건을 반드시 포함합니다.

## 후속 순서

1. `KR1.1` ETL: staging bundle 생성, dry-run 검증, 이후 commit sync
2. `KR1.3` coverage: cutover 경로 보호 테스트 확장
3. `KR1.4` onboarding: 변경점 delta 문서 반영
