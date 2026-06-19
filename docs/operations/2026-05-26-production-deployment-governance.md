# Production Deployment Governance

Date: 2026-05-26
Status: active policy

## Core Rule

Production must not be changed from a local dirty worktree.

Production deployment authority belongs to GitHub Actions running from `main` through the `Production` environment. Local machines may verify an existing deployment, but they must not create or promote a production deployment.

## URLs

| Kind | URL | Use |
| --- | --- | --- |
| Live canonical | `https://myscube.myscguard.app` | Security/DevOps control plane POC, smoke tests |
| Vercel deployment URL | `*.vercel.app` deployment host | Debugging a specific artifact only |
| Preview URL | Vercel random deployment URL | Artifact debugging only, not QA login |
| Stage URL | `https://inner-platform-stage-merryai-devs-projects.vercel.app` | Live rehearsal, Firebase Auth QA, never live evidence |

Do not treat a preview URL or a one-off deployment URL as the product status URL.
Because Firebase Auth only allows registered domains, do not share random Vercel preview URLs as Stage QA links. After each preview deployment, move the fixed Stage alias to the new deployment and share only the fixed Stage URL.

## Allowed Commands

Local verification is allowed:

```bash
node deploy-prod-align.mjs --verify-only <deployment-url-or-host>
```

Local production deployment is not allowed:

```bash
vercel deploy --prod
node deploy-prod-align.mjs
```

The second command intentionally fails closed.

## Rollback Policy

Rollback means moving the canonical live URL back to a known-good production deployment or reverting a future live manifest commit.

Rollback does not mean rebuilding or redeploying an old local checkout. Rebuilding old code can create a new artifact with unclear provenance and can reintroduce already-fixed UI, auth, or data behavior.

For each rollback, record:

- canonical URL
- selected deployment URL or manifest commit
- git SHA if available
- reason
- operator
- timestamp
- verification result

## GitHub Controls

Required target state:

- `main` is protected.
- direct push to `main` is disabled.
- required checks include CI `test-and-build`.
- production workflow uses `environment: Production`.
- production workflow verifies that the `CI` workflow succeeded for the exact `main` commit being deployed.
- production environment secrets are scoped to `Production`.
- production deployment is manual and records the deployment URL and git SHA.

Applied on 2026-05-26 in this branch:

- `.github/workflows/production-deploy.yml` checks that the exact `main` commit has a successful `CI` workflow before Vercel deploy starts.
- local production deploy commands fail closed; local verification is still available.
- BFF boot validates runtime safety before Firestore is initialized.
- stage/live BFF runtimes reject wildcard origins, Vercel preview origins in live, missing Firebase project IDs, live/non-live Firebase project mismatch, and live emulator usage.
- stage/live worker scheduler ownership must be explicit: `disabled` or `vercel` for the current Vercel-owned cron setup. `manual` is local-only.
- `BFF_SCHEDULER_OWNER=k8s` is blocked for stage/live until the Vercel cron definitions are removed or replaced by an audited scheduler cutover.
- Vercel-owned workers accept only `Authorization: Bearer $CRON_SECRET`; Kubernetes-owned workers accept `K8S_WORKER_SECRET`/`BFF_WORKER_SECRET`.
- Standalone worker CLI processes are blocked when workers are disabled or when Vercel owns the scheduler.
- Cloud Run defaults now deploy as stage/disabled workers, and Docker no longer defaults to wildcard origins.

Still required before using the workflow:

- Create a dedicated Vercel deploy token and set it as `VERCEL_DEPLOY_TOKEN_PRODUCTION` in the GitHub `Production` environment.
  Do not use a generic `VERCEL_TOKEN` secret for this workflow: GitHub Actions resolves environment secrets ahead of repository secrets when a job declares `environment: Production`, so changing only the repository secret can leave production deploys using a stale environment-scoped token.
- Keep `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` set in the GitHub `Production` environment.
- Keep production BFF environment variables in Vercel:
  - `BFF_DEPLOY_ENV=live`
  - `FIREBASE_PROJECT_ID=inner-platform-live-20260316`
  - `BFF_ALLOWED_ORIGINS=https://myscube.myscguard.app`
  - `BFF_SCHEDULER_OWNER=vercel` or `disabled`
  - 32+ char `CRON_SECRET` when Vercel crons are enabled.

Operational check on 2026-05-26:

- GitHub `Production` environment has `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.
- GitHub `Production` environment is missing `VERCEL_DEPLOY_TOKEN_PRODUCTION`.
- Vercel production environment contains `BFF_DEPLOY_ENV`, `FIREBASE_PROJECT_ID`, `BFF_ALLOWED_ORIGINS`, `BFF_SCHEDULER_OWNER`, and `CRON_SECRET`.

## Stage And Live Separation

Stage and live may eventually run the same artifact, but they must not share:

- Firebase project credentials
- write targets
- production secrets
- scheduler ownership
- canonical URLs

Required BFF environment contract:

| Variable | Local | Stage | Live |
| --- | --- | --- | --- |
| `BFF_DEPLOY_ENV` | `local` | `stage` | `live` |
| `FIREBASE_PROJECT_ID` | emulator or non-live project | stage project | `inner-platform-live-20260316` |
| `BFF_ALLOWED_ORIGINS` | localhost origins | explicit stage/preview origins | `https://myscube.myscguard.app` only |
| `BFF_WORKERS_ENABLED` | usually `false` | explicit | explicit |
| `BFF_SCHEDULER_OWNER` | `manual`, `disabled`, or local `k8s` testing | `disabled` or `vercel` until cron cutover | `disabled` or `vercel` until cron cutover |
| Worker secret | optional for disabled | 32+ chars if workers enabled | 32+ chars if workers enabled |

Live BFF must not accept a random Vercel preview deployment host as an allowed origin. Preview hosts are for PR/review artifacts, not product status.

## Kubernetes Path

Kubernetes is a rehearsal and runtime-governance path, not the immediate fix for stale local production deploys.

Initial Kubernetes work must be local-only:

- `DEPLOY_ENV=local`
- no live Firebase Admin credentials
- no live namespace
- no CronJobs
- BFF only
- port-forward access only

Move to stage/live Kubernetes only after GitHub production authority, environment contracts, and scheduler ownership are already enforced.
