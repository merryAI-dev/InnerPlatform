# Shared Portal Architecture

- route: `shared / architecture`
- primary users: 운영자, 개발자, QA, 의사결정자
- status: draft-active
- last updated: 2026-04-16

## Purpose

포털 안정화의 장기 방향을 `Firestore 유지 + BFF/API-first hybrid` 기준으로 정리해, 왜 이 방향을 택했는지와 6~8주 실행 순서를 한 곳에서 공유하기 위한 문서다.

## Current UX Summary

- 포털은 현재 Firestore direct read와 일부 realtime 구독의 영향을 받고 있어, route/provider/query coupling이 반복 이슈를 만든다.
- 장기 방향은 포털과 운영 summary surface를 BFF read model 중심으로 옮기고, realtime은 allowlist surface만 남기는 것이다.
- Firestore는 당분간 source of truth로 유지하되, 화면은 raw collection을 직접 해석하지 않는다.

## Current Feature Checklist

- [x] 장기 기본안이 `Firestore 유지 + BFF/API-first hybrid`로 고정됨
- [x] `Firestore direct 유지`와 `전면 재플랫폼`은 비교안으로만 정리됨
- [x] `AWS core backend`와 `AWS + Cloudflare hybrid`를 중기/장기 비교안으로 별도 문서화함
- [x] `client-direct architecture` 종료를 위한 의사결정 포인트 문서를 추가함
- [x] 사람이 결정할 6개 ballot과 그 기본 선택을 전제로 한 실행 플랜을 문서화함
- [x] `1000명 규모 내부 production SaaS` 기준으로 stable lane 기본 정책과 예외 경로 규칙을 문서화함
- [x] Firestore + GCS backup/restore plan을 문서화함
- [x] 장애 시 emergency ledger sheet CRUD와 reviewed reconciliation import 계획을 문서화함
- [x] 포털은 fetch-first, realtime allowlist-only 원칙을 채택함
- [x] route-scoped provider split이 1차 이행 과제로 정의됨
- [x] `/portal/project-select` entry surface가 portal workspace shell 밖의 lightweight entry shell로 분리됨
- [x] `/portal/onboarding`도 같은 lightweight entry shell과 BFF contract로 이동함
- [x] entry surface는 `entry-context` read model + `session-project` command API를 사용함
- [x] onboarding surface는 `onboarding-context` read model + `portal/registration` command API를 사용함
- [x] portal dashboard / submissions / weekly expense / bank statement / payroll summary read model 이행 계획이 정의됨
- [x] phase 1a로 portal dashboard / payroll / weekly-expenses / bank-statements summary endpoint와 클라이언트 contract가 추가됨
- [x] finance-grade master plan이 이전 `next plan`을 supersede하고, phase 0 gate foundation을 먼저 land하는 순서로 재정렬됨
- [x] phase 0 network gate foundation의 CI/doc cutover가 완료되어, canonical gate command와 JSON artifact path가 release evidence 기준으로 고정됨
- [x] phase 2 첫 command-authority slice로 weekly expense save path가 `portal/weekly-expenses/save` server-owned write boundary를 사용함
- [x] phase 2 둘째 command-authority slice로 PM weekly submit path가 `portal/weekly-submissions/submit` server-owned write boundary를 사용함
- [x] phase 2 셋째 command-authority slice로 admin cashflow week close path가 `/api/v1/cashflow/weeks/close` server-owned write boundary를 사용함
- [x] critical write path를 command API로 이동하는 단계가 플랜에 포함됨
- [x] App 루트 broad provider tree가 admin/portal route shell로 분리됨
- [x] route shell이 explicit Firestore access mode를 주입하고 store는 pathname self-inference를 하지 않음
- [x] CI가 `phase0:portal:network-gate` command를 직접 호출하고 artifact를 발행하는 최종 cutover가 닫힘
- [ ] admin summary surface cutover까지 완료됨
- [ ] 포털의 broad Firestore direct read가 완전히 제거됨

## Recent Changes

- [2026-04-16] portal hardening work now uses a main-agent orchestration model with subagents handling isolated implementation slices, and the required review loop / metrics / branch discipline is captured in a dedicated operations doc.
- [2026-04-16] phase 0 network gate foundation 기준으로 CI workflow가 canonical `phase0:portal:network-gate` command와 `artifacts/portal-network-gate.json` artifact path를 직접 source of truth로 사용하도록 닫았다. 기존 conditional fallback과 duplicated release-gate steps는 workflow에서 제거됐다.
- [2026-04-16] 기존 `portal production hardening next plan`은 finance-grade 기준으로는 약하다고 판단해 supersede했다. 새 master plan은 `phase 0 gate foundation -> read boundary completion -> command authority -> backup automation -> reviewed reconciliation -> production enforcement` 순서를 강제하고, `network/runtime/recovery evidence` 없이는 어떤 phase도 완료라고 부르지 않도록 못 박았다.
- [2026-04-15] 포털 안정화 장기안으로 `Firestore 유지 + BFF/API-first hybrid`를 채택했다.
- [2026-04-15] `Firestore direct 유지`, `AWS full replatform`, `AWS + Cloudflare hybrid`를 같은 기준으로 비교하고, 현재 권고 순서를 `하이브리드 안정화 -> AWS core backend -> 필요 시 Cloudflare edge layer`로 정리했다.
- [2026-04-15] `client-direct architecture`를 끝내기 위해 지금 닫아야 할 결정과, 구현 단계에서 닫을 결정, 후속 인프라 결정으로 미룰 항목을 별도 decision-point 문서로 정리했다.
- [2026-04-15] `client-direct architecture` 종료를 위한 사람 결정 항목을 6개 ballot로 압축하고, 현재 권장 선택을 전제로 한 8주 실행 플랜을 별도 operations 문서로 추가했다.
- [2026-04-16] `1000명 규모 내부 production SaaS` 기준으로 문서 전제를 바로잡고, stable lane을 기본으로 두되 low-risk 예외 경로만 time-boxed로 허용하도록 보정했다.
- [2026-04-16] Firestore source of truth를 유지하면서 GCS를 운영 백업 기준 저장소로 쓰는 backup/restore plan을 추가했다.
- [2026-04-16] ledger 업무 continuity를 위해 emergency sheet에서 CRUD를 허용하되, 플랫폼 복귀는 reviewed reconciliation import로만 반영하는 plan을 추가했다.
- [2026-04-15] 6~8주 RFC에서 route-scoped provider split, read model API, critical write command, admin summary cutover 순서를 고정했다.
- [2026-04-15] 포털 문제의 본질을 Firestore 자체가 아니라 클라이언트의 분산된 data access policy로 명시했다.
- [2026-04-15] Phase 1 구현으로 App 루트 broad provider를 admin/portal route shell로 분리하고, `portal-safe`/`admin-live` access mode를 route provider에서 주입하도록 바꿨다.
- [2026-04-15] Phase 1a 구현으로 `/portal/project-select`를 lightweight entry shell로 분리하고, portal store bootstrap 대신 BFF `entry-context`/`session-project` 계약을 쓰도록 옮겼다.
- [2026-04-15] follow-up으로 `/portal/onboarding`도 같은 entry shell과 BFF `onboarding-context`/`portal/registration` 계약으로 옮겨, 포털 entry surface의 핵심 경계를 일치시켰다.
- [2026-04-15] entry hardening과 함께 self-hosted Pretendard + immutable asset cache 정책을 추가해, HAR에서 보인 entry surface 네트워크 낭비를 줄이는 방향으로 첫 조치를 넣었다.
- [2026-04-16] phase 1 read-model slice로 `/api/v1/portal/dashboard-summary`, `/api/v1/portal/payroll-summary`, `/api/v1/portal/weekly-expenses-summary`, `/api/v1/portal/bank-statements-summary` endpoint와 대응 client contract를 추가했다.
- [2026-04-16] portal dashboard / payroll / weekly-expenses / bank-statements는 위 summary endpoint를 우선 읽고, store state는 fallback 또는 write path 쪽으로만 남기는 방향으로 cutover를 시작했다.
- [2026-04-16] phase 2 첫 write slice로 `/api/v1/portal/weekly-expenses/save` command route를 추가하고, `PortalWeeklyExpensePage` / `SettlementLedgerPage`가 expense sheet 저장, weekly submission 상태 반영, cashflow week actual 갱신을 하나의 command boundary로 위임하도록 옮겼다.
- [2026-04-16] 위 slice는 targeted tests, production build, canonical `phase0:portal:network-gate`를 모두 통과했고 `/portal/weekly-expenses`를 포함한 required portal routes에서 `listen=0 write=0 listen400=0 consoleErrors=0` budget을 유지했다.
- [2026-04-16] phase 2 둘째 write slice로 `/api/v1/portal/weekly-submissions/submit` command route를 추가하고, `PortalWeeklyExpensePage`의 PM 제출 흐름이 더 이상 `submitWeekAsPm` + per-transaction state patch를 분리 호출하지 않도록 잘랐다.
- [2026-04-16] 위 제출 slice도 targeted tests, production build, canonical `phase0:portal:network-gate`를 다시 통과했고 required portal routes budget을 유지했다.
- [2026-04-16] phase 2 셋째 write slice로 `/api/v1/cashflow/weeks/close` command route를 추가하고, `CashflowProjectSheet`의 admin 마감 흐름이 더 이상 `closeWeekAsAdmin` direct write path에 의존하지 않도록 옮겼다. route response, dev harness response, client contract의 summary shape도 `closedWeek`로 일치시켜 command result contract를 고정했다.
- [2026-04-16] phase1 close 과정에서 `project-select` smoke 실패 원인을 `VITE_PLATFORM_API_BASE_URL`이 local harness에서 죽어 있는 `127.0.0.1:8787`을 계속 가리키던 drift로 확정했고, harness 모드에서는 현재 Vite origin을 우선 사용하도록 정리했다.
- [2026-04-16] broad smoke에서 보였던 `ProjectDetailPage` dynamic import failure와 webserver refusal은 별도 제품 회귀가 아니라 같은 harness drift/worker churn의 false negative로 분리했고, Playwright harness를 serial worker + local API base 고정 계약으로 잠갔다.
- [2026-04-16] phase1 close 과정에서 `/portal/submissions -> /portal` 경로의 dashboard summary null-safety 회귀도 같이 수정해, broad smoke와 release gate를 실제 제품 상태 기준으로 다시 green으로 닫았다.

## Known Notes

- 이 문서는 patch note라기보다 운영/아키텍처 판단 기록에 가깝다.
- PostgreSQL/application server 전면 전환은 이번 RFC의 기본안이 아니라 후속 비교안이다.
- 예외 경로는 owner/expiry/remove condition 없는 임시 구조를 허용하지 않는다.
- Google Drive는 운영 공유본 보조 채널일 뿐, 백업 기준 저장소는 GCS다.

## Related Files

- `docs/operations/2026-04-16-portal-hardening-orchestration-model.md`
- `docs/operations/2026-04-16-finance-grade-portal-stabilization-master-plan.md`
- `docs/architecture/portal-stabilization-hybrid-rfc-2026-04-15.md`
- `docs/architecture/portal-platform-options-2026-04-15.md`
- `docs/architecture/client-direct-exit-decision-points-2026-04-15.md`
- `docs/operations/2026-04-15-portal-hybrid-stabilization-plan.md`
- `docs/operations/2026-04-15-client-direct-exit-plan.md`
- `docs/operations/2026-04-16-firestore-gcs-backup-restore-plan.md`
- `docs/operations/2026-04-16-emergency-ledger-reviewed-reconciliation-plan.md`
- `src/app/App.tsx`
- `src/app/routes.tsx`
- `src/app/components/portal/PortalEntryLayout.tsx`
- `src/app/data/admin-route-providers.tsx`
- `src/app/data/portal-route-providers.tsx`
- `src/app/data/firestore-realtime-mode.ts`
- `src/app/data/portal-store.tsx`
- `src/app/lib/platform-bff-client.ts`
- `server/bff/routes/portal-entry.mjs`
- `server/bff/routes/portal-weekly-expense-commands.mjs`
- `server/bff/routes/portal-weekly-submission-commands.mjs`
- `src/styles/fonts.css`
- `vercel.json`
- `src/app/data/payroll-store.tsx`
- `src/app/data/cashflow-weeks-store.tsx`
- `src/app/data/board-store.tsx`
- `src/app/data/training-store.tsx`
- `src/app/data/hr-announcements-store.tsx`

## Related QA / Ops Context

- Portal hardening slices are now expected to be assigned one at a time, with the main agent holding integration and verification responsibility across route, read-model, write-path, and release-gate changes.
- 반복적인 Firestore `Listen 400`, 포털 flicker, route/provider coupling 이슈가 누적되며 단기 핫픽스로는 한계가 분명해졌다.
- 운영 화면이 raw Firestore query를 직접 조합하는 구조를 줄이고, 읽기 계약을 BFF로 모으는 것이 장기 안정화의 핵심으로 정리됐다.
- 이번 phase는 provider를 옮기는 수준이 아니라, route shell이 data access policy를 명시적으로 주입하게 만든 첫 구조 변경이다.
- Phase 1a는 실제 HAR 병목이 나온 `project-select` entry surface를 우선 잘라낸 것으로, 장기 RFC를 화면 단위 read model 이행으로 연결하는 첫 concrete slice다.

## Next Watch Points

- Slice boundaries stay narrow enough that one subagent can finish a change without cross-slice edits.
- Main-agent verification continues to require the real smoke and HAR metrics, not just unit test success.
- portal network artifact가 실제 release blocker evidence로 계속 남는지
- Phase 0~1이 실제로 broad provider tree를 얼마나 줄이는지
- entry surface가 다시 Firestore direct read/write path를 끌어오지 않는지
- read model endpoint가 raw model drift 없이 유지되는지
- 새 포털 기능이 다시 Firestore direct path로 들어오지 않는지
