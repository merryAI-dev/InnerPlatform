# InnerPlatform — Expansion Todo

> 목표: A(내부 강화) → B(외부 SaaS 확장) 단계적 로드맵
> 생성: 2026-03-24

---

## 🚨 핵심 개발 원칙 (절대 지킬 것)

> **실사용 서비스다. DB와 Production에 영향을 주면 안 된다.**

- **Firestore 기존 컬렉션 구조 변경 금지** — 기존 필드 삭제/rename 하지 말 것
- **신규 기능은 항상 옵트인(opt-in)** — 기존 동작은 그대로 유지, 새 기능은 별도 플래그로
- **새 컬렉션은 additive** — 기존 데이터에 의존하지 않는 독립 컬렉션으로 설계
- **BFF endpoint 추가만 허용** — 기존 endpoint 시그니처 변경 금지
- **배포 전 로컬 에뮬레이터 검증 필수** — `npm run firebase:emulators:start`
- **브랜치 전략**: `feature/*` → PR → main 머지. 직접 main push 금지

---

## 🔴 긴급 (Expansion 전 반드시)

### 보안 — Firestore 규칙 강화
- [ ] `firebase/firestore.rules` — `isSignedIn()` 단일 규칙 → 역할/테넌트 기반으로 세분화
- [ ] 프로젝트 할당 검증 (할당된 프로젝트 외 접근 차단)
- [ ] 테넌트 격리 완성 (다른 orgId 문서 접근 불가)
- [ ] 규칙 배포 후 `npm run firebase:deploy:firestore` + 검증

### 코드 — 최대 부채 해소
- [ ] `server/bff/app.mjs` (105,305줄) → domain별 라우트 파일 분리 (`routes/settlement.mjs`, `routes/budget.mjs` 등)
- [ ] `SettlementLedgerPage.tsx` (3,242줄) → 그리드/헬퍼/증빙 컴포넌트 분해

---

## Phase 1 — 스마트 자동화 (A: MYSC 내부, 2~3주)

> 목표: 수동 반복 작업 줄이기. AI는 진짜 필요한 곳에만.
> 원칙: 히스토리/규칙 먼저 → 해결 안 되면 AI 호출

### 1-1. 비목/세목 히스토리 기반 제안 (AI 최소화) ✅

> 비목/세목은 프로젝트마다 코드북이 다르고, 같은 거래처도 맥락에 따라 달라서
> AI가 "알아서" 맞추기 어려움. 히스토리 패턴이 훨씬 정확.

```
같은 프로젝트 + 기존 거래처  →  히스토리 캐시 → 즉시 제안 (AI 불필요)
새 거래처 + 코드북 있음      →  코드북 fuzzy match (Phase 2-1)
새 거래처 + 코드북 없음      →  fuzzy만, 사람 검토 요청
```

- [x] Firestore `orgs/{orgId}/counterparty_budget_history` 컬렉션 설계
- [x] BFF `counterparty-budget-history.mjs` — `updateCounterpartyHistory`, `lookupCounterpartyHistory` 구현
- [x] BFF `upsertTransaction` — 비목 있으면 히스토리 side-effect (fire-and-forget)
- [x] BFF endpoint: `GET /api/v1/budget/suggest?counterparty=&projectId=`
- [x] `platform-bff-client.ts` — `fetchBudgetSuggestionViaBff` 추가
- [x] UI: 정산 그리드 비목/세목 셀에 제안 칩 표시 (클릭으로 수락)

### 1-2. 거래처 정규화 + 오타 탐지 (규칙 기반) ✅

> AI 없이도 충분히 가능. Levenshtein 유사도 + 정규화 규칙으로.

- [x] `src/app/platform/counterparty-normalizer.ts` 신규
  - 공백/특수문자 정규화 ("(주)", "주식회사" 등 제거)
  - 기존 거래처 목록과 유사도 비교 (편집거리 ≤ 2 이면 경고)
  - 16/16 테스트 통과
- [x] `SettlementLedgerPage.tsx` `updateCell` — 거래처 변경 시 자동 실행
- [x] UI: "혹시 OOO을 입력하려 하셨나요?" 인라인 힌트 (amber 칩)

### 1-3. 필수증빙 자동 판단 (규칙 기반, AI 불필요) ✅

> 비목 + 금액대 기반 규칙표로 자동 채움. 규칙 miss는 빈값 유지 (VLM 이미지 파싱은 별도 검토).

- [x] `src/app/platform/evidence-rules.ts` 신규
  - 비목별 금액대 기준 증빙 규칙표 (인건비/직접사업비/출장비/외주/운영비)
  - `prepareSettlementImportRows` + `updateRow` 에 2순위 fallback으로 통합
  - 17/17 테스트 통과
- [x] 규칙 miss 케이스 → 빈값 유지 (사용자가 직접 입력)
- ~~규칙 miss → AI 호출~~ — VLM 외 AI 불필요, 제거

### 1-4. 참여율 이상 탐지 (규칙 기반, AI 불필요) ✅

> 100% 초과 여부는 단순 합산. AI 필요 없음.

- [x] `participation-risk-rules.ts` — cross-project 합산 검증 함수 추가 (6/6 테스트 통과)
- [x] 정산 저장 시 자동 실행 → 100% 초과 시 저장 전 경고 모달 (AlertDialog)
- [ ] Admin 대시보드: 참여율 위험 직원 상세 목록 (기존 카운트 → 드릴다운) → Phase 2-2

---

## Phase 2 — 규칙 고도화 + VLM 파일럿 (A 마무리, 2주)

> 재설계: VLM 외 AI 불필요로 결론. 규칙 기반 고도화에 집중.
> AI(VLM)는 영수증/계약서 이미지 파싱에만 제한적으로 고려.

### 2-1. 코드북 fuzzy match (비목 제안 고도화)
- [ ] `src/app/platform/budget-auto-match.ts` 신규
  - 거래처명 + 메모 → 코드북 항목 fuzzy match (Levenshtein + 키워드 교집합)
  - cascade: 히스토리 hit → 코드북 매칭 → 빈값
  - 코드북 = `budgetCodebook` (프로젝트별 비목/세목 목록)
- [ ] BFF `GET /api/v1/budget/suggest` — 코드북 매칭 결과도 반환 (source: 'codebook')
- [ ] `SettlementLedgerPage.tsx` — 히스토리 miss 시 코드북 제안도 칩으로 표시

### 2-2. Admin 대시보드 강화
- [ ] 참여율 위험 직원 상세 목록 (기존 카운트 → 드릴다운 뷰) ← Phase 1-4에서 이전
- [ ] 비목 제안 수락률 통계 (히스토리 hit/miss 카운트)

### 2-3. VLM 파일럿 (선택, 별도 검토)
- [ ] 영수증/계약서 이미지 → 거래처명/금액/날짜 자동 추출
  - VLM(claude-sonnet vision)만 적용 범위
  - 텍스트 기반 정산은 규칙으로 충분 → VLM 필요 없음

---

## Phase 3 — B 준비 (SaaS 확장 기반, 3~4주)

### 멀티테넌시 UI
- [ ] 테넌트 온보딩 플로우 (신규 조직 등록 화면)
- [ ] 테넌트 선택 UI (현재 "mysc" 하드코딩 → 드롭다운)
- [ ] 테넌트별 브랜딩 (로고, 컬러 커스터마이징)
- [ ] 테넌트별 기능 플래그 관리 화면

### AI 온보딩 가이드
- [ ] 계약서 업로드 → 사업 유형 자동 감지 → 증빙 규칙 자동 설정
- [ ] "이 사업은 KOICA 유형 — 이렇게 설정됩니다" 단계별 안내
- [ ] 첫 정산 입력 시 "유사 사업 패턴 기반 비목 제안" (신규 조직도 즉시 활용 가능)

### 운영
- [ ] 테넌트별 Firestore 사용량 모니터링
- [ ] SLA 정의 (정산 AI 제안 응답 < 2s 등)

---

## Phase 4 — B 런칭

- [ ] 파일럿 조직 선정 (사회적기업 1~2곳)
- [ ] 온보딩 체크리스트 문서화
- [ ] AI 제안 정확도 리포트 (테넌트별 신뢰도 trend)
- [ ] 가격 정책 수립 (AI 사용량 기반 vs 정액)

---

## 기술 부채 (우선순위 낮음, 단계적 해소)

- [ ] `bank-statement.ts` (16,828줄) 모듈 분해
- [ ] Context Provider 8개 중첩 → Zustand 검토
- [ ] `any`/`unknown` 386개 인스턴스 타입 강화
- [ ] E2E 테스트 (Playwright) 핵심 시나리오 추가

---

## 핵심 인사이트

> AI 없이 B 확장 = "도구를 파는 것"
> AI 있으면 B 확장 = "보조금 정산 도메인 전문가를 파는 것"
>
> 보조금 정산의 진입장벽(비목 코드, 증빙 규칙, 참여율 계산)을
> AI가 낮춰주면 → 신규 조직 온보딩이 자동화됨

---

_Last updated: 2026-03-25 (Phase 1 완료 ✅ · Phase 2 시작: 규칙 고도화 + VLM 파일럿 방향 확정)_
