# Portal Submissions

- route: `/portal/submissions`
- primary users: PM, 주간 제출 상태 확인 담당자
- status: redirected
- last updated: 2026-04-14

## Purpose

기존 PM 제출 현황 화면이며, 현재는 핵심 제출 상태가 `/portal`의 `내 사업 현황` 안으로 흡수되어 직접 진입 시 홈으로 돌아간다.

## Current UX Summary

- 수요일 기준 주차 해석과 이번주 작성 여부가 핵심이었다.
- 최근 업데이트는 projection 수정일시를 기준으로 해석한다.
- 단순 문서 수보다 "해당 주차에 수정이 있었는가"가 더 중요한 지표다.
- 현재는 별도 탭 대신 홈에 흡수된 compact 제출 상태 표를 기준으로 본다.

## Current Feature Checklist

- [x] 이번주 작성 여부 판단 규칙은 유지됨
- [x] 수요일 기준 주차 해석 규칙은 유지됨
- [x] 최근 업데이트를 projection 수정 기준으로 확인 가능
- [x] 0값 저장과 미작성 구분을 전제로 상태 해석 가능
- [x] 현재는 별도 제출 화면 대신 홈 통합 섹션으로 확인
- [x] 직접 `/portal/submissions`로 접근하면 홈으로 정리됨
- [ ] 홈 통합 섹션에서 더 많은 제출 메타데이터가 필요한지 추가 운영 피드백 여지 있음

## Recent Changes

- [2026-04-14] 포털 session active project를 따라 제출 현황이 현재 선택한 사업 기준으로 즉시 바뀌도록 맞췄다.
- [2026-04-16] phase1 smoke에서 `/portal/submissions`가 홈으로 돌아온 뒤 dashboard summary read-model fallback 때문에 깨지던 회귀를 수정해, redirected submission surface가 다시 안정적으로 홈에 흡수되도록 복구했다.
- [2026-04-14] header slab, 표 헤더, 상태칩, 탭, 보조 카드 톤을 dashboard와 같은 Salesforce형 enterprise palette로 정리했다.
- [2026-04-14] 상단 설명 header, helper badge, 빈 상태 코칭 문구를 걷어내고 상태표/신청목록만 남겼다.
- [2026-04-14] 제출/수정 audit line에서 이름이 없을 때 `-` placeholder를 찍지 않도록 정리했다.
- [2026-04-14] 제출 가이드 카드와 미션 카드 없이 상태 표 중심으로 화면을 단순화했다.
- [2026-04-14] 별도 `내 제출 현황` 탭을 없애고 핵심 제출 상태를 `/portal` 대시보드 안으로 흡수했다.
- [2026-04-14] 직접 `/portal/submissions`로 들어오는 경우 홈으로 정리하도록 라우트를 바꿨다.
- [2026-04-10] `최근 업데이트`를 `최근 업데이트(Projection)` 의미로 정리했다.
- [2026-04-10] 주차 문서 수보다 해당 주차 수정 여부가 더 중요하도록 상태 해석을 바꿨다.
- [2026-04-10] 수요일 기준 이번주 작성 여부를 읽기 쉽게 정리했다.

## Known Notes

- 이 화면은 analytics 성격보다 운영 제출 체크리스트 성격이 강하다.
- "0도 작성은 맞음" 같은 운영 규칙이 UI 해석에 반영되어야 한다.

## Related Files

- `src/app/components/portal/PortalSubmissionsPage.tsx`
- `src/app/routes.tsx`

## Related Tests

- `src/app/platform/weekly-accounting-state.test.ts`
- `src/app/data/submissions.helpers.test.ts`
- `src/app/platform/lazy-route.test.ts`
- `src/app/data/portal-store.integration.test.ts`

## Related QA / Ops Context

- 최근 운영 요청에서 `주차 문서 수` 명칭이 직관적이지 않다는 지적이 있었고, projection 수정일시 기준으로 용어를 맞췄다.

## Next Watch Points

- 수요일 기준 주차 계산이 실제 운영 규칙과 계속 일치하는지
- projection 수정일시와 화면 표기가 다시 분리되지 않는지
- 작성 여부 판단에 `값이 0인 저장`과 `미작성`이 혼동되지 않는지
