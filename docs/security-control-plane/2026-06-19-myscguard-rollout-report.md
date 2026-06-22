# 2026-06-19 MYSCGuard Rollout Work Report

## Summary

`myscguard.app` security-domain POC was moved from draft/candidate state to an applied and verified Cloudflare/Vercel control-plane rollout.

Canonical security console:

- `https://myscube.myscguard.app`

Legacy hostname:

- `https://soc.myscguard.app` now redirects at Cloudflare edge to `https://myscube.myscguard.app`.
- The stale Vercel custom alias for `soc.myscguard.app` was removed, leaving Cloudflare redirect as the intended public behavior.

## Completed Work

### Cloudflare edge

- Imported existing `myscguard.app` Cloudflare DNS records, zone settings, and custom WAF ruleset into local Terraform state before apply.
- Applied Terraform with a plan limited to one addition:
  - `cloudflare_ruleset.legacy_redirects[0]`
  - `soc.myscguard.app` -> `https://myscube.myscguard.app`
- Confirmed no Terraform-managed resource was changed or destroyed during that apply.
- Verified Cloudflare-proxied DNS and HTTPS for:
  - `myscube.myscguard.app`
  - `devops.myscguard.app`
  - `drive.myscguard.app`
  - `github.myscguard.app`
  - `firestore.myscguard.app`
  - `audit.myscguard.app`
  - `edge.myscguard.app`

### Vercel

- Updated production BFF origin earlier in the rollout:
  - `BFF_ALLOWED_ORIGINS=https://myscube.myscguard.app`
- Set all security-domain Vercel aliases to the current production deployment:
  - primary `myscube.myscguard.app`: `inner-platform-k2x121b33-merryai-devs-projects.vercel.app`
  - secondary security subdomains: `inner-platform-gq6813nqh-merryai-devs-projects.vercel.app`
- Removed the stale Vercel alias:
  - `soc.myscguard.app`
- Added and published Vercel project-level direct-origin redirects for current production generated hosts. The stage alias is no longer part of this redirect set because internal/stage deploys must stay on the stage route:
  - `inner-platform.vercel.app`
  - `inner-platform-h799435np-merryai-devs-projects.vercel.app`
  - `inner-platform-dsk6wdc3e-merryai-devs-projects.vercel.app`
  - `inner-platform-gq6813nqh-merryai-devs-projects.vercel.app`
  - `inner-platform-k2x121b33-merryai-devs-projects.vercel.app`
- Removed the temporary Vercel route-version alias after route publish:
  - `inner-platform-f52434-routes-merryai-devs-projects.vercel.app`

### Repository hardening

- Added Terraform-managed legacy redirect support for retired hostnames.
- Extended strict edge smoke to verify:
  - Cloudflare-proxied hosts
  - scanner path/query blocking
  - `soc.myscguard.app` legacy redirect
  - Vercel direct-origin redirects/removal
- Updated production gate verification to accept either:
  - `CLOUDFLARE_API_TOKEN`, or
  - `CLOUDFLARE_API_KEY` plus `CLOUDFLARE_EMAIL`
- Removed vulnerable direct dependency `xlsx@0.18.5`.
- Replaced client-side XLSX parsing with the existing `exceljs` path.
- Restricted binary `.xls` upload support:
  - HTML-masked bank exports can still be parsed through the HTML parser.
  - General binary `.xls` is rejected and users should convert to CSV or XLSX.

## Verification Evidence

Passed:

- `terraform fmt -recursive infra/cloudflare`
- `terraform -chdir=infra/cloudflare validate`
- `terraform -chdir=infra/cloudflare plan -var-file=production.tfvars`
- `terraform -chdir=infra/cloudflare apply /tmp/myscguard.tfplan`
  - result: 1 added, 0 changed, 0 destroyed
- `npm run security:edge-smoke:strict`
  - 16/16 checks passed
  - evidence: `tmp/edge-smoke/cloudflare-edge-smoke.json`
- Approved production gate:
  - `CLOUDFLARE_EDGE_APPLY_APPROVED=1 CLOUDFLARE_EDGE_REQUIRE_SMOKE=1 CLOUDFLARE_EDGE_REQUIRE_CLOUDFLARE=1 CLOUDFLARE_EDGE_REQUIRE_REDIRECTS=1 CLOUDFLARE_SECURITY_DOMAIN_POC=1 CLOUDFLARE_PRO_POC_COMPENSATING_CONTROLS=1 npm run security:edge-gate`
- `npm run policy:verify`
- `npm run build`
- `npm test`
  - 250 test files passed
  - 1562 tests passed
  - 5 files / 59 tests skipped by existing policy
- `npm audit --audit-level=high`
  - passed after removing `xlsx`

Observed runtime checks:

- `https://myscube.myscguard.app/` returns `200` through Cloudflare.
- `https://soc.myscguard.app/some/path?x=1` returns `301` to `https://myscube.myscguard.app/some/path?x=1`.
- `https://edge.myscguard.app/.env` returns `403`.
- `https://edge.myscguard.app/?q=../` returns `403`.
- Current Vercel generated production hosts return `307` to `https://myscube.myscguard.app/`; internal stage hosts stay directly reachable for stage verification and must not be included in the production redirect set.
- Removed route-version alias returns `404` in strict edge smoke.

## Remaining Security Backlog

- Rotate the Cloudflare Global API Key that was pasted during rollout and replace it with a least-privilege API token.
- `npm audit` still reports moderate vulnerabilities through transitive dependencies:
  - `firebase-tools` / `@opentelemetry/core`
  - `firebase-admin` / Google client transitive `uuid`
  - `exceljs` transitive `uuid`
- Build still reports existing warnings:
  - `lottie-web` uses `eval`
  - several chunks exceed 500 kB
- Cloudflare Pro POC direct-origin bypass is controlled by Vercel project redirects, not Vercel Advanced Deployment Protection. This is accepted for the POC only and should be revisited before treating the setup as Enterprise-grade origin isolation.
- Product-app inventory still has owner/origin fields outside the security-domain POC scope. These should be closed before expanding the same pattern across all MYSC apps.

## Security Notes

- No Cloudflare or Vercel secret was committed to the repository.
- Local sensitive files remain gitignored:
  - `.env.security.local`
  - `infra/cloudflare/production.tfvars`
- The rollout intentionally avoids `mysc.co.kr`; `myscguard.app` is a dedicated security/DevOps control-plane domain.
