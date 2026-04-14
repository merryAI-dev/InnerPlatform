# Portal Project Settings

- route: `/portal/project-settings`
- primary users: PM, 배정 사업 관리 사용자
- status: active
- last updated: 2026-04-14

## Purpose

내 사업 목록과 주사업을 선택하고, 필요한 경우 사업별 증빙 드라이브 연결을 관리하는 화면이다.

## Current UX Summary

- 검색, 선택 리스트, 저장 footer 중심으로 본다.
- 최근 사용 사업, 현재 선택 상태 같은 보조 배너는 제거했다.
- 주사업 지정은 선택된 사업 카드 안에서 바로 처리한다.

## Current Feature Checklist

- [x] 사업 검색과 다중 선택 가능
- [x] 선택된 사업에서 주사업 지정 가능
- [x] 상태/클라이언트 기준으로 목록 확인 가능
- [x] 선택된 사업별 증빙 드라이브 연결 가능
- [x] 상단 상태 배너 없이 선택 리스트와 저장 footer 중심으로 작업 가능

## Recent Changes

- [2026-04-14] 현재 선택 상태, 최근 사용 사업, 현재 주사업 안내 배너를 제거하고 리스트 중심으로 축소했다.

## Known Notes

- 이 화면의 저장값은 포털 홈, 제출 현황, 주간 정산 진입에 직접 영향을 준다.
- 드라이브 연결은 선택된 사업에서만 관리하도록 유지하는 편이 혼선을 줄인다.

## Related Files

- `src/app/components/portal/PortalProjectSettings.tsx`
- `src/app/routes.tsx`

## Related Tests

- `src/app/components/portal/PortalMinimalSweep.layout.test.ts`

## Next Watch Points

- 사업 수가 많은 사용자에서 검색과 선택 밀도가 다시 과해지지 않는지
- 드라이브 연결 영역의 설명 문구가 다시 불어나지 않는지
