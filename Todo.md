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

### 1-1. 비목/세목 히스토리 기반 제안 (AI 최소화)

> 비목/세목은 프로젝트마다 코드북이 다르고, 같은 거래처도 맥락에 따라 달라서
> AI가 "알아서" 맞추기 어려움. 히스토리 패턴이 훨씬 정확.

```
같은 프로젝트 + 기존 거래처  →  히스토리 캐시 → 즉시 제안 (AI 불필요)
새 거래처 + 코드북 있음      →  AI 호출 (코드북 + 메모 컨텍스트 제공)
새 거래처 + 코드북 없음      →  fuzzy만, 사람 검토 요청
```

- [x] Firestore `orgs/{orgId}/counterparty_budget_history` 컬렉션 설계
  - 거래처명 → `{ budgetCategory, budgetSubCategory, usageCount, lastUsed }` 저장
  - 거래 저장 시 자동 업데이트
- [x] BFF `counterparty-budget-history.mjs` — `updateCounterpartyHistory`, `lookupCounterpartyHistory` 구현
- [x] BFF `upsertTransaction` — 비목 있으면 히스토리 side-effect (fire-and-forget)
- [x] BFF endpoint: `GET /api/v1/budget/suggest?counterparty=&projectId=`
- [x] `platform-bff-client.ts` — `fetchBudgetSuggestionViaBff` 추가
- [ ] `budget-auto-match.ts` — 히스토리 조회 레이어 추가 (fuzzy 이전에 실행)
- [ ] BFF `ai-helpers.mjs` — `suggestBudgetCodeWithAI(counterparty, memo, codeBook)` 신규
  - AI 호출은 히스토리 miss + 코드북 있을 때만
  - 모델: `claude-haiku-4-5-20251001` (빠름, 저렴)
  - 토큰 예산: 200 tokens
- [ ] UI: 정산 그리드 비목/세목 셀에 제안 뱃지 표시 (클릭으로 수락)

### 1-2. 거래처 정규화 + 오타 탐지 (규칙 기반)

> AI 없이도 충분히 가능. Levenshtein 유사도 + 정규화 규칙으로.

- [ ] `src/app/platform/counterparty-normalizer.ts` 신규
  - 공백/특수문자 정규화 ("(주)", "주식회사" 등 제거)
  - 기존 거래처 목록과 유사도 비교 (편집거리 ≤ 2 이면 경고)
- [ ] `deriveRowLocally()` 내 거래처 입력 시 자동 실행
- [ ] UI: "혹시 OOO을 입력하려 하셨나요?" 인라인 힌트

### 1-3. 필수증빙 자동 판단 (규칙 기반 + AI fallback)

> 현재 `evidenceRequired`가 빈 배열이면 아무것도 안 함.
> 비목 + 금액대 기반 규칙표로 먼저 채우고, 모호한 경우만 AI.

- [x] `src/app/platform/evidence-rules.ts` 신규
  - 비목별 금액대 기준 증빙 규칙표 (인건비/직접사업비/출장비/외주/운영비)
  - `prepareSettlementImportRows` + `updateRow` 에 2순위 fallback으로 통합
- [ ] 규칙 miss 케이스 → AI 호출 (`suggestEvidenceRequirements`) — Phase 2
- [ ] BFF endpoint: `POST /api/v1/ai/suggest-evidence` — Phase 2

### 1-4. 참여율 이상 탐지 (규칙 기반, AI 불필요)

> 100% 초과 여부는 단순 합산. AI 필요 없음.

- [ ] `participation-risk-rules.ts` — cross-project 합산 검증 함수 추가
- [ ] 정산 저장 시 자동 실행 → 100% 초과 시 저장 전 경고 모달
- [ ] Admin 대시보드: 참여율 위험 직원 목록

---

## Phase 2 — AI 안정화 (A 마무리, 2주)

### 비용 추적
- [ ] `observability.ts` — AI 호출당 token 사용량 추적
- [ ] Firestore `orgs/{orgId}/ai_metrics` 컬렉션 신설
- [ ] 월별 API 비용 집계 뷰 (Admin 대시보드)

### 품질 개선
- [ ] 사용자 피드백 루프 — 각 AI 제안 옆 👍/👎
- [ ] Rate limiting 추가 (대량 import 시 API quota 보호)
- [ ] 배치 처리 큐잉 (기존 `work-queue.mjs` 패턴 재활용)

### 환경변수 정리
```bash
ANTHROPIC_AI_BUDGET_SUGGEST_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_AI_EVIDENCE_CLASSIFY_MODEL=claude-sonnet-4-6
ANTHROPIC_AI_CACHE_TTL_SECONDS=86400
```

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

_Last updated: 2026-03-24 (Phase 1 재설계: 비목/세목 히스토리 우선, AI는 new 거래처에만)_
