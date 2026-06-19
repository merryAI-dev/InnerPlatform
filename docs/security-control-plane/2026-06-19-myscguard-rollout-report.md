# 2026-06-19 MYSCGuard Rollout Work Report

## Summary

Today we advanced the `myscguard.app` security-domain rollout for MYSCube from draft configuration toward a verified Cloudflare/Vercel control-plane setup.

The canonical security console host was changed from:

- `https://soc.myscguard.app`

to:

- `https://myscube.myscguard.app`

The repo was updated, tested, committed, pushed to `main`, deployed to Vercel, and the failing stage verification was stabilized by updating Vercel project-level routes.

## Completed Work

### Repository and runtime configuration

- Updated canonical live host references from `soc.myscguard.app` to `myscube.myscguard.app`.
- Updated `server/bff/runtime-safety.mjs` default live allowed origin to `https://myscube.myscguard.app`.
- Updated BFF/runtime tests, deploy alignment tests, stage/production workflow tests, Vercel redirect config, Cloudflare examples, and security-domain docs.
- Added a local-only credential template:
  - `.env.security.local`
  - This file is ignored by git through `.env*.local`.
- Confirmed gitignored local infra files remain untracked:
  - `.env.security.local`
  - `infra/cloudflare/production.tfvars`

### Vercel production configuration

- Updated Vercel Production env:
  - `BFF_ALLOWED_ORIGINS=https://myscube.myscguard.app`
- Created a new production deployment:
  - `inner-platform-m5g1l1ucp-merryai-devs-projects.vercel.app`
- Verified the deployment artifact returns `200` on the direct deployment URL.
- Attempted to assign `myscube.myscguard.app` as the Vercel canonical alias. The first attempt failed during certificate issuance before the Cloudflare DNS state was corrected.

### Vercel project-level routes

Stage failed once because project-level Vercel routes still redirected direct Vercel hosts to `https://soc.myscguard.app`.

Resolved by updating and publishing the three project-level routes:

- `inner-platform.vercel.app` -> `https://myscube.myscguard.app/$1`
- `inner-platform-stage-merryai-devs-projects.vercel.app` -> `https://myscube.myscguard.app/$1`
- `inner-platform-h799435np-merryai-devs-projects.vercel.app` -> `https://myscube.myscguard.app/$1`

After publishing, the route-version alias created by Vercel was removed:

- `inner-platform-f52434-routes-merryai-devs-projects.vercel.app`

### GitHub / CI / stage status

- Commit pushed to `main`:
  - `1fa2109 chore(edge): rename guard console host to myscube`
- CI run passed:
  - `https://github.com/merryAI-dev/MYSCube/actions/runs/27809537585`
- Stage Deploy initially failed at `Verify stage surface` due to stale project-level route destination.
- After route publish, the failed Stage job was rerun and passed:
  - `https://github.com/merryAI-dev/MYSCube/actions/runs/27809537572`

## Verification Evidence

Local checks completed before push:

- `npm test`
  - 250 test files passed
  - 1562 tests passed
  - 5 files / 59 tests skipped by existing test policy
- `npm run policy:verify`
  - passed
- `npm run build`
  - passed
  - existing large chunk and `lottie-web` eval warnings remain
- `terraform fmt -check -recursive infra/cloudflare`
  - passed
- `terraform -chdir=infra/cloudflare validate`
  - passed

Runtime checks observed:

- `inner-platform-m5g1l1ucp-merryai-devs-projects.vercel.app` returned `200`.
- `inner-platform-stage-merryai-devs-projects.vercel.app` redirects to `https://myscube.myscguard.app/...` after project-level route publish.
- `inner-platform.vercel.app` redirects to `https://myscube.myscguard.app/...` after project-level route publish.
- `inner-platform-h799435np-merryai-devs-projects.vercel.app` redirects to `https://myscube.myscguard.app/...` after project-level route publish.
- DNS lookup later showed both `myscube.myscguard.app` and `soc.myscguard.app` resolving to Cloudflare edge IPs.

## Current Known State

- `myscube.myscguard.app` is now the intended canonical security console host.
- `soc.myscguard.app` still resolves through Cloudflare and was observed returning `200` earlier in the work. It should be explicitly retired, redirected, or kept as a temporary rollback host by decision.
- Vercel project-level direct-origin redirects now point to `myscube`.
- The latest production deployment exists and is healthy on its generated Vercel URL.
- The Vercel custom alias/certificate status for `myscube.myscguard.app` still needs a fresh verification after Cloudflare DNS is confirmed stable.
- Cloudflare Terraform apply for the final `myscube` state was not completed in this work session.

## Security Notes

- A Cloudflare Global API Key was provided during the session. It was not committed to the repo.
- Because a Global API Key is broad and was pasted into the chat, rotate it after the rollout or replace it with a least-privilege Cloudflare API Token.
- Preferred Cloudflare token scope for this rollout:
  - Zone / Zone / Read
  - Zone / DNS / Edit
  - Zone / Rulesets / Edit if Terraform manages WAF/rulesets
- GitHub reported remaining Dependabot vulnerabilities on push:
  - 2 high
  - 2 moderate
  - These are separate from the hostname rollout and remain security backlog.

## Remaining Work To Reach 100-Point Verified State

1. Store Cloudflare credentials only in local ignored env or a secure secret manager.
2. Run Terraform plan with the real Cloudflare zone credentials.
3. Apply Cloudflare DNS/proxy state for `myscube.myscguard.app`.
4. Re-run Vercel alias assignment or verification for `myscube.myscguard.app`.
5. Verify HTTPS:
   - `https://myscube.myscguard.app/`
   - selected app paths
   - BFF/API unauthenticated behavior
   - Firebase auth helper paths
6. Run strict edge smoke:
   - `CLOUDFLARE_EDGE_REQUIRE_CLOUDFLARE=1`
   - `CLOUDFLARE_EDGE_REQUIRE_REDIRECTS=1`
7. Confirm Cloudflare response headers and WAF behavior.
8. Decide and implement `soc.myscguard.app` retirement behavior:
   - redirect to `myscube`, or
   - remove alias/DNS, or
   - document as rollback-only with expiry.
9. Update the security control-plane docs with final evidence paths and timestamps.
10. Address the remaining GitHub Dependabot vulnerabilities as a separate security-hardening task.

