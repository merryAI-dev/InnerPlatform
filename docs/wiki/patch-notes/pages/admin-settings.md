# Admin Settings

- route: `/settings`
- primary users: admin
- status: active
- last updated: 2026-04-14

## Purpose

조직 정보, 구성원, 원장 템플릿, 데이터 마이그레이션, 권한 설정을 관리하는 관리자 설정 화면이다.

## Current UX Summary

- 탭 기반으로 설정 범주를 나눠 본다.
- 조직, 구성원, 템플릿, 이관, 권한을 같은 화면에서 다룬다.

## Current Feature Checklist

- [x] 조직 정보 탭 확인 가능
- [x] 구성원 탭 확인 가능
- [x] 구성원 요약에서 `/users`로 점프 가능
- [x] 원장 템플릿 탭 확인 가능
- [x] 데이터 마이그레이션 탭 확인 가능
- [x] 권한 설정 탭 확인 가능
- [x] admin-only 접근 가드 유지
- [x] 불필요한 Firebase/브랜딩/가이드 탭 제거 상태 유지

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-09] settings surface trim 이후 운영 탭 위주로 정리됐다.

## Known Notes

- 최근 운영 정리에서 primary surface는 실운영 탭 위주로 축소됐다.

## Related Files

- `src/app/components/settings/SettingsPage.tsx`

## Related Tests

- `tests/e2e/admin-ops-surface.spec.ts`

## Related QA / Ops Context

- 구성원과 권한 설정은 `/users` auth governance 문서와 함께 봐야 한다.

## Next Watch Points

- 설정 탭 구성이 다시 운영 외 탭으로 번지지 않는지
