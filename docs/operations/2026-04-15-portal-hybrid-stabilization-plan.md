# 2026-04-15 Portal Hybrid Stabilization Plan

기준 RFC: [portal-stabilization-hybrid-rfc-2026-04-15.md](../architecture/portal-stabilization-hybrid-rfc-2026-04-15.md)

## Goal

6~8주 동안 포털과 연결된 운영 surface를 `Firestore direct app`에서 `BFF/API-first hybrid` 구조로 옮긴다.

## Phase Plan

### Phase 0. Freeze and Measure

- portal/viewer의 realtime allowlist 문서화
- 포털 관련 `onSnapshot` 사용 위치 목록 고정
- 새 direct listener 추가를 막는 guard/test 도입
- production 기준 network burst, Listen 400, initial render baseline 수집

### Phase 1. Route-Scoped Provider Split

- `App.tsx` broad provider tree 분리
- portal 전용 provider subtree 구성
- admin 전용 provider subtree 구성
- route 변경에 따라 mount/unmount가 명시적으로 보이도록 정리
- store는 route pathname이 아니라 injected access mode를 소비하도록 전환

### Phase 2. BFF Read Models

- portal dashboard summary endpoint
- submissions summary endpoint
- weekly expense summary endpoint
- bank statement handoff summary endpoint
- payroll summary endpoint

### Phase 3. Critical Write Commands

- weekly expense save
- weekly submission submit/close
- cashflow projection update/close
- bank statement handoff state update

### Phase 4. Admin Summary Cutover

- admin dashboard summary
- cashflow export surface metadata
- auth governance summary

## Task Breakdown

### Week 1

- provider inventory 완료
- realtime allowlist 정책 문서화
- direct listener guard 반영
- portal route provider split 설계 완료

### Week 2

- portal route provider split 구현
- portal boot path from global provider decoupling
- portal first-load smoke test 확립

### Week 3~4

- dashboard/submissions/payroll read model API 구현
- portal client를 API-first로 전환
- raw Firestore fallback 제거

### Week 5~6

- weekly expense / bank statement / cashflow critical command API 구현
- conflict handling, audit, status propagation 정리

### Week 7~8

- admin summary surfaces hybrid cutover
- cleanup: unused portal realtime/store path 제거
- 운영 runbook 및 QA checklist 정리

## Acceptance

- `/portal` 부팅이 broad realtime listener 없이 동작
- 포털 핵심 화면이 BFF read model 기준으로 렌더링
- 포털 주요 write path가 command API로 이동
- Firestore direct realtime은 allowlist surface만 남음

## Watch Points

- hybrid 상태가 임시가 아니라 고착되지 않도록 종료 조건을 매주 확인
- 새 기능이 raw Firestore path로 추가되지 않도록 코드리뷰 기준 명시
- endpoint별 read model schema drift를 테스트로 묶기
