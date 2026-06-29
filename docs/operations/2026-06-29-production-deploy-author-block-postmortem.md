# Production Deploy Author Block Postmortem

Date: 2026-06-29
Status: closed

## Impact

The cashflow actual sync fix reached `main`, but production deployment took longer than expected. Several Vercel production deployments stayed in `BLOCKED` / `STAGED` state and did not move `https://myscube.myscguard.app`.

The live domain stayed on the previous Ready deployment until a later no-op release commit was deployed.

## Root Cause

Vercel blocks deployments when the git commit author is not a member of the Vercel team. The functional fix commit was authored by `jylee0926@mysc.co.kr`, which Vercel reported as not having access to `merryai-dev's projects`.

The workflow only discovered this after creating a Vercel deployment, so the run appeared to hang while the deployment was actually blocked.

## What Fixed It

A no-op release commit authored by `merryAI-dev <ai@mysc.co.kr>` was pushed to `main`, then the existing `Production Deploy` workflow completed successfully.

Successful production deployment:

- Commit: `c20fcee`
- Vercel deployment: `inner-platform-n9du2k194-merryai-devs-projects.vercel.app`
- Canonical URL: `https://myscube.myscguard.app`
- GitHub Actions run: `28349587470`

## Permanent Policy

Production deploys fail fast unless the HEAD commit author email is in `VERCEL_DEPLOY_ALLOWED_AUTHOR_EMAILS`.

Current allowlist:

- `ai@mysc.co.kr`

If a functional commit is authored by someone outside the Vercel team, add a no-op release commit authored by an allowed deploy identity before dispatching production.

## Verification

- `npm test` passed before deploy.
- `npm run build` passed before deploy.
- `myscube.myscguard.app` now resolves to the Ready deployment `inner-platform-n9du2k194-merryai-devs-projects.vercel.app`.
