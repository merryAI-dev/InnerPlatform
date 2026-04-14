# Admin Users Auth Governance

- route: `/users`
- primary users: admin
- status: active
- last updated: 2026-04-14

## Purpose

사용자 권한과 auth 상태를 shallow 편집이 아니라 운영 정렬 관점에서 관리하는 대시보드다. Firebase Auth, canonical member, legacy member, custom claim drift를 한 화면에 모은다.

## Current UX Summary

- 사용자별 auth/member/claim 정합성을 비교해서 보여준다.
- drift가 있는 사용자를 찾고 개별 또는 일괄 deep sync를 수행한다.
- shallow role 편집이 아니라 canonical member, legacy member, custom claim을 함께 정렬하는 운영 surface다.

## Recent Changes

- [2026-04-13] 기존 `/users` 사용자 목록을 auth governance 대시보드로 교체했다.
- [2026-04-13] Firebase Auth, canonical member, legacy member, bootstrap 후보, custom claim drift를 한 응답으로 모으는 BFF를 추가했다.
- [2026-04-13] 개별 deep sync와 filtered bulk sync로 shallow adoption이 아니라 deep adoption을 가능하게 했다.
- [2026-04-13] stale claim이 member role을 덮어쓰지 않도록 auth/RBAC precedence를 정리했다.

## Known Notes

- 캐시플로 추출 접근성 이슈처럼 "누구는 보이고 누구는 안 보임" 문제의 운영 근거 화면이다.
- 이 화면만 바꿔서는 충분하지 않고, 실제 Firestore member role과 Firebase Auth 상태가 함께 맞아야 한다.

## Related Files

- `src/app/components/users/UserManagementPage.tsx`
- `src/app/components/users/auth-governance-view-model.ts`
- `src/app/lib/platform-bff-client.ts`
- `server/bff/auth-governance.mjs`
- `server/bff/routes/members.mjs`
- `src/app/data/auth-store.tsx`
- `src/app/data/auth-role-resolution.ts`

## Related Tests

- `src/app/components/users/auth-governance-view-model.test.ts`
- `src/app/lib/platform-bff-client.test.ts`
- `server/bff/auth-governance.test.mjs`
- `server/bff/request-context.test.ts`
- `server/bff/app.integration.test.ts`
- `src/app/platform/firestore-rules-policy.test.ts`

## Related QA / Ops Context

- 실제 운영에서 `jslee@mysc.co.kr` 등 특정 계정이 admin cashflow export를 보지 못한 이슈가 직접 계기였다.
- member role, claim, bootstrap admin 목록이 서로 어긋나면 화면 노출과 서버 권한이 어긋나는 문제가 생긴다.

## Next Watch Points

- bulk deep sync가 canonical member만 맞추고 legacy/custom claim을 놓치지 않는지
- role precedence가 다시 stale claim 우선으로 회귀하지 않는지
- `finance`와 `admin`의 기능별 권한 차등을 문서와 코드에서 일관되게 유지하는지
