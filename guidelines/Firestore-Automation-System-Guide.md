# Firestore Automation System Guide (Non-Developer Friendly)

## 1) 이 문서는 누구를 위한가?

- 개발자가 아니지만 Firebase/Firestore 운영 작업을 맡은 PM, 운영 담당자, QA.
- "명령어를 언제/왜/어떻게 써야 하는지"를 빠르게 이해해야 하는 팀원.

## 2) 이 시스템의 목표

- 반복되는 Firestore 운영 작업을 사람 의존이 아닌 스크립트 중심으로 표준화.
- 실수하기 쉬운 `.env`, `.firebaserc`, 인덱스 배포, 백업 리허설을 체크리스트화.
- 장애 시 재현 가능한 복구 절차 확보.

## 3) 자동화 범위 한눈에 보기

| 영역 | 자동화 스크립트 | 결과물/효과 |
| --- | --- | --- |
| 로그인 안정화 | `firebase:login:daemon:*` | 인증 세션 끊김 최소화 |
| 초기 세팅 원샷 | `firebase:autosetup` | `.env`, `.firebaserc`, rules/indexes 배포 |
| 배포 최소 단위 | `firebase:deploy:indexes` | 인덱스만 빠르게 반영 |
| 로컬 검증 | `firebase:emulators:*` | 안전한 테스트 환경 구성 |
| 백업 운영 | `firestore:backup:*` | 스케줄 생성/복구 리허설 |
| 보안 운영 | `pii:setup:vercel`, `pii:rotate` | PII 키 배포/순환 |

## 4) 가장 안전한 실행 순서 (처음 세팅)

1. Node 버전 맞추기  
   `nvm use 24`
2. 의존성 설치  
   `npm install`
3. Firebase 로그인(권장: daemon)
   - `npm run firebase:login:daemon:start`
   - 브라우저에서 코드 복사
   - `npm run firebase:login:daemon:submit -- '<authorization-code>'`
4. 로그인 확인  
   `npm run firebase:whoami`
5. 원샷 자동 세팅  
   `npm run firebase:autosetup`
6. Google 로그인 Provider 활성화(콘솔)
   - `npm run firebase:open:google-auth`
   - Firebase Console에서 Google Provider를 `Enable`
7. 앱 실행 확인  
   `npm run dev`

## 5) 일상 운영 시나리오

### A. 인덱스만 빠르게 반영하고 싶다

- 실행: `npm run firebase:deploy:indexes`
- 사용 시점: 신규 쿼리 추가, 복합 인덱스 누락 오류 발생 시.
- 확인 방법: Firebase CLI에서 indexes deploy 성공 메시지 확인.

### B. 운영 백업 정책을 설정하고 싶다

- 실행: `npm run firestore:backup:schedule`
- 사용 시점: 새 프로젝트 온보딩 직후, 보존기간 변경 시.
- 필수 조건: `FIREBASE_PROJECT_ID` 또는 `GOOGLE_CLOUD_PROJECT` 설정 + gcloud 권한.

### C. 복구 가능한지 리허설하고 싶다

- 실행: `npm run firestore:backup:rehearsal`
- 사용 시점: 월간/분기 DR(Disaster Recovery) 점검.
- 동작: 최신 READY 백업을 별도 데이터베이스로 복원 요청.

### D. Vercel에 PII 키를 한번에 반영하고 싶다

- 실행:
  - `npm run pii:setup:vercel`
  - `npm run pii:setup:vercel -- --push`
- 동작: 로컬 키링 생성 + Vercel env(production/preview/development) 반영.
- 주의: 최초 1회 `vercel login`, `vercel link` 필요.

## 6) 사람이 수동으로 해야 하는 항목

- Firebase Console에서 Google Provider 활성화.
- 조직 정책/IAM 권한 승인(보안팀 또는 관리자 승인 필요).
- 운영 배포 승인(서비스 영향도가 큰 경우 CAB/승인 프로세스).

## 7) 성공/실패 판단 기준

### 성공 기준

- `.env`와 `.firebaserc`가 생성 또는 최신 상태.
- Firestore rules/indexes deploy 성공 로그 확인.
- `firebase:whoami`로 계정 확인 가능.
- 백업 스케줄 조회 시 항목이 출력됨.

### 실패 기준

- 인증 오류 반복(`Unable to verify client`, `No authorized accounts`).
- project id 해석 실패.
- emulator 실행 조건(Java 21+) 미충족.

## 8) 자주 나는 오류와 복구 절차

### `Unable to verify client`

- 의미: 인증 코드가 현재 세션과 맞지 않거나 만료됨.
- 복구:
  1. `npm run firebase:login:daemon:start`
  2. 새 코드 발급 즉시 submit
  3. 이전 코드 재사용 금지

### `No authorized accounts`

- 의미: Firebase CLI 로그인 상태 없음.
- 복구:
  1. `npm run firebase:login`
  2. 또는 daemon login 재수행

### `Could not resolve Firebase project id`

- 의미: `.env`/`.firebaserc`에서 프로젝트 식별 실패.
- 복구:
  1. `npm run firebase:autosetup`
  2. 필요 시 `.env`의 `VITE_FIREBASE_PROJECT_ID` 수동 확인

### `Java 21+ is required`

- 의미: Firestore emulator 구동 조건 미충족.
- 복구:
  1. `brew install openjdk@21`
  2. 터미널 재시작 후 재실행

## 9) 분기별 운영 체크리스트 (권장)

1. 인덱스 상태 점검 및 필요 시 `firebase:deploy:indexes` 실행.
2. 백업 스케줄/보존기간 재검토.
3. 복구 리허설 1회 실행 후 결과 기록.
4. PII 키 로테이션 정책 준수 여부 확인.
5. 운영 문서와 실제 명령어 불일치 여부 점검.

## 10) PR에 포함되어야 하는 운영 증거

- 실행한 명령 목록.
- 성공 로그 요약(민감정보 제외).
- 실패/복구 기록(있다면 원인과 조치).
- 수동 작업이 남은 경우 "누가 언제 할지" 명시.

## 11) 관련 문서

- `README.md`
- `guidelines/TIL-Firebase-Daemon-Setup.md`
- `guidelines/Operational-Hardening-Runbook.md`
- `guidelines/Data-Stability-Implemented.md`
