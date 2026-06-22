# Firebase 화이트해킹 시연 결과

- 실행일: 2026-06-22
- 대상 Firebase project: `inner-platform-live-20260316`
- 대상 org: `mysc`
- 모드: 읽기 + 차단 기대 쓰기 canary
- 총 프로브: 8
- PASS: 8
- FAIL_OPEN: 0
- REVIEW: 0

## 요약

운영 Firebase 공개 API를 대상으로 비인가 접근 시나리오를 실행했습니다.

결과적으로 보호 대상 경로에서 `200 OK`는 발생하지 않았고, Firestore/Storage/Auth가 모두 비인가 접근을 차단했습니다.

본문 데이터는 출력하지 않았습니다. JSON 증적에는 상태 코드, 응답 바이트 길이, 응답 본문 SHA-256 해시만 남겼습니다.

## 결과 표

| 결과 | HTTP 상태 | 프로브 | 위험 | 대상 |
| --- | ---: | --- | --- | --- |
| PASS | 403 | `firestore-unauth-members-read` | 테넌트 멤버십 노출 | `orgs/mysc/members/whitehat-canary-deny-probe` |
| PASS | 403 | `firestore-unauth-projects-list` | 사업 데이터 대량 노출 | `orgs/mysc/projects?pageSize=1` |
| PASS | 403 | `firestore-bff-only-contacts-read` | 명함/연락처 PII 노출 | `orgs/mysc/contacts/whitehat-canary-deny-probe` |
| PASS | 403 | `firestore-audit-logs-read` | 보안 감사 로그 노출 | `orgs/mysc/audit_logs/whitehat-canary-deny-probe` |
| PASS | 403 | `firestore-top-level-tenants-read` | 테넌트 목록 탐색 | `tenants/whitehat-canary-deny-probe` |
| PASS | 401 | `firestore-fake-token-projects-list` | 가짜 토큰 인증 우회 | `orgs/mysc/projects?pageSize=1` |
| PASS | 403 | `storage-business-card-direct-read` | 명함 원본 이미지 노출 | `orgs/mysc/business-cards/whitehat-canary-deny-probe.png` |
| PASS | 403 | `firestore-unauth-write-canary` | 비인가 데이터 변조 | `orgs/mysc/whitehat_canary/whitehat-canary-deny-probe` |

## 시연 메시지

“실제 운영 Firebase 공개 API를 대상으로 익명 접근, 가짜 토큰, 민감 컬렉션 직접 접근, 비인가 쓰기 시도를 수행했습니다. 모든 시도는 401 또는 403으로 차단되었고, 보호 경로에서 200 응답은 없었습니다.”

## 한계

- 이 검증은 비인가 외부자 관점의 공개 API 프로브입니다.
- 정상 로그인한 내부 사용자의 과도한 조회, 크롤링, 대량 다운로드는 별도 관제와 rate limit, 감사 로그로 다뤄야 합니다.
- Firestore Admin SDK 권한을 가진 서버/서비스 계정 탈취 시나리오는 별도 키 관리와 IAM 감사가 필요합니다.
