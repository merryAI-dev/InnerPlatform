# TODOS

> 기술 부채 및 다음 단계 작업 목록
> 생성: 2026-03-25 (plan-ceo-review — admin role-meta 리팩토링 후)

---

## P2: admin-nav.ts 동적화

**What:** `FINANCE_ALLOWED`, `AUDITOR_ALLOWED`, `SUPPORT_ALLOWED`, `SECURITY_ALLOWED` Set들을 `rbac-policy.json` 기반으로 대체.

**Why:** 현재 신규 역할/라우트 추가 시 `admin-nav.ts` + `navigation.ts` 2개 파일 수동 수정 필요. role-meta.ts PR이 역할 메타 SSOT를 확립했으니 다음 단계는 접근 제어 정책의 SSOT화.

**How to apply:** 역할별 허용 경로를 `rbac-policy.json`의 `navPermissions` 섹션으로 이동하거나, 역할-경로 매핑 JSON을 별도 `policies/nav-policy.json`으로 관리.

**Effort:** S (인간 ~0.5일 / CC ~15분)
**Priority:** P2

**Blocked by:** `role-meta.ts` PR 완료 후

---

## P3: NAV_GROUPS 동적화

**What:** `AppLayout.tsx`의 `NAV_GROUPS` 배열을 config 파일 또는 Firestore 기반으로 대체.

**Why:** 테넌트별 커스텀 메뉴를 지원하려면 NAV_GROUPS가 하드코딩되어 있으면 불가. Phase B SaaS 확장 시 필수.

**How to apply:** 설정 파일(`src/app/platform/nav-config.ts`) 또는 Firestore `orgs/{orgId}/settings/nav` 로 이동. `enableMultiTenantUi` 피처플래그 켜질 때 Firestore 버전 사용.

**Effort:** M (인간 ~1일 / CC ~30분)
**Priority:** P3

**Depends on:** admin-nav.ts 동적화 완료 후

---
