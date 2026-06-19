# Cloudflare 앞단 WAF 전환 Runbook

Status: `approved` — `myscguard.app` 보안 도메인 POC의 final proxy cutover에 한해 승인됐다. `mysc.co.kr` 변경, 제품 도메인 교체, Enterprise-only 기능 적용은 별도 승인 대상이다.

목표: 보안/DevOps/Google Drive/GitHub/Firestore 관제용 control plane을 Cloudflare proxied custom domain 뒤에서 운영한다. Cloudflare가 TLS를 종료하고 WAF/DDoS/rate limit을 적용한 뒤 Vercel control-plane app으로 전달한다.

예산 결정: 1차 POC는 Cloudflare Pro `USD 20/month`와 보안/DevOps 전용 도메인 1개를 사용한다. `mysc.co.kr`는 건드리지 않는다. Vercel Advanced Deployment Protection, Vercel Enterprise는 이번 범위에서 제외한다.

## 현재 확인된 Vercel 앱 후보

`vercel project list --scope merryai-devs-projects --format json` 기준 현재 16개 프로젝트가 확인됐다. 아래 6개만 보호하면 부족하다.

authoritative inventory는 다음 명령으로 다시 생성한다.

```bash
node scripts/collect_vercel_edge_inventory.mjs
```

주의:

- `mysc-merry`가 아니라 현재 프로젝트명은 `mysc-merry-inv`로 확인됐다.
- `submit-mysc.com`은 이미 존재하며 `inner-platform` production alias로 보인다.
- `server/bff/runtime-safety.mjs`의 기본 live allowed origin은 `https://myscube.myscguard.app`이다. 임시 rollback/cutover 예외는 `BFF_LIVE_ALLOWED_ORIGINS`에 명시해야 한다.

## 구조

```text
User
  -> Cloudflare DNS proxied record
  -> Cloudflare TLS termination + WAF + DDoS + rate limit
  -> Vercel custom domain / Firebase origin
  -> App / BFF / Firebase auth helper
```

`*.vercel.app`는 Cloudflare zone에서 직접 프록시할 수 없다. 운영은 `myscube.myscguard.app` 같은 커스텀 도메인을 Vercel 프로젝트에 등록하고, Cloudflare DNS에서 해당 hostname을 proxied CNAME으로 관리해야 한다.

## 적용 순서

0. [Cloudflare/Vercel Production Gates](./cloudflare-production-gates.md) 통과
1. `myscguard.app` Cloudflare zone id 확인 완료
2. 각 Vercel project에 custom domain 등록
3. Cloudflare DNS에 proxied CNAME 추가
4. SSL/TLS mode를 `Full (strict)`로 설정
5. Cloudflare managed WAF + OWASP ruleset 활성화
6. privileged route managed challenge 적용
7. login/auth/API rate limit 적용
8. Vercel allowed origin/auth redirect URI를 커스텀 도메인으로 갱신
9. `*.vercel.app` 링크를 운영 문서/Slack/앱 설정에서 제거
10. MYSCube 보안 관제에 Cloudflare 로그/방화벽 이벤트 ingestion 추가. 이 항목은 cutover 이후가 아니라 pre-prod gate다.
11. Vercel project-level routes를 publish한 경우 Vercel이 생성한 `*-routes-merryai-devs-projects.vercel.app` alias를 제거하고 `404 DEPLOYMENT_NOT_FOUND`를 확인한다.

## 기본 POC: 보안/DevOps 전용 도메인

1차 POC는 `myscguard.app` 같은 보안/DevOps 전용 도메인을 사용한다. 이 도메인은 MYSCube 제품 운영 도메인이 아니라 내부 보안 관제/control-plane 도메인이다.

후보:

| Hostname | Role | Vercel project |
|---|---|
| `myscube.myscguard.app` | 보안 관제 메인 콘솔 | `inner-platform` |
| `devops.myscguard.app` | 배포/infra 운영 | `inner-platform` |
| `drive.myscguard.app` | Google Drive 권한/공유 관제 | `inner-platform` |
| `github.myscguard.app` | GitHub repo/Actions/secret 관제 | `inner-platform` |
| `firestore.myscguard.app` | Firestore rules/access/anomaly 관제 | `inner-platform` |
| `audit.myscguard.app` | 감사/증적 뷰 | `inner-platform` |
| `edge.myscguard.app` | WAF/canary 테스트 | `inner-platform` |

주의:

- `myscguard.app`은 `cube` 공식 운영 도메인이 아니다.
- `mysc.co.kr` DNS/메일/Google Workspace는 건드리지 않는다.
- `myscguard.app`은 Cloudflare Registrar에서 등록 완료된 도메인이다. Zone id는 Cloudflare dashboard에서 확인해 로컬 `infra/cloudflare/production.tfvars`에 반영했다.
- Vercel custom domain은 `inner-platform` production deployment에 alias로 연결했다. Vercel CLI는 각 hostname에 `A 76.76.21.21` DNS 레코드를 요구했다.
- Cloudflare final proxy apply는 완료됐다. 7개 `myscguard.app` host가 Cloudflare edge를 통과하고, scanner path/query smoke는 `403`을 반환한다.
- Vercel direct host 보상통제는 project-level routes를 사용한다. `inner-platform.vercel.app`, stage alias, current generated production URL은 `307`로 `https://myscube.myscguard.app`에 보낸다.
- Vercel routes publish 후 생성되는 route-version alias는 project-level route가 적용되지 않으므로 publish 직후 제거해야 한다.
- Google Drive/GitHub/Firestore 관제 기능은 MYSCube `inner-platform` control plane에서 제공한다.

## 코드 위치

- Terraform: `infra/cloudflare`
- Vercel domain manifest 예시: `infra/cloudflare/vercel-apps.example.json`
- Vercel domain command planner: `scripts/cloudflare_vercel_domain_plan.mjs`

## Vercel Custom Domain 등록

예시 manifest를 실제 도메인으로 복사한다.

```bash
cp infra/cloudflare/vercel-apps.example.json infra/cloudflare/vercel-apps.production.json
```

명령 계획 확인:

```bash
node scripts/cloudflare_vercel_domain_plan.mjs infra/cloudflare/vercel-apps.production.json
```

실제 적용:

```bash
node scripts/cloudflare_vercel_domain_plan.mjs infra/cloudflare/vercel-apps.production.json --apply
```

## Cloudflare Terraform

```bash
cd infra/cloudflare
cp production.tfvars.example production.tfvars
terraform init
terraform plan -var-file=production.tfvars
terraform apply -var-file=production.tfvars
```

`terraform apply`는 gate 승인 전 금지다. 먼저 다음 로컬 guard가 실패하는 이유를 모두 제거한다.

```bash
npm run security:edge-gate
```

2026-06-19 local verification:

- Terraform `v1.15.6`
- Cloudflare provider `v5.20.0`
- `terraform fmt -check -recursive infra/cloudflare`: pass
- `terraform -chdir=infra/cloudflare validate`: pass
- `terraform -chdir=infra/cloudflare plan -var-file=production.tfvars`: pass with real zone id before final apply
- `terraform -chdir=infra/cloudflare apply -var-file=production.tfvars`: final proxy apply completed for the 7 `myscguard.app` hostnames
- `CLOUDFLARE_SECURITY_DOMAIN_POC=1 CLOUDFLARE_PRO_POC_COMPENSATING_CONTROLS=1 npm run security:edge-gate`: pass with accepted POC warnings
- `CLOUDFLARE_EDGE_REQUIRE_CLOUDFLARE=1 CLOUDFLARE_EDGE_REQUIRE_REDIRECTS=1 npm run security:edge-smoke`: required after Cloudflare DNS/proxy apply, direct-route updates, and route-version alias cleanup

## Vercel direct-origin 보상통제

현재 POC 예산에서는 Vercel Advanced Deployment Protection을 사용하지 않는다. 따라서 다음 보상통제를 같이 유지한다.

```bash
vercel routes export --scope merryai-devs-projects
vercel alias ls --scope merryai-devs-projects
vercel alias remove inner-platform-f52434-routes-merryai-devs-projects.vercel.app --yes --scope merryai-devs-projects
CLOUDFLARE_EDGE_REQUIRE_CLOUDFLARE=1 CLOUDFLARE_EDGE_REQUIRE_REDIRECTS=1 npm run security:edge-smoke
```

검증 기준:

- `inner-platform.vercel.app` -> `307 https://myscube.myscguard.app/...`
- `inner-platform-stage-merryai-devs-projects.vercel.app` -> `307 https://myscube.myscguard.app/...`
- `inner-platform-7lwazqaf6-merryai-devs-projects.vercel.app` -> `307 https://myscube.myscguard.app/...`
- `inner-platform-h799435np-merryai-devs-projects.vercel.app` -> `307 https://myscube.myscguard.app/...`
- `inner-platform-dsk6wdc3e-merryai-devs-projects.vercel.app` -> `307 https://myscube.myscguard.app/...`
- `inner-platform-gq6813nqh-merryai-devs-projects.vercel.app` -> `307 https://myscube.myscguard.app/...`
- `inner-platform-f52434-routes-merryai-devs-projects.vercel.app` -> `404` after route-version alias cleanup
- route-version alias -> `404 DEPLOYMENT_NOT_FOUND`

route-version alias는 Vercel routes publish 때 다시 생길 수 있다. route를 publish한 작업자는 alias removal과 smoke evidence 갱신까지 같은 change window 안에서 끝내야 한다.

## WAF 기본 정책 초안

- Cloudflare Managed Ruleset 실행
- Cloudflare OWASP Core Ruleset 실행
- browser-only privileged route managed challenge
- `/api`, `/__/auth`, `/__/firebase`는 browser challenge 대상에서 제외
- query string의 명백한 SQLi/XSS/path traversal probe block
- `/wp-admin`, `/phpmyadmin`, `/.env`, `/server-status` scanner path block
- login page: IP+colo 기준 60초 20회 초과 시 managed challenge
- API: smoke test와 false-positive review 후 별도 rate limit 적용

## 주의

- Firebase Auth redirect URI는 Cloudflare hostname 기준으로 다시 등록해야 한다.
- BFF `BFF_ALLOWED_ORIGINS`는 최종 Cloudflare hostname만 허용해야 한다.
- Vercel preview domain은 운영 BFF allowed origins에 넣지 않는다.
- Cloudflare SSL mode는 Flexible 금지. 운영은 Full (strict)를 기준으로 한다.
- DNS-only record는 WAF를 우회하므로 web traffic hostname은 proxied 상태여야 한다.
- direct `*.vercel.app`, `*.firebaseapp.com`, `*.web.app` 접근이 운영 경로로 남아 있으면 Cloudflare WAF 우회 경로로 간주한다.
- Cloudflare Pro-only POC에서는 direct `*.vercel.app` 접근을 완전 기술 차단했다고 보지 않는다. 대신 Vercel Standard Deployment Protection, 운영 링크 제거, BFF/Firebase origin 미허용, 로그 모니터링을 보상통제로 둔다.
- Pro에서 모든 production URL까지 기술적으로 보호하려면 Advanced Deployment Protection add-on 또는 Enterprise 기능 검토가 필요하지만, 이번 POC 예산에서는 제외한다.
