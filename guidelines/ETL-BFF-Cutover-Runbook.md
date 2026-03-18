# ETL 마이그레이션 & BFF Cutover Runbook

## 목적

기존 Google Sheets 데이터를 Firestore로 완전 이관(ETL)하고,
모든 쓰기 작업을 BFF 경유로 전환(BFF cutover)한다.

## 현재 상태

- ETL 스크립트: `scripts/etl/` (build-staging-json.ts, sync-staging-to-firestore.ts)
- BFF 서버: `server/bff/` (Express, Cloud Run 배포)
- Feature flag: `VITE_PLATFORM_API_ENABLED=false` (현재 비활성)
- 데이터 라우팅: store.tsx → Feature Flag 기반 BFF / Firestore / Mock 분기

## Phase 1: ETL 빌드

### 1-1. 시트 프로필 확인
```bash
cat scripts/etl/config/sheet-profiles.ts
```

### 1-2. Staging JSON 빌드
```bash
npm run etl:build:staging-json
```
→ `scripts/etl/output/firestore-staging-bundle.json` 생성

### 1-3. Dry-run
```bash
npm run etl:sync:staging -- --bundle scripts/etl/output/firestore-staging-bundle.json --org mysc
```

### 1-4. 실제 동기화
```bash
npm run etl:sync:staging -- --bundle scripts/etl/output/firestore-staging-bundle.json --org mysc --commit
```

## Phase 2: BFF Cutover

### 2-1. 로컬 테스트
```bash
# .env 에서 feature flag 전환
VITE_PLATFORM_API_ENABLED=true

# BFF 서버 시작
npm run bff:dev

# 프론트엔드 시작
npm run dev
```

### 2-2. BFF 통합 테스트
```bash
npm run bff:test:integration
```

### 2-3. Vercel env 전환
```bash
# Production에서 BFF 활성화
vercel env rm VITE_PLATFORM_API_ENABLED production --yes
echo "true" | vercel env add VITE_PLATFORM_API_ENABLED production
```

### 2-4. Cloud Run BFF 배포
```bash
npm run bff:deploy:cloud-run
```

## 검증 체크리스트

- [ ] ETL staging bundle 빌드 완료
- [ ] Dry-run으로 문서 수/컬렉션 확인
- [ ] 실제 동기화 완료
- [ ] BFF 로컬 테스트 통과
- [ ] BFF 통합 테스트 통과
- [ ] Vercel production에서 BFF 활성화
- [ ] 프로덕션 7개 시나리오 재검증

## 롤백

BFF에 문제가 생기면:
```bash
vercel env rm VITE_PLATFORM_API_ENABLED production --yes
echo "false" | vercel env add VITE_PLATFORM_API_ENABLED production
```
→ 즉시 Firestore 직접 모드로 복귀
