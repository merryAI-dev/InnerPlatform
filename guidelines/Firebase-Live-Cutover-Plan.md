# Firebase Live Cutover 실행 계획

## 배경

현재 `mysc-bmp-14173451` (MYSC Business Platform) 프로젝트에는 개발/검증 과정에서 생긴
더미 데이터와 실제 운영 데이터가 혼재해 있다.
`inner-platform-live-20260316` 신규 프로젝트가 이미 생성되어 있으며,
이 프로젝트를 깨끗한 운영 환경으로 전환하는 것이 목표다.

## 프로젝트 구성

| 역할 | Project ID |
|------|-----------|
| Source (현재, 더미 혼재) | `mysc-bmp-14173451` |
| QA | `inner-platform-qa-20260310` |
| **Destination (새 운영)** | `inner-platform-live-20260316` |

---

## Phase 1 — Discover & 데이터 판별

**목적:** Source 프로젝트에서 실제 운영 데이터와 더미 데이터를 구분한다.

### 작업
```bash
SOURCE_FIREBASE_PROJECT_ID=mysc-bmp-14173451 \
npx tsx scripts/firestore_live_cutover.ts discover \
  --source-project mysc-bmp-14173451 \
  --org mysc \
  --out guidelines/output/live-discovery.json
```

### 판별 기준
- `likelyTestData: true` → 더미로 간주
- 실제 사업명, 담당자 UID, 거래 내역이 있는 프로젝트 → 이관 대상

### 산출물
- `guidelines/output/live-discovery.json` — 전체 프로젝트 목록 + heuristic 결과
- 이관할 `projectIds` 목록 확정 (사람이 최종 판단)

---

## Phase 2 — Destination 프로젝트 세팅

**목적:** `inner-platform-live-20260316`에 rules/indexes/storage를 배포한다.

### 작업

```bash
# 1. firebase 타겟 전환
firebase use inner-platform-live-20260316

# 2. rules + indexes + storage rules 배포
npm run firebase:deploy:firestore
```

### Firebase Console 수동 작업
- [ ] Google Sign-In provider 활성화
- [ ] Firebase Storage bucket 초기화
- [ ] Authorized domains에 Vercel production URL 추가
- [ ] Vercel preview URL 추가 (필요한 경우)

### 검증
```bash
# 빈 프로젝트에 앱이 연결되는지 로컬에서 확인
# .env를 inner-platform-live-20260316 config로 임시 교체 후 npm run dev
```

---

## Phase 3 — Manifest 작성 & Dry-run

**목적:** 이관 범위를 확정하고 실제 이관 전 검토한다.

### Manifest 작성
`scripts/firestore_live_cutover.manifest.json` 생성:

```json
{
  "orgId": "mysc",
  "projectIds": ["<Phase 1에서 확정된 실제 프로젝트 ID들>"],
  "memberUids": ["<연결된 사용자 UID들>"],
  "projectRequestIds": ["<필요한 경우>"],
  "includeProjectRequests": true,
  "includeProjectSubcollections": true,
  "includeWeeklySubmissionStatus": true,
  "includeCashflowWeeks": true,
  "includeComments": true,
  "includeEvidences": true,
  "includeAuditLogs": false,
  "includeContractStorage": true
}
```

### Dry-run
```bash
SOURCE_FIREBASE_PROJECT_ID=mysc-bmp-14173451 \
DEST_FIREBASE_PROJECT_ID=inner-platform-live-20260316 \
npx tsx scripts/firestore_live_cutover.ts migrate \
  --manifest scripts/firestore_live_cutover.manifest.json \
  --source-project mysc-bmp-14173451 \
  --dest-project inner-platform-live-20260316
```

→ 이관 대상 문서 수, Storage 객체 수 요약 확인

---

## Phase 4 — 실제 이관

**목적:** Firestore + Storage 데이터를 선별 복제한다.

### 사전 체크
- [ ] Dry-run 결과 검토 완료
- [ ] Destination 프로젝트 세팅 검증 완료
- [ ] 서비스 계정 인증 준비 (`gcloud auth application-default login` 또는 SA JSON)

### 실행
```bash
SOURCE_FIREBASE_PROJECT_ID=mysc-bmp-14173451 \
DEST_FIREBASE_PROJECT_ID=inner-platform-live-20260316 \
npx tsx scripts/firestore_live_cutover.ts migrate \
  --manifest scripts/firestore_live_cutover.manifest.json \
  --source-project mysc-bmp-14173451 \
  --dest-project inner-platform-live-20260316 \
  --commit
```

### 이관 후 검증 (Destination 프로젝트 기준)
- [ ] 프로젝트 목록 조회
- [ ] 사업 등록 제안 제출
- [ ] 계약서 업로드 확인
- [ ] 주간 사업비 입력 조회
- [ ] 통장내역 / 예산 / 캐시플로우 조회
- [ ] 증빙 업로드 / Drive 동기화

---

## Phase 5 — Vercel Production 전환

**목적:** 앱이 `inner-platform-live-20260316`을 바라보도록 전환한다.

### Vercel env 교체 항목

| 변수 | 설명 |
|------|------|
| `VITE_FIREBASE_API_KEY` | 새 프로젝트 SDK config |
| `VITE_FIREBASE_AUTH_DOMAIN` | 새 프로젝트 auth domain |
| `VITE_FIREBASE_PROJECT_ID` | `inner-platform-live-20260316` |
| `VITE_FIREBASE_STORAGE_BUCKET` | 새 프로젝트 bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | 새 프로젝트 sender ID |
| `VITE_FIREBASE_APP_ID` | 새 프로젝트 app ID |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | 새 프로젝트 서비스 계정 |

### .firebaserc 업데이트
```json
{
  "projects": {
    "default": "inner-platform-live-20260316"
  }
}
```

### 전환 순서
1. Vercel env 교체 → Production 재배포 트리거
2. 재배포 완료 후 실제 URL 접속 검증
3. 기존 `mysc-bmp-14173451`은 읽기 전용으로 보관

---

## 안전 원칙

- `mysc-bmp-14173451`은 절대 직접 삭제하지 않는다
- manifest 없이 전체 복사하지 않는다
- dry-run 결과 확인 없이 `--commit` 하지 않는다
- Vercel 전환 직전 Authorized domains 점검 필수

## 현재 상태

- [x] 이관 스크립트 및 Runbook 작성 완료
- [x] Destination 프로젝트 생성 완료 (`inner-platform-live-20260316`)
- [ ] Phase 1: Discover 실행
- [ ] Phase 2: Destination 세팅
- [ ] Phase 3: Dry-run
- [ ] Phase 4: 실제 이관
- [ ] Phase 5: Vercel 전환
