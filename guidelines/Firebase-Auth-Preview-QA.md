# Firebase Auth Preview QA

## 목적

랜덤 Vercel preview URL에서 `auth/unauthorized-domain`이 반복되는 문제를 줄이고,
stage 검수 URL과 Java API session 경로가 흔들리지 않도록 고정 stage alias 운영 기준을 정리한다.

기준일:

- 2026-03-12

현재 고정 stage alias:

- `https://inner-platform-stage-merryai-devs-projects.vercel.app`

## Vercel env 기준

Preview 환경변수:

- `VITE_FIREBASE_AUTH_ALLOWED_HOSTS=inner-platform-stage-merryai-devs-projects.vercel.app`
- `VITE_FIREBASE_AUTH_FALLBACK_URL=https://inner-platform-stage-merryai-devs-projects.vercel.app`
- `VITE_PLATFORM_API_ENABLED=true`
- `VITE_PLATFORM_API_BASE_URL=<absolute https Cloud Run Java API URL>`

금지:

- `VITE_PLATFORM_API_BASE_URL=/`
- `VITE_PLATFORM_API_BASE_URL=https://inner-platform-stage-merryai-devs-projects.vercel.app`
- `VITE_PLATFORM_API_BASE_URL=https://inner-platform.vercel.app`
- `VITE_PLATFORM_API_BASE_URL=http://localhost...`

이 값이 `/` 또는 Vercel 도메인이면 `/api/v1/auth/session`이 Java API가 아니라 Vercel BFF rewrite로 들어가서 로그인 후 session sync가 400으로 실패한다.

Java API Firebase project env는 분리한다.

- `JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID`: 브라우저 Firebase ID token을 발급한 Auth project와 일치해야 한다.
- `JVM_WEEKLY_FIRESTORE_PROJECT_ID`: Firestore 저장소 project를 명시한다.
- `JVM_WEEKLY_FIREBASE_PROJECT_ID` 하나만 바꾸는 방식은 로그인 수정 과정에서 저장소 project까지 이동시킬 수 있으므로 stage/live QA에서 반려한다.

## Firebase Console 점검 기준

위치:

- Firebase Console
- Authentication
- Settings
- Authorized domains

최소 확인 대상:

- `localhost`
- `inner-platform-stage-merryai-devs-projects.vercel.app`

선택 확인 대상:

- 실제 운영에 쓰는 production 도메인
- 장기 유지 브랜치 alias

주의:

- 랜덤 URL 예: `inner-platform-xxxxxxxxx-merryai-devs-projects.vercel.app`
- 이런 주소는 매번 바뀌므로 Authorized domains 운영 대상으로 삼지 않는다.
- Stage/QA 확인 링크로도 랜덤 preview URL을 전달하지 않는다.
- Preview 배포가 랜덤 URL로 생성되면 반드시 고정 preview alias에 연결한 뒤 그 alias만 공유한다.
- Firebase Auth가 켜진 환경에서 임시 URL을 공유하면 Google 로그인 단계에서 `auth/unauthorized-domain`이 발생할 수 있으므로, 임시 URL은 artifact 디버깅 용도로만 내부 확인한다.
- Java API Cloud Run CORS allowlist에는 stage alias origin이 반드시 포함되어야 한다.
- `Cross-Origin-Opener-Policy`의 `window.closed`/`window.close` 콘솔 경고는 Firebase popup에서 발생할 수 있지만, 실제 로그인 실패 판단은 `/api/v1/auth/session` 응답 상태와 CORS preflight로 한다.

## 기대 동작

### 1. 랜덤 preview URL

예:

- `https://inner-platform-bbig48qgr-merryai-devs-projects.vercel.app`

정상 동작:

- 로그인 화면 상단에 안내 배너가 보인다.
- Google 로그인 버튼이 비활성화된다.
- `고정 preview로 이동` 버튼이 보인다.
- 버튼 클릭 시 고정 preview alias로 이동한다.
- Firebase popup이 뜨지 않는다.
- `auth/unauthorized-domain` 메시지를 직접 맞지 않는다.

비정상:

- 랜덤 preview에서 Google popup이 열린다.
- `허용되지 않은 도메인` 에러가 그대로 뜬다.
- fallback URL이 비어 있어 이동 버튼이 보이지 않는다.

### 2. 고정 preview alias

예:

- `https://inner-platform-stage-merryai-devs-projects.vercel.app`

정상 동작:

- 로그인 버튼이 활성화된다.
- Google popup이 열린다.
- Firebase `unauthorized-domain` 에러가 나지 않는다.
- `/api/v1/auth/session`이 Cloud Run Java API로 요청되고 2xx를 반환한다.
- Cloud Run Java API의 `JVM_WEEKLY_FIREBASE_AUTH_PROJECT_ID`가 frontend `VITE_FIREBASE_PROJECT_ID`와 일치한다.
- Cloud Run Java API의 `JVM_WEEKLY_FIRESTORE_PROJECT_ID`가 의도한 Firestore storage project와 일치한다.
- `@mysc.co.kr`가 아닌 계정으로 로그인하면 회사 계정 제한 안내가 나온다.

비정상:

- 로그인 버튼이 비활성화된 채 남아 있다.
- `Firebase Auth에서 허용되지 않은 도메인` 에러가 발생한다.
- `/api/v1/auth/session`이 400을 반환한다.
- `/api/v1/auth/session`이 Vercel BFF로 rewrite된다.
- 배너가 고정 preview에서도 계속 뜬다.

### 3. localhost

예:

- `http://localhost:5173`

정상 동작:

- 로그인 버튼이 활성화된다.
- preview 차단 배너가 나오지 않는다.

## 배포 후 확인 순서

1. `vercel env pull <env-file> --environment=preview --scope merryai-devs-projects --yes`
2. `node scripts/verify_weekly_direct_vercel_env.mjs <env-file>` 로 `VITE_PLATFORM_API_BASE_URL`이 Java API Cloud Run URL인지 확인
3. `vercel deploy --archive=tgz --scope merryai-devs-projects --yes`
4. Preview 배포 URL이 생성되면 `npx vercel alias set <deployment-host> inner-platform-stage-merryai-devs-projects.vercel.app --scope merryai-devs-projects` 로 고정 alias를 갱신
5. `vercel inspect inner-platform-stage-merryai-devs-projects.vercel.app --scope merryai-devs-projects` 로 alias가 최신 deployment를 바라보는지 확인
6. Firebase Auth Authorized Domains에 `inner-platform-stage-merryai-devs-projects.vercel.app`이 있는지 확인
7. Cloud Run Java API CORS allowlist에 `https://inner-platform-stage-merryai-devs-projects.vercel.app`이 있는지 확인
8. 고정 stage alias 접속
9. Google 로그인 후 `/api/v1/auth/session` 2xx, CORS preflight 2xx, member profile sync 정상 여부 확인

## Live 배포 전 추가 확인

Live 배포 전에는 production env도 같은 기준으로 검증한다.

```bash
npx vercel env pull /tmp/inner-platform-production.env --environment=production --scope merryai-devs-projects --yes
WEEKLY_DIRECT_API_HOST_ALLOWLIST=<approved-java-api-host> node scripts/verify_weekly_direct_vercel_env.mjs /tmp/inner-platform-production.env
```

Live에서 금지되는 상태:

- `VITE_PLATFORM_API_BASE_URL=/`
- `VITE_PLATFORM_API_BASE_URL`이 `*.vercel.app`
- `VITE_PLATFORM_API_ENABLED`가 `true`가 아님
- production URL이 Firebase Auth Authorized Domains에 없음
- production URL이 Java API CORS allowlist에 없음

## 관련 코드

- `src/app/platform/preview-auth.ts`
- `src/app/components/auth/LoginPage.tsx`
- `src/app/data/auth-store.tsx`
- `src/app/platform/api-session.ts`
- `scripts/verify_weekly_direct_vercel_env.mjs`
