# TODOS

> 기술 부채 및 다음 단계 작업 목록
> 생성: 2026-03-25 (plan-ceo-review — admin role-meta 리팩토링 후)

---

## ~~P2: admin-nav.ts 동적화~~ ✅ 완료 (2026-03-25)

`758600e` — `nav-policy.json` SSOT로 전환. `FINANCE_ALLOWED` 등 하드코딩 Set 4개 제거.

---

## ~~P3: NAV_GROUPS 동적화~~ ✅ 완료 (2026-03-25)

`4f895e2` — `nav-config.ts`로 분리. `AppLayout.tsx`에서 42줄 하드코딩 제거.

---

## P1: PR #126 프로덕션 머지 계획 (2026-03-26 예정)

**PR:** https://github.com/merryAI-dev/InnerPlatform/pull/126
**Branch:** `refactor/bff-route-split` → `main`

### 머지 전 체크리스트

- [ ] **CI 확인** — GitHub Actions 빌드/테스트 녹색
- [ ] **로컬 full test** — `npm install && npx vitest run` 전체 통과
- [ ] **TypeScript 빌드** — `npm run build` 에러 없음
- [ ] **Vercel Preview** — PR 프리뷰 배포 정상 동작 확인

### 기능별 수동 검증

- [ ] **SettingsPage > 권한 설정 탭** — `rbac-policy.json` 기반 동적 매트릭스 체크/X 표시 정상
- [ ] **SettingsPage > 구성원 탭** — 역할 배지 color/label 표시 (`ROLE_META`)
- [ ] **UserManagementPage** — 역할 아이콘/컬러/라벨 정상 (`ROLE_META`)
- [ ] **사이드바 네비게이션** — finance/auditor/support/security 역할별 메뉴 필터링 (`nav-policy.json`)
- [ ] **BFF 엔드포인트** — `/api/` 경로들 응답 정상 (라우트 분리 후 동일 동작)
- [ ] **SettlementLedgerPage** — 컴포넌트 분해 후 기존 기능 동일
- [ ] **테넌트 관리** — admin 역할에서 테넌트 관리/브랜딩 탭 접근 가능

### 머지 순서

1. 위 체크리스트 전부 통과 확인
2. `main` 브랜치 최신 상태 pull → conflict 확인
3. Squash merge 또는 merge commit (커밋 히스토리 유지 권장)
4. Vercel 프로덕션 배포 확인
5. 배포 후 5분간 콘솔 에러/API 에러 모니터링

### 롤백 계획

- 문제 발생 시: `git revert --no-commit HEAD` → 새 커밋으로 revert
- BFF 문제인 경우: `server/bff/app.mjs` 단독 revert 가능 (라우트 파일들은 import만 변경)
- UI 문제인 경우: 정책 파일(`nav-policy.json`, `nav-config.ts`) 수정으로 핫픽스 가능

---

## P4: Firestore 기반 테넌트별 메뉴 커스텀 (미래)

**What:** `nav-config.ts`의 정적 NAV_GROUPS를 Firestore `orgs/{orgId}/settings/nav`에서 오버라이드 가능하게.

**Why:** 멀티테넌트 SaaS 확장 시 테넌트별로 다른 메뉴 구성 필요.

**How to apply:** `enableMultiTenantUi` 피처플래그가 켜지면 Firestore nav 설정을 우선 적용, 없으면 `nav-config.ts` 기본값 사용.

**Effort:** M (인간 ~1일 / CC ~30분)
**Priority:** P4 — 피처플래그 활성화 시점에 맞춰 진행

**Depends on:** PR #126 머지 완료 후

---
