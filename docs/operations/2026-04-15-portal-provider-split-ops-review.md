# 2026-04-15 Portal Provider Split Ops Review

## Why This Review Exists

이 문서는 `route-scoped provider split` 작업을 **CPO / 운영 관점**에서 계속 따라잡기 위한 가벼운 리뷰 기준이다.

목표는 구조를 이상적으로 만드는 것이 아니라, 아래 두 가지를 먼저 지키는 것이다.

- 포털이 더 이상 broad realtime 성격을 끌고 들어오지 않도록 한다.
- 기존 운영 흐름이 갑자기 멈추거나, 관리자/PM의 화면 접근성이 망가지지 않도록 한다.

## Review Stance

- 엄격한 구조 순도보다 `operation continuity`를 우선한다.
- “완전히 예쁘게 분리됐는가”보다 `포털 부팅`, `권한별 access mode`, `기존 업무 흐름 유지`를 먼저 본다.
- Phase 1에서는 broad provider를 route shell로 내리는 것만으로도 충분히 의미 있는 진전으로 본다.

## What Must Keep Working

### 1. Admin Ops Must Stay Live

- admin / finance / tenant_admin / auditor는 admin route에서 기존 운영 surface를 계속 볼 수 있어야 한다.
- admin route는 `admin-live` access mode를 써야 한다.
- payroll, cashflow week, HR announcement, board, training 같은 운영 surface가 portal-safe로 잘못 눌리면 안 된다.

### 2. Portal Must Stay Safe

- admin 권한 사용자가 portal route에 들어가더라도 portal은 `portal-safe`여야 한다.
- portal은 privileged role이라고 해서 다시 broad realtime read로 올라가면 안 된다.
- `window.location` 같은 암묵적 route 추론 대신 shell에서 access mode를 주입해야 한다.

### 3. Existing Flow Must Not Regress

- 포털 첫 부팅
- 온보딩 후 다음 화면 이동
- payroll / dashboard / weekly-expense / bank-statement 진입
- 기존 PM/사업담당자의 업무 동선

위 흐름에서 “새 구조 때문에 갑자기 다시 onboarding으로 튕김”, “listen error가 다시 증가함”, “portal에서 admin용 broad listen이 붙음” 같은 일이 없어야 한다.

## This Review Is Not Trying To Prove

- provider tree가 최종 형태로 완전히 정리됐다는 것
- 포털의 모든 Firestore direct read가 제거됐다는 것
- BFF hybrid cutover가 이미 끝났다는 것

이 문서는 **Phase 1이 운영적으로 안전한지**만 먼저 본다.

## Current Gates

- [x] App root에서 broad operational provider tree가 빠졌는가
- [x] route shell이 `admin-live` / `portal-safe`를 명시적으로 주입하는가
- [x] store가 더 이상 pathname self-inference를 하지 않는가
- [x] RFC / ops plan / patch-note가 같은 브랜치 안에서 같이 보이는가
- [ ] 실제 route wrapper 동작을 런타임으로 검증하는 regression test가 있는가
- [ ] 포털 주요 흐름 smoke 확인이 문서/QA 기준으로 남아 있는가

## Lightweight Review Loop

반복 점검은 아래 명령 하나로 한다.

```bash
bash scripts/review_portal_provider_split.sh
```

이 명령은 다음을 함께 본다.

1. 어떤 핵심 파일이 바뀌었는지
2. 문서가 같은 브랜치에 함께 들어왔는지
3. access policy / provider split focused test가 계속 초록인지

## Reviewer Notes

- 이 작업의 성공은 “구조론적으로 완벽”이 아니라 “포털이 더 안전해지고, admin 운영이 안 죽는 것”이다.
- 그래서 다음 feedback도 동일 기준으로 준다.
- 더 좋은 구조 제안은 하되, 당장 운영을 흔드는 변경은 막는다.
