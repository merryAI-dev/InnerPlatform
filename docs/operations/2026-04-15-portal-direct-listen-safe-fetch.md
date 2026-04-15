# PM Portal Direct Listen Safe Fetch Hotfix

## Goal

- `/portal` 홈과 인건비 화면에 남아 있는 direct Firestore realtime listener를 제거한다.
- PM/viewer 경로에서 반복되는 `Firestore Listen 400`을 더 줄인다.

## Scope

- `src/app/components/portal/PortalDashboard.tsx`
- `src/app/components/portal/PortalPayrollPage.tsx`
- 공용 역할 정책 재사용
- 관련 patch note 갱신

## Approach

- `admin`, `tenant_admin`, `finance`, `auditor`만 realtime 유지
- `pm`, `viewer`는 `getDocs` 기반 safe fetch 사용
- 홈과 인건비 화면 모두 `transactions`를 direct realtime listen 대신 role-based fetch로 전환

## Verification

- 대상 컴포넌트 테스트 또는 source contract test
- `npm run build`
- 필요 시 production canary 재확인
