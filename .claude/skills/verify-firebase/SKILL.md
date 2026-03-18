---
name: verify-firebase
description: Firebase 프로젝트 전환, 배포, cutover 전 정합성 검증. 환경변수, Auth, Firestore rules, members 일괄 점검.
argument-hint: "[선택사항: env|auth|rules|members|all]"
disable-model-invocation: true
---

# Firebase 정합성 검증

## 목적

Firebase 프로젝트 전환이나 프로덕션 배포 전에 자주 발생하는 문제를 사전 탐지합니다:

1. **Vercel env 개행 오염** — trailing `\n`이 값에 포함되어 Firebase 연결 실패
2. **Firebase UID 불일치** — 프로젝트마다 UID가 다르므로 members 등록 누락
3. **빈 문자열 쿼리** — documentId() 쿼리에 빈 문자열 전달
4. **Auth provider 미설정** — Google Sign-In 미활성화, Authorized domains 누락
5. **Firestore rules 배포 누락** — 새 프로젝트에 rules/indexes 미배포
6. **프로젝트 목록 필터링** — CONTRACT_PENDING 등 상태 필터가 전사 프로젝트 조회를 막음
7. **isRegistered 과도한 체크** — projectIds.length > 0 조건이 첫 로그인 사용자를 차단
8. **Vercel alias 누락** — `vercel --prod` 후 alias가 자동 안 붙어서 이전 배포를 가리킴
9. **gcloud 계정 전환** — 다른 사용자 계정으로 전환된 상태에서 SA 키 생성 실패
10. **@mysc.co.kr 자동 등록** — 첫 로그인 시 members에 없으면 PM으로 자동 등록 필요

## When to Run

- Firebase 프로젝트를 새로 만들거나 전환할 때
- Vercel env를 변경한 후
- 프로덕션 배포 전
- 로그인 실패, 데이터 안 보임 등 Firebase 관련 이슈 발생 시

---

## Workflow

### Step 1: Vercel env 개행 검사

```bash
vercel env pull /tmp/firebase-env-check --environment production
```

아래 변수들에 `\n`이 포함되어 있는지 검사:
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

PASS 조건: 모든 값에 `\n` suffix 없음
FAIL 조건: 하나라도 trailing newline 있음

→ 수정: `vercel env rm` + `printf 'value' | vercel env add`

### Step 2: Firebase 프로젝트 일치 검사

```bash
# .firebaserc의 default
cat .firebaserc | jq -r '.projects.default'

# Vercel env의 PROJECT_ID
grep VITE_FIREBASE_PROJECT_ID /tmp/firebase-env-check
```

PASS 조건: 두 값이 동일
FAIL 조건: 불일치 → 어느 쪽이 맞는지 확인 필요

### Step 3: Firebase Auth 사용자 등록 검사

```bash
# 현재 로그인 계정의 UID 확인
npx tsx -e "
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const app = initializeApp({ projectId: '<PROJECT_ID>' });
const auth = getAuth(app);
auth.getUserByEmail('<EMAIL>').then(u => console.log('UID:', u.uid));
"

# members 컬렉션에 해당 UID 존재 확인
npx tsx -e "
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: '<PROJECT_ID>' });
const db = getFirestore(app);
db.doc('orgs/mysc/members/<UID>').get().then(snap => {
  console.log('exists:', snap.exists);
  if (snap.exists) console.log('role:', snap.data().role);
});
"
```

PASS 조건: UID가 members에 존재하고 적절한 role 보유
FAIL 조건: members에 없음 → 새 UID로 등록 필요

### Step 4: Firestore rules 배포 상태 검사

```bash
npx firebase-tools deploy --only firestore:rules --project <PROJECT_ID> --dry-run
```

PASS 조건: dry-run 성공 (compilation OK)
FAIL 조건: 컴파일 에러 또는 미배포

### Step 5: Bootstrap admin 이메일 동기화 검사

```bash
# firestore.rules의 isBootstrapAdminEmail()
grep "isBootstrapAdminEmail" firebase/firestore.rules

# auth-bootstrap.ts의 DEFAULT_BOOTSTRAP_ADMIN_EMAILS
grep "DEFAULT_BOOTSTRAP_ADMIN_EMAILS" src/app/data/auth-bootstrap.ts
```

PASS 조건: 두 파일의 이메일 목록 동일
FAIL 조건: 불일치

### Step 6: Vercel alias 검사

```bash
curl -sI https://inner-platform.vercel.app | grep "last-modified"
```

PASS 조건: last-modified가 최근 배포 시각과 일치
FAIL 조건: 오래된 배포를 가리킴 → `vercel alias` 재설정

### Step 7: documentId 빈 문자열 검사

```bash
grep -rn "documentId()" src/app/data/ --include="*.ts" --include="*.tsx"
```

각 사용처에서 쿼리 대상 배열에 `.filter(Boolean)`이 있는지 확인.

PASS 조건: documentId() 미사용 또는 .filter(Boolean) 있음
FAIL 조건: `.filter(Boolean)` 누락

### Step 8: 프로젝트 목록 상태 필터 검사

```bash
grep -n "where.*status.*CONTRACT_PENDING\|where.*'status'" src/app/data/portal-store.tsx
```

PASS 조건: portal-store에서 프로젝트 목록 쿼리에 상태 필터 없음
FAIL 조건: CONTRACT_PENDING 등 필터 있음 → 전사 프로젝트 조회 차단

### Step 9: @mysc.co.kr 자동 등록 확인

```bash
grep -n "endsWith.*@mysc.co.kr" src/app/data/portal-store.tsx
```

PASS 조건: members에 없는 @mysc.co.kr 사용자 자동 등록 로직 있음
FAIL 조건: 자동 등록 없음 → 수동 등록 필요

### Step 10: gcloud 계정 확인

```bash
gcloud config get-value account
```

PASS 조건: `ai@mysc.co.kr` (Firebase 프로젝트 소유자)
FAIL 조건: 다른 계정 → `gcloud config set account ai@mysc.co.kr`

### Step 11: Vercel alias 최신 확인

```bash
vercel ls 2>&1 | head -5
curl -sI https://inner-platform.vercel.app | grep "last-modified"
```

PASS 조건: alias가 가장 최근 deployment를 가리킴
FAIL 조건: 오래된 배포 → `vercel alias <latest-url> inner-platform.vercel.app`

---

## 종합 보고서

```markdown
## Firebase 정합성 검증 결과

| 항목 | 상태 | 상세 |
|------|------|------|
| Vercel env 개행 | ✅/❌ | |
| 프로젝트 ID 일치 | ✅/❌ | |
| Auth UID 등록 | ✅/❌ | |
| Rules 배포 | ✅/❌ | |
| Bootstrap 이메일 동기화 | ✅/❌ | |
| documentId 빈 문자열 방어 | ✅/❌ | |
| 프로젝트 목록 필터 | ✅/❌ | |
| @mysc.co.kr 자동 등록 | ✅/❌ | |
| gcloud 계정 | ✅/❌ | |
| Vercel alias 최신 | ✅/❌ | |
```

---

## 예외사항

1. **로컬 개발 환경** — .env가 QA 프로젝트를 가리키는 건 정상 (프로덕션과 다를 수 있음)
2. **에뮬레이터 모드** — `VITE_FIREBASE_USE_EMULATORS=true`이면 Auth/Firestore 검사 불필요
3. **Cloud Run BFF** — BFF는 별도 서비스 계정을 사용하므로 members 검사 대상 아님

## Related Files

| File | Purpose |
|------|---------|
| `firebase/firestore.rules` | Firestore 보안 규칙 |
| `src/app/data/auth-bootstrap.ts` | Bootstrap admin 이메일 정의 |
| `src/app/data/portal-store.tsx` | 포털 데이터 로딩 (documentId 쿼리) |
| `src/app/config/feature-flags.ts` | Feature flag 파싱 |
| `.firebaserc` | Firebase 프로젝트 연결 |
| `vercel.json` | Vercel 배포 설정 |
