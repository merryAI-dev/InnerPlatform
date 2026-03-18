# Firebase Live Cutover Runbook

## 목적

더미/검증 데이터가 섞여 있는 기존 Firebase 프로젝트를 계속 정리하는 대신, **새 운영용 Firebase 프로젝트를 만든 뒤 실제 운영에 필요한 데이터만 선별 이관**한다.

이 프로젝트는 이미 Firebase 런타임 연결과 rules/indexes 배포가 env 기반으로 분리돼 있다.

- Firebase 클라이언트 연결: [src/app/lib/firebase.ts](/Users/boram/InnerPlatform-ft-izzie-latest/src/app/lib/firebase.ts)
- Firestore rules: [firebase/firestore.rules](/Users/boram/InnerPlatform-ft-izzie-latest/firebase/firestore.rules)
- Firestore indexes: [firebase/firestore.indexes.json](/Users/boram/InnerPlatform-ft-izzie-latest/firebase/firestore.indexes.json)
- 자동 세팅: [scripts/firebase_autosetup.sh](/Users/boram/InnerPlatform-ft-izzie-latest/scripts/firebase_autosetup.sh)
- 선별 이관 스크립트: [scripts/firestore_live_cutover.ts](/Users/boram/InnerPlatform-ft-izzie-latest/scripts/firestore_live_cutover.ts)

## 권장 전략

기존 프로젝트를 직접 청소하지 말고 다음 순서로 진행한다.

1. 새 Firebase 프로젝트 생성
2. 새 프로젝트에 동일한 Firestore rules/indexes/storage rules 배포
3. `orgs/mysc` 아래에서 실제 운영에 필요한 프로젝트만 manifest로 선택
4. dry-run으로 이관 범위를 검토
5. commit으로 Firestore/Storage를 선별 복제
6. Vercel production env를 새 Firebase 프로젝트로 전환
7. 기존 Firebase 프로젝트는 읽기 전용 아카이브처럼 유지

## 무엇을 옮길지

기본적으로 아래는 **옮길 가치가 높다**.

- `projects`
- `project_requests`
- `members` 중 선택된 프로젝트와 연결된 사용자
- `projects/{projectId}/expense_sheets`
- `projects/{projectId}/bank_statements`
- `projects/{projectId}/budget_summary`
- `projects/{projectId}/budget_code_book`
- `ledgers`
- `transactions`
- `weekly_submission_status`
- `cashflow_weeks`
- 계약서 PDF Storage 경로 `orgs/{orgId}/project-request-contracts/...`

기본적으로 아래는 **안 옮기는 쪽이 안전하다**.

- 테스트/검증용 프로젝트
- 임시 요청 문서
- 불필요한 `audit_logs`
- 일회성 검증 문서

## 1. 새 Firebase 프로젝트 준비

### 1-1. Firebase 프로젝트 생성

Firebase Console에서 새 프로젝트를 만든다.

### 1-2. 웹 앱과 config 확보

웹 앱을 하나 생성하고 SDK config를 확보한다.

### 1-3. 로컬 `.env` / `.firebaserc` 준비

자동 설정이 가능하면:

```bash
npm run firebase:autosetup
```

수동 config가 이미 있으면:

```bash
npm run firebase:fill-env -- '{"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"..."}'
```

### 1-4. rules / indexes / storage rules 배포

```bash
npm run firebase:bootstrap
```

### 1-5. 콘솔 수동 작업

- Google Sign-In provider 활성화
- Firebase Storage bucket 초기화
- 필요한 경우 Authorized domains 추가

## 2. 현재 프로젝트에서 live 후보 추출

먼저 source 프로젝트를 훑어보고 어떤 프로젝트가 test/dummy처럼 보이는지 구분한다.

```bash
SOURCE_FIREBASE_PROJECT_ID=mysc-bmp-14173451 \
npx tsx scripts/firestore_live_cutover.ts discover \
  --source-project mysc-bmp-14173451 \
  --org mysc \
  --out guidelines/output/live-discovery.json
```

출력에는 `likelyTestData`와 heuristic 이유가 들어간다. 이 값은 **참고용**이고 최종 선별은 사람이 한다.

## 3. manifest 작성

샘플:

- [scripts/firestore_live_cutover.manifest.sample.json](/Users/boram/InnerPlatform-ft-izzie-latest/scripts/firestore_live_cutover.manifest.sample.json)

핵심 필드:

- `projectIds`: 새 운영용으로 옮길 실제 프로젝트 ID
- `memberUids`: 명시적으로 같이 데려갈 사용자 UID
- `projectRequestIds`: 필요한 요청 문서가 있으면 명시
- `includeContractStorage`: 계약서 PDF Storage 객체 복제 여부

## 4. dry-run 검토

```bash
SOURCE_FIREBASE_PROJECT_ID=mysc-bmp-14173451 \
DEST_FIREBASE_PROJECT_ID=my-new-live-project \
npx tsx scripts/firestore_live_cutover.ts migrate \
  --manifest scripts/firestore_live_cutover.manifest.sample.json \
  --source-project mysc-bmp-14173451 \
  --dest-project my-new-live-project
```

이 단계는 쓰지 않고, 몇 개의 문서와 storage object가 이동 대상인지 요약만 보여준다.

## 5. 실제 이관

### 5-1. 인증

아래 둘 중 하나를 쓴다.

- ADC (`gcloud auth application-default login`)
- 혹은 source/destination 서비스 계정

사용 가능한 env:

- `SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON`
- `SOURCE_FIREBASE_SERVICE_ACCOUNT_BASE64`
- `SOURCE_FIREBASE_SERVICE_ACCOUNT_PATH`
- `DEST_FIREBASE_SERVICE_ACCOUNT_JSON`
- `DEST_FIREBASE_SERVICE_ACCOUNT_BASE64`
- `DEST_FIREBASE_SERVICE_ACCOUNT_PATH`

Storage bucket이 기본 이름이 아니면 아래도 지정한다.

- `SOURCE_FIREBASE_STORAGE_BUCKET`
- `DEST_FIREBASE_STORAGE_BUCKET`

### 5-2. commit 실행

```bash
SOURCE_FIREBASE_PROJECT_ID=mysc-bmp-14173451 \
DEST_FIREBASE_PROJECT_ID=my-new-live-project \
npx tsx scripts/firestore_live_cutover.ts migrate \
  --manifest scripts/firestore_live_cutover.manifest.sample.json \
  --source-project mysc-bmp-14173451 \
  --dest-project my-new-live-project \
  --commit
```

## 6. Vercel cutover

새 Firebase 프로젝트로 바꾸려면 production env를 같이 바꿔야 한다.

필수 client env:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

필수 server env:

- `FIREBASE_SERVICE_ACCOUNT_JSON` 또는 `FIREBASE_SERVICE_ACCOUNT_BASE64`

그 외:

- `VITE_DEFAULT_ORG_ID=mysc`
- Drive 연동을 그대로 쓸 거면 `GOOGLE_DRIVE_*` env는 유지 가능

## 7. 컷오버 후 검증

최소 검증:

1. 로그인
2. 프로젝트 목록 조회
3. 사업 등록 제안 제출
4. 계약서 업로드
5. 주간 사업비 입력 조회
6. 통장내역 / 예산 / 캐시플로우 조회
7. 증빙 업로드 / 동기화

## 8. 안전 원칙

- 기존 production Firebase를 직접 정리하지 않는다
- manifest 없이 전체 복사하지 않는다
- dry-run 확인 없이 `--commit` 하지 않는다
- cutover 직전엔 Vercel env와 Firebase Auth authorized domains를 같이 점검한다
