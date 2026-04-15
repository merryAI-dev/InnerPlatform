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
- [x] portal dashboard / submissions / weekly expense / bank statement / payroll summary read model 이행 계획이 정의됨
- [x] critical write path를 command API로 이동하는 단계가 플랜에 포함됨
- [x] App 루트 broad provider tree가 admin/portal route shell로 분리됨
- [x] route shell이 explicit Firestore access mode를 주입하고 store는 pathname self-inference를 하지 않음
- [ ] admin summary surface cutover까지 완료됨
- [ ] 포털의 broad Firestore direct read가 완전히 제거됨

## Recent Changes

- [2026-04-15] 포털 안정화 장기안으로 `Firestore 유지 + BFF/API-first hybrid`를 채택했다.
- [2026-04-15] 6~8주 RFC에서 route-scoped provider split, read model API, critical write command, admin summary cutover 순서를 고정했다.
- [2026-04-15] 포털 문제의 본질을 Firestore 자체가 아니라 클라이언트의 분산된 data access policy로 명시했다.
- [2026-04-15] Phase 1 구현으로 App 루트 broad provider를 admin/portal route shell로 분리하고, `portal-safe`/`admin-live` access mode를 route provider에서 주입하도록 바꿨다.

## Known Notes

- 이 문서는 patch note라기보다 운영/아키텍처 판단 기록에 가깝다.
- PostgreSQL/application server 전면 전환은 이번 RFC의 기본안이 아니라 후속 비교안이다.

## Related Files

- `docs/architecture/portal-stabilization-hybrid-rfc-2026-04-15.md`
- `docs/operations/2026-04-15-portal-hybrid-stabilization-plan.md`
- `src/app/App.tsx`
- `src/app/routes.tsx`
- `src/app/data/admin-route-providers.tsx`
- `src/app/data/portal-route-providers.tsx`
- `src/app/data/firestore-realtime-mode.ts`
- `src/app/data/portal-store.tsx`
- `src/app/data/payroll-store.tsx`
- `src/app/data/cashflow-weeks-store.tsx`
- `src/app/data/board-store.tsx`
- `src/app/data/training-store.tsx`
- `src/app/data/hr-announcements-store.tsx`

## Related QA / Ops Context

- 반복적인 Firestore `Listen 400`, 포털 flicker, route/provider coupling 이슈가 누적되며 단기 핫픽스로는 한계가 분명해졌다.
- 운영 화면이 raw Firestore query를 직접 조합하는 구조를 줄이고, 읽기 계약을 BFF로 모으는 것이 장기 안정화의 핵심으로 정리됐다.
- 이번 phase는 provider를 옮기는 수준이 아니라, route shell이 data access policy를 명시적으로 주입하게 만든 첫 구조 변경이다.

## Next Watch Points

- Phase 0~1이 실제로 broad provider tree를 얼마나 줄이는지
- read model endpoint가 raw model drift 없이 유지되는지
- 새 포털 기능이 다시 Firestore direct path로 들어오지 않는지
