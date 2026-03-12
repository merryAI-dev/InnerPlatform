# Firebase Auth Preview QA

## 목적

랜덤 Vercel preview URL에서 `auth/unauthorized-domain`이 반복되는 문제를 줄이기 위해,
로그인은 고정 preview alias에서만 허용하고 랜덤 preview에서는 안내 후 이동시키는 운영 기준을 정리한다.

기준일:

- 2026-03-12

현재 고정 preview alias:

- `https://inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app`

## Vercel env 기준

Preview 환경변수:

- `VITE_FIREBASE_AUTH_ALLOWED_HOSTS=inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app`
- `VITE_FIREBASE_AUTH_FALLBACK_URL=https://inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app`

## Firebase Console 점검 기준

위치:

- Firebase Console
- Authentication
- Settings
- Authorized domains

최소 확인 대상:

- `localhost`
- `inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app`

선택 확인 대상:

- 실제 운영에 쓰는 production 도메인
- 장기 유지 브랜치 alias

주의:

- 랜덤 URL 예: `inner-platform-xxxxxxxxx-merryai-devs-projects.vercel.app`
- 이런 주소는 매번 바뀌므로 Authorized domains 운영 대상으로 삼지 않는다.

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

- `https://inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app`

정상 동작:

- 로그인 버튼이 활성화된다.
- Google popup이 열린다.
- Firebase `unauthorized-domain` 에러가 나지 않는다.
- `@mysc.co.kr`가 아닌 계정으로 로그인하면 회사 계정 제한 안내가 나온다.

비정상:

- 로그인 버튼이 비활성화된 채 남아 있다.
- `Firebase Auth에서 허용되지 않은 도메인` 에러가 발생한다.
- 배너가 고정 preview에서도 계속 뜬다.

### 3. localhost

예:

- `http://localhost:5173`

정상 동작:

- 로그인 버튼이 활성화된다.
- preview 차단 배너가 나오지 않는다.

## 배포 후 확인 순서

1. `vercel env ls` 에서 Preview env 두 개가 보이는지 확인
2. `vercel inspect <latest deployment>` 로 alias가 `inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app` 인지 확인
3. 랜덤 preview URL 접속
4. 안내 배너, 버튼 비활성화, 고정 preview 이동 버튼 확인
5. 고정 preview alias 접속
6. Google 로그인 정상 여부 확인

## 관련 코드

- `src/app/platform/preview-auth.ts`
- `src/app/components/auth/LoginPage.tsx`
- `src/app/data/auth-store.tsx`
