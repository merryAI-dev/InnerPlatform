# Portal Payroll

- route: `/portal/payroll`
- primary users: PM
- status: active
- last updated: 2026-04-15

## Purpose

프로젝트별 인건비 지급일, 지급 예정 공지, 월간 정산 완료 확인을 한 화면에서 다루는 포털 운영면이다.

## Current UX Summary

- 지급일 등록, 다음 공지 예정일, 잔액 여력 큐를 한 화면에서 확인한다.
- `/portal` 계열에서는 실시간 Firestore listen 대신 일회성 fetch로 거래 내역을 읽어 포털 안정성을 우선한다.
- 확인이 필요한 지급/월마감 공지만 상단에 노출하고, 나머지는 폼과 상태 카드 중심으로 유지한다.

## Current Feature Checklist

- [x] 프로젝트별 인건비 지급일 저장 가능
- [x] 이번 달 지급 예정일과 공지 예정일 미리보기 가능
- [x] 지급 예정 공지 확인 처리 가능
- [x] 월간 정산 완료 확인 처리 가능
- [x] 프로젝트 거래 내역을 기준으로 지급 여력 상태 계산 가능
- [x] `/portal/payroll`에서는 realtime listen 없이 fetch 기반으로 안정적으로 부팅 가능
- [x] 지급 화면도 route shell이 주입한 `portal-safe` access mode만 소비함

## Recent Changes

- [2026-04-15] 포털 경로에서는 `transactions`를 `onSnapshot`으로 구독하지 않고 `getDocs` 일회성 조회로 읽도록 바꿨다.
- [2026-04-15] 반복 Firestore `Listen 400` 재시도 후보를 줄이기 위해 지급 화면도 `/portal` safe fetch 정책을 따르게 했다.
- [2026-04-15] 지급 화면은 pathname 기반 realtime 추론을 제거하고, route shell에서 주입한 access policy를 기준으로 read-all/realtime 여부를 결정하도록 바꿨다.

## Related Files

- `src/app/components/portal/PortalPayrollPage.tsx`
- `src/app/data/payroll-store.tsx`
- `src/app/data/firestore-realtime-mode.ts`

## Next Watch Points

- 지급 화면에서도 stale role 때문에 realtime이 다시 살아나지 않는지
- 지급일 저장 후 여력 상태 계산이 fetch 기반에서도 기대한 순서로 보이는지
