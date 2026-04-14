# Admin Approvals

- route: `/approvals`
- primary users: admin
- status: active
- last updated: 2026-04-14

## Purpose

사업비 승인 대기와 인력변경 승인 대기를 한 화면에서 처리하는 단일 승인 surface다.

## Current UX Summary

- 승인 대기 항목을 카드/섹션으로 본다.
- 처리 이력보다는 현재 대기 건 처리에 집중한다.

## Current Feature Checklist

- [x] 승인 대기 항목 확인 가능
- [x] 프로젝트 요청 승인 섹션 확인 가능
- [x] 사업비 승인 대기 검토 가능
- [x] 인력변경 승인 대기 검토 가능
- [x] 승인/반려 코멘트 입력 가능
- [x] 관련 프로젝트/인력변경 화면으로 이동 가능
- [x] 대기건수 KPI 확인 가능
- [x] 단일 운영 surface로 사용 가능
- [x] 별도 처리 이력 탭 없이 현재 처리 중심 구조 유지

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-09] approvals surface trim 이후 단일 운영면으로 정리됐다.

## Known Notes

- 최근 운영 정리에서 history 탭을 빼고 현재 대기 처리 중심으로 정리됐다.

## Related Files

- `src/app/components/approval/AdminApprovalPage.tsx`

## Related Tests

- `tests/e2e/admin-ops-surface.spec.ts`

## Related QA / Ops Context

- 승인 surface 단순화는 운영 밀도와 직접 연결된다.

## Next Watch Points

- 승인 대기 중심 구조가 다시 복잡한 다중 탭 구조로 회귀하지 않는지
