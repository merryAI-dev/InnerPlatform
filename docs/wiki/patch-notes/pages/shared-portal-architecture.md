# Shared Portal Architecture

- route: `shared / architecture`
- primary users: 운영자, 개발자, QA, 의사결정자
- status: draft-active
- last updated: 2026-04-15

## Purpose

포털 안정화의 장기 방향을 `Firestore 유지 + BFF/API-first hybrid` 기준으로 정리해, 왜 이 방향을 택했는지와 6~8주 실행 순서를 한 곳에서 공유하기 위한 문서다.

## Current UX Summary

- 포털은 현재 Firestore direct read와 일부 realtime 구독의 영향을 받고 있어, route/provider/query coupling이 반복 이슈를 만든다.
- 장기 방향은 포털과 운영 summary surface를 BFF read model 중심으로 옮기고, realtime은 allowlist surface만 남기는 것이다.
- Firestore는 당분간 source of truth로 유지하되, 화면은 raw collection을 직접 해석하지 않는다.

## Current Feature Checklist

- [x] 장기 기본안이 `Firestore 유지 + BFF/API-first hybrid`로 고정됨
- [x] `Firestore direct 유지`와 `전면 재플랫폼`은 비교안으로만 정리됨
- [x] 포털은 fetch-first, realtime allowlist-only 원칙을 채택함
- [x] route-scoped provider split이 1차 이행 과제로 정의됨
- [x] `portal-store` bootstrap을 project catalog / current project scope / weekly submission scope로 분리함
- [x] 동일한 project snapshot은 state를 다시 쓰지 않도록 dedupe contract를 추가함
- [x] portal dashboard / submissions / weekly expense / bank statement / payroll summary read model 이행 계획이 정의됨
- [x] critical write path를 command API로 이동하는 단계가 플랜에 포함됨
- [ ] admin summary surface cutover까지 완료됨
- [ ] 포털의 broad Firestore direct read가 완전히 제거됨

## Recent Changes

- [2026-04-15] 포털 안정화 장기안으로 `Firestore 유지 + BFF/API-first hybrid`를 채택했다.
- [2026-04-15] 6~8주 RFC에서 route-scoped provider split, read model API, critical write command, admin summary cutover 순서를 고정했다.
- [2026-04-15] 포털 문제의 본질을 Firestore 자체가 아니라 클라이언트의 분산된 data access policy로 명시했다.
- [2026-04-15] `portal-store` bootstrap loop를 project catalog / project scope / weekly submission effect로 분리해, project state write가 scoped fetch를 다시 깨우는 self-trigger 구조를 제거했다.
- [2026-04-15] public `/portal` 기준 Firestore `Listen/channel` 요청이 0건인 상태까지 확인했다.

## Postmortem

- 내가 처음 몇 번의 핫픽스에서 `Firestore 400`과 `provider realtime drift`만 좁게 보고, `portal-store` 안의 bootstrap self-trigger를 늦게 봤다.
- 그 결과 원인 분리가 끝나기 전에 `production이 고쳐졌다`는 뉘앙스로 커뮤니케이션한 구간이 있었다. 그건 잘못이었다.
- 이번 장애의 직접 원인은 `projects`를 쓰는 bootstrap effect가 다시 `scopedProjectIds`와 주간 제출 fetch를 흔드는 구조였다. 즉 Firestore 자체보다 `클라이언트 상태 write와 fetch scope가 한 effect에 섞여 있던 설계`가 핵심이었다.
- 구조 문제를 증상별 핫픽스로 먼저 눌러버린 것도 좋지 않았다. 이후에는 `루프 source -> state write boundary -> fetch boundary` 순서로만 본다.

## Guardrails

- route/provider 정책 문제와 data bootstrap 문제를 같은 버그로 뭉뚱그리지 않는다.
- `production fixed`라는 표현은 `main CI green + Vercel alias 갱신 + 해당 route smoke` 이후에만 쓴다.
- 포털 store는 `catalog`, `current scope`, `cross-project summary`를 한 effect에 섞지 않는다.
- Firestore fetch 결과를 state에 쓸 때는 `same snapshot no-op` 비교 계약을 먼저 둔다.
- public smoke와 authenticated smoke를 분리해서 본다. public에서 조용하다고 authenticated도 조용하다고 가정하지 않는다.

## Known Notes

- 이 문서는 patch note라기보다 운영/아키텍처 판단 기록에 가깝다.
- PostgreSQL/application server 전면 전환은 이번 RFC의 기본안이 아니라 후속 비교안이다.
- 이번 장애는 `Firestore가 나빠서`가 아니라 `bootstrap read boundary가 엉켜서` 발생한 사례로 기록한다.

## Related Files

- `docs/architecture/portal-stabilization-hybrid-rfc-2026-04-15.md`
- `docs/operations/2026-04-15-portal-hybrid-stabilization-plan.md`
- `src/app/App.tsx`
- `src/app/data/portal-store.tsx`
- `src/app/data/payroll-store.tsx`
- `src/app/data/cashflow-weeks-store.tsx`
- `src/app/data/board-store.tsx`
- `src/app/data/training-store.tsx`
- `src/app/data/hr-announcements-store.tsx`

## Related QA / Ops Context

- 반복적인 Firestore `Listen 400`, 포털 flicker, route/provider coupling 이슈가 누적되며 단기 핫픽스로는 한계가 분명해졌다.
- 운영 화면이 raw Firestore query를 직접 조합하는 구조를 줄이고, 읽기 계약을 BFF로 모으는 것이 장기 안정화의 핵심으로 정리됐다.
- `portal-store` bootstrap loop가 실제 churn source였고, route-scoped provider split만으로는 이 문제가 닫히지 않는다는 점을 확인했다.

## Next Watch Points

- Phase 0~1이 실제로 broad provider tree를 얼마나 줄이는지
- read model endpoint가 raw model drift 없이 유지되는지
- 새 포털 기능이 다시 Firestore direct path로 들어오지 않는지
- authenticated PM 세션에서 여전히 남는 Firestore channel churn이 있는지
