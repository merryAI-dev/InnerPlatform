# Stage Deployment Governance

Date: 2026-06-18

## Decision

The stage canonical URL is fixed to:

`https://inner-platform-internal-stage-merryai-devs-projects.vercel.app`

Stage deployments must be promoted only by the GitHub Actions workflow:

`.github/workflows/stage-deploy.yml`

Local Vercel preview deployments must not be aliased to the stage canonical URL. Vercel may still classify the artifact as a non-production deployment internally, but promotion to the stage canonical URL is governed only by GitHub Actions and Git refs.

## Why

The stage URL previously pointed at a Vercel CLI preview artifact that was not reliably tied to the intended Git snapshot. That made the browser load an older cashflow UI and caused missing asset/API behavior such as 404 responses and HTML being returned for a CSS asset.

For a company-wide SaaS surface, stage must be reproducible from Git. A stage incident should be debugged by commit, workflow run, and Vercel deployment URL, not by an untracked local preview.

## Required Path

1. Merge the intended source to `main`.
2. Let `Stage Deploy` run automatically from `main`, or run it manually with `ref=main`.
3. The workflow checks out `main`, installs dependencies, runs policy/build/smoke gates, deploys to a Vercel preview artifact, and then aliases that artifact to the fixed stage host.

The workflow currently allows only `main` as the stage source ref. This keeps stage reproducible from the integration branch while production remains separated behind the production workflow and token.

The stage alias must stay on the internal stage host and must not pass through the `myscube.myscguard.app` security redirect path.

The stage surface check treats security-route symptoms as failures, not acceptable degraded states:

- Stage root must return `200`.
- Stage root must not include Cloudflare response markers such as `cf-ray` or `server: cloudflare`.
- Stage root must not receive security-domain `Content-Security-Policy-Report-Only` headers.
- Stage cashflow config API may return `200` or unauthenticated `401`; `403` is not accepted because it can mask an edge/security guard block.

## Required Secrets

The Stage environment or repository must define:

- `VERCEL_DEPLOY_TOKEN_STAGE`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Production keeps using its separate production-scoped token.

The stage token must live only in the GitHub `Stage` environment or repository secrets. Do not keep a local Vercel token with permission to alias the stage host; repository hooks can block committed scripts, but Vercel account permissions are the hard boundary.

## Local Guardrails

- `scripts/assert-safe-stage-deploy.mjs` fails outside GitHub Actions.
- `scripts/guard_stage_deploy_policy.mjs` blocks direct stage deploy/alias commands in ordinary staged or pushed files.
- `.husky/pre-commit` and `.husky/pre-push` run the stage policy guard.

## Rollback

To roll stage back, revert or restore the known-good source on `main`, then rerun `Stage Deploy`. Do not run `vercel alias set` locally for the stage host.

## Current Baseline

The recovered stage source baseline was rescued from `c70ff6e` on `rescue/cli-preview-stage-combined-20260618` and should be promoted through `main`.
# 폐기됨

이 문서는 과거 Stage 운영 기록입니다. Stage 배포 경로는 2026-08-01 폐기되었으며 아래 명령과 workflow를 실행하지 않습니다.
