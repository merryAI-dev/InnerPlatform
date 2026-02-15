## PR 요약

이 PR이 해결하는 문제와 기대 효과를 3줄 이내로 작성하세요.

- 문제:
- 해결:
- 기대 효과:

## 변경 범위

- [ ] 프론트엔드(UI/페이지)
- [ ] BFF/API
- [ ] Firebase/Firestore 설정
- [ ] 운영 스크립트(scripts)
- [ ] 워커/스케줄링(outbox/work_queue)
- [ ] 문서(README/guidelines)
- [ ] 기타

## 비개발자용 설명

개발자가 아닌 운영 담당자 관점에서, "무엇이 어떻게 달라졌는지"를 쉽게 설명하세요.

## Firestore 자동화 실행 증거 (해당 시 필수)

실행한 명령과 결과를 적어주세요. 민감정보는 제외하세요.

```bash
# 예시
npm run firebase:whoami
npm run firebase:autosetup
npm run firebase:deploy:indexes
npm run firestore:backup:schedule
npm run bff:outbox:worker
npm run bff:work-queue:worker
```

- 실행 일시:
- 실행자:
- 대상 프로젝트 ID:
- 성공 로그 요약:
- 실패/재시도 내역:

## 테스트/검증

- [ ] `npm test` 통과
- [ ] `npm run build` 통과
- [ ] 기능 수동 검증 완료
- [ ] 문서와 실제 동작 일치 확인

검증 결과 요약:

## 수동 작업 필요 항목 (운영/관리자)

자동화로 처리되지 않는 작업을 반드시 명시하세요.

- [ ] Firebase Console에서 Google Provider 활성화 확인
- [ ] IAM/보안 승인 확인
- [ ] Vercel 환경변수 반영 후 redeploy
- [ ] Vercel Cron 또는 외부 워커 런타임 구성(outbox/work_queue)
- [ ] 기타:

## 위험도 및 롤백 계획

- 영향 범위:
- 예상 리스크:
- 롤백 방법:

## 체크리스트

- [ ] 민감정보(.env, key, token) 커밋 없음
- [ ] `.gitignore` 확인 완료
- [ ] PR 본문에 운영 증거 포함
- [ ] 필요한 후속 작업(담당자/기한) 명시
