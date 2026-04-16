# 2026-04-16 Portal Network Gate Foundation Slice Briefs

브랜치:

- `feat/portal-network-gate-foundation`

목표:

- stable portal routes의 network/runtime correctness를 코드와 CI에 gate로 고정한다.

공통 규칙:

- implementer는 자기 slice 범위 밖 파일을 건드리지 않는다.
- 각 slice 종료 전 자기 테스트를 실행한다.
- main agent가 spec review, quality review, integration, final gate를 맡는다.

## Slice A: Route Budget Contract

책임:

- stable portal route별 connection budget 정의
- budget evaluation helper와 unit test 추가

소유 파일:

- `src/app/platform/portal-network-budgets.ts`
- `src/app/platform/portal-network-budgets.test.ts`

허용 수정:

- `docs/operations/2026-04-16-finance-grade-portal-stabilization-master-plan.md`

금지:

- Playwright spec 수정
- CI workflow 수정

종료 조건:

- route budget unit test green
- stable routes 예산이 명시적으로 코드화됨

검증:

- `npm test -- src/app/platform/portal-network-budgets.test.ts`

## Slice B: Playwright Artifact Capture

책임:

- smoke specs가 route별 network/runtime artifact를 남기도록 변경

소유 파일:

- `tests/e2e/support/portal-network-artifact.ts`
- `tests/e2e/support/portal-network-artifact.test.ts`
- `tests/e2e/platform-smoke.spec.ts`
- `tests/e2e/product-release-gates.spec.ts`
- `playwright.harness.config.mjs`

금지:

- CI workflow 수정
- package.json 수정

종료 조건:

- smoke suite 통과
- route artifact 파일이 실제로 생성됨

검증:

- `npm test -- tests/e2e/support/portal-network-artifact.test.ts`
- `CI=1 npx playwright test tests/e2e/platform-smoke.spec.ts tests/e2e/product-release-gates.spec.ts --config playwright.harness.config.mjs`

## Slice C: Canonical Network Gate Script

책임:

- route budgets + artifacts를 읽어 gate를 실행하는 canonical script 추가

소유 파일:

- `scripts/portal_network_gate.ts`
- `src/app/platform/portal-network-gate.test.ts`
- `package.json`

허용 수정:

- `scripts/phase1_portal_validation_gate.ts`

금지:

- workflow 수정
- Playwright smoke spec 수정

종료 조건:

- gate unit test green
- real gate command local pass
- JSON summary output 생성

검증:

- `npm test -- src/app/platform/portal-network-gate.test.ts`
- `npm run phase0:portal:network-gate -- --json-out /tmp/portal-network-gate.json`

## Slice D: CI Wiring and Artifact Publishing

책임:

- GitHub Actions가 canonical gate만 호출하도록 정리
- artifact 업로드 연결
- docs/wiki 동기화

소유 파일:

- `.github/workflows/ci.yml`
- `docs/operations/2026-04-16-portal-hardening-orchestration-model.md`
- `docs/operations/2026-04-16-finance-grade-portal-stabilization-master-plan.md`
- `docs/wiki/patch-notes/pages/shared-portal-architecture.md`
- `docs/wiki/patch-notes/log.md`
- `docs/wiki/patch-notes/index.md`

허용 수정:

- `src/app/platform/ci-workflow.contract.test.ts`

금지:

- runtime source 수정
- Playwright smoke spec 수정

종료 조건:

- CI workflow가 duplicated smoke/build invocation 대신 canonical gate 사용
- artifact upload step 존재
- docs와 wiki가 phase 0 gate foundation 기준으로 갱신

검증:

- `npm test -- src/app/platform/ci-workflow.contract.test.ts`
- `npm run phase0:portal:network-gate -- --json-out /tmp/portal-network-gate.json`

## Integration Gate

main agent only:

1. slice A-D 병합 상태 확인
2. conflict / duplicate logic 정리
3. `npm run phase0:portal:network-gate -- --json-out artifacts/portal-network-gate.local.json`
4. route artifact summary 확인
5. PR 생성 전 spec review / quality review 기록 정리
