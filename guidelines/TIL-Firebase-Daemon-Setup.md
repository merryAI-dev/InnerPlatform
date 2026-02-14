# TIL: Firebase 자동화 메뉴판 (Daemon Login 포함)

## 배경

원격/에이전트 환경에서는 `firebase login --no-localhost` 프롬프트 세션이 자주 끊겨 인증 코드가 무효화된다.  
이 레포는 **daemon 로그인 방식**으로 이를 안정화하고, Firebase 초기 세팅을 메뉴처럼 재사용 가능하게 구성했다.

## 자동화 메뉴 (이 레포에서 바로 실행)

### 메뉴 A: 세션 끊김 없는 로그인

```bash
npm run firebase:login:daemon:start
npm run firebase:login:daemon:submit -- '<authorization-code>'
npm run firebase:login:daemon:status
```

### 메뉴 B: 프로젝트/웹앱/.env/룰 배포 원샷

```bash
npm run firebase:autosetup
```

생성되는 `.env`에는 멀티테넌시 강제 플래그가 포함된다:

```bash
VITE_TENANT_ISOLATION_STRICT=true
```

### 메뉴 C: 콘솔에서 복사한 Firebase Config로 즉시 채우기

```bash
npm run firebase:fill-env -- '{"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"..."}'
```

### 메뉴 D: Google 로그인 Provider 페이지 바로 열기

```bash
npm run firebase:open:google-auth
```

### 메뉴 E: 로컬 Emulator 모드

```bash
npm run firebase:emulators:prepare
npm run firebase:emulators:start
```

### 메뉴 F: BFF API + 실데이터 통합 테스트

```bash
npm run bff:dev
npm run bff:seed:demo
npm run bff:test:integration
```

### 메뉴 G: BFF 운영 작업

```bash
# 만료된 idempotency key 정리
npm run bff:cleanup:idempotency

# outbox 재처리 워커
npm run bff:outbox:worker

# Cloud Run 배포
npm run bff:deploy:cloud-run
```

### 메뉴 H: Firestore 인덱스/백업 운영

```bash
# 복합 인덱스만 배포
npm run firebase:deploy:indexes

# 백업 스케줄 생성/갱신
npm run firestore:backup:schedule

# 최신 백업 복구 리허설(별도 DB로 restore)
npm run firestore:backup:rehearsal
```

### 메뉴 I: SLO/알림 자동 세팅

```bash
# 예: 슬랙/메일 notification channel 지정 후 알림 정책 생성
export MONITORING_NOTIFICATION_CHANNELS='projects/<project>/notificationChannels/<id>'
npm run monitoring:setup:alerts
```

### 메뉴 J: PII/정책 검증

```bash
# RBAC 정책 파일 검증
npm run policy:verify

# PII 키 로테이션(현재 키로 재암호화)
npm run pii:rotate
```

### 메뉴 K: Vercel 전용 PII 키 자동 세팅 (GCP 없이)

```bash
# 1) 로컬 키링 파일 생성(.env.pii.local)
npm run pii:setup:vercel

# 2) Vercel 프로젝트 env(production/preview/development) 일괄 반영
npm run pii:setup:vercel -- --push
```

- 최초 1회 `vercel login` + `vercel link --project <name> --scope <team>` 필요.
- 키 교체 시 같은 명령을 다시 실행하면 기존 key-id 항목을 교체한다.
- `.env.pii.local`은 저장소에 커밋하지 않는다.

## 다른 프로젝트로 복붙해서 쓰는 방법

1. 아래 파일을 새 프로젝트에 복사:
   - `scripts/firebase_login_daemon.mjs`
   - `scripts/firebase_autosetup.sh`
   - `scripts/firebase_fill_env_from_config.sh`
   - `scripts/firebase_open_google_auth_provider.sh`
2. `package.json`에 scripts 추가:
   - `firebase:login:daemon:start`
   - `firebase:login:daemon:submit`
   - `firebase:login:daemon:status`
   - `firebase:autosetup`
   - `firebase:open:google-auth`
3. `firebase.json`, `firebase/firestore.rules`, `firebase/firestore.indexes.json`를 프로젝트 정책에 맞게 수정.

## Firebase 서비스 확장 메뉴 (템플릿 명령)

```bash
# Storage rules 배포
npx firebase-tools deploy --only storage --project <project-id>

# Hosting 배포
npx firebase-tools deploy --only hosting --project <project-id>

# Functions 배포
npx firebase-tools deploy --only functions --project <project-id>

# 특정 Functions만 배포
npx firebase-tools deploy --only functions:<name> --project <project-id>
```

## 자주 나는 오류

- `Unable to verify client`: 로그인 URL(`session`/`attest`) 변형 또는 만료. 새 세션 생성 후 즉시 재시도.
- `Unable to authenticate using the provided code`: 코드-세션 불일치/만료. 새 daemon 세션에서 다시 진행.
- `mapfile: command not found`: macOS Bash 3 환경. 이 레포 스크립트는 호환 패치됨.
- Node 경고: `nvm use 24` 권장.

## 원샷 프롬프트 템플릿

### 한국어

```text
이 레포에 Firebase를 자동화 메뉴판 방식으로 세팅해줘.
요구사항:
1) daemon 로그인(start/submit/status) 추가
2) autosetup으로 .env/.firebaserc/WebApp/Firestore rules-indexes 자동화
3) Google Auth provider 콘솔 바로가기 스크립트 추가
4) Emulator 준비/실행 흐름 포함
5) 다른 프로젝트에 복붙 가능한 TIL 문서 작성
6) 마지막에 test/build/firebase whoami 결과 보고
```

```text
추가 요구:
7) Firestore 복합 인덱스(projectId+ledgerId 포함) 명시 + 인덱스 전용 배포 스크립트
8) 감사로그 해시체인 + 위변조 검증 API
9) Outbox 패턴 + 재처리 워커(재시도/DEAD 상태)
10) 백업 스케줄/복구 리허설 스크립트
11) 5xx/latency/conflict rate 알림 자동화
12) 동시성 경쟁 통합테스트(TDD)
13) PII 암호화(KMS/로컬) + 키 로테이션 스크립트
14) 권한변경 감사 + 정책-as-code 검증 파이프라인
```

### English

```text
Set up Firebase in this repo as a reusable automation menu.
Requirements:
1) Add daemon login flow (start/submit/status)
2) Add autosetup for .env/.firebaserc/Web app/Firestore rules+indexes
3) Add Google Auth provider console shortcut script
4) Include emulator prepare/start flow
5) Write a reusable TIL markdown for porting to other repos
6) Validate with test/build/firebase whoami and report outputs
```
