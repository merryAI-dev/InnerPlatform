# Firebase 화이트해킹 시연

이 시연은 승인된 MYSC Firebase 보안 검증용입니다.

목적은 Firebase Auth, Firestore Rules, Storage Rules가 일반적인 비인가 접근을 실제로 차단하는지 확인하는 것입니다. 의도적으로 비파괴 방식으로 설계했습니다.

- Firestore/Storage 응답 본문을 출력하지 않습니다.
- 실제 문서를 덤프하지 않습니다.
- 보호 대상에서 `200 OK`가 나오면 즉시 `FAIL_OPEN`으로 판정합니다.
- 쓰기 시도는 `--allow-write-probes`를 명시한 경우에만 실행합니다.
- 운영으로 보이는 프로젝트 ID는 `--allow-prod` 없이는 실행하지 않습니다.

## 실행

읽기 전용 프로브:

```sh
npm run security:firebase:whitehat
```

운영/라이브 읽기 전용 프로브:

```sh
npm run security:firebase:whitehat -- --allow-prod
```

차단 기대 쓰기 canary 프로브:

```sh
npm run security:firebase:whitehat -- --allow-prod --allow-write-probes
```

## 리포트

실행 결과는 아래 경로에 저장됩니다.

```text
tmp/firebase-whitehat-demo/
```

각 실행은 두 파일을 만듭니다.

- 임원/시연용 Markdown 리포트
- 상태 코드, 바이트 길이, 본문 해시를 담은 JSON 증적

## 검증 범위

- 비인증 Firestore 멤버십 문서 읽기
- 비인증 프로젝트 컬렉션 목록 조회
- BFF 전용 contacts 컬렉션 직접 읽기
- 비인증 audit_logs 읽기
- 최상위 tenants 탐색
- 가짜 Bearer token 인증 우회
- Firebase Auth 가짜 idToken 조회
- Storage business-cards 원본 이미지 경로 직접 읽기

## 안전 경계

이 도구는 데이터 추출 도구가 아닙니다. 어떤 프로브라도 `200`을 반환하면 본문을 출력하지 않고 `FAIL_OPEN`으로 표시해 즉시 검토 대상으로 올립니다.
