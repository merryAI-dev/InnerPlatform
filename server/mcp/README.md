# MYSCube MCP

`cashflow_status`만 제공하는 읽기 전용 MCP입니다. 정산 데이터는 브라우저·Playwright·화면 크롤링이 아니라 BFF→JVM의 기존 정산 조회 경로에서만 읽습니다.

## 연결

Claude의 MCP 설정에서 다음처럼 `node server/mcp/server.mjs`를 실행합니다. 처음 도구를 호출하면 launcher가 브라우저를 열고, MYSCube Firebase 로그인 뒤 PKCE OAuth를 완료합니다. 토큰은 프로세스 메모리에만 보관합니다.

```json
{
  "mcpServers": {
    "myscube": {
      "command": "node",
      "args": ["/absolute/path/to/MYSCube/server/mcp/server.mjs"]
    }
  }
}
```

실행 환경에는 다음만 설정합니다.

- `MYSCUBE_BFF_BASE_URL`: `https://myscube.myscguard.app`

`MYSCUBE_ID_TOKEN`, `MYSCUBE_TENANT_ID`는 더 이상 설정하지 않습니다. Firestore service-account JSON, Slack token, GitHub token, JVM service token은 설정하거나 전달하지 않습니다. `.env`는 저장소에 커밋하지 않습니다.

## Remote MCP (Claude)

배포된 BFF의 `https://myscube.myscguard.app/mcp`를 Remote MCP 주소로 등록합니다. 서버는 OAuth discovery와 Dynamic Client Registration, Authorization Code + PKCE(S256)를 제공합니다. Claude가 로그인하면 `/mcp/authorize`에서 기존 Firebase 로그인 세션으로 확인하고, BFF가 10분짜리 opaque access token을 발급합니다.

운영 환경에는 두 public URL을 동일한 정식 도메인으로 설정합니다.

```dotenv
MYSCUBE_MCP_OAUTH_ISSUER=https://myscube.myscguard.app
MYSCUBE_MCP_PUBLIC_ORIGIN=https://myscube.myscguard.app
```

## 권한과 감사

Firebase ID token은 같은 출처의 로그인 완료 요청에만 사용되고 redirect·Claude 설정·환경변수에 남지 않습니다. OAuth code와 access token은 Firestore에 SHA-256 해시만 저장합니다. MCP는 `x-actor-*` 헤더를 만들지 않으며, opaque token은 BFF가 활성 구성원 컨텍스트로 해석한 뒤에만 JVM trusted header로 변환합니다. JVM은 프로젝트 배정과 권한을 다시 검사합니다. stderr 감사 로그에는 token·금액·프로젝트명을 남기지 않습니다.

## 다음 단계

GitHub, Firestore 직접 접근, Slack 발송은 포함하지 않습니다. Slack 리마인드는 별도 승인·권한 모델로 추가해야 합니다.
