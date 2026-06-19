# Cloudflare/Vercel Production Gates

Status: `approved`

The Cloudflare/Vercel WAF work is approved for the dedicated `myscguard.app` security-domain POC final proxy cutover. This approval does not approve changing `mysc.co.kr`, replacing the MYSCube product domain, or enabling Enterprise-only controls without a separate review.

Budget decision: first POC is Cloudflare Pro plus a dedicated security/DevOps control-plane domain. Domain `myscguard.app` was registered through Cloudflare Registrar on 2026-06-19. See [Cloudflare Pro POC Budget](./cloudflare-pro-poc-budget.md).

## Blocking Gates

1. Authoritative Vercel inventory
   - Collect every Vercel project, domain, latest production deployment, preview deployment policy, and owning team.
   - Source command: `node scripts/collect_vercel_edge_inventory.mjs`.
   - Current draft evidence: [Vercel Edge Inventory Snapshot](./vercel-edge-inventory-2026-06-19.md).

2. Domain and origin table
   - For every app, document:
     - production domain
     - preview domain policy
     - Firebase auth domain
     - BFF allowed origin
     - Cloudflare hostname
     - Vercel custom-domain target
   - Current POC direction: use registered domain `myscguard.app` for security/DevOps control plane only.
   - Do not use `mysc.co.kr` in this POC.
   - Do not treat `myscguard.app` as the MYSCube product domain.

3. Direct origin bypass review
   - Confirm whether these remain operational paths:
     - `*.vercel.app`
     - `*.firebaseapp.com`
     - `*.web.app`
   - For the Cloudflare Pro-only POC, direct access is handled through documented compensating controls rather than Vercel Advanced Deployment Protection.
   - Direct access remains a finding if it is used as an approved production path, appears in live docs/bookmarks, is allowed by BFF CORS, or is authorized in Firebase Auth without explicit rollback approval.

4. Terraform verification
   - `terraform fmt -check -recursive infra/cloudflare`
   - `terraform init`
   - `terraform validate`
   - `terraform plan -var-file=production.tfvars`
   - Local verification on 2026-06-19: Terraform `v1.15.6`, Cloudflare provider `v5.20.0`, `fmt`, `validate`, and `plan -var-file=production.tfvars` pass.

5. Smoke test scenarios
   - Scenario document: [Cloudflare WAF Smoke Test Scenarios](./cloudflare-smoke-test-scenarios.md).
   - Login page loads without challenge loops.
   - Firebase redirect and popup auth complete through the Cloudflare hostname.
   - `/__/auth/*` and `/__/firebase/*` are not challenged.
   - BFF API returns JSON and is not interrupted by browser-only challenge pages.
   - Upload flows complete for expected file sizes.
   - Rate limiting triggers only under intentional abuse tests.
   - PWA manifest, service worker, icons, and camera permissions continue to pass.

6. WAF/SOC observability
   - Cloudflare Security Events, WAF blocks, managed challenges, rate-limit events, and DNS changes must land in an owned log destination.
   - MYSCube must show security findings or ingest normalized Cloudflare events.
   - Each high/critical event must have owner, severity, response SLA, escalation path, and retention period.

7. Explicit approval
   - Production apply requires named approver, rollback owner, rollback command, and cutover window.

## Security/DevOps Control Plane POC Values

| Field | Approved POC value | Current state |
|---|---|---|
| Project owner | `mwbyun1220@mysc.co.kr` / MYSC security and platform owner | Approved for POC ownership |
| Vercel project | `inner-platform` | Verified MYSCube production project |
| Vercel target URL | `inner-platform-gq6813nqh-merryai-devs-projects.vercel.app` | Current production deployment for the security-domain aliases |
| Primary hostname | `myscube.myscguard.app` | Canonical host selected; Cloudflare DNS/proxy apply completed; strict edge smoke passed |
| Drive monitoring hostname | `drive.myscguard.app` | Vercel custom domain registered; Cloudflare DNS proxied; strict edge smoke passed |
| GitHub monitoring hostname | `github.myscguard.app` | Vercel custom domain registered; Cloudflare DNS proxied; strict edge smoke passed |
| Firestore monitoring hostname | `firestore.myscguard.app` | Vercel custom domain registered; Cloudflare DNS proxied; strict edge smoke passed |
| BFF live allowed origin | `https://myscube.myscguard.app` | Code default updated |

Earlier `cube.mysc.co.kr` changes are not the selected POC route. Do not update production env to `cube.mysc.co.kr`.

Cloudflare zone id was copied from the Cloudflare dashboard on 2026-06-19 and written to local, git-ignored `infra/cloudflare/production.tfvars`.

Cloudflare zone id lookup command for future verification:

```bash
CLOUDFLARE_API_TOKEN=... npm run security:cloudflare:zone
```

## Known Blockers From Review

- `/api` and `/__/auth` were previously included in managed challenge scope. This would break API clients and Firebase auth helper redirects.
- Vercel project inventory shows 16 projects, but the earlier manifest covered only 6.
- `mysc-merry` was incorrect; current Vercel project appears to be `mysc-merry-inv`.
- `submit-mysc.com` is already present and appears associated with `inner-platform`; it is out of scope for the security-domain POC.
- `server/bff/runtime-safety.mjs` now defaults live allowed origins to `https://myscube.myscguard.app`; any legacy Vercel-origin exception must be explicit in `BFF_LIVE_ALLOWED_ORIGINS`.
- Existing Cloudflare rulesets, if any, need import/ownership planning before Terraform manages the zone entry-point rulesets.
- Direct Vercel generated deployment URLs use POC compensating controls only. Protecting all production URLs is out of scope for the USD 20/month POC and would require Vercel Advanced Deployment Protection or Enterprise.
- Actual Cloudflare zone id is configured locally in git-ignored `infra/cloudflare/production.tfvars`.
- Vercel custom domains were initially registered to the wrong `observability-devops` project, then reassigned on 2026-06-19 to the verified `inner-platform` production deployment. Current security-domain aliases point to `inner-platform-gq6813nqh-merryai-devs-projects.vercel.app`.
- DNS-only bootstrap was used for Vercel certificate issuance. Final Cloudflare proxy apply for the `myscube.myscguard.app` hostname set completed on 2026-06-19.
- `soc.myscguard.app` is retired as an app alias and now redirects at Cloudflare edge to `https://myscube.myscguard.app`.
- Managed WAF and Terraform-managed rate limits are intentionally disabled for the USD 20/month Cloudflare Pro POC because the account/zone did not accept the managed ruleset execution and already had/limited the rate-limit phase entrypoint. The active POC control is custom WAF plus Cloudflare DDoS/TLS/proxying.
- `CLOUDFLARE_EDGE_REQUIRE_CLOUDFLARE=1 CLOUDFLARE_EDGE_REQUIRE_REDIRECTS=1 npm run security:edge-smoke` passed after Cloudflare apply and Vercel route cleanup.
- Public DNS verification through `1.1.1.1` and `8.8.8.8` returns Cloudflare edge IPs for all 7 hostnames. The local ISP resolver `164.124.101.2` still returned stale `76.76.21.21` immediately after cutover, so smoke uses public resolver evidence instead of local resolver cache.
- WAF custom block evidence: `https://edge.myscguard.app/.env` and `https://edge.myscguard.app/?q=../` both return `403` when resolved through Cloudflare edge.
- Vercel project-level routes redirect these direct hosts to `https://myscube.myscguard.app`: `inner-platform.vercel.app`, `inner-platform-stage-merryai-devs-projects.vercel.app`, `inner-platform-7lwazqaf6-merryai-devs-projects.vercel.app`, `inner-platform-h799435np-merryai-devs-projects.vercel.app`, `inner-platform-dsk6wdc3e-merryai-devs-projects.vercel.app`, and `inner-platform-gq6813nqh-merryai-devs-projects.vercel.app`.
- Vercel creates a route-version alias whenever project-level routes are published. The latest route-version alias `inner-platform-f52434-routes-merryai-devs-projects.vercel.app` was removed after route publication and verified as `404` in strict edge smoke.
- GitHub Actions stage and production release workflows currently fail during the Vercel release step because the environment secret token is invalid. Local Vercel CLI authentication is valid, but its token is a short-lived session token and must not be copied into CI. Rotate `VERCEL_DEPLOY_TOKEN_PRODUCTION` and the stage release token with a long-lived Vercel API token before declaring CI deployment fully healthy.

## Production Apply Rule

Do not run:

```bash
terraform apply -var-file=production.tfvars
node scripts/cloudflare_vercel_domain_plan.mjs infra/cloudflare/vercel-apps.production.json --apply
```

until this file is `approved`, `npm run security:edge-gate` passes, and a fresh `npm run security:edge-smoke` evidence file exists.

The domain planner also refuses `--apply` unless this environment variable is set after approval:

```bash
CLOUDFLARE_EDGE_APPLY_APPROVED=1
```

Run the local guard before asking for approval:

```bash
npm run security:edge-gate
```

After explicit human approval for apply and after removing any Vercel route-version alias, run the guard with:

```bash
CLOUDFLARE_EDGE_APPLY_APPROVED=1 CLOUDFLARE_EDGE_REQUIRE_SMOKE=1 CLOUDFLARE_EDGE_REQUIRE_CLOUDFLARE=1 CLOUDFLARE_EDGE_REQUIRE_REDIRECTS=1 CLOUDFLARE_SECURITY_DOMAIN_POC=1 CLOUDFLARE_PRO_POC_COMPENSATING_CONTROLS=1 npm run security:edge-gate
```

For the Cloudflare Pro-only POC, direct Vercel routes can be assessed with compensating controls instead of hard failing the local guard:

```bash
CLOUDFLARE_PRO_POC_COMPENSATING_CONTROLS=1 npm run security:edge-gate
```

For the dedicated security-domain POC, product app inventory gaps are out of scope:

```bash
CLOUDFLARE_SECURITY_DOMAIN_POC=1 CLOUDFLARE_PRO_POC_COMPENSATING_CONTROLS=1 npm run security:edge-gate
```

This guard is intentionally conservative. It fails on `draft`, unresolved owner/origin placeholders, `example.com`, missing Terraform, and direct production `*.vercel.app` routes.
