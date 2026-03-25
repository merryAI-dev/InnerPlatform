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

- [ ] **SettingsPage > 권한 설정 탭** — 동적 매트릭스 정상
- [ ] **SettingsPage > 구성원 탭** — 역할 배지 표시 (`ROLE_META`)
- [ ] **UserManagementPage** — 역할 아이콘/컬러/라벨 정상
- [ ] **사이드바 네비게이션** — 역할별 메뉴 필터링 (`nav-policy.json`)
- [ ] **BFF 엔드포인트** — `/api/` 경로들 응답 정상
- [ ] **SettlementLedgerPage** — 컴포넌트 분해 후 기존 기능 동일
- [ ] **테넌트 관리** — admin에서 테넌트 관리/브랜딩 탭 접근 가능

### 머지 순서

1. 체크리스트 전부 통과 확인
2. `main` 최신 pull → conflict 확인
3. Merge commit (커밋 히스토리 유지)
4. Vercel 프로덕션 배포 확인
5. 배포 후 5분간 모니터링

### 롤백 계획

- `git revert --no-commit HEAD` → 새 커밋으로 revert
- BFF: `server/bff/app.mjs` 단독 revert 가능
- UI: 정책 파일 수정으로 핫픽스 가능

---

## P2: 역할 간소화 — 8개 → 4개 (PR #126 머지 후)

**Why:** 내부 SaaS(`@mysc.co.kr` 전용)에서 역할 8개는 관리 부담만 키움. 어드민이 역할 할당할 때 tenant_admin/support/security/auditor 구분이 실무에서 무의미하고, 사용자도 자기 역할 권한을 직관적으로 이해하기 어려움. 편의성 > 세밀한 권한 분리.

### 역할 매핑

```
AS-IS (8 roles)          →  TO-BE (4 roles)       비고
─────────────────────────────────────────────────────────
admin                    →  admin                  전체 관리 (설정/구성원/테넌트)
tenant_admin             →  admin에 흡수           내부 SaaS에서 테넌트 분리 불필요
support                  →  admin에 흡수           내부 지원 = 관리자
security                 →  admin에 흡수           내부 보안 = 관리자
finance                  →  finance                재무 (캐시플로/승인/정산/감사로그)
auditor                  →  finance에 흡수         감사 = 재무 + 감사로그 읽기
pm                       →  pm                     프로젝트 (입력/제출/포털)
viewer                   →  viewer                 열람 전용 (포털)
```

### 변경 파일 목록

| 파일 | 변경 |
|------|------|
| `src/app/data/types.ts` | `UserRole` 타입 4개로 축소 |
| `src/app/platform/role-meta.ts` | 4개 역할만 남김 |
| `policies/rbac-policy.json` | 역할 4개, 권한 병합 |
| `policies/nav-policy.json` | fullAccessRoles: admin만, routePermissions: finance만 |
| `src/app/platform/admin-nav.ts` | policy 읽는 코드는 변경 없음 (JSON만 변경) |
| `src/app/platform/navigation.ts` | `ADMIN_SPACE_ROLES` 축소 |
| `firebase/firestore.rules` | canRead/canWrite 역할 목록 축소 |
| `firebase/storage.rules` | 동일 |
| `server/bff/` | 라우트별 ROUTE_ROLES 축소 |
| `src/app/components/users/UserManagementPage.tsx` | 역할 선택 UI 4개만 표시 |
| `src/app/components/settings/SettingsPage.tsx` | 권한 매트릭스 4열 |

### 마이그레이션

- 기존 사용자 중 `tenant_admin`/`support`/`security` → `admin`으로 일괄 변경
- 기존 `auditor` → `finance`로 일괄 변경
- Firestore 일회성 스크립트로 처리 (members 컬렉션 role 필드)

### 주의사항

- `ROLE_META`가 `Record<UserRole, RoleMeta>`이므로 타입 변경하면 컴파일러가 누락 잡아줌
- `nav-policy.json` / `rbac-policy.json`은 JSON이라 타입 체크 안 됨 → 테스트로 커버
- 기존 `role-meta.test.ts`의 `ALL_ROLES` 배열도 함께 업데이트

**Effort:** S (CC ~20분 — SSOT 덕분에 수정 포인트 적음)
**Priority:** P2
**Depends on:** PR #126 머지 완료 후

---

## P3: Firestore 기반 테넌트별 메뉴 커스텀 (미래)

**What:** `nav-config.ts`의 정적 NAV_GROUPS를 Firestore에서 오버라이드 가능하게.

**Why:** 멀티테넌트 SaaS 확장 시 테넌트별 메뉴 구성 필요. 현재는 내부 플랫폼이라 불필요.

**Effort:** M (CC ~30분)
**Priority:** P3 — 외부 확장 시점에 맞춰 진행. 역할 간소화(P2) 완료 후.

---
