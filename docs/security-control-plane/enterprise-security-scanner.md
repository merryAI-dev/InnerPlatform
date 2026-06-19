# Enterprise Security Scanner

전사 GitHub, Firestore, Google Drive 보안 상태를 MYSCube가 직접 판정하지 않는다. 판정은 Python 보안 관제 워커가 수행하고, MYSCube 프론트는 Firestore에 저장된 finding과 asset을 읽어 보여주는 콘솔 역할만 맡는다.

## 위치

- Python 패키지: `scripts/security_control_plane/security_control_plane`
- 실행 진입점: `scripts/security_control_plane/run_scan.py`
- 룰 테스트: `scripts/security_control_plane/tests/test_rules.py`

## 사용하는 전문 라이브러리

- GitHub: `PyGithub`
- Firestore: `firebase-admin`
- Drive: `google-api-python-client`, `google-auth`
- Schema validation: `pydantic`

## 범위

- GitHub: `merryAI-dev` org 전체 repo
- Firestore: 현재 확인된 7개 Firebase 프로젝트 전체
- Drive: 접근 가능한 Shared Drive 전체
- Workspace 감사 로그: Google Workspace Admin Reports API 자격증명 추가 후 같은 워커에 확장

## 실행 예시

```bash
cd /Users/mysc/MYSCube
python3 -m venv .venv-security
. .venv-security/bin/activate
pip install -r scripts/security_control_plane/requirements.txt

export GITHUB_TOKEN=...
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
export GOOGLE_WORKSPACE_DELEGATED_ADMIN_EMAIL=admin@mysc.co.kr

python scripts/security_control_plane/run_scan.py \
  --output tmp/enterprise-security-report.json
```

운영 런타임은 Python 3.11 이상을 기준으로 한다. macOS 기본 Python 3.9에서는 Google SDK가 EOL 경고를 내므로 Cloud Run Job, GitHub Actions, 또는 별도 pyenv/uv 기반 3.11+ 환경에서 실행한다.

Firestore에 결과를 쓰려면:

```bash
python scripts/security_control_plane/run_scan.py \
  --write-firestore \
  --output tmp/enterprise-security-report.json
```

## 저장 컬렉션

중앙 프로젝트의 `orgs/{orgId}` 아래에 저장한다.

- `securityMonitoringRuns`
- `securityFindings`
- `securityAssets`

## 보안 원칙

- raw 이메일, Drive file ID, GitHub token은 저장하지 않는다.
- finding은 hash 식별자와 제한된 metadata만 저장한다.
- 프론트는 finding을 재판정하지 않는다.
- 외부 API 응답은 `pydantic` 모델로 정규화한 뒤 룰 엔진에 넘긴다.
- Drive/Workspace 전체 감사는 domain-wide delegation이 설정된 서비스 계정으로 실행한다.
- GitHub 토큰은 `GITHUB_TOKEN`을 우선 사용하고, 로컬에서는 `gh auth token`을 fallback으로 사용한다.
